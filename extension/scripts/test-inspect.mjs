// Quick smoke test: bundles inspector via esbuild on the fly, runs it
// against a sample glb, and prints a structural summary.
import { build } from "esbuild";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/test-inspect.mjs <path-to-file.glb|.gltf>");
  process.exit(1);
}

const out = path.join(await fs.mkdtemp(path.join(tmpdir(), "ts-inspect-")), "inspector.cjs");
await build({
  entryPoints: [path.join(root, "src/inspector.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: out,
  logLevel: "error",
});

const { inspect } = await import(out);
const report = await inspect(path.resolve(file));

console.log("FILE   :", report.file.name, `(${report.file.format}, ${report.file.size} bytes)`);
console.log("ASSET  :", JSON.stringify(report.asset));
console.log("COUNTS :", JSON.stringify(report.counts));
console.log("SCENES :", report.scenes.length, "default =", report.defaultScene);
if (report.meshes[0]) {
  const m = report.meshes[0];
  console.log("MESH 0 :", JSON.stringify({
    name: m.name,
    prims: m.primitives.length,
    totalTris: m.totalTriangles,
    primSummary: m.primitives.map(p => ({
      mode: p.modeName,
      vtx: p.vertexCount,
      tris: p.triangleCount,
      attrs: p.attributes.map(a => a.name),
      indices: p.indices,
      morph: p.morphTargets.length,
      material: p.material,
    })),
  }, null, 2));
}
if (report.materials[0]) {
  const mat = report.materials[0];
  console.log("MAT 0  :", JSON.stringify({
    name: mat.name, alphaMode: mat.alphaMode, doubleSided: mat.doubleSided,
    pbr: mat.pbr ? {
      bcf: mat.pbr.baseColorFactor,
      bct: mat.pbr.baseColorTexture,
      mf: mat.pbr.metallicFactor,
      rf: mat.pbr.roughnessFactor,
    } : null,
    normal: mat.normalTexture, occlusion: mat.occlusionTexture, emissive: mat.emissiveTexture,
  }, null, 2));
}
console.log("IMAGES :", report.images.map(i => ({
  i: i.index, mime: i.mimeType, res: i.resolution, src: i.bufferView !== null ? `bv=${i.bufferView}` : i.uri?.slice(0,40),
  thumb: i.thumbnailDataUrl ? "yes" : "no",
})));
console.log("ANIMS  :", report.animations.map(a => ({ name: a.name, ch: a.channels.length, dur: a.duration })));
console.log("BUF/BV/ACC:", report.buffers.length, "/", report.bufferViews.length, "/", report.accessors.length);
console.log("EXT USED:", report.extensionsUsed);
console.log("EXT FOUND:", report.extensions.map(e => e.location));
