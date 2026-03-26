"""CLI entry point and orchestration for truthsayer."""

import argparse
import os
import sys

from rich.console import Console

from truthsayer import __version__
from truthsayer.sections import (
    render_overview,
    render_scene_graph,
    render_meshes,
    render_materials,
    render_textures,
    render_animations,
    render_skins,
    render_cameras,
    render_buffers,
    render_extensions,
)

ALL_SECTIONS = [
    "overview",
    "scene",
    "meshes",
    "materials",
    "textures",
    "animations",
    "skins",
    "cameras",
    "buffers",
    "extensions",
]

SECTION_RENDERERS = {
    "overview": render_overview,
    "scene": render_scene_graph,
    "meshes": render_meshes,
    "materials": render_materials,
    "textures": render_textures,
    "animations": render_animations,
    "skins": render_skins,
    "cameras": render_cameras,
    "buffers": render_buffers,
    "extensions": render_extensions,
}


def parse_section_list(raw: str) -> list[str]:
    parts = [s.strip().lower() for s in raw.split(",") if s.strip()]
    for p in parts:
        if p not in ALL_SECTIONS:
            print(f"Unknown section: '{p}'", file=sys.stderr)
            print(f"Valid sections: {', '.join(ALL_SECTIONS)}", file=sys.stderr)
            sys.exit(1)
    return parts


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="truthsayer",
        description="Inspect glTF/GLB files with beautiful terminal output.",
    )
    p.add_argument(
        "file",
        help="Path to a .glb or .gltf file",
    )
    p.add_argument(
        "--only",
        metavar="SECTIONS",
        help=f"Comma-separated sections to show ({', '.join(ALL_SECTIONS)})",
    )
    p.add_argument(
        "--exclude",
        metavar="SECTIONS",
        help="Comma-separated sections to hide",
    )
    p.add_argument(
        "--no-color",
        action="store_true",
        help="Disable color output",
    )
    p.add_argument(
        "--compact",
        action="store_true",
        help="Skip empty sections and default-valued fields",
    )
    p.add_argument(
        "--version",
        action="version",
        version=f"truthsayer {__version__}",
    )
    return p


def resolve_sections(args) -> list[str]:
    if args.only:
        return parse_section_list(args.only)
    sections = list(ALL_SECTIONS)
    if args.exclude:
        excluded = parse_section_list(args.exclude)
        sections = [s for s in sections if s not in excluded]
    return sections


def main():
    parser = build_parser()
    args = parser.parse_args()

    filepath = args.file
    if not os.path.isfile(filepath):
        print(f"File not found: {filepath}", file=sys.stderr)
        sys.exit(1)

    console = Console(no_color=args.no_color, highlight=False)

    try:
        from pygltflib import GLTF2
        gltf = GLTF2().load(filepath)
    except Exception as e:
        console.print(f"[red bold]Error loading file:[/] {e}")
        sys.exit(1)

    file_size = os.path.getsize(filepath)
    sections = resolve_sections(args)
    compact = args.compact

    # Banner
    console.print()
    console.print(
        "  [bold magenta]TRUTHSAYER[/] [dim]— glTF / GLB Inspector[/]",
    )

    for section_name in sections:
        renderer = SECTION_RENDERERS[section_name]
        renderer(gltf, console, filepath=filepath, file_size=file_size, compact=compact)

    console.print()
