# Third-Party Notices

This extension bundles or adapts code from the following third-party projects.
All are MIT-licensed.

---

## three.js

The 3D viewer panel embeds [three.js](https://threejs.org/) (`three`) along
with its bundled DRACO and Basis Universal decoder assets.

> Copyright © 2010-2025 three.js authors
> Licensed under the MIT License — https://github.com/mrdoob/three.js/blob/dev/LICENSE

The DRACO decoder files in `out/lib/draco/` and the Basis transcoder files in
`out/lib/basis/` are copied verbatim from
`node_modules/three/examples/jsm/libs/{draco,basis}/` at build time.

---

## glb-viewer-core (OHZI Interactive Studio)

The 3D viewer in `src/webview/viewer.ts` is a fresh implementation, but the
following patterns were adapted from
[`ohzinteractive/glb-viewer-core`](https://github.com/ohzinteractive/glb-viewer-core):

- Studio environment scene (emissive cube layout used to seed
  `PMREMGenerator`).
- Loader wiring (DRACO + KTX2 + Meshopt) mirroring `SceneController.setLibURIs`.
- Camera fit-to-bounding-sphere math.
- Wireframe / double-sided / normals toggles and selection wireframe overlay.

> Copyright © 2019-2025 OHZI Interactive Studio
> Licensed under the MIT License — https://github.com/ohzinteractive/glb-viewer-core/blob/main/LICENSE.md

The full text of the OHZI license is reproduced below.

```
MIT License

Copyright (c) 2019-2025 OHZI Interactive Studio

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
