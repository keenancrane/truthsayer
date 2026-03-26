"""Section renderers for truthsayer.

Each render_* function takes (gltf, console, **kwargs) and prints its section
to the console.  The kwargs always include filepath, file_size, and compact.
"""

from __future__ import annotations

import os
from typing import Any

from pygltflib import GLTF2
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.tree import Tree

from truthsayer.constants import (
    COMPONENT_TYPE,
    PRIMITIVE_MODE,
    BUFFER_VIEW_TARGET,
    SAMPLER_MAG_FILTER,
    SAMPLER_MIN_FILTER,
    SAMPLER_WRAP,
    COMPONENT_TYPE_SIZE,
    ACCESSOR_TYPE_COUNT,
)
from truthsayer.formatting import (
    STYLE_SECTION,
    STYLE_INDEX,
    STYLE_NAME,
    STYLE_TYPE,
    STYLE_VALUE,
    STYLE_DIM,
    STYLE_LABEL,
    STYLE_NONE,
    STYLE_KEYWORD,
    human_size,
    index_name,
    label_value,
    section_rule,
    none_text,
    tag,
    ref,
    format_range,
    format_vector,
    format_matrix_4x4,
    make_tree,
    add_prop,
    empty_notice,
)


# ═══════════════════════════════════════════════════════════════
#  1. Overview
# ═══════════════════════════════════════════════════════════════

def render_overview(gltf: GLTF2, console: Console, **kw):
    filepath: str = kw["filepath"]
    file_size: int = kw["file_size"]

    ext = os.path.splitext(filepath)[1].lower()
    fmt = "GLB (Binary)" if ext == ".glb" else "GLTF (JSON)"

    asset = gltf.asset
    version = getattr(asset, "version", None) or "—"
    generator = getattr(asset, "generator", None)
    copyright_ = getattr(asset, "copyright", None)
    min_ver = getattr(asset, "minVersion", None)

    lines = Text()

    def _add(lbl, val):
        lines.append(f"  {lbl:<20}", style=STYLE_LABEL)
        if val:
            lines.append(str(val), style=STYLE_VALUE)
        else:
            lines.append("—", style=STYLE_NONE)
        lines.append("\n")

    _add("File", os.path.basename(filepath))
    _add("Format", fmt)
    _add("Size", human_size(file_size))
    _add("glTF Version", version)
    _add("Generator", generator)
    _add("Copyright", copyright_)
    _add("Min Version", min_ver)

    lines.append("\n")

    counts = [
        ("Scenes", len(gltf.scenes)),
        ("Nodes", len(gltf.nodes)),
        ("Meshes", len(gltf.meshes)),
        ("Materials", len(gltf.materials)),
        ("Textures", len(gltf.textures)),
        ("Images", len(gltf.images)),
        ("Animations", len(gltf.animations)),
        ("Skins", len(gltf.skins)),
        ("Cameras", len(gltf.cameras)),
        ("Buffers", len(gltf.buffers)),
        ("Buffer Views", len(gltf.bufferViews)),
        ("Accessors", len(gltf.accessors)),
    ]

    row = []
    for i, (name, count) in enumerate(counts):
        cell = Text()
        cell.append(f"  {name} ", style=STYLE_LABEL)
        dots = "·" * (14 - len(name))
        cell.append(dots + " ", style=STYLE_DIM)
        cell.append(f"{count:>3}", style=STYLE_VALUE)
        row.append(cell)
        if (i + 1) % 3 == 0:
            combined = Text()
            for c in row:
                combined.append_text(c)
            combined.append("\n")
            lines.append_text(combined)
            row = []
    if row:
        combined = Text()
        for c in row:
            combined.append_text(c)
        combined.append("\n")
        lines.append_text(combined)

    ext_used = getattr(gltf, "extensionsUsed", None) or []
    ext_req = getattr(gltf, "extensionsRequired", None) or []
    if ext_used or ext_req:
        lines.append("\n")
        if ext_used:
            lines.append("  Extensions Used     ", style=STYLE_LABEL)
            lines.append(", ".join(ext_used), style=STYLE_TYPE)
            lines.append("\n")
        if ext_req:
            lines.append("  Extensions Required ", style=STYLE_LABEL)
            lines.append(", ".join(ext_req), style=STYLE_TYPE)
            lines.append("\n")

    panel = Panel(
        lines,
        title="[magenta bold]File Overview[/]",
        title_align="left",
        border_style="magenta",
        padding=(0, 1),
    )
    console.print()
    console.print(panel)


# ═══════════════════════════════════════════════════════════════
#  2. Scene Graph
# ═══════════════════════════════════════════════════════════════

def _node_label(gltf: GLTF2, idx: int) -> Text:
    node = gltf.nodes[idx]
    t = Text()
    t.append("Node ", style=STYLE_DIM)
    t.append(str(idx), style=STYLE_INDEX)
    if node.name:
        t.append(f": \"{node.name}\"", style=STYLE_NAME)
    if node.mesh is not None:
        mesh = gltf.meshes[node.mesh]
        t.append(" ⯈ ", style=STYLE_DIM)
        t.append("Mesh ", style=STYLE_DIM)
        t.append(str(node.mesh), style=STYLE_INDEX)
        if mesh.name:
            t.append(f" \"{mesh.name}\"", style=STYLE_NAME)
    if node.camera is not None:
        t.append(" ◎ ", style=STYLE_DIM)
        t.append("Camera ", style=STYLE_DIM)
        t.append(str(node.camera), style=STYLE_INDEX)
    if node.skin is not None:
        t.append(" ◈ ", style=STYLE_DIM)
        t.append("Skin ", style=STYLE_DIM)
        t.append(str(node.skin), style=STYLE_INDEX)
    return t


def _add_transform(tree: Tree, node):
    t = node.translation
    r = node.rotation
    s = node.scale
    m = node.matrix

    if m and len(m) == 16:
        identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        if not all(abs(a - b) < 1e-6 for a, b in zip(m, identity)):
            txt = Text()
            txt.append("⊞ matrix ", style=STYLE_DIM)
            txt.append(format_matrix_4x4(m), style=STYLE_VALUE)
            tree.add(txt)
        return

    if t and len(t) == 3 and not all(abs(v) < 1e-6 for v in t):
        txt = Text()
        txt.append("↹ translation ", style=STYLE_DIM)
        txt.append(format_vector(t), style=STYLE_VALUE)
        tree.add(txt)
    if r and len(r) == 4 and not (abs(r[0]) < 1e-6 and abs(r[1]) < 1e-6 and abs(r[2]) < 1e-6 and abs(r[3] - 1.0) < 1e-6):
        txt = Text()
        txt.append("↻ rotation    ", style=STYLE_DIM)
        txt.append(format_vector(r), style=STYLE_VALUE)
        tree.add(txt)
    if s and len(s) == 3 and not all(abs(v - 1.0) < 1e-6 for v in s):
        txt = Text()
        txt.append("⇔ scale       ", style=STYLE_DIM)
        txt.append(format_vector(s), style=STYLE_VALUE)
        tree.add(txt)


def _build_node_tree(gltf: GLTF2, parent_tree: Tree, node_idx: int):
    node = gltf.nodes[node_idx]
    subtree = parent_tree.add(_node_label(gltf, node_idx))
    _add_transform(subtree, node)
    children = node.children or []
    for child_idx in children:
        _build_node_tree(gltf, subtree, child_idx)


def render_scene_graph(gltf: GLTF2, console: Console, **kw):
    compact = kw.get("compact", False)
    if compact and not gltf.scenes:
        return
    section_rule(console, "Scene Graph")
    if not gltf.scenes:
        empty_notice(console, "(no scenes)")
        return

    for si, scene in enumerate(gltf.scenes):
        lbl = Text()
        lbl.append("Scene ", style=STYLE_DIM)
        lbl.append(str(si), style=STYLE_INDEX)
        if scene.name:
            lbl.append(f": \"{scene.name}\"", style=STYLE_NAME)
        if gltf.scene is not None and si == gltf.scene:
            lbl.append(" ★ default", style=STYLE_KEYWORD)

        tree = make_tree(lbl)
        for node_idx in (scene.nodes or []):
            _build_node_tree(gltf, tree, node_idx)

        console.print(tree)


# ═══════════════════════════════════════════════════════════════
#  3. Meshes
# ═══════════════════════════════════════════════════════════════

def _accessor_summary(gltf: GLTF2, acc_idx: int | None, show_range: bool = False) -> Text:
    t = Text()
    if acc_idx is None:
        t.append("—", style=STYLE_NONE)
        return t
    acc = gltf.accessors[acc_idx]
    t.append("Accessor ", style=STYLE_DIM)
    t.append(str(acc_idx), style=STYLE_INDEX)
    t.append("  ", style=STYLE_DIM)
    t.append(acc.type or "?", style=STYLE_TYPE)
    t.append(" × ", style=STYLE_DIM)
    t.append(COMPONENT_TYPE.get(acc.componentType, str(acc.componentType)), style=STYLE_TYPE)
    if show_range and (acc.min is not None or acc.max is not None):
        t.append("  ", style=STYLE_DIM)
        t.append(format_range(acc.min, acc.max), style=STYLE_VALUE)
    return t


def render_meshes(gltf: GLTF2, console: Console, **kw):
    compact = kw.get("compact", False)
    if compact and not gltf.meshes:
        return
    section_rule(console, "Meshes")
    if not gltf.meshes:
        empty_notice(console)
        return

    for mi, mesh in enumerate(gltf.meshes):
        mesh_tree = make_tree(index_name(mi, mesh.name, prefix="Mesh"))

        for pi, prim in enumerate(mesh.primitives):
            mode_name = PRIMITIVE_MODE.get(prim.mode, PRIMITIVE_MODE.get(4, "TRIANGLES")) if prim.mode is not None else "TRIANGLES"

            prim_lbl = Text()
            prim_lbl.append(f"Primitive {pi}", style=STYLE_DIM)
            prim_lbl.append(" ▸ ", style=STYLE_DIM)
            prim_lbl.append(mode_name, style=STYLE_TYPE)

            if prim.material is not None:
                mat = gltf.materials[prim.material] if prim.material < len(gltf.materials) else None
                prim_lbl.append(" ▸ ", style=STYLE_DIM)
                prim_lbl.append("Material ", style=STYLE_DIM)
                prim_lbl.append(str(prim.material), style=STYLE_INDEX)
                if mat and mat.name:
                    prim_lbl.append(f" \"{mat.name}\"", style=STYLE_NAME)

            # Vertex count from POSITION accessor
            pos_idx = getattr(prim.attributes, "POSITION", None)
            if pos_idx is not None and pos_idx < len(gltf.accessors):
                count = gltf.accessors[pos_idx].count
                prim_lbl.append(" ▸ ", style=STYLE_DIM)
                prim_lbl.append(f"{count:,} vertices", style=STYLE_VALUE)

            prim_tree = mesh_tree.add(prim_lbl)

            # Attributes
            attrs = prim.attributes
            attr_names = [
                "POSITION", "NORMAL", "TANGENT",
                "TEXCOORD_0", "TEXCOORD_1",
                "COLOR_0", "JOINTS_0", "WEIGHTS_0",
            ]
            for attr_name in attr_names:
                acc_idx = getattr(attrs, attr_name, None)
                if acc_idx is not None:
                    show_range = attr_name == "POSITION"
                    row = Text()
                    row.append(f"{attr_name:<14}", style=STYLE_KEYWORD)
                    row.append_text(_accessor_summary(gltf, acc_idx, show_range=show_range))
                    prim_tree.add(row)

            # Custom attributes (start with _)
            for attr_name in dir(attrs):
                if attr_name.startswith("_") and not attr_name.startswith("__"):
                    acc_idx = getattr(attrs, attr_name, None)
                    if acc_idx is not None and isinstance(acc_idx, int):
                        row = Text()
                        row.append(f"{attr_name:<14}", style=STYLE_KEYWORD)
                        row.append_text(_accessor_summary(gltf, acc_idx))
                        prim_tree.add(row)

            # Indices
            if prim.indices is not None:
                idx_acc = gltf.accessors[prim.indices]
                row = Text()
                row.append("Indices       ", style=STYLE_KEYWORD)
                row.append_text(_accessor_summary(gltf, prim.indices))
                row.append(f"  {idx_acc.count:,} indices", style=STYLE_VALUE)
                prim_tree.add(row)

            # Morph targets
            targets = prim.targets or []
            if targets:
                tgt_lbl = Text()
                tgt_lbl.append(f"Morph Targets: {len(targets)}", style=STYLE_DIM)
                tgt_tree = prim_tree.add(tgt_lbl)
                for ti, target in enumerate(targets):
                    tgt_node = tgt_tree.add(Text(f"Target {ti}", style=STYLE_DIM))
                    if isinstance(target, dict):
                        for k, v in target.items():
                            row = Text()
                            row.append(f"{k:<14}", style=STYLE_KEYWORD)
                            row.append_text(_accessor_summary(gltf, v))
                            tgt_node.add(row)
            elif not compact:
                prim_tree.add(Text("Morph Targets: (none)", style=STYLE_DIM))

        # Mesh-level weights
        weights = mesh.weights or []
        if weights:
            mesh_tree.add(label_value("Weights", format_vector(weights)))

        console.print(mesh_tree)


# ═══════════════════════════════════════════════════════════════
#  4. Materials
# ═══════════════════════════════════════════════════════════════

def _texture_info(label: str, tex_info, extra_field: str | None = None) -> Text:
    """Format a material texture reference."""
    t = Text()
    t.append(f"{label:<24}", style=STYLE_LABEL)
    if tex_info is None:
        t.append("—", style=STYLE_NONE)
        return t
    idx = getattr(tex_info, "index", None)
    t.append("Texture ", style=STYLE_DIM)
    t.append(str(idx), style=STYLE_INDEX)
    tc = getattr(tex_info, "texCoord", None)
    if tc is not None and tc != 0:
        t.append(f" (texCoord: {tc})", style=STYLE_DIM)
    if extra_field:
        val = getattr(tex_info, extra_field, None)
        if val is not None:
            t.append(f" ({extra_field}: {val})", style=STYLE_DIM)
    return t


def render_materials(gltf: GLTF2, console: Console, **kw):
    compact = kw.get("compact", False)
    if compact and not gltf.materials:
        return
    section_rule(console, "Materials")
    if not gltf.materials:
        empty_notice(console)
        return

    for mi, mat in enumerate(gltf.materials):
        mat_tree = make_tree(index_name(mi, mat.name, prefix="Material"))

        alpha = getattr(mat, "alphaMode", "OPAQUE") or "OPAQUE"
        add_prop(mat_tree, "Alpha Mode", alpha, style=STYLE_TYPE)
        if alpha == "MASK":
            add_prop(mat_tree, "Alpha Cutoff", getattr(mat, "alphaCutoff", 0.5))
        add_prop(mat_tree, "Double Sided", "yes" if mat.doubleSided else "no")

        # PBR Metallic-Roughness
        pbr = mat.pbrMetallicRoughness
        if pbr:
            pbr_lbl = Text("PBR Metallic-Roughness", style=STYLE_KEYWORD)
            pbr_tree = mat_tree.add(pbr_lbl)

            bcf = getattr(pbr, "baseColorFactor", None)
            add_prop(pbr_tree, "Base Color Factor", format_vector(bcf))

            bct = getattr(pbr, "baseColorTexture", None)
            pbr_tree.add(_texture_info("Base Color Texture", bct))

            add_prop(pbr_tree, "Metallic Factor", getattr(pbr, "metallicFactor", 1.0))
            add_prop(pbr_tree, "Roughness Factor", getattr(pbr, "roughnessFactor", 1.0))

            mrt = getattr(pbr, "metallicRoughnessTexture", None)
            pbr_tree.add(_texture_info("Metal/Rough Texture", mrt))

        # Normal / Occlusion / Emissive
        mat_tree.add(_texture_info("Normal Texture", mat.normalTexture, extra_field="scale"))
        mat_tree.add(_texture_info("Occlusion Texture", mat.occlusionTexture, extra_field="strength"))

        ef = getattr(mat, "emissiveFactor", None)
        add_prop(mat_tree, "Emissive Factor", format_vector(ef))
        mat_tree.add(_texture_info("Emissive Texture", mat.emissiveTexture))

        # Extensions on this material
        ext = getattr(mat, "extensions", None)
        if ext:
            _render_extension_dict(mat_tree, ext)

        console.print(mat_tree)


# ═══════════════════════════════════════════════════════════════
#  5. Textures, Samplers & Images
# ═══════════════════════════════════════════════════════════════

def render_textures(gltf: GLTF2, console: Console, **kw):
    compact = kw.get("compact", False)
    has_any = gltf.textures or gltf.samplers or gltf.images
    if compact and not has_any:
        return
    section_rule(console, "Textures, Samplers & Images")
    if not has_any:
        empty_notice(console)
        return

    # ── Textures table ──
    if gltf.textures:
        table = Table(
            title="Textures", title_style="bold", border_style="dim",
            show_lines=False, pad_edge=True, padding=(0, 1),
        )
        table.add_column("Texture", style=STYLE_INDEX, justify="right")
        table.add_column("Name", style=STYLE_NAME)
        table.add_column("Sampler", style=STYLE_INDEX, justify="right")
        table.add_column("Image", style=STYLE_INDEX, justify="right")

        for ti, tex in enumerate(gltf.textures):
            table.add_row(
                str(ti),
                tex.name or "—",
                str(tex.sampler) if tex.sampler is not None else "—",
                str(tex.source) if tex.source is not None else "—",
            )
        console.print(table)

    # ── Samplers table ──
    if gltf.samplers:
        table = Table(
            title="Samplers", title_style="bold", border_style="dim",
            show_lines=False, pad_edge=True, padding=(0, 1),
        )
        table.add_column("Sampler", style=STYLE_INDEX, justify="right")
        table.add_column("Mag Filter", style=STYLE_TYPE)
        table.add_column("Min Filter", style=STYLE_TYPE)
        table.add_column("Wrap S", style=STYLE_TYPE)
        table.add_column("Wrap T", style=STYLE_TYPE)

        for si, samp in enumerate(gltf.samplers):
            table.add_row(
                str(si),
                SAMPLER_MAG_FILTER.get(samp.magFilter, str(samp.magFilter) if samp.magFilter else "—"),
                SAMPLER_MIN_FILTER.get(samp.minFilter, str(samp.minFilter) if samp.minFilter else "—"),
                SAMPLER_WRAP.get(samp.wrapS, str(samp.wrapS) if samp.wrapS else "REPEAT"),
                SAMPLER_WRAP.get(samp.wrapT, str(samp.wrapT) if samp.wrapT else "REPEAT"),
            )
        console.print(table)

    # ── Images table ──
    if gltf.images:
        table = Table(
            title="Images", title_style="bold", border_style="dim",
            show_lines=False, pad_edge=True, padding=(0, 1),
        )
        table.add_column("Image", style=STYLE_INDEX, justify="right")
        table.add_column("Name", style=STYLE_NAME)
        table.add_column("MIME Type", style=STYLE_TYPE)
        table.add_column("Source")

        for ii, img in enumerate(gltf.images):
            source = "—"
            if img.bufferView is not None:
                bv = gltf.bufferViews[img.bufferView]
                source = f"BufferView {img.bufferView} ({human_size(bv.byteLength)})"
            elif img.uri:
                uri = img.uri
                if uri.startswith("data:"):
                    source = f"Data URI ({human_size(len(uri))})"
                else:
                    source = uri

            table.add_row(
                str(ii),
                img.name or "—",
                img.mimeType or "—",
                source,
            )
        console.print(table)


# ═══════════════════════════════════════════════════════════════
#  6. Animations
# ═══════════════════════════════════════════════════════════════

def render_animations(gltf: GLTF2, console: Console, **kw):
    compact = kw.get("compact", False)
    if compact and not gltf.animations:
        return
    section_rule(console, "Animations")
    if not gltf.animations:
        empty_notice(console)
        return

    for ai, anim in enumerate(gltf.animations):
        anim_tree = make_tree(index_name(ai, anim.name, prefix="Animation"))

        # Try to compute duration from input accessors
        duration_min = None
        duration_max = None

        for ci, channel in enumerate(anim.channels):
            ch_lbl = Text()
            ch_lbl.append(f"Channel {ci}", style=STYLE_DIM)
            ch_lbl.append(" → ", style=STYLE_DIM)

            target = channel.target
            if target.node is not None:
                node = gltf.nodes[target.node]
                ch_lbl.append("Node ", style=STYLE_DIM)
                ch_lbl.append(str(target.node), style=STYLE_INDEX)
                if node.name:
                    ch_lbl.append(f" \"{node.name}\"", style=STYLE_NAME)
            ch_lbl.append(" / ", style=STYLE_DIM)
            ch_lbl.append(target.path or "?", style=STYLE_KEYWORD)

            ch_tree = anim_tree.add(ch_lbl)

            sampler = anim.samplers[channel.sampler]
            s_lbl = Text()
            s_lbl.append("Sampler ", style=STYLE_DIM)
            s_lbl.append(str(channel.sampler), style=STYLE_INDEX)
            s_lbl.append(": ", style=STYLE_DIM)
            s_lbl.append(sampler.interpolation or "LINEAR", style=STYLE_TYPE)

            # Keyframe count and duration from input accessor
            if sampler.input is not None and sampler.input < len(gltf.accessors):
                inp_acc = gltf.accessors[sampler.input]
                s_lbl.append(f", {inp_acc.count:,} keyframes", style=STYLE_VALUE)
                if inp_acc.min is not None:
                    t_min = inp_acc.min[0] if isinstance(inp_acc.min, list) else inp_acc.min
                    if duration_min is None or t_min < duration_min:
                        duration_min = t_min
                if inp_acc.max is not None:
                    t_max = inp_acc.max[0] if isinstance(inp_acc.max, list) else inp_acc.max
                    if duration_max is None or t_max > duration_max:
                        duration_max = t_max

            ch_tree.add(s_lbl)

        if duration_max is not None:
            dur = duration_max - (duration_min or 0.0)
            add_prop(anim_tree, "Duration", f"~{dur:.2f}s")

        console.print(anim_tree)


# ═══════════════════════════════════════════════════════════════
#  7. Skins
# ═══════════════════════════════════════════════════════════════

def render_skins(gltf: GLTF2, console: Console, **kw):
    compact = kw.get("compact", False)
    if compact and not gltf.skins:
        return
    section_rule(console, "Skins")
    if not gltf.skins:
        empty_notice(console)
        return

    for si, skin in enumerate(gltf.skins):
        skin_tree = make_tree(index_name(si, skin.name, prefix="Skin"))

        if skin.skeleton is not None:
            skel_lbl = Text()
            skel_lbl.append("Skeleton Root           ", style=STYLE_LABEL)
            skel_lbl.append("Node ", style=STYLE_DIM)
            skel_lbl.append(str(skin.skeleton), style=STYLE_INDEX)
            node = gltf.nodes[skin.skeleton]
            if node.name:
                skel_lbl.append(f" \"{node.name}\"", style=STYLE_NAME)
            skin_tree.add(skel_lbl)

        if skin.inverseBindMatrices is not None:
            add_prop(skin_tree, "Inv. Bind Matrices", f"Accessor {skin.inverseBindMatrices}")

        joints = skin.joints or []
        jt_lbl = Text()
        jt_lbl.append(f"Joints ({len(joints)})", style=STYLE_KEYWORD)
        jt_tree = skin_tree.add(jt_lbl)

        for ji in joints:
            node = gltf.nodes[ji]
            jt_tree.add(index_name(ji, node.name, prefix="Node"))

        console.print(skin_tree)


# ═══════════════════════════════════════════════════════════════
#  8. Cameras
# ═══════════════════════════════════════════════════════════════

def render_cameras(gltf: GLTF2, console: Console, **kw):
    compact = kw.get("compact", False)
    if compact and not gltf.cameras:
        return
    section_rule(console, "Cameras")
    if not gltf.cameras:
        empty_notice(console)
        return

    for ci, cam in enumerate(gltf.cameras):
        cam_lbl = index_name(ci, cam.name, prefix="Camera")
        cam_lbl.append(" (", style=STYLE_DIM)
        cam_lbl.append(cam.type or "?", style=STYLE_TYPE)
        cam_lbl.append(")", style=STYLE_DIM)
        cam_tree = make_tree(cam_lbl)

        if cam.type == "perspective" and cam.perspective:
            p = cam.perspective
            import math
            yfov_deg = getattr(p, "yfov", None)
            if yfov_deg is not None:
                add_prop(cam_tree, "Y-FOV", f"{yfov_deg:.4f} rad ({math.degrees(yfov_deg):.1f}°)")
            add_prop(cam_tree, "Aspect Ratio", getattr(p, "aspectRatio", None))
            add_prop(cam_tree, "Z-Near", getattr(p, "znear", None))
            add_prop(cam_tree, "Z-Far", getattr(p, "zfar", None))

        elif cam.type == "orthographic" and cam.orthographic:
            o = cam.orthographic
            add_prop(cam_tree, "X-Mag", getattr(o, "xmag", None))
            add_prop(cam_tree, "Y-Mag", getattr(o, "ymag", None))
            add_prop(cam_tree, "Z-Near", getattr(o, "znear", None))
            add_prop(cam_tree, "Z-Far", getattr(o, "zfar", None))

        console.print(cam_tree)


# ═══════════════════════════════════════════════════════════════
#  9. Buffers, Buffer Views & Accessors
# ═══════════════════════════════════════════════════════════════

def render_buffers(gltf: GLTF2, console: Console, **kw):
    section_rule(console, "Buffers, Buffer Views & Accessors")

    # ── Buffers ──
    if gltf.buffers:
        table = Table(
            title="Buffers", title_style="bold", border_style="dim",
            show_lines=False, pad_edge=True, padding=(0, 1),
        )
        table.add_column("Buffer", style=STYLE_INDEX, justify="right")
        table.add_column("Size", justify="right")
        table.add_column("URI")

        for bi, buf in enumerate(gltf.buffers):
            uri = "—"
            if buf.uri:
                if buf.uri.startswith("data:"):
                    uri = f"Data URI ({human_size(len(buf.uri))})"
                else:
                    uri = buf.uri
            else:
                uri = "(embedded GLB blob)"

            table.add_row(
                str(bi),
                human_size(buf.byteLength),
                uri,
            )
        console.print(table)

    # ── Buffer Views ──
    if gltf.bufferViews:
        table = Table(
            title="Buffer Views", title_style="bold", border_style="dim",
            show_lines=False, pad_edge=True, padding=(0, 1),
        )
        table.add_column("View", style=STYLE_INDEX, justify="right")
        table.add_column("Buffer", style=STYLE_INDEX, justify="right")
        table.add_column("Offset", justify="right")
        table.add_column("Length", justify="right")
        table.add_column("Stride", justify="right")
        table.add_column("Target", style=STYLE_TYPE)

        for vi, bv in enumerate(gltf.bufferViews):
            table.add_row(
                str(vi),
                str(bv.buffer),
                str(bv.byteOffset or 0),
                human_size(bv.byteLength),
                str(bv.byteStride) if bv.byteStride else "—",
                BUFFER_VIEW_TARGET.get(bv.target, str(bv.target) if bv.target else "—"),
            )
        console.print(table)

    # ── Accessors ──
    if gltf.accessors:
        table = Table(
            title="Accessors", title_style="bold", border_style="dim",
            show_lines=False, pad_edge=True, padding=(0, 1),
        )
        table.add_column("Acc", style=STYLE_INDEX, justify="right")
        table.add_column("View", style=STYLE_INDEX, justify="right")
        table.add_column("Offset", justify="right")
        table.add_column("Type", style=STYLE_TYPE)
        table.add_column("Component", style=STYLE_TYPE)
        table.add_column("Count", justify="right")
        table.add_column("Range")
        table.add_column("Nrm", justify="center")

        for ai, acc in enumerate(gltf.accessors):
            sparse_marker = ""
            if acc.sparse:
                sparse_marker = " ⚡"
            table.add_row(
                str(ai),
                str(acc.bufferView) if acc.bufferView is not None else "—",
                str(acc.byteOffset or 0),
                acc.type or "?",
                COMPONENT_TYPE.get(acc.componentType, str(acc.componentType)),
                f"{acc.count:,}{sparse_marker}",
                format_range(acc.min, acc.max),
                "✓" if acc.normalized else "—",
            )
        console.print(table)


# ═══════════════════════════════════════════════════════════════
#  10. Extensions
# ═══════════════════════════════════════════════════════════════

def _render_extension_dict(tree: Tree, ext: dict | Any, depth: int = 0):
    """Recursively render extension data as tree nodes."""
    if not isinstance(ext, dict):
        tree.add(Text(str(ext), style=STYLE_VALUE))
        return
    for key, value in ext.items():
        if isinstance(value, dict):
            sub = tree.add(Text(key, style=STYLE_KEYWORD))
            _render_extension_dict(sub, value, depth + 1)
        elif isinstance(value, list):
            if len(value) <= 8 and all(not isinstance(v, (dict, list)) for v in value):
                lbl = Text()
                lbl.append(f"{key}: ", style=STYLE_KEYWORD)
                lbl.append(str(value), style=STYLE_VALUE)
                tree.add(lbl)
            else:
                sub = tree.add(Text(f"{key} ({len(value)} items)", style=STYLE_KEYWORD))
                for i, item in enumerate(value[:20]):
                    if isinstance(item, dict):
                        item_node = sub.add(Text(f"[{i}]", style=STYLE_INDEX))
                        _render_extension_dict(item_node, item, depth + 1)
                    else:
                        sub.add(Text(str(item), style=STYLE_VALUE))
                if len(value) > 20:
                    sub.add(Text(f"... and {len(value) - 20} more", style=STYLE_DIM))
        else:
            lbl = Text()
            lbl.append(f"{key}: ", style=STYLE_KEYWORD)
            lbl.append(str(value) if value is not None else "—", style=STYLE_VALUE)
            tree.add(lbl)


def _scan_extensions(gltf: GLTF2) -> list[tuple[str, str, dict]]:
    """Walk the GLTF object and collect all per-object extensions."""
    found = []
    collections = [
        ("Node", gltf.nodes),
        ("Mesh", gltf.meshes),
        ("Material", gltf.materials),
        ("Texture", gltf.textures),
        ("Image", gltf.images),
        ("Sampler", gltf.samplers),
        ("Animation", gltf.animations),
        ("Skin", gltf.skins),
        ("Camera", gltf.cameras),
        ("Buffer", gltf.buffers),
        ("BufferView", gltf.bufferViews),
        ("Accessor", gltf.accessors),
    ]
    for type_name, collection in collections:
        for idx, obj in enumerate(collection):
            ext = getattr(obj, "extensions", None)
            if ext:
                found.append((f"{type_name} {idx}", getattr(obj, "name", None), ext))
    # Also check mesh primitives
    for mi, mesh in enumerate(gltf.meshes):
        for pi, prim in enumerate(mesh.primitives):
            ext = getattr(prim, "extensions", None)
            if ext:
                found.append((f"Mesh {mi} Primitive {pi}", None, ext))
    # Top-level extensions
    top_ext = getattr(gltf, "extensions", None)
    if top_ext:
        found.append(("Root (top-level)", None, top_ext))
    return found


def render_extensions(gltf: GLTF2, console: Console, **kw):
    compact = kw.get("compact", False)
    ext_used = getattr(gltf, "extensionsUsed", None) or []
    ext_req = getattr(gltf, "extensionsRequired", None) or []

    if compact and not ext_used and not ext_req:
        return
    section_rule(console, "Extensions")
    if not ext_used and not ext_req:
        empty_notice(console, "(no extensions)")
        return

    tree = make_tree(Text("Extensions", style=STYLE_KEYWORD))

    if ext_used:
        lbl = Text()
        lbl.append("Used: ", style=STYLE_LABEL)
        lbl.append(", ".join(ext_used), style=STYLE_TYPE)
        tree.add(lbl)

    if ext_req:
        lbl = Text()
        lbl.append("Required: ", style=STYLE_LABEL)
        lbl.append(", ".join(ext_req), style=STYLE_TYPE)
        tree.add(lbl)

    # Scan for per-object extensions
    found = _scan_extensions(gltf)
    if found:
        data_tree = tree.add(Text("Extension Data Found:", style=STYLE_LABEL))
        for location, name, ext_data in found:
            loc_lbl = Text()
            loc_lbl.append(location, style=STYLE_INDEX)
            if name:
                loc_lbl.append(f" \"{name}\"", style=STYLE_NAME)
            loc_node = data_tree.add(loc_lbl)
            _render_extension_dict(loc_node, ext_data)

    console.print(tree)
