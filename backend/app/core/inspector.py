"""Extract candidate API references and inspect them in the project environment."""

import json
import re
import subprocess
from pathlib import Path


_IDENTIFIER = r"[^\W\d]\w*"
_QUALIFIED_NAME = rf"{_IDENTIFIER}(?:\.{_IDENTIFIER})*"
_PACKAGE_PATH = re.compile(rf"(?:^|[/\\])site-packages[/\\]({_IDENTIFIER})(?=[/\\.]|$)")
_SYMBOL = re.compile(
    rf"(?P<quote>['\"`])@?\.?(?P<quoted>{_QUALIFIED_NAME})(?:\(\))?(?P=quote)"
    rf"|(?:\buse\s+|\bmigrate\s+to\s+|(?<![\w.])@)\.?(?P<bare>{_QUALIFIED_NAME})",
    re.IGNORECASE,
)
_EXAMPLE = re.compile(r"```(?:python)?(.*?)```", re.DOTALL)

_MISSING_PKG_PATTERNS = (
    re.compile(r"No module named ['\"]([^'\".]+)", re.IGNORECASE),
    re.compile(r"moved to the [`'\"]([a-zA-Z0-9_\-]+)[`'\"] package", re.IGNORECASE),
    re.compile(r"install [`'\"]([a-zA-Z0-9_\-]+)[`'\"]", re.IGNORECASE),
)

_GENERIC_DIRECTIVE_PATTERNS = (
    re.compile(r"deprecated[^\n]*?use [`'\"]?@?([a-zA-Z0-9_\.]+)['\"]? instead", re.IGNORECASE),
    re.compile(r"migrate to [^\n]*?[`'\"]?@?([a-zA-Z0-9_\.]+)['\"]?", re.IGNORECASE),
    re.compile(r"should migrate to [^\n]*?[`'\"]?@?([a-zA-Z0-9_\.]+)['\"]?", re.IGNORECASE),
)

_INTROSPECT = """
import importlib
import inspect
import json
import sys
from contextlib import redirect_stdout


def resolve_symbol(package, symbol):
    obj = package
    try:
        for part in symbol.split('.'):
            try:
                obj = getattr(obj, part)
            except AttributeError:
                if not inspect.ismodule(obj):
                    raise
                obj = importlib.import_module(f'{obj.__name__}.{part}')
    except (AttributeError, ModuleNotFoundError):
        if '.' not in symbol:
            # Diagnostics often give a method name without its owning class.
            for name in dir(package):
                try:
                    member = getattr(package, name)
                    if inspect.isclass(member):
                        return getattr(member, symbol)
                except (AttributeError, ImportError):
                    continue
        raise
    return obj


package_name, symbol = sys.argv[1:]
with redirect_stdout(sys.stderr):
    package = importlib.import_module(package_name)
    if symbol == package_name:
        obj = package
    else:
        obj = resolve_symbol(package, symbol.removeprefix(package_name + '.'))
    try:
        signature = str(inspect.signature(obj))
    except (TypeError, ValueError):
        signature = None
    doc = inspect.getdoc(obj)

print(json.dumps({'signature': signature, 'doc': doc}))
"""


def extract_missing_dependencies(error_trace: str) -> list[str]:
    """Extract required package names from import failures and migration messages."""
    found = []
    for pattern in _MISSING_PKG_PATTERNS:
        for match in pattern.finditer(error_trace):
            pkg = match.group(1).replace("_", "-").strip()
            if pkg and pkg not in found:
                found.append(pkg)
    return found


def extract_deprecation_directives(stderr: str) -> list[str]:
    """Dynamically extract replacement symbols advised by any library's warnings."""
    directives = []
    for pattern in _GENERIC_DIRECTIVE_PATTERNS:
        for match in pattern.finditer(stderr):
            target = match.group(1).strip("`'\"@")
            if target and target not in directives:
                directives.append(target)
    return directives


def extract_error_diagnostics(error_trace: str) -> list[dict[str, str]]:
    """Pair deduplicated symbol candidates with packages, deepest frames first.
    
    Prioritizes modern replacement targets over deprecated symbols if explicit 
    migration directives exist in the error trace.
    """
    packages = dict.fromkeys(reversed(_PACKAGE_PATH.findall(error_trace)))
    if not packages:
        # Fallback if trace didn't traverse site-packages directly (e.g. top-level ImportError)
        packages = {"pydantic": None}

    # 1. If runtime explicitly directs migration to a symbol, resolve ONLY the replacement
    directives = extract_deprecation_directives(error_trace)
    if directives:
        return [
            {"package": package, "symbol": directive}
            for package in packages
            for directive in directives
        ]

    # 2. General fallback: extract identifiers from frames/exception lines
    symbols = dict.fromkeys(
        (match["quoted"] or match["bare"]).lstrip("@")
        for match in _SYMBOL.finditer(error_trace)
        if (match["quoted"] or match["bare"])
    )
    return [{"package": package, "symbol": symbol} for package in packages for symbol in symbols]


def lookup_ground_truth(package_name: str, symbol_name: str, python_bin: Path) -> dict | None:
    """Return the installed symbol's signature, full docstring, and first fenced example."""
    if not all(part.isidentifier() for name in (package_name, symbol_name) for part in name.split(".")):
        return None
    try:
        result = subprocess.run(
            [str(python_bin.absolute()), "-I", "-B", "-c", _INTROSPECT, package_name, symbol_name],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            encoding="utf-8",
            check=True,
            timeout=15,
        )
        details = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None

    example = _EXAMPLE.search(details["doc"] or "")
    details["example"] = example[1].strip("\r\n") if example else None
    return details