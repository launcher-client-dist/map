// A bridge proposal in the 3D editor: a stock bridge of the game (a prefab) stretched between two banks, and the
// server's walk over it. No DOM here: the page and the tests (node) share it.
//
// The prefabs (map3d/bridge_prefabs.json, read by the staff tools from the client's own voxel and decor records,
// 2026-11-27) are six stock bridges, each as its records in one frame: i along the bridge from bank A, r to its right, dy
// over bank A's cube, rotations and slope tiles as if it ran east. Each stretches the way the stock one is built: a start
// cap (its cells i < s: stairs, gates, the first log), then segments of p cells taken in turn from the stock's own
// middle (a log and its railing; a plank and its rope), then the stock's end cap (its last e cells). So at the stock's
// own length a prefab is the stock bridge, record for record; longer or shorter it adds or drops whole segments (the
// length steps by p). Support columns (logs, pillars) reach down to the ground under them. "plain" is the bare deck (the
// swamp's walkways: most stock bridges), any width, with logs only where a stretch would pass MAX_SPAN.
// The walk is the ramp's (map3d/ramp.js: the server's step rule), over the grid with the bridge's cubes put in.
import { K } from "./cdata.js";
import { DIRS, lanes, axisOf, walkRamp, rampReason } from "./ramp.js";

export const PRESETS = ["swamp", "raised", "raisedLogs", "broken", "rope", "canopy", "gapFill", "plain"];
export const GAP_MAX = 4;   // the gap filler: a gap of at most this many cells (the stock one fills 3 and 4)
export const MAX_RUN = 32, MAX_SPAN = 8, LOG_DEPTH = 12, SUPPORT_DEPTH = 16;
const DECK = [643, "SwampWoodBridge"], LOG = [7, "SwampWoodLog"];
// the frame: the step along (dx, dz) and the right (rx, rz) of each direction, and its quarter turns from east
const FRAME = { E: [1, 0, 0, -1, 0], N: [0, 1, 1, 0, 1], W: [-1, 0, 0, 1, 2], S: [0, -1, -1, 0, 3] };
const SLOPE_DIR = { 171: "N", 172: "E", 173: "S", 174: "W" }, SLOPE_ID = { N: 171, E: 172, S: 173, W: 174 };
const TURN = ["E", "N", "W", "S"];
const SWAP = { 170: 169, 169: 170, 6: 12, 12: 6 };   // along-x / along-z twins (walls, planks)
const SLOPE_K = { 171: 1, 172: 2, 173: 3, 174: 4 };   // (the ramp's slope types: rising N, E, S, W)
// tile names of the cubes a walker can't stand in but are not ground (invisible decks and walls are solid to the walk)
const solid = (c) => c.kind !== K.water;
const cubeAt = (cell, y) => (cell?.cubes || []).find((c) => c.y === y) || null;
function landAt(cell, f) {
  const c = cubeAt(cell, f);
  return !!(c && solid(c) && !cubeAt(cell, f + 1) && !cubeAt(cell, f + 2));
}
function groundBelow(cell, y, depth) {   // the highest solid cube under y within depth, or null
  let g = null;
  for (const c of cell?.cubes || []) if (solid(c) && c.y < y && c.y >= y - depth && (g === null || c.y > g)) g = c.y;
  return g;
}
const longest = (sup) => { let g = 0; for (let k = 1; k < sup.length; k++) g = Math.max(g, sup[k] - sup[k - 1] - 1); return g; };

// the lengths a prefab can take: s + e + p x n (n >= 0), at most MAX_RUN
export function lengthsOf(pf) {
  if (!pf || typeof pf === "string" || pf.id === "plain") return null;
  const out = [];
  for (let L = pf.s + pf.e; L <= MAX_RUN; L += pf.p) out.push(L);
  return out;
}
// the nearest length a prefab can take to `run`
export function snapLength(pf, run) {
  const L = lengthsOf(pf);
  if (!L) return run;
  return L.reduce((p, q) => (Math.abs(q - run) < Math.abs(p - run) ? q : p), L[0]);
}

// Plan a bridge from bank A to bank B ({x, z, f}: the cube each bank stands on) as a prefab (its object from
// bridge_prefabs.json; or "plain") -> {kind, preset, lo, hi, dir, run, rise, width, segments, rows: [{k: "v"|"d", id, t,
// x, y, z, rot, store}], deck, supports, span, cols, problems}
export function planBridge(a, b, width, cellAt, prefab = null) {
  const dir = axisOf(a, b);
  const [dx, dz, rx, rz, turns] = FRAME[dir];
  const run = Math.abs(dx ? b.x - a.x : b.z - a.z);
  const problems = [];
  if (b.f !== a.f) problems.push({ code: "uneven", diff: b.f - a.f, x: b.x, z: b.z });
  if (prefab === "gapFill" || prefab?.id === "gapFill") return gapPlan(a, b, width, cellAt, dir, run, problems);
  if (!prefab || prefab === "plain" || prefab.id === "plain") return plainPlan(a, b, width, cellAt, dir, run, problems);
  const pf = prefab, n = pf.stockLength, { s, p, e } = pf;
  const middle = run - s - e;
  if (middle < 0) problems.push({ code: "tooShort", min: s + e });
  if (run > MAX_RUN) problems.push({ code: "tooLong", run, max: MAX_RUN });
  if (middle >= 0 && middle % p) problems.push({ code: "step", step: p, near: snapLength(pf, run) });
  const k = Math.max(0, Math.floor(middle / p)), m = Math.max(1, Math.round((n - s - e) / p));
  const at = (i, r) => ({ x: a.x + i * dx + r * rx, z: a.z + i * dz + r * rz });
  const rows = [];
  const put = (q, i) => {
    let id = q.id;
    if (q.k === "v" && SLOPE_DIR[id]) id = SLOPE_ID[TURN[(TURN.indexOf(SLOPE_DIR[id]) + turns) % 4]];
    else if (q.k === "v" && SWAP[id] && turns % 2) id = SWAP[id];
    const t = nameOfSwap(q.t, id);
    rows.push({ k: q.k, id, t, ...at(i, q.r), y: a.f + q.dy, ...(q.k === "d" ? { rot: (q.rot - 90 * turns + 720) % 360 } : {}), store: storeOf(pf, q.t),
      ...(q.foot ? { foot: true } : {}) });
  };
  for (const q of pf.records) {
    if (q.i < s) put(q, q.i);
    else if (q.i >= n - e) put(q, q.i + (run - n));
    else {
      const seg = Math.floor((q.i - s) / p), off = (q.i - s) % p;
      for (let g = 0; g < k; g++) if (g % m === seg) put(q, s + g * p + off);
    }
  }
  adaptSupports(rows, cellAt);
  // the walk's grid: every voxel (slopes as slopes), the decors left out (a model, not a cube)
  const cols = rows.filter((q) => q.k === "v").map((q) => ({ x: q.x, z: q.z, y0: q.y, top: q.y, k: SLOPE_K[q.id] || 0 }));
  return { kind: "bridge", preset: pf.id, lo: a, hi: b, dir, run, rise: b.f - a.f, width: 1, segments: k, rows, deck: [], span: 0,
    supports: [], cols, problems, lanes: pf.lanes || [0] };
}
// (a swapped twin's name: the planks and the walls come in along-x / along-z pairs)
function nameOfSwap(t, id) {
  const twins = { 170: "HorizontalWall", 169: "VerticalWall", 6: "SwampWoodCubeH", 12: "SwampWoodCubeV", 171: "Slope1", 172: "Slope2", 173: "Slope3", 174: "Slope4" };
  return twins[id] || t;
}
function storeOf(pf, t) { return pf.pieces?.[t]?.store || pf.pieces?.[nameOfSwap(t, 0)]?.store || "bake"; }
// support columns (logs, pillars) that stand on the ground in the stock bridge (their foot): down to the ground under
// them here (or up out of ground that rose); a column hanging over water stays as it is
function adaptSupports(rows, cellAt) {
  for (const foot of rows.filter((q) => q.foot)) {
    const list = rows.filter((q) => q.k === "v" && q.id === foot.id && q.x === foot.x && q.z === foot.z);
    const g = groundBelow(cellAt(foot.x, foot.z), foot.y + 1, SUPPORT_DEPTH);
    if (g === null) continue;
    if (g + 1 < foot.y) for (let y = g + 1; y < foot.y; y++) rows.push({ ...foot, y });
    else if (g >= foot.y) for (let i = rows.length - 1; i >= 0; i--) if (list.includes(rows[i]) && rows[i].y <= g) rows.splice(i, 1);
  }
}

// "plain": the bare swamp deck, 1 to 3 wide, at bank A's height over every cell that isn't ground there; logs (both
// sides, from the bed up to the deck + 2) only where a stretch would pass MAX_SPAN
function plainPlan(a, b, width, cellAt, dir, run, problems) {
  const [dx, dz, rx, rz] = FRAME[dir];
  const w = Math.max(1, Math.min(3, width | 0 || 1)), f = a.f;
  const L = lanes(w).map((j) => -j);   // (the lanes as right offsets)
  const at = (i, r) => ({ x: a.x + i * dx + r * rx, z: a.z + i * dz + r * rz });
  if (run < 2) problems.push({ code: "tooShort", min: 2 });
  if (run > MAX_RUN) problems.push({ code: "tooLong", run, max: MAX_RUN });
  const rows = [], deck = [];
  const span = Math.min(run, MAX_RUN + 1);
  for (let i = 1; i < span; i++) for (const r of L) {
    const p = at(i, r);
    if (landAt(cellAt(p.x, p.z), f)) continue;
    deck.push({ ...p, i, r });
    rows.push({ k: "v", id: DECK[0], t: DECK[1], ...p, y: f, store: "bake" });
  }
  const di = [...new Set(deck.map((d) => d.i))].sort((p, q) => p - q);
  const sup = new Set([0, run]);
  for (let i = 1; i < span; i++) if (!di.includes(i) || L.some((r) => { const p = at(i, r), c = cubeAt(cellAt(p.x, p.z), f - 1); return c && solid(c); })) sup.add(i);
  const s0 = [...sup].sort((p, q) => p - q), want = [];
  for (let k = 1; k < s0.length; k++) {
    const gap = s0[k] - s0[k - 1] - 1;
    if (gap <= MAX_SPAN) continue;
    const n = Math.ceil((gap + 1) / (MAX_SPAN + 1)) - 1;
    for (let m = 1; m <= n; m++) want.push(s0[k - 1] + Math.round((m * (s0[k] - s0[k - 1])) / (n + 1)));
  }
  const logsAt = new Set();
  for (const i of want) for (const r of [Math.min(...L) - 1, Math.max(...L) + 1]) {
    const p = at(i, r), cell = cellAt(p.x, p.z);
    if (landAt(cell, f)) continue;
    const g = groundBelow(cell, f, LOG_DEPTH);
    if (g === null) continue;
    for (let y = g + 1; y <= f + 2; y++) rows.push({ k: "v", id: LOG[0], t: LOG[1], ...p, y, store: "bake" });
    logsAt.add(i);
  }
  const supports = [...new Set([...s0, ...logsAt])].sort((p, q) => p - q);
  const gap = longest(supports);
  if (gap > MAX_SPAN && !problems.some((p) => p.code === "tooLong")) problems.push({ code: "tooFar", span: gap, max: MAX_SPAN });
  const cols = rows.map((q) => ({ x: q.x, z: q.z, y0: q.y, top: q.y, k: 0 }));
  return { kind: "bridge", preset: "plain", lo: a, hi: b, dir, run, rise: b.f - f, width: w, segments: 0, rows, deck, supports, span: gap, cols, problems };
}

// "gapFill" (the stock filler at 131, -66: wooden planks closing a gap of a few cells between two places at the same
// level): a SwampWoodCubeH (along x; its along-z twin SwampWoodCubeV) at the banks' height over every cell of the gap
// that isn't ground there, 1 to 3 wide, and a SwampWoodFence at deck + 1 on each side that opens onto water or a drop
// (facing the planks: the same rotations as the bridges' railings)
function gapPlan(a, b, width, cellAt, dir, run, problems) {
  const [dx, dz, rx, rz, turns] = FRAME[dir];
  const w = Math.max(1, Math.min(3, width | 0 || 1)), f = a.f;
  const L = lanes(w).map((j) => -j);
  const at = (i, r) => ({ x: a.x + i * dx + r * rx, z: a.z + i * dz + r * rz });
  if (run < 2) problems.push({ code: "tooShort", min: 2 });
  if (run - 1 > GAP_MAX) problems.push({ code: "gapLong", gap: run - 1, max: GAP_MAX });
  const plank = turns % 2 ? [12, "SwampWoodCubeV"] : [6, "SwampWoodCubeH"];
  const rows = [], deck = [];
  for (let i = 1; i < Math.min(run, GAP_MAX + 2); i++) for (const r of L) {
    const p = at(i, r);
    if (landAt(cellAt(p.x, p.z), f)) continue;
    deck.push({ ...p, i, r });
    rows.push({ k: "v", id: plank[0], t: plank[1], ...p, y: f, store: "bake" });
  }
  const edge = [Math.max(...L) + 1, Math.min(...L) - 1];   // (the right side, then the left)
  for (const d of deck) edge.forEach((r, side) => {
    if (d.r !== (side ? Math.min(...L) : Math.max(...L))) return;
    const p = at(d.i, r), cell = cellAt(p.x, p.z);
    if (landAt(cell, f) || cubeAt(cell, f + 1) || deck.some((q) => q.x === p.x && q.z === p.z)) return;
    rows.push({ k: "d", id: 23, t: "SwampWoodFence", ...p, y: f + 1, rot: ((side ? 180 : 0) - 90 * turns + 720) % 360, store: "bake" });
  });
  const cols = rows.filter((q) => q.k === "v").map((q) => ({ x: q.x, z: q.z, y0: q.y, top: q.y, k: 0 }));
  return { kind: "bridge", preset: "gapFill", lo: a, hi: b, dir, run, rise: b.f - f, width: w, segments: 0, rows, deck, supports: [], span: 0, cols, problems };
}

// Walk a bridge both ways (the ramp's walk: the server's step rule), on its centre line. The banks at two heights: one
// reason, "uneven" (it needs a ramp at the far end), not the step the walk then meets there.
export function walkBridge(plan, cellAt, layerAt = () => null) {
  // (a prefab: its deck lanes, the centre first; it walks when one of them walks both ways)
  let r = null;
  if (plan.preset !== "plain" && plan.preset !== "gapFill") {
    const [, , rx, rz] = FRAME[plan.dir];
    for (const lane of [...(plan.lanes || [0])].sort((p, q) => Math.abs(p) - Math.abs(q))) {
      const sh = (e) => ({ ...e, x: e.x + lane * rx, z: e.z + lane * rz });
      const w = walkRamp({ ...plan, lo: sh(plan.lo), hi: sh(plan.hi), width: 1 }, cellAt, layerAt);
      if (!r) r = w;
      if (w.ok) { r = { ...w, lane }; break; }
    }
  } else r = walkRamp(plan, cellAt, layerAt);
  if (plan.problems.some((p) => p.code === "uneven")) {
    const near = (x) => Math.abs(x.x - plan.hi.x) + Math.abs(x.z - plan.hi.z) <= 1 + plan.width;
    r.reasons = r.reasons.filter((x) => !(["step", "short", "drop", "blocked", "void"].includes(x.code) && near(x)));
  }
  return r;
}

// ---- the link: the prefab and the length are the bridge (the rows follow from them, its banks and the ground; the
// shipping step grafts that stock prefab's baked units): pieces "<dir>|<prefab>|<length>|<width>|<segments>"
export function encodeBridge(plan) {
  return `${plan.dir}|${plan.preset}|${plan.run}|${plan.width}|${plan.segments}`;
}
export function decodeBridge(text) {
  const m = /^([NESW])\|([A-Za-z]+)\|(\d+)\|([123])\|(\d+)$/.exec(String(text || ""));
  return m ? { dir: m[1], preset: m[2], run: +m[3], width: +m[4], segments: +m[5] } : null;
}
export const presetOf = (pieces) => decodeBridge(pieces)?.preset || "swamp";

// a bridge marker of the link -> its plan (prefabs: the loaded bridge_prefabs.json's list)
export function planOfBridge(m, cellAt, prefabs = []) {
  if (!m.points || m.points.length < 2 || !m.fields) return null;
  const fl = m.fields;
  if (!Number.isFinite(+fl.lo) || !Number.isFinite(+fl.hi) || fl.lo === "" || fl.hi === "") return null;
  const a = { x: m.points[0][0], z: m.points[0][1], f: +fl.lo }, b = { x: m.points[1][0], z: m.points[1][1], f: +fl.hi };
  const got = decodeBridge(fl.pieces), id = got?.preset || "swamp";
  const pf = id === "plain" || id === "gapFill" ? id : prefabs.find((q) => q.id === id) || null;
  if (!pf) return null;
  return planBridge(a, b, +fl.width || 1, cellAt, pf);
}

// the link fields of a plan (a bridge marker: points [[a.x, a.z], [b.x, b.z]] and these)
export function fieldsOfBridge(plan, label = "") {
  const out = { lo: plan.lo.f, hi: plan.hi.f, width: plan.width, pieces: encodeBridge(plan) };
  if (label) out.label = label;
  return out;
}

// what an approved bridge becomes: the rows in the server's data/map_edits format, each with how it ships ("bake": a
// built or static piece the client draws only from a chunk's bake, so the stock prefab's baked units are grafted;
// "placeable": a decor record; "collision": a record the client and the server both take)
export function editRows(plan) {
  return plan.rows.map((q) => ({ kind: q.k === "v" ? "voxel" : "decor", id: q.id, tile: q.t, at: [q.x, q.y, q.z], ...(q.rot != null ? { rot: q.rot } : {}), ship: q.store }));
}

// the reason in words (t3: the 3D view's translator); the ramp's for the walk's own reasons
export function bridgeReason(r, t3) {
  switch (r.code) {
    case "tooShort": return t3("br.tooShort", r.min);
    case "tooLong": return t3("br.tooLong", r.max);
    case "tooFar": return t3("br.tooFar", r.span, r.max);
    case "step": return t3("br.step", r.step, r.near);
    case "gapLong": return t3("br.gapLong", r.gap, r.max);
    case "uneven": return t3(r.diff > 0 ? "br.unevenUp" : "br.unevenDown", Math.abs(r.diff));
    default: return rampReason(r, t3);
  }
}
