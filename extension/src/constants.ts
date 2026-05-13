// GL enum -> human-readable name mappings for glTF 2.0.
// Mirrors truthsayer/constants.py.

export const COMPONENT_TYPE: Record<number, string> = {
  5120: "BYTE",
  5121: "UNSIGNED_BYTE",
  5122: "SHORT",
  5123: "UNSIGNED_SHORT",
  5125: "UNSIGNED_INT",
  5126: "FLOAT",
};

export const COMPONENT_TYPE_SIZE: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

export const PRIMITIVE_MODE: Record<number, string> = {
  0: "POINTS",
  1: "LINES",
  2: "LINE_LOOP",
  3: "LINE_STRIP",
  4: "TRIANGLES",
  5: "TRIANGLE_STRIP",
  6: "TRIANGLE_FAN",
};

export const BUFFER_VIEW_TARGET: Record<number, string> = {
  34962: "ARRAY_BUFFER",
  34963: "ELEMENT_ARRAY_BUFFER",
};

export const SAMPLER_MAG_FILTER: Record<number, string> = {
  9728: "NEAREST",
  9729: "LINEAR",
};

export const SAMPLER_MIN_FILTER: Record<number, string> = {
  9728: "NEAREST",
  9729: "LINEAR",
  9984: "NEAREST_MIPMAP_NEAREST",
  9985: "LINEAR_MIPMAP_NEAREST",
  9986: "NEAREST_MIPMAP_LINEAR",
  9987: "LINEAR_MIPMAP_LINEAR",
};

export const SAMPLER_WRAP: Record<number, string> = {
  33071: "CLAMP_TO_EDGE",
  33648: "MIRRORED_REPEAT",
  10497: "REPEAT",
};

export const ACCESSOR_TYPE_COUNT: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

export const ALL_SECTIONS = [
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
] as const;

export type SectionId = (typeof ALL_SECTIONS)[number];

export const SECTION_TITLES: Record<SectionId, string> = {
  overview: "File Overview",
  scene: "Scene Graph",
  meshes: "Meshes",
  materials: "Materials",
  textures: "Textures, Samplers & Images",
  animations: "Animations",
  skins: "Skins",
  cameras: "Cameras",
  buffers: "Buffers, Buffer Views & Accessors",
  extensions: "Extensions",
};
