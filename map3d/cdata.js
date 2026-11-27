// The 3D view's grid data (the C look) and its placement check. No DOM here: the page and the tests (node) share it.
//
// A chunk file (map3d/c/<a>_<b>.bin, written by the staff tools' map3d_export.py; chunk (a, b) holds x in
// [16a - 8, 16a + 8), z the same): "OG3C" | u8 version 1 | i16 a, b | 256 cells, z-major (z = 16b - 8 + j,
// x = 16a - 8 + i): u8 n cubes, each i8 cube y, u8 kind (KINDS), u8 flags (CUBE) | u8 n layers, each i8 floor cube f,
// u8 stand (stand height - f, in hundredths), u8 page floor (maplink.js floorCode), u8 bad bits (BAD), u8 warn bits
// (WARN), u8 exits (the server's walk steps to N 1, E 2, S 4, W 8).
// A cube y fills y - 1 .. y in the meshes; a player standing on it is at y + 0.8 (what /pos prints). A layer is where a
// player can be put: the server's own faults for a landing (the landing tools' rule) and its walk out of it.
import { floorOf } from "../maplink.js";

export const CHUNK = 16;
export const KINDS = ["none", "grass", "dirt", "sand", "rock", "paved", "wood", "snow", "lava", "other",
  "slopeN", "slopeE", "slopeS", "slopeW", "water", "wall", "hidden", "roof", "object"];
export const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
export const CUBE = { walk: 1, dark: 2, pz: 4, swamp: 8 };
export const BAD = { object: 1, inside: 2, void: 4, lava: 8, water: 16, dark: 32, roof: 64, closed: 128 };
export const WARN = { slope: 1, edge: 2, hidden: 4, nogrid: 8 };
export const EXITS = [["N", 1], ["E", 2], ["S", 4], ["W", 8]];
// the order reasons are said in (the worst first)
const BAD_ORDER = ["water", "inside", "dark", "lava", "void", "roof", "object", "closed"];
const WARN_ORDER = ["edge", "slope", "hidden", "nogrid"];

// the chunk of a cell, and its file's name
export const chunkOf = (x, z) => [Math.floor((x + 8) / CHUNK), Math.floor((z + 8) / CHUNK)];
export const chunkKey = (a, b) => a + "_" + b;
export const cellKey = (x, z) => x + "," + z;
// a chunk's distance to a focus (x, z), in cells: its centre's
export const chunkDistance = (a, b, x, z) => Math.hypot(a * CHUNK - x, b * CHUNK - z);
// chunks as [a, b] pairs (or {a, b} objects), the nearest to the focus first (a stable sort: equal distances keep their order)
export const nearestFirst = (list, x, z) => [...list].sort((p, q) => {
  const [pa, pb] = Array.isArray(p) ? p : [p.a, p.b], [qa, qb] = Array.isArray(q) ? q : [q.a, q.b];
  return chunkDistance(pa, pb, x, z) - chunkDistance(qa, qb, x, z);
});

// a chunk file -> {a, b, cells: Map("x,z" -> {x, z, cubes: [{y, kind, flags}], layers: [layer]})}
export function decodeChunk(buf) {
  const d = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  const magic = String.fromCharCode(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3));
  if (magic !== "OG3C") throw new Error("not a map3d chunk: " + magic);
  if (d.getUint8(4) !== 1) throw new Error("map3d chunk version " + d.getUint8(4));
  const a = d.getInt16(5, true), b = d.getInt16(7, true);
  let p = 9;
  const cells = new Map();
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const x = CHUNK * a - 8 + i, z = CHUNK * b - 8 + j;
    const cubes = [], layers = [];
    for (let n = d.getUint8(p++); n > 0; n--, p += 3) cubes.push({ y: d.getInt8(p), kind: d.getUint8(p + 1), flags: d.getUint8(p + 2) });
    for (let n = d.getUint8(p++); n > 0; n--, p += 6) {
      const f = d.getInt8(p);
      layers.push({ x, z, f, stand: Math.round((f + d.getUint8(p + 1) / 100) * 100) / 100, floor: floorOf(d.getUint8(p + 2)),
        bad: d.getUint8(p + 3), warn: d.getUint8(p + 4), exits: d.getUint8(p + 5) });
    }
    cells.set(cellKey(x, z), { x, z, cubes, layers });
  }
  if (p !== d.byteLength) throw new Error(`map3d chunk ${a}_${b}: ${d.byteLength - p} bytes left over`);
  return { a, b, cells };
}

// a layer's verdict: {level: "ok" | "warn" | "bad", reasons: [{code, ...}]} (codes: BAD and WARN names; "edge" names
// the sides with no step)
export function verdict(layer) {
  const reasons = [];
  for (const k of BAD_ORDER) if (layer.bad & BAD[k]) reasons.push({ code: k });
  // (a bad spot says why it is bad; its edges and slopes would only add noise)
  if (!layer.bad) for (const k of WARN_ORDER) if (layer.warn & WARN[k]) {
    if (k === "edge") reasons.push({ code: k, sides: EXITS.filter(([, bit]) => !(layer.exits & bit)).map(([s]) => s) });
    else reasons.push({ code: k });
  }
  const level = layer.bad ? "bad" : layer.warn ? "warn" : "ok";
  return { level, reasons };
}

const WALLISH = new Set([K.wall, K.object, K.roof, K.hidden]);

// What a pointer on the 3D view hits: the cell, the height it hit and whether that face looks up. -> {layer, cube,
// level, reasons}. A top face: the layer standing on that cube (a water surface: the bed under it, which says water).
// A side: no layer there, the cube's side (a wall, an object, a cliff): bad.
export function pickAt(cell, y, up = true) {
  if (!cell) return { layer: null, cube: null, level: "bad", reasons: [{ code: "nodata" }] };
  const cubeAt = (h) => cell.cubes.find((c) => c.y - 1 < h && h <= c.y + 0.01) || null;
  if (up) {
    // the layer whose cube top is at y (a slope's stand is a little lower or higher: take the nearest within a cube)
    let best = null;
    for (const l of cell.layers) {
      const d = Math.abs(l.f - y);
      if (d <= 1.0 && (!best || d < Math.abs(best.f - y))) best = l;
    }
    const wet = cell.cubes.find((c) => c.kind === K.water && Math.abs(c.y - 0.2 - y) < 0.3);
    if (wet) {   // the water's sheet: the ground under it
      const bed = cell.layers.filter((l) => l.f < wet.y).sort((p, q) => q.f - p.f)[0];
      if (bed) return { layer: bed, cube: wet, ...verdict(bed) };
      return { layer: null, cube: wet, level: "bad", reasons: [{ code: "water" }] };
    }
    if (best) return { layer: best, cube: cubeAt(best.f - 0.5), ...verdict(best) };
    const c = cubeAt(y - 0.01);
    return { layer: null, cube: c, level: "bad", reasons: [{ code: c && WALLISH.has(c.kind) ? "wallTop" : "covered" }] };
  }
  const c = cubeAt(y);
  return { layer: null, cube: c, level: "bad", reasons: [{ code: c && WALLISH.has(c.kind) ? "wall" : "cliff", kind: c ? KINDS[c.kind] : "" }] };
}

// the layer a marker of the 2D page stands on: its cell's layers on its floor (the highest one; a floor with no layer
// there: the surface's top layer, else the layer nearest that slice) -> layer or null
export function layerFor(cell, floor) {
  if (!cell || !cell.layers.length) return null;
  let on = cell.layers.filter((l) => l.floor === floor);
  // a house: its floor and its roof are both on the surface floor; the 2D surface draws the ground without roofs, so a
  // marker there is inside (the roof only when it is all the cell has: a post put in a wall stands on its roof)
  const under = on.filter((l) => !(l.bad & BAD.roof));
  if (under.length) on = under;
  if (on.length) return on.reduce((p, q) => (q.stand > p.stand ? q : p));
  if (floor === "s") return cell.layers.reduce((p, q) => (q.stand > p.stand ? q : p));
  const n = +floor;
  return cell.layers.reduce((p, q) => (Math.abs(q.f - n) < Math.abs(p.f - n) ? q : p));
}

// the height a marker is drawn at when its cell has no layer (inside a wall: the top of what is there)
export function topOf(cell) {
  if (!cell || !cell.cubes.length) return 0;
  return Math.max(...cell.cubes.map((c) => c.y));
}

// The markers' ends checked against the grid: [{id, end: "at" | "dest", x, z, floor, level, reasons}], the worst
// first, then [{passed}] counts. cellAt(x, z) -> a cell or undefined (not loaded: not checked). Only the kinds a
// player stands at or lands on: a spawn, a rope's or portal's own spot and its landing.
export const CHECKED = new Set(["spawn", "rope", "rope2", "hole", "portal", "elevator", "lever", "npc", "boss", "door"]);
export function problemsOf(markers, cellAt) {
  const out = [], passed = { spots: 0, landings: 0, unloaded: 0 };
  for (const m of markers) {
    if (!CHECKED.has(m.kind) || !("x" in m)) continue;
    const ends = [["at", m.x, m.z, m.floor]];
    if (m.dest) ends.push(["dest", m.dest.x, m.dest.z, m.dest.floor]);
    for (const [end, x, z, floor] of ends) {
      const cell = cellAt(x, z);
      if (!cell) { passed.unloaded++; continue; }
      const layer = layerFor(cell, floor);
      const v = layer && layer.floor === floor ? verdict(layer)
        : layer && floor === "s" ? verdict(layer)
          : { level: "bad", reasons: [{ code: layer ? "otherFloor" : "nofloor" }] };
      if (v.level === "ok") { passed[end === "at" ? "spots" : "landings"]++; continue; }
      // a rope post itself stands on its tile (not judged for edges: it is a post, the landing is what a player uses)
      if (end === "at" && v.level === "warn" && m.kind !== "spawn") { passed.spots++; continue; }
      out.push({ id: m.id, kind: m.kind, end, x, z, floor, level: v.level, reasons: v.reasons, stand: layer ? layer.stand : null });
    }
  }
  out.sort((p, q) => (p.level === q.level ? 0 : p.level === "bad" ? -1 : 1));
  return { problems: out, passed };
}

// the words of a reason: t3(key, ...values) is the page's translator for map3d/words3d.js
export function reasonText(r, t3) {
  if (r.code === "edge") return t3("r.edge", r.sides.map((s) => t3("side." + s)).join(", "));
  if (r.code === "wall" || r.code === "cliff") return t3("r." + r.code, r.kind ? t3("kind3." + r.kind) : "");
  return t3("r." + r.code);
}
