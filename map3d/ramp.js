// A ramp proposal in the 3D editor: the pieces between two ends, and the server's walk over them. No DOM here: the
// page and the tests (node) share it.
//
// The stock map builds every ramp the same way (read from the server's own cube grid and the client's voxel records,
// 2026-11-27): a collision slope cube Slope1..Slope4 (tiles 171..174, rising north, east, south, west: the server's
// RISE) that climbs one cube across its cell, set on support cubes (BlockNoItems, 175, the commonest one under a
// slope); the ground's look comes from that ground's ramp prefab (GrassRamp, SandRamp, ...), baked into the chunk's
// meshes. One slope cube per cube of rise: a rise of R needs R slope cells in a row, so a run of n cells from end to
// end climbs at most n - 1 cubes ("too steep" past that).
//
// The walk is the server's step rule: a body walks from a cell's centre into the
// next in 20 steps of 0.1; at each point its height is the highest top under its footprint (the centre and 4 corners
// 0.25 away; slopes only in its own cell) at most 0.6 over its feet, taken when within 1.2 or lower; a block whose
// height overlaps the body's (1.5 tall, the floor under it left out) stops it. Here on the 3D view's own grid data plus
// the ramp's pieces (a model of it: no props, no walls standing now, no wall insides; the staff tools' walk-out gate
// judges for real before anything ships).
import { K, KINDS } from "./cdata.js";

export const SLOPE_TILE = { 1: 171, 2: 172, 3: 173, 4: 174 };   // Slope1..4: rising N, E, S, W
export const SUPPORT_TILE = 175;                                // BlockNoItems
// the ground's ramp prefab (its look), by the grid's ground kind of the ramp's low end
export const RAMP_PREFAB = {
  grass: [267, "GrassRamp"], dirt: [17, "GroundRamp"], sand: [373, "SandRamp"], rock: [383, "RockRamp"],
  paved: [366, "CobbleRamp"], snow: [294, "SnowRamp"], wood: [623, "PlainsWoodStairs"], other: [17, "GroundRamp"],
};
export const DIRS = { N: [0, 1, 1], E: [1, 0, 2], S: [0, -1, 3], W: [-1, 0, 4] };   // dx, dz, slope type
export const MAX_RUN = 12, MAX_WIDTH = 3;
const STEP = 0.1, STEPS = 20, RISE_OK = 1.2, UP = 0.6, FOOT = 0.25, HALF_BODY = 0.75, OVERLAP = 0.25, TOP_TO_STAND = 0.3;

const SOLIDISH = (kind) => kind !== K.water;
const slopeOfKind = (kind) => ({ [K.slopeN]: 1, [K.slopeE]: 2, [K.slopeS]: 3, [K.slopeW]: 4 })[kind] || 0;
const RISE = { 1: [0, 1], 2: [1, 0], 3: [0, -1], 4: [-1, 0] };

// the lanes across a ramp of this width (offsets from its centre line)
export const lanes = (w) => (w <= 1 ? [0] : w === 2 ? [0, 1] : [-1, 0, 1]);

// the direction from a to b along the axis that moves most: [name, along, across] (a diagonal snaps to it)
export function axisOf(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? "E" : "W";
  return dz >= 0 ? "N" : "S";
}

// the highest solid cube of a cell at most y (its top is where a ramp column stands), or null
function groundUnder(cell, y) {
  let g = null;
  for (const c of cell?.cubes || []) if (SOLIDISH(c.kind) && c.y <= y && (g === null || c.y > g)) g = c.y;
  return g;
}

// Plan a ramp between two ends a, b ({x, z, f}: the cube each end stands on; the lower one is the start) ->
// {lo, hi, dir, run, rise, width, ground, cols: [{x, z, i, j, y0, top, k}], problems: [{code, ...}]}.
// A column's pieces: support cubes y0..top-1 and its top cube: a slope (k 1..4) or, k 0, a flat support (none when
// the ground is already at its height: y0 > top).
export function planRamp(a, b, width, cellAt) {
  const [lo, hi] = a.f <= b.f ? [a, b] : [b, a];
  const dir = axisOf(lo, hi);
  const [dx, dz, k] = DIRS[dir];
  const run = Math.abs(dx ? hi.x - lo.x : hi.z - lo.z);
  const rise = hi.f - lo.f;
  const w = Math.max(1, Math.min(MAX_WIDTH, width | 0 || 1));
  const [px, pz] = dx ? [0, 1] : [1, 0];
  const topKind = (cellAt(lo.x, lo.z)?.cubes || []).find((c) => c.y === lo.f)?.kind;
  const ground = KINDS[topKind] in RAMP_PREFAB ? KINDS[topKind] : /^slope/.test(KINDS[topKind] || "") ? "dirt" : "other";
  const problems = [];
  if (run < 1) problems.push({ code: "tooShort" });
  if (run > MAX_RUN) problems.push({ code: "tooLong", run });
  if (rise > Math.max(0, run - 1)) problems.push({ code: "steep", rise, run, need: rise + 1 });
  // where the slope cells go along the run: the rise's cells in a row from `first`, flat cells at the low end's height
  // before them and at the high end's after them. The latest place by default (flat at the bottom, as most stock
  // ramps); an earlier one when the ground there has cubes over the flat cells' tops (a mound the ramp climbs over)
  const last = Math.max(1, run - rise);
  let first = last, buried = Infinity;
  for (let f0 = last; f0 >= 1; f0--) {
    const n = columnsAt(lo, run, rise, f0, w, dx, dz, px, pz, k, cellAt).filter((c) => buries(cellAt(c.x, c.z), c.top)).length;
    if (n < buried) { buried = n; first = f0; }
    if (!n) break;
  }
  const cols = columnsAt(lo, run, rise, first, w, dx, dz, px, pz, k, cellAt);
  return { lo, hi, dir, run, rise, width: w, ground, prefab: RAMP_PREFAB[ground], cols, problems, first, firstDefault: last };
}

// the columns of a ramp whose slope cells start at `first`
function columnsAt(lo, run, rise, first, w, dx, dz, px, pz, k, cellAt) {
  const cols = [];
  for (let i = 1; i < run; i++) for (const j of lanes(w)) {
    const x = lo.x + i * dx + j * px, z = lo.z + i * dz + j * pz;
    const { top, slope } = topAt(lo.f, rise, first, i);
    // (a slope cell's own top cube is always the slope: a flat cube already there, a one-cube step of the ground, is
    // replaced by it, so its ground is looked for under it)
    const g = groundUnder(cellAt(x, z), slope ? top - 1 : top);
    cols.push({ x, z, i, j, y0: g === null ? top - 3 : g + 1, top, k: slope ? k : 0 });
  }
  return cols;
}
// a column's top cube along the run: flat at the low end's height before `first`, then one up per slope cell, then flat
// at the high end's
function topAt(f, rise, first, i) {
  if (i < first) return { top: f, slope: false };
  if (i < first + rise) return { top: f + (i - first + 1), slope: true };
  return { top: f + rise, slope: false };
}
// a solid cube in the body's room over a column's top (it would stand in the way)
function buries(cell, top) {
  return (cell?.cubes || []).some((c) => SOLIDISH(c.kind) && c.y > top && c.y <= top + 2);
}

// ---- the pieces in the link: "<dir><width>|" then, per column in plan order (along the run from the low end, the
// lanes across), how many cubes it stacks (its top cube and the supports under it; 0: none, the ground is there). A
// column's top and slope follow from the two ends (lo.f, hi.f and the run), so the count is all a column needs; when the
// slope cells start earlier than the default (the run's end), "|<first>" after the counts says where.
export function encodePieces(plan) {
  const counts = plan.dir + plan.width + "|" + plan.cols.map((c) => Math.max(0, c.top - c.y0 + 1)).join(",");
  return plan.first != null && plan.first !== plan.firstDefault ? counts + "|" + plan.first : counts;
}
// -> {dir, width, cols} (the cols as planRamp makes them) or null (not a ramp's pieces, or not these ends')
export function decodePieces(text, lo, hi) {
  const m = /^([NESW])([123])\|([0-9,]*)(?:\|(\d+))?$/.exec(String(text || ""));
  if (!m) return null;
  const [dx, dz, k] = DIRS[m[1]], w = +m[2], [px, pz] = dx ? [0, 1] : [1, 0];
  const run = Math.abs(dx ? hi.x - lo.x : hi.z - lo.z), rise = hi.f - lo.f;
  if (rise < 0 || run > MAX_RUN) return null;
  const last = Math.max(1, run - rise), first = m[4] != null ? +m[4] : last;
  if (first < 1 || first > last) return null;
  const parts = m[3] ? m[3].split(",") : [];
  const cols = [];
  let n = 0;
  for (let i = 1; i < run; i++) for (const j of lanes(w)) {
    const p = parts[n++];
    if (p === undefined || p === "" || +p > 64) return null;
    const { top, slope } = topAt(lo.f, rise, first, i);
    cols.push({ x: lo.x + i * dx + j * px, z: lo.z + i * dz + j * pz, i, j, y0: top - +p + 1, top, k: slope ? k : 0 });
  }
  return n === parts.length ? { dir: m[1], width: w, cols, first } : null;
}

// a ramp marker of the link -> its plan ({lo, hi, dir, run, rise, width, ground, prefab, cols, problems}) or null:
// the pieces it carries when they fit its ends, else planned again on the grid (cellAt; a pasted or moved ramp)
export function planOfMarker(m, cellAt) {
  if (!m.points || m.points.length < 2 || !m.fields) return null;
  const f = m.fields;
  if (!Number.isFinite(+f.lo) || !Number.isFinite(+f.hi)) return null;
  const a = { x: m.points[0][0], z: m.points[0][1], f: +f.lo }, b = { x: m.points[1][0], z: m.points[1][1], f: +f.hi };
  const plan = planRamp(a, b, +f.width || 1, cellAt);
  const got = decodePieces(f.pieces, plan.lo, plan.hi);
  if (got && got.dir === plan.dir && got.width === plan.width && got.cols.length === plan.cols.length) { plan.cols = got.cols; plan.first = got.first; }
  if (f.ground && f.ground in RAMP_PREFAB) { plan.ground = f.ground; plan.prefab = RAMP_PREFAB[f.ground]; }
  return plan;
}

// the link fields of a plan (a ramp marker: points [[lo.x, lo.z], [hi.x, hi.z]] and these)
export function fieldsOfPlan(plan, label = "") {
  const out = { lo: plan.lo.f, hi: plan.hi.f, width: plan.width, ground: plan.ground, pieces: encodePieces(plan) };
  if (label) out.label = label;
  return out;
}

// ---- the grid with the ramp's pieces in it: per cell {flat: [cube y], slopes: [[y, k]], blocks: [cube y]}
function columnsWith(cols, cellAt) {
  const extra = new Map();
  for (const c of cols) {
    const key = c.x + "," + c.z;
    const e = extra.get(key) || [];
    for (let y = c.y0; y < c.top; y++) e.push([y, 0]);
    if (c.y0 <= c.top) e.push([c.top, c.k]);
    extra.set(key, e);
  }
  const memo = new Map();
  return (x, z) => {
    const key = x + "," + z;
    if (memo.has(key)) return memo.get(key);
    const cubes = new Map();   // y -> slope type (0 flat)
    for (const c of cellAt(x, z)?.cubes || []) if (SOLIDISH(c.kind)) cubes.set(c.y, slopeOfKind(c.kind));
    for (const [y, k] of extra.get(key) || []) cubes.set(y, k);
    const col = { cubes, has: cellAt(x, z) != null || extra.has(key) };
    memo.set(key, col);
    return col;
  };
}

// a cell's walkable tops at a point (server scale: a flat cube's top y + 0.5, a slope from y - 0.5 to y + 0.5)
function tops(col, x, z, px, pz, slopes) {
  const out = [];
  for (const [y, k] of col.cubes) {
    if (col.cubes.has(y + 1)) continue;   // covered
    if (!k) { out.push(y + 0.5); continue; }
    if (!slopes) continue;   // (a slope counts only in the body's own cell, as the server's footprint has it)
    const [ax, az] = RISE[k];
    const t = (px - x) * ax + (pz - z) * az + 0.5;
    out.push(y - 0.5 + Math.min(Math.max(t, 0), 1));
  }
  return out;
}

// stand_height(x, z, near) on the model: the highest top under the footprint at most 0.6 over the feet, + 0.3
function standHeight(colAt, x, z, near) {
  const feet = near - TOP_TO_STAND;
  const own = [Math.round(x), Math.round(z)];
  let best = null;
  for (const [px, pz] of [[x, z], [x - FOOT, z - FOOT], [x - FOOT, z + FOOT], [x + FOOT, z - FOOT], [x + FOOT, z + FOOT]]) {
    const cx = Math.round(px), cz = Math.round(pz);
    for (const h of tops(colAt(cx, cz), cx, cz, px, pz, cx === own[0] && cz === own[1])) if (h <= feet + UP + 1e-9 && (best === null || h > best)) best = h;
  }
  return best === null ? null : best + TOP_TO_STAND;
}

// a block in the cell at (x, z) the body at stand height h runs into: a flat cube with a height overlap of at least
// OVERLAP that isn't the floor under the feet (a slope is walked, not run into) -> its cube y or null
// (a cube whose top is within a step of the feet is a top to stand on, not a block; a cube with a slope right on it
// is the slope's support, part of the ramp)
function blockAt(colAt, x, z, h) {
  const cx = Math.round(x), cz = Math.round(z), col = colAt(cx, cz);
  const feet = h - TOP_TO_STAND;
  for (const [y, k] of col.cubes) {
    if (k || y + 0.5 <= feet + UP + 1e-9 || col.cubes.get(y + 1) > 0) continue;
    if (HALF_BODY + 0.5 - Math.abs(h - y) >= OVERLAP) return y;
  }
  return null;
}

// one walk from cell a (stood at height h) into cell b -> {h, path} or {fail: {code, x, z, ...}, path}
function walkInto(colAt, a, h, b) {
  const n = Math.hypot(b.x - a.x, b.z - a.z), dx = ((b.x - a.x) / n) * STEP, dz = ((b.z - a.z) / n) * STEP;
  let px = a.x, pz = a.z, height = h;
  const path = [];
  for (let s = 0; s < STEPS; s++) {
    const nx = px + dx, nz = pz + dz;
    const blocked = blockAt(colAt, nx, nz, height);
    if (blocked !== null) return { fail: { code: "blocked", x: Math.round(nx), z: Math.round(nz), y: blocked }, path };
    px = nx; pz = nz;
    const there = standHeight(colAt, px, pz, height);
    if (there !== null && (Math.abs(there - height) <= RISE_OK || there < height)) height = there;
    path.push([px, height, pz]);
    if (Math.round(px) === b.x && Math.round(pz) === b.z && Math.abs(px - b.x) <= STEP && Math.abs(pz - b.z) <= STEP) return { h: height, path };
  }
  // stopped short: a step up it can't take (or nothing to stand on ahead)
  const ahead = tops(colAt(b.x, b.z), b.x, b.z, b.x, b.z, true).filter((t) => t > height - TOP_TO_STAND);
  if (!colAt(b.x, b.z).has || !tops(colAt(b.x, b.z), b.x, b.z, b.x, b.z, true).length) return { fail: { code: "void", x: b.x, z: b.z }, path };
  const step = ahead.length ? Math.min(...ahead) - (height - TOP_TO_STAND) : 0;
  return { fail: { code: "step", x: b.x, z: b.z, step: Math.round(step * 10) / 10 }, path };
}

// Walk a ramp both ways on every lane: from the low end's cell up the run to the high end, and back down.
// -> {ok, reasons: [{code, ...}], walks: [[x, stand y, z] ...] (server scale), up, down}
export function walkRamp(plan, cellAt, layerAt = () => null) {
  const reasons = [...plan.problems];
  const colAt = columnsWith(plan.cols, cellAt);
  const { lo, hi } = plan;
  const [dx, dz] = DIRS[plan.dir], [px, pz] = dx ? [0, 1] : [1, 0];
  // the ends: water or void under them is no ramp
  for (const [end, e] of [["lo", lo], ["hi", hi]]) {
    const l = layerAt(e.x, e.z, e.f);
    if (l && (l.bad & 16)) reasons.push({ code: "water", end, x: e.x, z: e.z });
    if (l && (l.bad & 4)) reasons.push({ code: "void", end, x: e.x, z: e.z });
  }
  // the pieces bury no other path: a column's new cubes may not fill the body space of a layer someone walks on there
  // (the ground a column stands on, cube y0 - 1, is built on, not buried)
  for (const c of plan.cols) {
    if (c.y0 > c.top) continue;
    const cut = (cellAt(c.x, c.z)?.layers || []).find((l) => !l.bad && l.f !== c.y0 - 1 && l.f + 1 >= c.y0 && l.f + 1 <= c.top);
    if (cut) reasons.push({ code: "cuts", x: c.x, z: c.z, f: cut.f });
  }
  const walks = [];
  let up = true, down = true;
  if (!plan.problems.some((p) => p.code === "steep" || p.code === "tooShort" || p.code === "tooLong")) {
    for (const j of lanes(plan.width)) {
      const cells = [];
      for (let i = 0; i <= plan.run; i++) cells.push({ x: lo.x + i * dx + j * px, z: lo.z + i * dz + j * pz });
      for (const [way, list] of [["up", cells], ["down", [...cells].reverse()]]) {
        const startTop = way === "up" ? lo.f : hi.f;
        let h = startTop + 0.5 + TOP_TO_STAND;
        const path = [[list[0].x, h, list[0].z]];
        let failed = null;
        for (let n = 1; n < list.length && !failed; n++) {
          const r = walkInto(colAt, list[n - 1], h, list[n]);
          path.push(...r.path);
          if (r.fail) failed = r.fail; else h = r.h;
        }
        // arrived at the other end's own height (a drop off the side would land lower)
        const endTop = way === "up" ? hi.f : lo.f;
        if (!failed && Math.abs(h - (endTop + 0.5 + TOP_TO_STAND)) > 0.05) failed = { code: way === "up" ? "short" : "drop", x: list[list.length - 1].x, z: list[list.length - 1].z };
        if (failed) {
          if (way === "up") up = false; else down = false;
          if (!reasons.some((r) => r.code === failed.code && r.x === failed.x && r.z === failed.z)) reasons.push({ ...failed, way, lane: j });
        }
        if (j === lanes(plan.width)[Math.floor(lanes(plan.width).length / 2)] || lanes(plan.width).length === 1) walks.push({ way, path, ok: !failed });
      }
    }
  } else { up = down = false; }
  return { ok: reasons.length === 0 && up && down, up, down, reasons, walks };
}

// the reason in words (t3: the 3D view's translator)
export function rampReason(r, t3) {
  switch (r.code) {
    case "steep": return t3("rr.steep", r.rise, r.run, r.need);
    case "tooShort": return t3("rr.tooShort");
    case "tooLong": return t3("rr.tooLong", MAX_RUN);
    case "blocked": return t3("rr.blocked", r.x, r.z);
    case "step": return t3("rr.step", r.step, r.x, r.z);
    case "void": return t3("rr.void", r.x, r.z);
    case "water": return t3("rr.water", r.x, r.z);
    case "cuts": return t3("rr.cuts", r.x, r.z);
    case "short": return t3("rr.short", r.x, r.z);
    case "drop": return t3("rr.drop", r.x, r.z);
    default: return r.code;
  }
}
