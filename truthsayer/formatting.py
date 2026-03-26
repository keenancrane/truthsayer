"""Shared Rich formatting helpers and style constants."""

import math

from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.style import Style
from rich.text import Text
from rich.tree import Tree

# ── Style palette ────────────────────────────────────────────

STYLE_SECTION = Style(color="magenta", bold=True)
STYLE_INDEX = Style(color="cyan")
STYLE_NAME = Style(color="yellow")
STYLE_TYPE = Style(color="green")
STYLE_VALUE = Style(color="white")
STYLE_DIM = Style(dim=True)
STYLE_LABEL = Style(color="white", dim=True)
STYLE_KEYWORD = Style(color="bright_blue", bold=True)
STYLE_WARN = Style(color="red")
STYLE_NONE = Style(color="white", dim=True, italic=True)


# ── Formatting functions ─────────────────────────────────────

def human_size(num_bytes: int) -> str:
    if num_bytes == 0:
        return "0 B"
    units = ("B", "KB", "MB", "GB", "TB")
    exponent = min(int(math.log(num_bytes, 1024)), len(units) - 1)
    value = num_bytes / (1024 ** exponent)
    if exponent == 0:
        return f"{num_bytes} B"
    return f"{value:.2f} {units[exponent]}"


def index_name(idx: int, name: str | None, prefix: str = "") -> Text:
    """Format an indexed object as '0: \"MyName\"' or '0: (unnamed)'."""
    t = Text()
    if prefix:
        t.append(prefix + " ", style=STYLE_DIM)
    t.append(str(idx), style=STYLE_INDEX)
    if name:
        t.append(": ", style=STYLE_DIM)
        t.append(f"\"{name}\"", style=STYLE_NAME)
    return t


def label_value(label: str, value, style=None) -> Text:
    """Format a 'Label  value' pair with dot-leader alignment."""
    t = Text()
    padded = label.ljust(24, " ")
    t.append(padded, style=STYLE_LABEL)
    if value is None or value == "" or value == []:
        t.append("—", style=STYLE_NONE)
    else:
        t.append(str(value), style=style or STYLE_VALUE)
    return t


def section_rule(console: Console, title: str):
    """Print a styled section divider."""
    console.print()
    console.print(Rule(title=title, style="magenta", align="left"))


def none_text(value: str = "—") -> Text:
    return Text(value, style=STYLE_NONE)


def tag(value: str, style=None) -> Text:
    return Text(value, style=style or STYLE_TYPE)


def ref(prefix: str, idx: int | None) -> Text:
    """Format a cross-reference like 'Texture 2'."""
    t = Text()
    if idx is None:
        t.append("—", style=STYLE_NONE)
    else:
        t.append(f"{prefix} ", style=STYLE_DIM)
        t.append(str(idx), style=STYLE_INDEX)
    return t


def format_range(mn, mx) -> str:
    """Format accessor min/max as a compact range string."""
    if mn is None and mx is None:
        return "—"
    def _fmt(v):
        if isinstance(v, list):
            return "[" + ", ".join(f"{x:.4g}" if isinstance(x, float) else str(x) for x in v) + "]"
        if isinstance(v, float):
            return f"{v:.4g}"
        return str(v)
    return f"{_fmt(mn)} → {_fmt(mx)}"


def format_vector(v) -> str:
    """Format a short numeric list compactly."""
    if v is None or v == []:
        return "—"
    if isinstance(v, list):
        return "[" + ", ".join(f"{x:.4g}" if isinstance(x, float) else str(x) for x in v) + "]"
    return str(v)


def format_matrix_4x4(m) -> str:
    """Format a 16-element list as a compact 4x4 matrix indicator."""
    if not m or len(m) != 16:
        return "—"
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    if all(abs(a - b) < 1e-6 for a, b in zip(m, identity)):
        return "(identity)"
    rows = []
    for r in range(4):
        row = m[r * 4:(r + 1) * 4]
        rows.append("[" + ", ".join(f"{x:.4g}" for x in row) + "]")
    return "\n".join(rows)


def make_tree(label) -> Tree:
    """Create a Rich Tree with our preferred guide style."""
    return Tree(label, guide_style="dim")


def add_prop(tree: Tree, label: str, value, style=None) -> Tree:
    """Add a property leaf to a tree node."""
    return tree.add(label_value(label, value, style=style))


def empty_notice(console: Console, msg: str = "(none)"):
    """Print a dim notice for empty sections."""
    console.print(Text(f"  {msg}", style=STYLE_DIM))
