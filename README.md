# truthsayer

<p align="center">
  <img src="icon.png" alt="Truthsayer" width="512">
</p>

<p align="center">
  <em>From time to time, your mesh editor lies to you about the contents of a glTF file.<br/>For those times, there's <tt>truthsayer</tt>.</em>
</p>

---

`truthsayer` is a command line utility that opens a glTF or GLB file and tells you everything about it — scene hierarchy, meshes, materials, textures, animations, skins, cameras, buffer layouts, and extensions — without modifying or recomputing any attributes.  You can ask for specific information (e.g., just the cameras), or simply dump everything that is known about the file.  Information is displayed directly on the command line, using rich formatting.

Many programs (Blender, MeshLab, etc.) will create data on load if it doesn't exist.  While this kind of initialization is reasonable from a software engineering perspective (e.g., the program may need that information to draw the mesh!) it sometimes causes headaches when you just want to know what data is really coming from the mesh file itself.  `truthsayer` provides an ironclad solution to this problem.

## Quick Start

After cloning the repo, run these commands to install `truthsayer`:

```bash
git clone https://github.com/your-org/truthsayer.git
cd truthsayer
pip install -e .
truthsayer path/to/model.glb
```

## Example Output

Running `truthsayer DamagedHelmet.glb --compact` on a GLB file `DamagedHelmet.glb` now produces:

```
  TRUTHSAYER — glTF / GLB Inspector

╭─ File Overview ──────────────────────────────────────────────────────────────╮
│   File                DamagedHelmet.glb                                      │
│   Format              GLB (Binary)                                           │
│   Size                3.60 MB                                                │
│   glTF Version        2.0                                                    │
│   Generator           Khronos Blender glTF 2.0 exporter                      │
│                                                                              │
│   Scenes ········   1  Nodes ·········   1  Meshes ········   1              │
│   Materials ·····   1  Textures ······   5  Images ········   5              │
│   Buffers ·······   1  Buffer Views ··   9  Accessors ·····   4              │
╰──────────────────────────────────────────────────────────────────────────────╯

Scene Graph ────────────────────────────────────────────────────────────────────
Scene 0: "Scene" ★ default
└── Node 0: "node_damagedHelmet_-6514" ⯈ Mesh 0
    └── ↻ rotation    [0.7071, 0, 0, 0.7071]

Meshes ─────────────────────────────────────────────────────────────────────────
Mesh 0: "mesh_helmet_LP_13930damagedHelmet"
└── Primitive 0 ▸ TRIANGLES ▸ Material 0 "Material_MR" ▸ 14,556 vertices
    ├── POSITION      Accessor 1  VEC3 × FLOAT  [-0.9475, -1.187, -0.901] → ...
    ├── NORMAL        Accessor 2  VEC3 × FLOAT
    ├── TEXCOORD_0    Accessor 3  VEC2 × FLOAT
    └── Indices       Accessor 0  SCALAR × UNSIGNED_SHORT  46,356 indices

Materials ──────────────────────────────────────────────────────────────────────
Material 0: "Material_MR"
├── Alpha Mode              OPAQUE
├── PBR Metallic-Roughness
│   ├── Base Color Texture      Texture 0
│   ├── Metallic Factor         1.0
│   └── Metal/Rough Texture     Texture 1
├── Normal Texture          Texture 4 (scale: 1.0)
├── Occlusion Texture       Texture 3 (strength: 1.0)
└── Emissive Texture        Texture 2

Textures, Samplers & Images ────────────────────────────────────────────────────
┏━━━━━━━┳━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Image ┃ Name ┃ MIME Type  ┃ Source                   ┃
┡━━━━━━━╇━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│     0 │ —    │ image/jpeg │ BufferView 4 (913.70 KB) │
│     1 │ —    │ image/jpeg │ BufferView 5 (1.24 MB)   │
│   ... │      │            │                          │
└───────┴──────┴────────────┴──────────────────────────┘
```

*(Colors and styling are visible in a real terminal.)*

## Sections

Truthsayer organizes its output into **10 sections**, each covering a different aspect of the glTF file:

| Section | What it shows |
|---|---|
| **overview** | File name, format (GLB/GLTF), size, glTF version, generator, copyright, and a summary grid of object counts across all categories. |
| **scene** | The full scene graph as a tree — scenes, nodes, child hierarchies, with inline display of transforms (translation, rotation, scale, matrix) and references to meshes, cameras, and skins. |
| **meshes** | Each mesh and its primitives: rendering mode, material reference, vertex count, per-attribute accessor bindings (type, component type, bounding range), index counts, and morph targets. |
| **materials** | PBR metallic-roughness parameters (base color, metallic/roughness factors, textures), normal/occlusion/emissive maps, alpha mode, double-sidedness, and per-material extensions. |
| **textures** | Three linked tables: Textures (sampler + image index), Samplers (mag/min filters, wrap modes), and Images (MIME type, source URI or buffer view with size). |
| **animations** | Each animation's channels (target node and property path), samplers (interpolation mode, keyframe count), and computed duration from input accessor min/max. |
| **skins** | Skeleton root, inverse bind matrix accessor, and the full joint list with node name cross-references. |
| **cameras** | Perspective cameras (Y-FOV in radians and degrees, aspect ratio, near/far) and orthographic cameras (x/y magnification, near/far). |
| **buffers** | Three tables covering Buffers (size, URI), Buffer Views (buffer, offset, length, stride, target), and Accessors (type, component type, count, min/max range, normalization, sparse marker). |
| **extensions** | Lists of `extensionsUsed` and `extensionsRequired`, plus a recursive walk of all per-object extension data found anywhere in the file. |

## Usage

```
truthsayer <file> [options]
```

### Positional argument

| Argument | Description |
|---|---|
| `file` | Path to a `.glb` or `.gltf` file. |

### Options

| Flag | Description |
|---|---|
| `--only SECTIONS` | Show only the listed sections (comma-separated). |
| `--exclude SECTIONS` | Hide the listed sections (comma-separated). |
| `--compact` | Skip empty sections entirely and omit default-valued fields. |
| `--no-color` | Disable color and styling (plain text output). |
| `--version` | Print version and exit. |
| `-h`, `--help` | Show help message and exit. |

Valid section names for `--only` and `--exclude`:

```
overview, scene, meshes, materials, textures,
animations, skins, cameras, buffers, extensions
```

### Examples

Show everything (default):

```bash
truthsayer model.glb
```

Focus on just the scene hierarchy and mesh details:

```bash
truthsayer model.glb --only scene,meshes
```

Show everything except the low-level buffer layout:

```bash
truthsayer model.glb --exclude buffers
```

Clean output for piping or logging:

```bash
truthsayer model.glb --no-color --compact > report.txt
```

## What Truthsayer Shows (and Doesn't)

**Shows:**
- File metadata (format, size, version, generator, copyright)
- Object counts for every glTF category
- Full scene graph hierarchy with transforms
- Mesh structure: primitives, modes, attribute bindings, vertex/index counts, morph targets
- Material properties: PBR parameters, texture references, alpha/culling settings
- Texture/sampler/image relationships and storage details
- Animation channels, interpolation, keyframe counts, duration
- Skin joint lists and skeleton references
- Camera projection parameters
- Buffer/view/accessor data layout (offsets, sizes, types, ranges)
- All extensions and extras found anywhere in the file

**Does not show:**
- Actual vertex positions, normals, or tangent data
- Index buffer contents (triangle connectivity)
- Texture pixel data
- Animation keyframe values
- Inverse bind matrix values
- Any raw binary buffer content

The goal is to give you a complete structural understanding of a glTF asset without flooding the terminal with megabytes of numeric data.

## Requirements

- Python 3.9+
- [pygltflib](https://pypi.org/project/pygltflib/) — glTF 2.0 parsing (GLB and GLTF)
- [Rich](https://pypi.org/project/rich/) — terminal formatting (trees, tables, panels, styled text)

## Project Structure

```
truthsayer/
├── pyproject.toml          Project metadata and dependencies
├── README.md
├── truthsayer/
│   ├── __init__.py         Version string
│   ├── __main__.py         python -m truthsayer support
│   ├── cli.py              Argument parsing and section orchestration
│   ├── constants.py        GL enum → human name mappings
│   ├── formatting.py       Rich style palette and reusable formatters
│   └── sections.py         One render function per section (10 total)
```

## License

MIT
