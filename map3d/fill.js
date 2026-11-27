// "Preencher" in the 3D editor: join two areas at the same level by filling the fewest cells between them with a chosen
// block (or a set of blocks), and the server's walk over it. No DOM here: the page and the tests (node) share it.
//
// The stock example (131.8, -4.2, -66.3): wooden planks (SwampWoodCubeH) laid at the walk level over a gap of a few
// cells of water, a SwampWoodFence on the edges that face water. The blocks offered are the game's own walk-level
// tiles (client records: the most used tops and floors, the swamp's first): a block at the areas' height on each cell
// to fill; a "set" adds what goes with it (the railing on open sides; an embankment's fill down to the ground). Each is a
// built or terrain voxel the client draws from the chunk's bake (shipped by grafting, as the bridges).
// The crossing: the fewest cells to fill between the two clicks, found on the grid at their level (ground there costs
// nothing, each cell to fill costs one, turns allowed: an L when the areas don't face each other); width 1 to 3 widens
// it across. The walk is the ramp's (map3d/ramp.js: the server's step rule), segment by segment along the path.
import { K } from "./cdata.js";
import { lanes, walkRamp, rampReason } from "./ramp.js";

// a block (or set): its top cube (its along-z twin for planks laid along z), what fills under it down to the ground,
// and a railing on open sides
export const BLOCKS = [
  { id: "planksRail", top: [6, "SwampWoodCubeH"], topZ: [12, "SwampWoodCubeV"], rail: [23, "SwampWoodFence"] },   // the stock filler
  { id: "planks", top: [6, "SwampWoodCubeH"], topZ: [12, "SwampWoodCubeV"] },
  { id: "swampDeck", top: [643, "SwampWoodBridge"] },
  { id: "woodFloor", top: [352, "PlainsWoodCube"] },
  { id: "stone", top: [20, "StoneTop"] },
  { id: "cobbleCauseway", top: [207, "CobbleStone"], down: [207, "CobbleStone"] },
  { id: "swampGrass", top: [163, "SwampGrassTop"], down: [1499, "MudFill"] },
  { id: "mud", top: [167, "MudTop"], down: [1499, "MudFill"] },
  { id: "earth", top: [9, "EarthTop"], down: [1497, "EarthFill"] },
];
export const MAX_FILL = 24, DOWN_DEPTH = 16, MARGIN = 4, MAX_BOX = 48;
// a railing beside a cell, by the side it stands on (the bridges' rule: it faces the walk)
const RAIL_ROT = { "0,-1": 0, "0,1": 180, "-1,0": 90, "1,0": 270 };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const solid = (c) => c.kind !== K.water;
const cubeAt = (cell, y) => (cell?.cubes || []).find((c) => c.y === y) || null;
function landAt(cell, f) {
  const c = cubeAt(cell, f);
  return !!(c && solid(c) && !cubeAt(cell, f + 1) && !cubeAt(cell, f + 2));
}
// a cell a block can go in at height f: nothing solid there, and room over it
const fillable = (cell, f) => { const c = cubeAt(cell, f); return (!c || !solid(c)) && !cubeAt(cell, f + 1) && !cubeAt(cell, f + 2); };
function groundBelow(cell, y, depth) {
  let g = null;
  for (const c of cell?.cubes || []) if (solid(c) && c.y < y && c.y >= y - depth && (g === null || c.y > g)) g = c.y;
  return g;
}
export const blockOf = (id) => BLOCKS.find((b) => b.id === id) || BLOCKS[0];

// The fewest cells to fill from a to b at a's level: the cheapest path over the cells around them (a cell to fill
// costs 1, a cell of ground at that level a little, a turn a little; anything else is a wall), so the fewest cells to
// fill first, then the straightest, the shortest way over ground -> [{x, z}] from a to b, or null when no way exists
const COST_GROUND = 0.01, COST_TURN = 0.001;
export function crossingPath(a, b, cellAt) {
  const f = a.f;
  const x0 = Math.min(a.x, b.x) - MARGIN, x1 = Math.max(a.x, b.x) + MARGIN, z0 = Math.min(a.z, b.z) - MARGIN, z1 = Math.max(a.z, b.z) + MARGIN;
  if (x1 - x0 > MAX_BOX || z1 - z0 > MAX_BOX) return null;
  const W = x1 - x0 + 1, idx = (x, z, d) => ((z - z0) * W + (x - x0)) * 5 + d;   // (d: the way it came in, 4 = start)
  const step = new Map();
  const stepOf = (x, z) => {
    const k = x + "," + z;
    if (!step.has(k)) { const c = cellAt(x, z); step.set(k, landAt(c, f) ? COST_GROUND : fillable(c, f) ? 1 : null); }
    return step.get(k);
  };
  const dist = new Map(), prev = new Map(), heap = [];
  const push = (c, s) => { heap.push([c, s]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const s0 = [a.x, a.z, 4];
  dist.set(idx(...s0), 0);
  push(0, s0);
  let end = null;
  while (heap.length) {
    const [c, [x, z, d]] = pop();
    if (c > dist.get(idx(x, z, d))) continue;
    if (x === b.x && z === b.z) { end = [x, z, d]; break; }
    N4.forEach(([dx, dz], nd) => {
      const nx = x + dx, nz = z + dz;
      if (nx < x0 || nx > x1 || nz < z0 || nz > z1) return;
      const sc = stepOf(nx, nz);
      if (sc === null) return;
      const nc = c + sc + (d !== 4 && d !== nd ? COST_TURN : 0), k = idx(nx, nz, nd);
      if (dist.has(k) && dist.get(k) <= nc) return;
      dist.set(k, nc); prev.set(k, [x, z, d]); push(nc, [nx, nz, nd]);
    });
  }
  if (!end) return null;
  const path = [];
  for (let s = end; s; s = prev.get(idx(...s))) path.unshift({ x: s[0], z: s[1] });
  return path;
}
// a path's corners (its ends and every turn) and back
export function cornersOf(path) {
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [p, q, r] = [path[i - 1], path[i], path[i + 1]];
    if (q.x - p.x !== r.x - q.x || q.z - p.z !== r.z - q.z) out.push(q);
  }
  if (path.length > 1) out.push(path[path.length - 1]);
  return out;
}
export function pathOf(corners) {
  const out = [{ ...corners[0] }];
  for (let k = 1; k < corners.length; k++) {
    const a = corners[k - 1], b = corners[k], dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    if (dx && dz) return null;   // (corners on a line each)
    for (let x = a.x + dx, z = a.z + dz; ; x += dx, z += dz) { out.push({ x, z }); if (x === b.x && z === b.z) break; }
  }
  return out;
}

// Plan a fill from area A to area B (a, b: {x, z, f}) with a block (id) and a width; corners: a path given (a link's),
// else the fewest cells to fill -> {kind: "fill", block, lo, hi, run, width, corners, path, cells, rows, cols, problems}
export function planFill(a, b, width, cellAt, blockId = "planksRail", corners = null) {
  const blk = blockOf(blockId), f = a.f, w = Math.max(1, Math.min(3, width | 0 || 1));
  const problems = [];
  let path = null;
  if (b.f !== f) problems.push({ code: "uneven", diff: b.f - f, x: b.x, z: b.z });
  if (corners) path = pathOf(corners);
  else if (b.f === f) {
    path = crossingPath(a, b, cellAt);
    // (the crossing itself: from the last ground before the first cell to fill to the first ground after the last;
    // the rest of the way is ground that walks already)
    if (path) {
      const gap = path.map((p, i) => (landAt(cellAt(p.x, p.z), f) ? -1 : i)).filter((i) => i >= 0);
      if (gap.length) path = path.slice(Math.max(0, gap[0] - 1), Math.min(path.length, gap[gap.length - 1] + 2));
    }
  }
  if (!path) { if (b.f === f) problems.push({ code: "noWay" }); path = pathOf([a, { x: b.x, z: a.z }, b].filter((p, i, s) => i === 0 || p.x !== s[i - 1].x || p.z !== s[i - 1].z)) || [a, b]; }
  const rows = [], cells = [], seen = new Set();
  const put = (x, z, along) => {
    const k = x + "," + z;
    if (seen.has(k)) return;
    const cell = cellAt(x, z);
    if (landAt(cell, f) || !fillable(cell, f)) return;
    seen.add(k);
    cells.push({ x, z });
    const top = along === "z" && blk.topZ ? blk.topZ : blk.top;
    rows.push({ k: "v", id: top[0], t: top[1], x, z, y: f, store: "bake" });
    if (blk.down) {   // an embankment: down to the ground under it
      const g = groundBelow(cell, f, DOWN_DEPTH);
      if (g !== null) for (let y = g + 1; y < f; y++) rows.push({ k: "v", id: blk.down[0], t: blk.down[1], x, z, y, store: "bake" });
    }
  };
  path.forEach((p, i) => {
    const q = path[i + 1] || path[i - 1] || p, along = q.x !== p.x ? "x" : "z";
    put(p.x, p.z, along);
    // the width: across the way it goes here (1: the path; 2: and its right; 3: both sides)
    if (w > 1) {
      const [rx, rz] = along === "x" ? [0, -1] : [1, 0];
      for (const j of lanes(w).map((v) => -v)) if (j) put(p.x + j * rx, p.z + j * rz, along);
    }
  });
  if (!cells.length && !problems.length) problems.push({ code: "noGap" });
  if (cells.length > MAX_FILL * w) problems.push({ code: "tooLong", gap: cells.length, max: MAX_FILL * w });
  if (blk.rail) {   // a railing beside each filled cell where it opens onto water or a drop
    const onPath = new Set(path.map((p) => p.x + "," + p.z));
    for (const c of cells) for (const [dx, dz] of N4) {
      const x = c.x + dx, z = c.z + dz, k = x + "," + z, cell = cellAt(x, z);
      if (seen.has(k) || onPath.has(k) || landAt(cell, f) || cubeAt(cell, f + 1)) continue;
      rows.push({ k: "d", id: blk.rail[0], t: blk.rail[1], x, z, y: f + 1, rot: RAIL_ROT[dx + "," + dz], store: "bake" });
    }
  }
  const cols = rows.filter((q) => q.k === "v").map((q) => ({ x: q.x, z: q.z, y0: q.y, top: q.y, k: 0 }));
  const cs = cornersOf(path);
  return { kind: "fill", block: blk.id, lo: a, hi: { ...b, x: path[path.length - 1].x, z: path[path.length - 1].z }, dir: dirOf(cs[0], cs[1] || cs[0]),
    run: path.length - 1, rise: b.f - f, width: w, corners: cs, path, cells, rows, cols, problems };
}
const dirOf = (p, q) => (q.x > p.x ? "E" : q.x < p.x ? "W" : q.z > p.z ? "N" : "S");

// Walk a fill both ways along its path, a straight segment at a time (the ramp's walk). Two levels: one reason.
export function walkFill(plan, cellAt, layerAt = () => null) {
  const reasons = plan.problems.filter((p) => p.code !== "noGap");
  const walks = [];
  let up = true, down = true;
  if (!plan.problems.some((p) => p.code === "uneven" || p.code === "noWay")) {
    const cs = plan.corners;
    for (let k = 1; k < cs.length; k++) {
      const a = { ...cs[k - 1], f: plan.lo.f }, b = { ...cs[k], f: plan.lo.f };
      const run = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
      const r = walkRamp({ lo: a, hi: b, dir: dirOf(a, b), run, width: 1, cols: plan.cols, problems: [] }, cellAt, layerAt);
      up = up && r.up; down = down && r.down;
      for (const x of r.reasons) if (!reasons.some((y) => y.code === x.code && y.x === x.x && y.z === x.z)) reasons.push(x);
      walks.push(...r.walks);
    }
  } else { up = down = false; }
  return { ok: up && down && !reasons.length, up, down, reasons, walks };
}

// ---- the link: points = the path's corners; pieces "<block>|<width>|<cells>" (the cells to fill, said for a reader)
export function encodeFill(plan) { return `${plan.block}|${plan.width}|${plan.cells.length}`; }
export function decodeFill(text) {
  const m = /^([A-Za-z]+)\|([123])\|(\d+)$/.exec(String(text || ""));
  return m && BLOCKS.some((b) => b.id === m[1]) ? { block: m[1], width: +m[2], cells: +m[3] } : null;
}
export const blockOfPieces = (pieces) => decodeFill(pieces)?.block || "planksRail";
// a fill marker of the link -> its plan (along the corners it carries)
export function planOfFill(m, cellAt) {
  if (!m.points || m.points.length < 2 || !m.fields) return null;
  const fl = m.fields;
  if (!Number.isFinite(+fl.lo) || !Number.isFinite(+fl.hi) || fl.lo === "" || fl.hi === "") return null;
  const cs = m.points.map(([x, z]) => ({ x, z }));
  const a = { ...cs[0], f: +fl.lo }, b = { ...cs[cs.length - 1], f: +fl.hi };
  return planFill(a, b, +fl.width || 1, cellAt, blockOfPieces(fl.pieces), cs);
}
export function fieldsOfFill(plan, label = "") {
  const out = { lo: plan.lo.f, hi: plan.hi.f, width: plan.width, pieces: encodeFill(plan) };
  if (label) out.label = label;
  return out;
}
export const pointsOfFill = (plan) => plan.corners.map((p) => [p.x, p.z]);
// what an approved fill becomes: the map edit's rows (built or terrain voxels and a static railing: grafted)
export function editRows(plan) {
  return plan.rows.map((q) => ({ kind: q.k === "v" ? "voxel" : "decor", id: q.id, tile: q.t, at: [q.x, q.y, q.z], ...(q.rot != null ? { rot: q.rot } : {}), ship: q.store }));
}
export function fillReason(r, t3) {
  switch (r.code) {
    case "tooLong": return t3("fl.tooLong", r.gap, r.max);
    case "noGap": return t3("fl.noGap");
    case "noWay": return t3("fl.noWay");
    case "uneven": return t3(r.diff > 0 ? "br.unevenUp" : "br.unevenDown", Math.abs(r.diff));
    default: return rampReason(r, t3);
  }
}
