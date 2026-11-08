"""Select and replace Python syntax using Tree-sitter byte ranges."""

from tree_sitter import Language, Parser
from tree_sitter_python import language
import ast
import importlib
import re


_PYTHON = Language(language())


def find_node_at_line(source_code: str, line_number: int) -> dict:
    """Find the statement or definition on a one-based line."""
    source_bytes = source_code.encode("utf-8")
    row = line_number - 1
    lines = source_bytes.split(b"\n")
    if not 0 <= row < len(lines) or not lines[row].strip():
        raise ValueError(f"No Python syntax node at line {line_number}.")

    root = Parser(_PYTHON).parse(source_bytes).root_node
    pending = [(root, 0)]
    candidates = []
    while pending:
        node, depth = pending.pop()
        end = node.end_point
        if not node.start_point.row <= row <= end.row or (row == end.row and end.column == 0):
            continue
        # Only select complete statements or definitions; never sub-expression clauses
        if node.type == "ERROR" or node.type.endswith(("_definition", "_statement")):
            candidates.append((node, depth))
        if node.type != "decorator":
            pending.extend((child, depth + 1) for child in node.named_children)

    if not candidates:
        raise ValueError(f"No Python syntax node at line {line_number}.")
    node, _ = min(candidates, key=lambda item: (-item[1], item[0].start_byte))

    # If the candidate sits inside a nested inner class (e.g. `class Config:`),
    # expand the slice to the inner class definition so the entire block refactors cleanly.
    current = node
    while current.parent is not None:
        if (
            current.type == "class_definition"
            and current.parent.type == "block"
            and current.parent.parent is not None
            and current.parent.parent.type == "class_definition"
        ):
            node = current
            break
        current = current.parent

    return {
        "node_type": node.type,
        "start_byte": node.start_byte,
        "end_byte": node.end_byte,
        "start_point": node.start_point,
        "end_point": node.end_point,
        "source_slice": source_bytes[node.start_byte:node.end_byte].decode("utf-8"),
    }


def module_imports(source_code: str) -> str:
    """Return top-level import statements as read-only context for node repair."""
    source_bytes = source_code.encode("utf-8")
    root = Parser(_PYTHON).parse(source_bytes).root_node
    return "\n".join(
        source_bytes[node.start_byte:node.end_byte].decode("utf-8")
        for node in root.named_children
        if node.type in {"import_statement", "import_from_statement", "future_import_statement"}
    )


def splice_replacement(source_code: str, start_byte: int, end_byte: int, replacement_code: str) -> str:
    """Replace an end-exclusive UTF-8 byte range without touching adjacent bytes."""
    source_bytes = source_code.encode("utf-8")
    if not 0 <= start_byte <= end_byte <= len(source_bytes):
        raise ValueError("Replacement range is outside the source or reversed.")
    if any(
        offset < len(source_bytes) and 0x80 <= source_bytes[offset] <= 0xBF
        for offset in (start_byte, end_byte)
    ):
        raise ValueError("Replacement range must start and end on UTF-8 character boundaries.")

    replacement_bytes = replacement_code.encode("utf-8")
    return (source_bytes[:start_byte] + replacement_bytes + source_bytes[end_byte:]).decode("utf-8")

def reconcile_imports(source: str, package: str, symbol: str) -> str:
    """Ensure a symbol is imported from `package` in `source`.
    
    If `from package import ...` exists, appends `symbol` if missing.
    If no import exists, prepends `from package import symbol`.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source

    # Check if symbol is already imported
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == package:
            names = [alias.name for alias in node.names]
            if symbol in names:
                return source  # Already present
            
            # Find the line of this import in source and inject the symbol
            pattern = rf"(from\s+{re.escape(package)}\s+import\s+)([^\n]+)"
            match = re.search(pattern, source)
            if match:
                prefix = match.group(1)
                existing = match.group(2).strip()
                replacement = f"{prefix}{existing}, {symbol}"
                return source[:match.start()] + replacement + source[match.end():]

    # If no `from package import ...` exists, prepend it
    return f"from {package} import {symbol}\n{source}"

def harmonize_imports(source: str, replacement_code: str, target_package: str) -> str:
    """Ensure newly referenced symbols belonging to target_package are imported.
    
    Verifies against the package's actual namespace to prevent importing local 
    variables, parameters, or comprehension targets (e.g. 'v', 'cls', 'tag').
    """
    try:
        rep_tree = ast.parse(replacement_code)
        src_tree = ast.parse(source)
    except SyntaxError:
        return source

    # Try to load target package namespace to verify real exportable members
    try:
        pkg_mod = importlib.import_module(target_package)
        valid_package_symbols = set(dir(pkg_mod))
    except Exception:
        valid_package_symbols = None

    # Collect identifiers used in the replacement
    used_names = {node.id for node in ast.walk(rep_tree) if isinstance(node, ast.Name)}

    # Filter out anything that is definitely NOT an export of target_package
    if valid_package_symbols is not None:
        used_names = {name for name in used_names if name in valid_package_symbols}

    for node in ast.walk(src_tree):
        if isinstance(node, ast.ImportFrom) and node.module == target_package:
            existing_imported = {alias.name for alias in node.names}
            missing = used_names - existing_imported

            if missing:
                pattern = rf"(from\s+{re.escape(target_package)}\s+import\s+)([^\n]+)"
                match = re.search(pattern, source)
                if match:
                    prefix, existing = match.group(1), match.group(2).strip()
                    new_import = f"{prefix}{existing}, {', '.join(sorted(missing))}"
                    return source[:match.start()] + new_import + source[match.end():]

    return source