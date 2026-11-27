// The B look's chunk meshes (map3d/b/<a>_<b>.glb): glTF 2.0 binary, as map3d_export.py writes them, read without a
// glTF loader (only what that writer uses). No DOM here: the page and the tests (node) share it.
// One node (translation + scale: KHR_mesh_quantization, positions as SHORT padded to 4 a vertex), one mesh, each
// primitive POSITION (SHORT VEC3, stride 8), COLOR_0 (normalized UNSIGNED_BYTE VEC4), indices (u16 or u32), its
// material's name ("ground" or "water").
const COMP = { 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array };
const SIZE = { SCALAR: 1, VEC3: 3, VEC4: 4 };

export function parseGlb(buf) {
  const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const d = new DataView(ab);
  if (d.getUint32(0, true) !== 0x46546c67 || d.getUint32(4, true) !== 2) throw new Error("not a glTF 2 binary");
  const jsonLen = d.getUint32(12, true);
  if (d.getUint32(16, true) !== 0x4e4f534a) throw new Error("glb: no JSON chunk first");
  const gl = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)));
  const binAt = 20 + jsonLen;
  const binStart = binAt + 8;
  if (d.getUint32(binAt + 4, true) !== 0x004e4942) throw new Error("glb: no BIN chunk");
  const node = gl.nodes[0];
  const read = (i) => {
    const a = gl.accessors[i], v = gl.bufferViews[a.bufferView], T = COMP[a.componentType];
    if (!T) throw new Error("glb: component type " + a.componentType);
    const per = v.byteStride ? v.byteStride / T.BYTES_PER_ELEMENT : SIZE[a.type];
    return { array: new T(ab, binStart + (v.byteOffset || 0), a.count * per), stride: per, size: SIZE[a.type], count: a.count };
  };
  const prims = gl.meshes[0].primitives.map((p) => ({
    position: read(p.attributes.POSITION),
    color: read(p.attributes.COLOR_0),
    index: read(p.indices),
    material: gl.materials?.[p.material]?.name || "ground",
  }));
  return { translation: node.translation || [0, 0, 0], scale: node.scale || [1, 1, 1], prims };
}

// one vertex of a primitive in game coordinates (for tests and picking checks)
export function vertexOf(g, prim, i) {
  const p = prim.position.array, s = prim.position.stride;
  return [0, 1, 2].map((k) => g.translation[k] + p[i * s + k] * g.scale[k]);
}
