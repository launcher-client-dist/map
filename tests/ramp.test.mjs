// The 3D editor's Ramp (map3d/ramp.js): the pieces it proposes between two ends, the server's walk over them both
// ways and the reasons it gives, the pieces in the link; then the same on the published grid (the street, a swamp
// cliff, one too steep).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as CD from "../map3d/cdata.js";
import * as RP from "../map3d/ramp.js";
import { encode, decode } from "../maplink.js";
import { WORDS3, translator3 } from "../map3d/words3d.js";

// a small world: cells {"x,z": {cubes: [{y, kind}], layers: [{f, bad, floor}]}}; ground(x0..x1, z0..z1, top, kind)
function world() {
  const cells = new Map();
  const cell = (x, z) => {
    const k = x + "," + z;
    if (!cells.has(k)) cells.set(k, { x, z, cubes: [], layers: [] });
    return cells.get(k);
  };
  const W = {
    cellAt: (x, z) => cells.get(x + "," + z),
    layerAt: (x, z, f) => cells.get(x + "," + z)?.layers.find((l) => l.f === f) || null,
    ground(x0, x1, z0, z1, top, kind = "grass", from = top) {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const c = cell(x, z);
        for (let y = from; y <= top; y++) c.cubes.push({ y, kind: CD.K[y === top ? kind : "dirt"], flags: 0 });
        c.layers = c.layers.filter((l) => l.f < from || l.f > top);
        c.layers.push({ x, z, f: top, stand: top + 0.3, floor: "s", bad: 0, warn: 0, exits: 15 });
      }
      return W;
    },
    cube(x, z, y, kind = "wall") { cell(x, z).cubes.push({ y, kind: CD.K[kind], flags: 0 }); return W; },
    mark(x, z, f, bad) { cell(x, z).layers.find((l) => l.f === f).bad |= bad; return W; },
  };
  return W;
}
// a street at -5 (x 0..4) and a step up to a platform at -3 (x 5..8), 3 cells across (z -1..1)
const street = () => world().ground(-2, 4, -2, 2, -5, "paved", -7).ground(5, 9, -2, 2, -3, "paved", -7);

test("the pieces: flat cells first, then one slope cube per cube of rise, on supports down to the ground", () => {
  const W = street();
  const plan = RP.planRamp({ x: 0, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, 1, W.cellAt);
  assert.equal(plan.dir, "E");
  assert.deepEqual([plan.run, plan.rise, plan.width], [5, 2, 1]);
  assert.deepEqual(plan.cols.map((c) => [c.x, c.y0, c.top, c.k]), [[1, -4, -5, 0], [2, -4, -5, 0], [3, -4, -4, 2], [4, -4, -3, 2]]);
  assert.equal(RP.encodePieces(plan), "E1|0,0,1,2");   // (the first two: the street is already there)
  assert.deepEqual(plan.problems, []);
  // the ground's look: paved -> the cobble ramp; grass -> the grass ramp
  assert.deepEqual(plan.prefab, [366, "CobbleRamp"]);
  const G = world().ground(0, 6, 0, 0, 0, "grass").ground(7, 9, 0, 0, 3, "grass", 0);
  assert.deepEqual(RP.planRamp({ x: 9, z: 0, f: 3 }, { x: 2, z: 0, f: 0 }, 1, G.cellAt).prefab, [267, "GrassRamp"]);
  // the order of the clicks doesn't matter: the low end starts it; a diagonal snaps to the axis that moves most
  const back = RP.planRamp({ x: 5, z: 0, f: -3 }, { x: 0, z: 0, f: -5 }, 1, W.cellAt);
  assert.equal(RP.encodePieces(back), "E1|0,0,1,2");
  assert.equal(RP.axisOf({ x: 0, z: 0 }, { x: 1, z: -4 }), "S");
  // 3 wide: the lanes either side of the line
  const wide = RP.planRamp({ x: 0, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, 3, W.cellAt);
  assert.deepEqual(wide.cols.filter((c) => c.i === 4).map((c) => [c.z, c.top, c.k]), [[-1, -3, 2], [0, -3, 2], [1, -3, 2]]);
});

test("the walk: up the ramp and back down on every lane, as the server steps (green)", () => {
  const W = street();
  for (const w of [1, 2, 3]) {
    const plan = RP.planRamp({ x: 0, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, w, W.cellAt);
    const r = RP.walkRamp(plan, W.cellAt, W.layerAt);
    assert.ok(r.ok, JSON.stringify(r.reasons));
    assert.ok(r.up && r.down);
    const up = r.walks.find((x) => x.way === "up");
    // it ends standing on the platform: top -3, stand +0.3 over the cube's top (server scale: the cube's y + 0.5)
    assert.ok(Math.abs(up.path.at(-1)[1] - (-3 + 0.5 + 0.3)) < 1e-6);
    // and it climbs gradually: no point rises more than the server's step allows
    for (let i = 1; i < up.path.length; i++) assert.ok(up.path[i][1] - up.path[i - 1][1] <= 0.6 + 1e-9);
  }
  // with no ramp, the same line doesn't walk: a step of 2 cubes
  const none = RP.walkRamp({ ...RP.planRamp({ x: 0, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, 1, W.cellAt), cols: [] }, W.cellAt, W.layerAt);
  assert.ok(!none.ok && none.reasons.some((x) => (x.code === "step" || x.code === "blocked") && x.x === 5), JSON.stringify(none.reasons));   // (the platform's side: a wall to the body)
});

test("red with the reason: too steep, too long, blocked, an end in the water, burying another path", () => {
  const t3 = translator3("en");
  const W = street();
  const steep = RP.walkRamp(RP.planRamp({ x: 3, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, 1, W.cellAt), W.cellAt, W.layerAt);
  assert.ok(!steep.ok);
  assert.deepEqual(steep.reasons[0], { code: "steep", rise: 2, run: 2, need: 3 });
  assert.equal(RP.rampReason(steep.reasons[0], t3), "too steep: +2 in 2 cells (needs 3 cells)");
  assert.equal(steep.walks.length, 0);
  const long = RP.planRamp({ x: -20, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, 1, W.cellAt);
  assert.ok(long.problems.some((p) => p.code === "tooLong"));
  // a wall standing in the run (2 cubes over the street)
  const B = street().cube(2, 0, -4).cube(2, 0, -3);
  const blocked = RP.walkRamp(RP.planRamp({ x: 0, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, 1, B.cellAt), B.cellAt, B.layerAt);
  assert.ok(!blocked.ok && !blocked.up);
  assert.deepEqual(blocked.reasons.map((r) => [r.code, r.x, r.z]), [["blocked", 2, 0]]);
  assert.match(RP.rampReason(blocked.reasons[0], t3), /blocked at \(2, 0\)/);
  // the low end in the water
  const Wt = street().mark(0, 0, -5, CD.BAD.water);
  assert.ok(RP.walkRamp(RP.planRamp({ x: 0, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, 1, Wt.cellAt), Wt.cellAt, Wt.layerAt).reasons.some((r) => r.code === "water"));
  // a ramp over a passage someone walks: its supports fill the passage's room (a tunnel at -6 under a ground at -3)
  const T = world().ground(0, 0, 0, 0, -6).ground(0, 4, 0, 0, -9).ground(5, 9, 0, 0, -3, "grass", -9);
  T.cellAt(3, 0).layers.push({ x: 3, z: 0, f: -7, stand: -6.7, floor: "-1", bad: 0, warn: 0, exits: 15 });
  const cut = RP.walkRamp(RP.planRamp({ x: 0, z: 0, f: -6 }, { x: 5, z: 0, f: -3 }, 1, T.cellAt), T.cellAt, T.layerAt);
  assert.ok(cut.reasons.some((r) => r.code === "cuts" && r.x === 3), JSON.stringify(cut.reasons));
});

test("the pieces in the link: a count per column, back as they were; a ramp marker round trips", async () => {
  const W = street();
  const plan = RP.planRamp({ x: 0, z: 0, f: -5 }, { x: 5, z: 0, f: -3 }, 2, W.cellAt);
  const text = RP.encodePieces(plan);
  assert.equal(text, "E2|0,0,0,0,1,1,2,2");
  const back = RP.decodePieces(text, plan.lo, plan.hi);
  assert.deepEqual(back.cols, plan.cols);
  for (const bad of ["", "E2|0,0", "X2|0,0,0,0,1,1,2,2", "E4|0", "E2|0,0,0,0,1,1,2,2,3", "E2|a,0,0,0,1,1,2,2"]) assert.equal(RP.decodePieces(bad, plan.lo, plan.hi), null, bad);
  // a 12-cell run 3 wide fits the link's text limit (300)
  const L = world().ground(0, 0, -1, 1, 0).ground(1, 11, -1, 1, -20).ground(12, 12, -1, 1, 11, "grass", -20);
  assert.ok(RP.encodePieces(RP.planRamp({ x: 0, z: 0, f: 0 }, { x: 12, z: 0, f: 11 }, 3, L.cellAt)).length <= 300);
  // the marker: its ends, the fields, through a link and back; its plan from the carried pieces
  const m = { id: 0, kind: "ramp", floor: "s", locked: false, points: [[plan.lo.x, plan.lo.z], [plan.hi.x, plan.hi.z]], fields: RP.fieldsOfPlan(plan, "rampa") };
  const state = { view: { floors: ["s"] }, markers: [m] };
  const again = (await decode(await encode(state))).markers[0];
  assert.deepEqual(again, m);
  const p2 = RP.planOfMarker(again, W.cellAt);
  assert.deepEqual([p2.dir, p2.width, p2.rise, p2.ground], ["E", 2, 2, "paved"]);
  assert.deepEqual(p2.cols, plan.cols);
  assert.ok(RP.walkRamp(p2, W.cellAt, W.layerAt).ok);
});

test("the ramp's words exist in every language", () => {
  const keys = Object.keys(WORDS3.en).filter((k) => k.startsWith("rr.") || k.startsWith("ramp") || k.endsWith(".ramp") || k === "hint.rampHigh");
  assert.ok(keys.length >= 15);
  for (const lang of Object.keys(WORDS3)) for (const k of keys) assert.ok(WORDS3[lang][k], lang + " " + k);
});

// ---- the published grid (map3d/c): the places of the report's pictures
const DATA = new URL("../map3d/", import.meta.url);
const have = existsSync(new URL("meta.json", DATA));
function gridCellAt() {
  const memo = new Map();
  return (x, z) => {
    const [a, b] = CD.chunkOf(x, z), key = a + "_" + b;
    if (!memo.has(key)) {
      const f = new URL(`c/${key}.bin.gz`, DATA);
      memo.set(key, existsSync(f) ? CD.decodeChunk(gunzipSync(readFileSync(f))) : null);
    }
    return memo.get(key)?.cells.get(x + "," + z);
  };
}

test("on the map: the Basile street and a swamp cliff walk both ways; too steep is red", { skip: !have && "no map3d/ data" }, () => {
  const cellAt = gridCellAt(), layerAt = (x, z, f) => cellAt(x, z)?.layers.find((l) => l.f === f) || null;
  const check = (a, b, w) => RP.walkRamp(RP.planRamp(a, b, w, cellAt), cellAt, layerAt);
  // the street: no way up there today (the walk alone fails), with the ramp it walks
  const sa = { x: -240, z: 183, f: -5 }, sb = { x: -236, z: 183, f: -2 };
  assert.ok(!RP.walkRamp({ ...RP.planRamp(sa, sb, 2, cellAt), cols: [] }, cellAt, layerAt).ok);
  const st = check(sa, sb, 2);
  assert.ok(st.ok, JSON.stringify(st.reasons));
  // the swamp cliff: +3 over 5 cells
  const sw = check({ x: 359, z: -260, f: -1 }, { x: 359, z: -255, f: 2 }, 2);
  assert.ok(sw.ok, JSON.stringify(sw.reasons));
  // the same cliff from 2 cells away: too steep
  const steep = check({ x: 359, z: -257, f: -1 }, { x: 359, z: -255, f: 2 }, 2);
  assert.ok(!steep.ok && steep.reasons[0].code === "steep");
});
