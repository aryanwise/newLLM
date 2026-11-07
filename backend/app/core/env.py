"""Create a project-local Python environment and install its dependencies."""

import os
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile


class SandboxEnvironment:
    def __init__(self, project_dir: Path | str, *, timeout: float = 120) -> None:
        self.project_dir = Path(project_dir).resolve()
        self.venv_dir = self.project_dir / ".venv"
        python_path = "Scripts/python.exe" if os.name == "nt" else "bin/python"
        self.python_bin = self.venv_dir / python_path
        self.timeout = timeout

    def ensure_venv(self) -> Path:
        """Return the sandbox interpreter, creating it if needed."""
        config = self.venv_dir / "pyvenv.cfg"
        if self.python_bin.is_file() and config.is_file():
            return self.python_bin

        self.project_dir.mkdir(parents=True, exist_ok=True)
        uv = shutil.which("uv")
        if uv:
            command = [
                uv, "venv", "--allow-existing", "--python", sys.executable, str(self.venv_dir),
            ]
        else:
            base_python = str(Path(sys.executable).resolve())
            command = [base_python, "-I", "-m", "venv", str(self.venv_dir)]

        success, output = self._run(command)
        if not success:
            raise RuntimeError(f"Could not create {self.venv_dir}: {output}")
        if not self.python_bin.is_file() or not config.is_file():
            raise RuntimeError(f"Virtual environment was not created at {self.venv_dir}")
        return self.python_bin

    def install_dependencies(self, deps: list[str]) -> tuple[bool, str]:
        """Write requirements.txt and install it into the sandbox interpreter."""
        if any(not dep.strip() or any(char in dep for char in "\r\n\0") for dep in deps):
            return False, "Each dependency must be a nonempty line in requirements.txt."

        try:
            python_bin = str(self.ensure_venv())
            requirements = self.project_dir / "requirements.txt"
            self._write_requirements(requirements, deps)
        except (OSError, RuntimeError) as exc:
            return False, str(exc)

        uv = shutil.which("uv")
        if uv:
            return self._run([uv, "pip", "install", "-r", str(requirements), "--python", python_bin])

        # A previously created uv environment may not have pip seeded.
        pip = [python_bin, "-I", "-m", "pip"]
        success, _ = self._run([*pip, "--version"])
        bootstrap_output = ""
        if not success:
            success, bootstrap_output = self._run([python_bin, "-I", "-m", "ensurepip"])
            if not success:
                return False, bootstrap_output
        success, install_output = self._run([*pip, "install", "-r", str(requirements)])
        return success, bootstrap_output + install_output

    def _run(self, command: list[str]) -> tuple[bool, str]:
        try:
            result = subprocess.run(
                command,
                cwd=self.project_dir,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=self.timeout,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            output = (exc.output or b"").decode("utf-8", errors="replace")
            message = f"{Path(command[0]).name} timed out after {self.timeout:g} seconds."
            return False, f"{output}\n{message}".strip()
        except OSError as exc:
            return False, str(exc)
        return result.returncode == 0, result.stdout

    @staticmethod
    def _write_requirements(path: Path, deps: list[str]) -> None:
        # Publish the whole file together so readers never see a partial list.
        file = NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False)
        temporary = Path(file.name)
        try:
            with file:
                file.writelines(f"{dep}\n" for dep in deps)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
