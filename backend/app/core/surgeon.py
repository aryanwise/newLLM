"""Select and replace Python syntax using Tree-sitter byte ranges."""

from tree_sitter import Language, Parser
from tree_sitter_python import language


_PYTHON = Language(language())


def find_node_at_line(source_code: str, line_number: int) -> dict:
    """Find the most deeply nested statement or definition on a one-based line.

    A decorator line selects the decorated definition so the repair can change
    the decorator and the definition it wraps. Equally nested nodes are selected
    in source order. Returned points are zero-based.
    """
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
        if node.type == "ERROR" or node.type.endswith(("_definition", "_statement", "_clause")):
            candidates.append((node, depth))
        if node.type != "decorator":
            pending.extend((child, depth + 1) for child in node.named_children)

    if not candidates:
        raise ValueError(f"No Python syntax node at line {line_number}.")
    node, _ = min(candidates, key=lambda item: (-item[1], item[0].start_byte))
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
