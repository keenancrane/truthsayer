"""GL enum → human-readable name mappings for glTF 2.0."""

COMPONENT_TYPE = {
    5120: "BYTE",
    5121: "UNSIGNED_BYTE",
    5122: "SHORT",
    5123: "UNSIGNED_SHORT",
    5125: "UNSIGNED_INT",
    5126: "FLOAT",
}

PRIMITIVE_MODE = {
    0: "POINTS",
    1: "LINES",
    2: "LINE_LOOP",
    3: "LINE_STRIP",
    4: "TRIANGLES",
    5: "TRIANGLE_STRIP",
    6: "TRIANGLE_FAN",
}

BUFFER_VIEW_TARGET = {
    34962: "ARRAY_BUFFER",
    34963: "ELEMENT_ARRAY_BUFFER",
}

SAMPLER_MAG_FILTER = {
    9728: "NEAREST",
    9729: "LINEAR",
}

SAMPLER_MIN_FILTER = {
    9728: "NEAREST",
    9729: "LINEAR",
    9984: "NEAREST_MIPMAP_NEAREST",
    9985: "LINEAR_MIPMAP_NEAREST",
    9986: "NEAREST_MIPMAP_LINEAR",
    9987: "LINEAR_MIPMAP_LINEAR",
}

SAMPLER_WRAP = {
    33071: "CLAMP_TO_EDGE",
    33648: "MIRRORED_REPEAT",
    10497: "REPEAT",
}

ANIMATION_INTERPOLATION = {
    "LINEAR": "LINEAR",
    "STEP": "STEP",
    "CUBICSPLINE": "CUBICSPLINE",
}

ANIMATION_PATH = {
    "translation": "translation",
    "rotation": "rotation",
    "scale": "scale",
    "weights": "weights",
}

ALPHA_MODE = {
    "OPAQUE": "OPAQUE",
    "MASK": "MASK",
    "BLEND": "BLEND",
}

COMPONENT_TYPE_SIZE = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
}

ACCESSOR_TYPE_COUNT = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}
