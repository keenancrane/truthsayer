// Truthsayer inspector: parses .glb / .gltf files into a structured InspectionReport
// without inferring any data that isn't literally in the file.
//
// Intentionally does NOT use @gltf-transform/core or pygltflib-style object
// models, because those frameworks fill in defaults and synthesize data on
// load.  Truthsayer's whole purpose is to tell you what's actually there.

import * as fs from "fs/promises";
import * as path from "path";
import {
  COMPONENT_TYPE,
  PRIMITIVE_MODE,
  BUFFER_VIEW_TARGET,
  SAMPLER_MAG_FILTER,
  SAMPLER_MIN_FILTER,
  SAMPLER_WRAP,
} from "./constants.js";

// ─── Public report shape (consumed by the webview) ───────────────────────

export interface InspectionReport {
  file: {
    name: string;
    path: string;
    format: "GLB" | "GLTF";
    size: number;
  };
  asset: {
    version: string | null;
    generator: string | null;
    copyright: string | null;
    minVersion: string | null;
  };
  counts: Record<string, number>;
  extensionsUsed: string[];
  extensionsRequired: string[];
  scenes: SceneNode[];
  defaultScene: number | null;
  nodes: GltfNode[];
  meshes: MeshInfo[];
  materials: MaterialInfo[];
  textures: TextureInfo[];
  samplers: SamplerInfo[];
  images: ImageInfo[];
  animations: AnimationInfo[];
  skins: SkinInfo[];
  cameras: CameraInfo[];
  buffers: BufferInfo[];
  bufferViews: BufferViewInfo[];
  accessors: AccessorInfo[];
  extensions: ExtensionEntry[];
  topLevelExtensions: Record<string, unknown> | null;
  warnings: string[];
}

export interface SceneNode {
  index: number;
  name: string | null;
  rootNodeIndices: number[];
  isDefault: boolean;
}

export interface GltfNode {
  index: number;
  name: string | null;
  mesh: number | null;
  camera: number | null;
  skin: number | null;
  children: number[];
  translation: number[] | null;
  rotation: number[] | null;
  scale: number[] | null;
  matrix: number[] | null;
}

export interface PrimitiveInfo {
  index: number;
  mode: number;
  modeName: string;
  material: number | null;
  attributes: { name: string; accessor: number }[];
  indices: number | null;
  indexCount: number | null;
  vertexCount: number | null;
  triangleCount: number;
  morphTargets: { name: string; accessor: number }[][];
  extensions: Record<string, unknown> | null;
}

export interface MeshInfo {
  index: number;
  name: string | null;
  primitives: PrimitiveInfo[];
  weights: number[] | null;
  totalTriangles: number;
  extensions: Record<string, unknown> | null;
}

export interface TextureRef {
  index: number;
  texCoord: number | null;
  scale?: number;
  strength?: number;
}

export interface MaterialInfo {
  index: number;
  name: string | null;
  alphaMode: string | null;
  alphaCutoff: number | null;
  doubleSided: boolean;
  pbr: {
    baseColorFactor: number[] | null;
    baseColorTexture: TextureRef | null;
    metallicFactor: number | null;
    roughnessFactor: number | null;
    metallicRoughnessTexture: TextureRef | null;
  } | null;
  normalTexture: TextureRef | null;
  occlusionTexture: TextureRef | null;
  emissiveTexture: TextureRef | null;
  emissiveFactor: number[] | null;
  extensions: Record<string, unknown> | null;
}

export interface TextureInfo {
  index: number;
  name: string | null;
  sampler: number | null;
  source: number | null;
  extensions: Record<string, unknown> | null;
}

export interface SamplerInfo {
  index: number;
  name: string | null;
  magFilter: number | null;
  magFilterName: string | null;
  minFilter: number | null;
  minFilterName: string | null;
  wrapS: number | null;
  wrapSName: string;
  wrapT: number | null;
  wrapTName: string;
}

export interface ImageInfo {
  index: number;
  name: string | null;
  mimeType: string | null;
  bufferView: number | null;
  uri: string | null;
  uriIsDataUrl: boolean;
  uriDataLength: number | null;
  bufferViewByteLength: number | null;
  resolution: { width: number; height: number } | null;
  // Either a webview-safe data URL for embedded images, or the uri for external,
  // when the extension can show a thumbnail.
  thumbnailDataUrl: string | null;
}

export interface AnimationChannelInfo {
  index: number;
  samplerIndex: number;
  targetNode: number | null;
  targetNodeName: string | null;
  targetPath: string | null;
  interpolation: string;
  inputAccessor: number | null;
  outputAccessor: number | null;
  keyframeCount: number | null;
  tMin: number | null;
  tMax: number | null;
}

export interface AnimationInfo {
  index: number;
  name: string | null;
  channels: AnimationChannelInfo[];
  duration: number | null;
}

export interface SkinInfo {
  index: number;
  name: string | null;
  skeleton: number | null;
  skeletonName: string | null;
  inverseBindMatrices: number | null;
  joints: { index: number; name: string | null }[];
}

export interface CameraInfo {
  index: number;
  name: string | null;
  type: string | null;
  perspective: {
    yfov: number | null;
    aspectRatio: number | null;
    znear: number | null;
    zfar: number | null;
  } | null;
  orthographic: {
    xmag: number | null;
    ymag: number | null;
    znear: number | null;
    zfar: number | null;
  } | null;
}

export interface BufferInfo {
  index: number;
  name: string | null;
  byteLength: number;
  uri: string | null;
  uriIsDataUrl: boolean;
  uriDataLength: number | null;
  embedded: boolean;
}

export interface BufferViewInfo {
  index: number;
  name: string | null;
  buffer: number;
  byteOffset: number;
  byteLength: number;
  byteStride: number | null;
  target: number | null;
  targetName: string | null;
}

export interface AccessorInfo {
  index: number;
  name: string | null;
  bufferView: number | null;
  byteOffset: number;
  type: string | null;
  componentType: number;
  componentTypeName: string;
  count: number;
  min: number[] | null;
  max: number[] | null;
  normalized: boolean;
  sparse: boolean;
}

export interface ExtensionEntry {
  location: string;
  name: string | null;
  data: Record<string, unknown>;
}

// ─── GLB / glTF loader ───────────────────────────────────────────────────

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_CHUNK_JSON = 0x4e4f534a; // "JSON"
const GLB_CHUNK_BIN = 0x004e4942; // "BIN\0"

interface LoadedGltf {
  json: any;
  binChunk: Uint8Array | null;
  format: "GLB" | "GLTF";
  filePath: string;
  fileSize: number;
}

async function loadGltfFile(filePath: string): Promise<LoadedGltf> {
  const buf = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".glb") {
    return parseGlb(buf, filePath, stat.size);
  }
  // Treat anything else as glTF JSON.
  return parseGltfJson(buf, filePath, stat.size);
}

function parseGltfJson(buf: Buffer, filePath: string, size: number): LoadedGltf {
  const text = buf.toString("utf8");
  const json = JSON.parse(text);
  return { json, binChunk: null, format: "GLTF", filePath, fileSize: size };
}

function parseGlb(buf: Buffer, filePath: string, size: number): LoadedGltf {
  if (buf.length < 12) {
    throw new Error("File too small to be a valid GLB.");
  }
  const magic = buf.readUInt32LE(0);
  if (magic !== GLB_MAGIC) {
    throw new Error(`Not a GLB file (bad magic: 0x${magic.toString(16)}).`);
  }
  const version = buf.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version: ${version}. Only glTF 2.0 GLBs are supported.`);
  }
  const declaredLen = buf.readUInt32LE(8);
  if (declaredLen > buf.length) {
    throw new Error("GLB declared length exceeds file size.");
  }

  let pos = 12;
  let json: any | null = null;
  let bin: Uint8Array | null = null;

  while (pos + 8 <= declaredLen) {
    const chunkLen = buf.readUInt32LE(pos);
    const chunkType = buf.readUInt32LE(pos + 4);
    const chunkStart = pos + 8;
    const chunkEnd = chunkStart + chunkLen;
    if (chunkEnd > buf.length) {
      throw new Error("GLB chunk extends past end of file.");
    }
    if (chunkType === GLB_CHUNK_JSON && json === null) {
      const slice = buf.subarray(chunkStart, chunkEnd);
      json = JSON.parse(slice.toString("utf8"));
    } else if (chunkType === GLB_CHUNK_BIN && bin === null) {
      bin = new Uint8Array(buf.buffer, buf.byteOffset + chunkStart, chunkLen);
    }
    pos = chunkEnd;
  }

  if (json === null) {
    throw new Error("GLB file has no JSON chunk.");
  }
  return { json, binChunk: bin, format: "GLB", filePath, fileSize: size };
}

// ─── Image header parsing (PNG / JPEG) ───────────────────────────────────

function parsePngSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (data[i] !== sig[i]) return null;
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = dv.getUint32(16, false);
  const height = dv.getUint32(20, false);
  return { width, height };
}

function parseJpegSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 2;
  while (pos < data.length - 1) {
    if (data[pos] !== 0xff) return null;
    const marker = data[pos + 1];
    if (marker === 0xd9) return null;
    if (
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd8)
    ) {
      pos += 2;
      continue;
    }
    if (pos + 3 >= data.length) return null;
    const segLen = dv.getUint16(pos + 2, false);
    const sof = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    if (sof.has(marker)) {
      if (pos + 9 >= data.length) return null;
      const height = dv.getUint16(pos + 5, false);
      const width = dv.getUint16(pos + 7, false);
      return { width, height };
    }
    pos += 2 + segLen;
  }
  return null;
}

function parseWebpSize(data: Uint8Array): { width: number; height: number } | null {
  // RIFF container: "RIFF" <size> "WEBP" <chunkFourCC> ...
  if (data.length < 30) return null;
  if (
    data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46 ||
    data[8] !== 0x57 || data[9] !== 0x45 || data[10] !== 0x42 || data[11] !== 0x50
  ) return null;
  const fourcc = String.fromCharCode(data[12], data[13], data[14], data[15]);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (fourcc === "VP8X") {
    // 3-byte little-endian (width-1), then 3-byte little-endian (height-1).
    const w = (data[24] | (data[25] << 8) | (data[26] << 16)) + 1;
    const h = (data[27] | (data[28] << 8) | (data[29] << 16)) + 1;
    return { width: w, height: h };
  }
  if (fourcc === "VP8L") {
    // Signature byte 0x2f at offset 20, then 14-bit width-1 / 14-bit height-1.
    if (data[20] !== 0x2f || data.length < 25) return null;
    const b0 = data[21], b1 = data[22], b2 = data[23], b3 = data[24];
    const w = ((b0 | (b1 << 8)) & 0x3fff) + 1;
    const h = (((b1 >> 6) | (b2 << 2) | (b3 << 10)) & 0x3fff) + 1;
    return { width: w, height: h };
  }
  if (fourcc === "VP8 ") {
    // Look for the start code 0x9d 0x01 0x2a, then 16-bit width then 16-bit height.
    for (let i = 20; i < Math.min(data.length - 6, 64); i++) {
      if (data[i] === 0x9d && data[i + 1] === 0x01 && data[i + 2] === 0x2a) {
        const w = dv.getUint16(i + 3, true) & 0x3fff;
        const h = dv.getUint16(i + 5, true) & 0x3fff;
        return { width: w, height: h };
      }
    }
    return null;
  }
  return null;
}

function parseImageSize(data: Uint8Array): { width: number; height: number } | null {
  return parsePngSize(data) ?? parseJpegSize(data) ?? parseWebpSize(data);
}

// ─── External buffer / image resolution ──────────────────────────────────

async function resolveExternalUri(filePath: string, uri: string): Promise<Uint8Array | null> {
  if (uri.startsWith("data:")) {
    const commaIdx = uri.indexOf(",");
    if (commaIdx < 0) return null;
    const meta = uri.slice(5, commaIdx);
    const payload = uri.slice(commaIdx + 1);
    if (meta.endsWith(";base64")) {
      return Buffer.from(payload, "base64");
    }
    return Buffer.from(decodeURIComponent(payload), "utf8");
  }
  const dir = path.dirname(filePath);
  const resolved = path.resolve(dir, decodeURIComponent(uri));
  try {
    return await fs.readFile(resolved);
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function arr<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

function takeNumberArray(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === "number") ? (v as number[]) : null;
}

function safeName(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toMime(buf: Uint8Array | null): string {
  if (!buf || buf.length < 12) return "application/octet-stream";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return "application/octet-stream";
}

function bytesToDataUrl(buf: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
}

// ─── Main inspect() entry point ──────────────────────────────────────────

export async function inspect(filePath: string): Promise<InspectionReport> {
  const loaded = await loadGltfFile(filePath);
  const json = loaded.json;
  const warnings: string[] = [];

  const asset = (json.asset ?? {}) as Record<string, unknown>;
  const scenes = arr<any>(json.scenes);
  const nodes = arr<any>(json.nodes);
  const meshes = arr<any>(json.meshes);
  const materials = arr<any>(json.materials);
  const textures = arr<any>(json.textures);
  const samplers = arr<any>(json.samplers);
  const images = arr<any>(json.images);
  const animations = arr<any>(json.animations);
  const skins = arr<any>(json.skins);
  const cameras = arr<any>(json.cameras);
  const buffers = arr<any>(json.buffers);
  const bufferViews = arr<any>(json.bufferViews);
  const accessors = arr<any>(json.accessors);

  // Pre-resolve external buffers (only those referenced by image bufferViews,
  // to keep loads cheap).  GLB main blob is already in memory.
  const externalBufferCache = new Map<number, Uint8Array | null>();
  const getBufferBytes = async (bufIdx: number): Promise<Uint8Array | null> => {
    if (externalBufferCache.has(bufIdx)) return externalBufferCache.get(bufIdx)!;
    const buf = buffers[bufIdx];
    if (!buf) return null;
    if (loaded.format === "GLB" && bufIdx === 0 && !buf.uri) {
      externalBufferCache.set(bufIdx, loaded.binChunk);
      return loaded.binChunk;
    }
    if (typeof buf.uri === "string") {
      const bytes = await resolveExternalUri(loaded.filePath, buf.uri);
      externalBufferCache.set(bufIdx, bytes);
      return bytes;
    }
    externalBufferCache.set(bufIdx, null);
    return null;
  };

  // Build node info (used by scene graph + skins + animations)
  const nodeInfos: GltfNode[] = nodes.map((n: any, i: number) => ({
    index: i,
    name: safeName(n?.name),
    mesh: typeof n?.mesh === "number" ? n.mesh : null,
    camera: typeof n?.camera === "number" ? n.camera : null,
    skin: typeof n?.skin === "number" ? n.skin : null,
    children: arr<number>(n?.children).filter((c) => typeof c === "number"),
    translation: takeNumberArray(n?.translation),
    rotation: takeNumberArray(n?.rotation),
    scale: takeNumberArray(n?.scale),
    matrix: takeNumberArray(n?.matrix),
  }));

  const sceneInfos: SceneNode[] = scenes.map((s: any, i: number) => ({
    index: i,
    name: safeName(s?.name),
    rootNodeIndices: arr<number>(s?.nodes).filter((c) => typeof c === "number"),
    isDefault: typeof json.scene === "number" && json.scene === i,
  }));

  const meshInfos: MeshInfo[] = meshes.map((m: any, mi: number): MeshInfo => {
    const prims = arr<any>(m?.primitives).map((prim: any, pi: number): PrimitiveInfo => {
      const mode = typeof prim?.mode === "number" ? prim.mode : 4;
      const modeName = PRIMITIVE_MODE[mode] ?? PRIMITIVE_MODE[4];
      const attrs = (prim?.attributes ?? {}) as Record<string, unknown>;
      const orderedAttrNames = [
        "POSITION", "NORMAL", "TANGENT",
        "TEXCOORD_0", "TEXCOORD_1",
        "COLOR_0", "JOINTS_0", "WEIGHTS_0",
      ];
      const seen = new Set<string>();
      const attributeList: { name: string; accessor: number }[] = [];
      for (const name of orderedAttrNames) {
        if (typeof attrs[name] === "number") {
          attributeList.push({ name, accessor: attrs[name] as number });
          seen.add(name);
        }
      }
      // Custom attributes (typically prefixed with _).
      for (const k of Object.keys(attrs)) {
        if (seen.has(k)) continue;
        if (typeof attrs[k] === "number") {
          attributeList.push({ name: k, accessor: attrs[k] as number });
        }
      }

      const indicesIdx = typeof prim?.indices === "number" ? prim.indices : null;
      let indexCount: number | null = null;
      if (indicesIdx !== null && accessors[indicesIdx]) {
        indexCount = typeof accessors[indicesIdx].count === "number" ? accessors[indicesIdx].count : null;
      }
      let vertexCount: number | null = null;
      const posIdx = typeof attrs.POSITION === "number" ? (attrs.POSITION as number) : null;
      if (posIdx !== null && accessors[posIdx]) {
        vertexCount = typeof accessors[posIdx].count === "number" ? accessors[posIdx].count : null;
      }
      const elemCount = indexCount ?? vertexCount ?? 0;
      let triCount = 0;
      if (mode === 4) triCount = Math.floor(elemCount / 3);
      else if (mode === 5 || mode === 6) triCount = Math.max(0, elemCount - 2);

      const targets = arr<any>(prim?.targets).map((t: any) => {
        const out: { name: string; accessor: number }[] = [];
        if (t && typeof t === "object") {
          for (const [k, v] of Object.entries(t)) {
            if (typeof v === "number") out.push({ name: k, accessor: v });
          }
        }
        return out;
      });

      return {
        index: pi,
        mode,
        modeName,
        material: typeof prim?.material === "number" ? prim.material : null,
        attributes: attributeList,
        indices: indicesIdx,
        indexCount,
        vertexCount,
        triangleCount: triCount,
        morphTargets: targets,
        extensions: (prim?.extensions && typeof prim.extensions === "object") ? prim.extensions : null,
      };
    });

    return {
      index: mi,
      name: safeName(m?.name),
      primitives: prims,
      weights: takeNumberArray(m?.weights),
      totalTriangles: prims.reduce((s, p) => s + p.triangleCount, 0),
      extensions: (m?.extensions && typeof m.extensions === "object") ? m.extensions : null,
    };
  });

  const materialInfos: MaterialInfo[] = materials.map((mat: any, i: number): MaterialInfo => {
    const pbrSrc = mat?.pbrMetallicRoughness;
    const texRef = (t: any, extra?: "scale" | "strength"): TextureRef | null => {
      if (!t || typeof t.index !== "number") return null;
      const out: TextureRef = {
        index: t.index,
        texCoord: typeof t.texCoord === "number" ? t.texCoord : null,
      };
      if (extra && typeof t[extra] === "number") {
        (out as any)[extra] = t[extra];
      }
      return out;
    };
    return {
      index: i,
      name: safeName(mat?.name),
      alphaMode: typeof mat?.alphaMode === "string" ? mat.alphaMode : null,
      alphaCutoff: typeof mat?.alphaCutoff === "number" ? mat.alphaCutoff : null,
      doubleSided: mat?.doubleSided === true,
      pbr: pbrSrc
        ? {
            baseColorFactor: takeNumberArray(pbrSrc.baseColorFactor),
            baseColorTexture: texRef(pbrSrc.baseColorTexture),
            metallicFactor: typeof pbrSrc.metallicFactor === "number" ? pbrSrc.metallicFactor : null,
            roughnessFactor: typeof pbrSrc.roughnessFactor === "number" ? pbrSrc.roughnessFactor : null,
            metallicRoughnessTexture: texRef(pbrSrc.metallicRoughnessTexture),
          }
        : null,
      normalTexture: texRef(mat?.normalTexture, "scale"),
      occlusionTexture: texRef(mat?.occlusionTexture, "strength"),
      emissiveTexture: texRef(mat?.emissiveTexture),
      emissiveFactor: takeNumberArray(mat?.emissiveFactor),
      extensions: (mat?.extensions && typeof mat.extensions === "object") ? mat.extensions : null,
    };
  });

  const textureInfos: TextureInfo[] = textures.map((tex: any, i: number) => ({
    index: i,
    name: safeName(tex?.name),
    sampler: typeof tex?.sampler === "number" ? tex.sampler : null,
    source: typeof tex?.source === "number" ? tex.source : null,
    extensions: (tex?.extensions && typeof tex.extensions === "object") ? tex.extensions : null,
  }));

  const samplerInfos: SamplerInfo[] = samplers.map((s: any, i: number) => ({
    index: i,
    name: safeName(s?.name),
    magFilter: typeof s?.magFilter === "number" ? s.magFilter : null,
    magFilterName: typeof s?.magFilter === "number" ? (SAMPLER_MAG_FILTER[s.magFilter] ?? String(s.magFilter)) : null,
    minFilter: typeof s?.minFilter === "number" ? s.minFilter : null,
    minFilterName: typeof s?.minFilter === "number" ? (SAMPLER_MIN_FILTER[s.minFilter] ?? String(s.minFilter)) : null,
    wrapS: typeof s?.wrapS === "number" ? s.wrapS : null,
    wrapSName: typeof s?.wrapS === "number" ? (SAMPLER_WRAP[s.wrapS] ?? String(s.wrapS)) : "REPEAT",
    wrapT: typeof s?.wrapT === "number" ? s.wrapT : null,
    wrapTName: typeof s?.wrapT === "number" ? (SAMPLER_WRAP[s.wrapT] ?? String(s.wrapT)) : "REPEAT",
  }));

  // Images: extract bytes for resolution detection + thumbnail.
  const imageInfos: ImageInfo[] = await Promise.all(
    images.map(async (img: any, i: number): Promise<ImageInfo> => {
      const bvIdx = typeof img?.bufferView === "number" ? img.bufferView : null;
      const uri = typeof img?.uri === "string" ? img.uri : null;
      let bytes: Uint8Array | null = null;
      let bvByteLength: number | null = null;
      let uriDataLength: number | null = null;
      let uriIsDataUrl = false;

      if (bvIdx !== null) {
        const bv = bufferViews[bvIdx];
        if (bv) {
          bvByteLength = typeof bv.byteLength === "number" ? bv.byteLength : null;
          const bufBytes = await getBufferBytes(typeof bv.buffer === "number" ? bv.buffer : 0);
          if (bufBytes) {
            const off = typeof bv.byteOffset === "number" ? bv.byteOffset : 0;
            const len = typeof bv.byteLength === "number" ? bv.byteLength : 0;
            if (off + len <= bufBytes.length) {
              bytes = bufBytes.subarray(off, off + len);
            }
          }
        }
      } else if (uri) {
        if (uri.startsWith("data:")) {
          uriIsDataUrl = true;
          uriDataLength = uri.length;
        }
        bytes = await resolveExternalUri(loaded.filePath, uri);
      }

      const resolution = bytes ? parseImageSize(bytes) : null;
      const mime = typeof img?.mimeType === "string" ? img.mimeType : toMime(bytes);
      // Webviews render PNG/JPEG/WebP/GIF natively.  Cap raw size at 4 MiB.
      const previewable = mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" || mime === "image/gif";
      const thumbnailDataUrl =
        bytes && bytes.length <= 4 * 1024 * 1024 && previewable
          ? bytesToDataUrl(bytes, mime)
          : null;

      return {
        index: i,
        name: safeName(img?.name),
        mimeType: typeof img?.mimeType === "string" ? img.mimeType : null,
        bufferView: bvIdx,
        uri,
        uriIsDataUrl,
        uriDataLength,
        bufferViewByteLength: bvByteLength,
        resolution,
        thumbnailDataUrl,
      };
    })
  );

  const animationInfos: AnimationInfo[] = animations.map((anim: any, ai: number): AnimationInfo => {
    const channels = arr<any>(anim?.channels);
    const samplersA = arr<any>(anim?.samplers);
    let dMin: number | null = null;
    let dMax: number | null = null;
    const channelInfos: AnimationChannelInfo[] = channels.map((ch: any, ci: number) => {
      const sIdx = typeof ch?.sampler === "number" ? ch.sampler : -1;
      const samp = sIdx >= 0 ? samplersA[sIdx] : null;
      const target = ch?.target ?? {};
      const targetNode = typeof target.node === "number" ? target.node : null;
      const inputAcc = samp && typeof samp.input === "number" ? samp.input : null;
      const outputAcc = samp && typeof samp.output === "number" ? samp.output : null;
      let kf: number | null = null;
      let tMin: number | null = null;
      let tMax: number | null = null;
      if (inputAcc !== null && accessors[inputAcc]) {
        const inAcc = accessors[inputAcc];
        if (typeof inAcc.count === "number") kf = inAcc.count;
        if (Array.isArray(inAcc.min) && typeof inAcc.min[0] === "number") {
          tMin = inAcc.min[0];
          if (dMin === null || tMin < dMin) dMin = tMin;
        }
        if (Array.isArray(inAcc.max) && typeof inAcc.max[0] === "number") {
          tMax = inAcc.max[0];
          if (dMax === null || tMax > dMax) dMax = tMax;
        }
      }
      return {
        index: ci,
        samplerIndex: sIdx,
        targetNode,
        targetNodeName: targetNode !== null ? (nodeInfos[targetNode]?.name ?? null) : null,
        targetPath: typeof target.path === "string" ? target.path : null,
        interpolation: samp && typeof samp.interpolation === "string" ? samp.interpolation : "LINEAR",
        inputAccessor: inputAcc,
        outputAccessor: outputAcc,
        keyframeCount: kf,
        tMin,
        tMax,
      };
    });
    const duration = dMax !== null ? dMax - (dMin ?? 0) : null;
    return { index: ai, name: safeName(anim?.name), channels: channelInfos, duration };
  });

  const skinInfos: SkinInfo[] = skins.map((sk: any, i: number) => ({
    index: i,
    name: safeName(sk?.name),
    skeleton: typeof sk?.skeleton === "number" ? sk.skeleton : null,
    skeletonName:
      typeof sk?.skeleton === "number" ? (nodeInfos[sk.skeleton]?.name ?? null) : null,
    inverseBindMatrices:
      typeof sk?.inverseBindMatrices === "number" ? sk.inverseBindMatrices : null,
    joints: arr<number>(sk?.joints)
      .filter((j) => typeof j === "number")
      .map((j) => ({ index: j, name: nodeInfos[j]?.name ?? null })),
  }));

  const cameraInfos: CameraInfo[] = cameras.map((cam: any, i: number) => {
    const p = cam?.perspective;
    const o = cam?.orthographic;
    return {
      index: i,
      name: safeName(cam?.name),
      type: typeof cam?.type === "string" ? cam.type : null,
      perspective: p
        ? {
            yfov: typeof p.yfov === "number" ? p.yfov : null,
            aspectRatio: typeof p.aspectRatio === "number" ? p.aspectRatio : null,
            znear: typeof p.znear === "number" ? p.znear : null,
            zfar: typeof p.zfar === "number" ? p.zfar : null,
          }
        : null,
      orthographic: o
        ? {
            xmag: typeof o.xmag === "number" ? o.xmag : null,
            ymag: typeof o.ymag === "number" ? o.ymag : null,
            znear: typeof o.znear === "number" ? o.znear : null,
            zfar: typeof o.zfar === "number" ? o.zfar : null,
          }
        : null,
    };
  });

  const bufferInfos: BufferInfo[] = buffers.map((b: any, i: number) => {
    const uri = typeof b?.uri === "string" ? b.uri : null;
    const isData = uri !== null && uri.startsWith("data:");
    return {
      index: i,
      name: safeName(b?.name),
      byteLength: typeof b?.byteLength === "number" ? b.byteLength : 0,
      uri,
      uriIsDataUrl: isData,
      uriDataLength: isData ? uri!.length : null,
      embedded: uri === null,
    };
  });

  const bufferViewInfos: BufferViewInfo[] = bufferViews.map((bv: any, i: number) => ({
    index: i,
    name: safeName(bv?.name),
    buffer: typeof bv?.buffer === "number" ? bv.buffer : 0,
    byteOffset: typeof bv?.byteOffset === "number" ? bv.byteOffset : 0,
    byteLength: typeof bv?.byteLength === "number" ? bv.byteLength : 0,
    byteStride: typeof bv?.byteStride === "number" ? bv.byteStride : null,
    target: typeof bv?.target === "number" ? bv.target : null,
    targetName: typeof bv?.target === "number" ? (BUFFER_VIEW_TARGET[bv.target] ?? String(bv.target)) : null,
  }));

  const accessorInfos: AccessorInfo[] = accessors.map((a: any, i: number) => ({
    index: i,
    name: safeName(a?.name),
    bufferView: typeof a?.bufferView === "number" ? a.bufferView : null,
    byteOffset: typeof a?.byteOffset === "number" ? a.byteOffset : 0,
    type: typeof a?.type === "string" ? a.type : null,
    componentType: typeof a?.componentType === "number" ? a.componentType : 0,
    componentTypeName:
      typeof a?.componentType === "number"
        ? (COMPONENT_TYPE[a.componentType] ?? String(a.componentType))
        : "?",
    count: typeof a?.count === "number" ? a.count : 0,
    min: takeNumberArray(a?.min),
    max: takeNumberArray(a?.max),
    normalized: a?.normalized === true,
    sparse: a?.sparse !== undefined && a?.sparse !== null,
  }));

  // Per-object extension scan (mirrors _scan_extensions in sections.py).
  const extensionEntries: ExtensionEntry[] = [];
  const collections: [string, any[]][] = [
    ["Node", nodes], ["Mesh", meshes], ["Material", materials],
    ["Texture", textures], ["Image", images], ["Sampler", samplers],
    ["Animation", animations], ["Skin", skins], ["Camera", cameras],
    ["Buffer", buffers], ["BufferView", bufferViews], ["Accessor", accessors],
  ];
  for (const [typeName, coll] of collections) {
    for (let i = 0; i < coll.length; i++) {
      const ex = coll[i]?.extensions;
      if (ex && typeof ex === "object") {
        extensionEntries.push({
          location: `${typeName} ${i}`,
          name: safeName(coll[i]?.name),
          data: ex,
        });
      }
    }
  }
  for (let mi = 0; mi < meshes.length; mi++) {
    const prims = arr<any>(meshes[mi]?.primitives);
    for (let pi = 0; pi < prims.length; pi++) {
      const ex = prims[pi]?.extensions;
      if (ex && typeof ex === "object") {
        extensionEntries.push({
          location: `Mesh ${mi} Primitive ${pi}`,
          name: null,
          data: ex,
        });
      }
    }
  }

  const counts: Record<string, number> = {
    Scenes: scenes.length,
    Nodes: nodes.length,
    Meshes: meshes.length,
    Materials: materials.length,
    Textures: textures.length,
    Images: images.length,
    Animations: animations.length,
    Skins: skins.length,
    Cameras: cameras.length,
    Buffers: buffers.length,
    "Buffer Views": bufferViews.length,
    Accessors: accessors.length,
  };

  return {
    file: {
      name: path.basename(filePath),
      path: filePath,
      format: loaded.format,
      size: loaded.fileSize,
    },
    asset: {
      version: typeof asset.version === "string" ? asset.version : null,
      generator: typeof asset.generator === "string" ? asset.generator : null,
      copyright: typeof asset.copyright === "string" ? asset.copyright : null,
      minVersion: typeof asset.minVersion === "string" ? asset.minVersion : null,
    },
    counts,
    extensionsUsed: arr<string>(json.extensionsUsed).filter((s) => typeof s === "string"),
    extensionsRequired: arr<string>(json.extensionsRequired).filter((s) => typeof s === "string"),
    scenes: sceneInfos,
    defaultScene: typeof json.scene === "number" ? json.scene : null,
    nodes: nodeInfos,
    meshes: meshInfos,
    materials: materialInfos,
    textures: textureInfos,
    samplers: samplerInfos,
    images: imageInfos,
    animations: animationInfos,
    skins: skinInfos,
    cameras: cameraInfos,
    buffers: bufferInfos,
    bufferViews: bufferViewInfos,
    accessors: accessorInfos,
    extensions: extensionEntries,
    topLevelExtensions:
      json.extensions && typeof json.extensions === "object" ? json.extensions : null,
    warnings,
  };
}
