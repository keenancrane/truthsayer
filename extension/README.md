# Truthsayer — VS Code / Cursor Extension

> *From time to time, your mesh editor lies to you about the contents of a glTF file.*
> *For those times, there's `truthsayer`.*

A VS Code / Cursor custom editor that opens `.glb` and `.gltf` files and shows you
exactly what's inside — scene graph, meshes, materials, textures, animations,
skins, cameras, buffers, and extensions — without inferring or recomputing any
data that isn't literally in the file.

This is a TypeScript port of the `truthsayer` CLI (in the parent directory of
this folder), repackaged as an interactive editor with collapsible trees,
click-through cross-references, inline image thumbnails, and live re-inspect
on file change.

## Features

- **Side-by-side 3D viewer + structural inspector**.  The 3D viewport (left)
  uses three.js with DRACO + KTX2 + Meshopt support; the structural inspector
  (right) shows the truthful glTF report.  Drag the splitter to resize.
- **Cross-linking**: clicking a `Mesh N` link in the inspector frames and
  highlights that mesh in the viewport; clicking a node frames it; clicking an
  animation plays it.  Clicking an object in the 3D viewport scrolls the
  inspector to the matching mesh / node row.
- **Custom editor**: opens `.glb` / `.gltf` directly in the editor area as the
  default view.  No CLI, no Python, no external tools.
- **Faithful inspection**: walks the raw glTF JSON without filling in defaults
  (e.g. an unset `metallicFactor` shows as missing, not as `1.0`).
- **Cross-references**: click any `Material`, `Texture`, `Accessor`,
  `BufferView`, `Node`, `Image`, `Sampler`, etc. reference to jump to its row
  and flash-highlight it.
- **Image thumbnails**: PNG / JPEG / WebP / GIF images embedded in the file or
  referenced via URI render inline; click for a lightbox.
- **All ten sections** from the CLI: Overview, Scene Graph, Meshes, Materials,
  Textures, Animations, Skins, Cameras, Buffers, Extensions.
- **Inspector toolbar**: search box (filters and highlights matches across
  every section), per-section show/hide, Compact mode (skip empty sections /
  default values), Refresh, "Open as raw".
- **Viewer toolbar**: Frame all, Wireframe, Double-sided, Normals (override and
  vector helpers), Origin arrows, background picker, animation clip selector
  with playback speed.
- **Live updates**: re-inspects (and reloads the 3D viewport) automatically
  when the file changes on disk.
- **GLB and glTF**: reads both formats, including external `.bin` and external
  image references.

## Attribution

The 3D viewer panel is a fresh implementation, but the loader wiring, studio
environment scene, camera fit-to-bounds math, and selection-wireframe pattern
were adapted from
[`ohzinteractive/glb-viewer-core`](https://github.com/ohzinteractive/glb-viewer-core)
(MIT).  See [`NOTICE.md`](./NOTICE.md) for full third-party attributions.

## Install (Cursor or VS Code)

After packaging:

```bash
cd extension
npm install
npm run build
npx vsce package --no-dependencies
# Then in Cursor:  Cmd/Ctrl-Shift-P  →  "Extensions: Install from VSIX..."
```

Or for development, open `extension/` in Cursor and press `F5` to launch a
debug Extension Host with Truthsayer loaded.

## Usage

- Click any `.glb` / `.gltf` file in the Explorer — it opens in Truthsayer
  automatically.
- Right-click → **Truthsayer: Inspect Active glTF/GLB File** to force open with
  Truthsayer.
- Inside the editor:
  - **Search box**: live-filters all sections.
  - **Section buttons**: toggle visibility (mirrors the CLI's `--only` /
    `--exclude`).
  - **Compact**: hides empty sections and default-valued fields.
  - **Open as raw**: switches to the default editor (useful for `.gltf` JSON).
  - **Refresh**: re-runs the inspector.
  - Click any blue index to jump to that object's row.
  - Click an image thumbnail to enlarge.

## How it works

`extension/src/inspector.ts` is a self-contained glTF 2.0 / GLB parser:

- Reads the file as a `Buffer`, parses the GLB header and chunk table, and
  extracts the JSON metadata + binary blob.
- Walks the **raw JSON object tree** (no library normalization) so every value
  shown is one that's actually in the file.
- Resolves external buffer / image URIs relative to the file path.
- Detects PNG / JPEG / WebP image dimensions from the raw bytes for the
  thumbnail panel.

`extension/src/editorProvider.ts` registers a `CustomReadonlyEditorProvider` for
`.glb` and `.gltf`.  It runs the inspector in the extension host process and
posts a structured `InspectionReport` to the webview.

`extension/src/webview/main.ts` renders that report into native DOM with VS
Code theme variables, plus search, toggles, lightbox, and cross-references.

No bundled runtime dependencies — the extension is just `out/extension.js` (the
inspector + editor provider) plus `out/webview.js` and `out/webview.css`.

## License

MIT (same as the parent `truthsayer` project).
