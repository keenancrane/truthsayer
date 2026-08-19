// Build the extension host code (Node, CommonJS) and the webview client (browser, IIFE).
// Also copies three.js's DRACO and KTX2 / Basis decoder assets into out/lib/ so the
// webview can load them as static resources.
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

const hostBuild = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
};

const webviewBuild = {
  ...common,
  entryPoints: ["src/webview/main.ts"],
  outfile: "out/webview.js",
  platform: "browser",
  format: "iife",
  target: "es2020",
};

const stylesBuild = {
  ...common,
  entryPoints: ["src/webview/styles.css"],
  outfile: "out/webview.css",
  loader: { ".css": "css" },
};

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function copyDecoderAssets() {
  const threeLibs = path.resolve("node_modules/three/examples/jsm/libs");
  // DRACO: copy the gltf/ subset (used by GLTFLoader's DRACOLoader integration).
  copyDir(path.join(threeLibs, "draco/gltf"), "out/lib/draco");
  // Basis (KTX2) transcoder.
  copyDir(path.join(threeLibs, "basis"), "out/lib/basis");
  console.log("decoder assets copied to out/lib/");
}

async function run() {
  if (watch) {
    const hostCtx = await esbuild.context(hostBuild);
    const webviewCtx = await esbuild.context(webviewBuild);
    const stylesCtx = await esbuild.context(stylesBuild);
    copyDecoderAssets();
    await Promise.all([hostCtx.watch(), webviewCtx.watch(), stylesCtx.watch()]);
    console.log("watching...");
  } else {
    await Promise.all([
      esbuild.build(hostBuild),
      esbuild.build(webviewBuild),
      esbuild.build(stylesBuild),
    ]);
    copyDecoderAssets();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
