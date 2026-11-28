// The 3D editor's Bridge (map3d/bridge.js): the stock bridges as prefabs (map3d/bridge_prefabs.json) stretched between
// two banks by whole segments, turned to any direction, their support columns down to the ground; the bare planks and
// the gap filler; the server's walk over them; the link. (The record-for-record match of each prefab with its stock
// bridge is checked by the staff tools against the client's own records; here the prefab file is the stock.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as CD from "../map3d/cdata.js";
import * as BR from "../map3d/bridge.js";
import { encode, decode } from "../maplink.js";
import { WORDS3, translator3 } from "../map3d/words3d.js";

const PREFABS = JSON.parse(readFileSync(new URL("../map3d/bridge_prefabs.json", import.meta.url), "utf8")).prefabs;
const pf = (id) => PREFABS.find((q) => q.id === id);

// a small world: a river along z (x from 1 to n - 1), banks at `bank` on both sides, water at bank - 1 on a bed `deep`
// under the bank
function river(n = 6, { bank = -5, far = bank, deep = 2, wide = 3 } = {}) {
  const cells = new Map();
  const cell = (x, z) => { const k = x + "," + z; if (!cells.has(k)) cells.set(k, { x, z, cubes: [], layers: [] }); return cells.get(k); };
  for (let z = -wide - 3; z <= wide + 3; z++) for (let x = -4; x <= n + 4; x++) {
    const c = cell(x, z), top = x <= 0 ? bank : x >= n ? far : null;
    if (top !== null) {
      for (let y = bank - 6; y <= top; y++) c.cubes.push({ y, kind: CD.K[y === top ? "grass" : "dirt"], flags: 0 });
      c.layers.push({ x, z, f: top, stand: top + 0.3, floor: "s", bad: 0, warn: 0, exits: 15 });
    } else {
      if (deep !== null) for (let y = bank - 6; y <= bank - deep; y++) c.cubes.push({ y, kind: CD.K.dirt, flags: 0 });
      c.cubes.push({ y: bank - 1, kind: CD.K.water, flags: 0 });
      c.layers.push({ x, z, f: bank - deep, stand: bank - deep + 0.3, floor: "s", bad: CD.BAD.water, warn: 0, exits: 15 });
    }
  }
  return { cellAt: (x, z) => cells.get(x + "," + z), layerAt: (x, z, f) => cells.get(x + "," + z)?.layers.find((l) => l.f === f) || null };
}
const key = (q) => [q.k, q.id, q.x, q.y, q.z, q.rot ?? ""].join(" ");

test("the prefab file: the stock bridges, each made of whole segments at its own length", () => {
  assert.deepEqual(PREFABS.map((q) => q.id), ["swamp", "rope", "canopy", "raised", "raisedLogs", "broken"]);
  for (const q of PREFABS) {
    const middle = q.stockLength - q.s - q.e;
    assert.ok(middle >= 0 && middle % q.p === 0, q.id);
    assert.ok(BR.lengthsOf(q).includes(q.stockLength), q.id);
    for (const r of q.records) assert.ok(["v", "d"].includes(r.k) && Number.isInteger(r.i) && Number.isInteger(r.r) && Number.isInteger(r.dy), q.id);
    // how each piece ships: a baked (built or static) piece is grafted from the stock prefab, a decor is placed, a collision cube is a record
    for (const [t, p] of Object.entries(q.pieces)) assert.ok(["bake", "placeable", "collision"].includes(p.store), q.id + " " + t);
  }
  // the swamp bridge with logs and lamps: 7 planks, 4 log columns, 6 railings, 4 lanterns
  const sw = pf("swamp");
  assert.deepEqual(Object.fromEntries(Object.entries(sw.pieces).map(([t, p]) => [t, p.n])), { SwampWoodBridge: 7, SwampWoodLog: 16, SwampLantern: 4, SwampWoodFence: 6 });
  assert.deepEqual(BR.lengthsOf(sw).slice(0, 4), [4, 8, 12, 16]);
  assert.equal(BR.snapLength(sw, 11), 12);
});

test("at its own length a prefab is its stock records; each length step adds one segment's records", () => {
  const W = river(30);
  for (const q of PREFABS) {
    const a = { x: 0, z: 0, f: -5 };
    const plan = BR.planBridge(a, { x: q.stockLength, z: 0, f: -5 }, 1, W.cellAt, q);
    // (the support columns reach the ground here: compare the rest record for record)
    const fixed = (rows) => rows.filter((r) => !(q.support || []).includes(r.id)).map((r) => key(r)).sort();
    const want = q.records.filter((r) => !(q.support || []).includes(r.id)).map((r) => key({ ...r, x: r.i, y: -5 + r.dy, z: -r.r })).sort();
    assert.deepEqual(fixed(plan.rows), want, q.id);
    assert.deepEqual(plan.problems, [], q.id);
    const longer = BR.planBridge(a, { x: q.stockLength + q.p, z: 0, f: -5 }, 1, W.cellAt, q);
    const seg = q.records.filter((r) => r.i >= q.s && r.i < q.s + q.p).length;
    assert.equal(longer.rows.filter((r) => !(q.support || []).includes(r.id)).length, want.length + seg - q.records.filter((r) => r.i >= q.s && r.i < q.s + q.p && (q.support || []).includes(r.id)).length, q.id);
    assert.equal(longer.segments, plan.segments + 1, q.id);
  }
  // a length between two steps: said, with the nearest one it can take
  const sw = pf("swamp");
  const odd = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 10, z: 0, f: -5 }, 1, river(12).cellAt, sw);
  assert.deepEqual(odd.problems, [{ code: "step", step: 4, near: 8 }]);
  assert.equal(BR.bridgeReason(odd.problems[0], translator3("en")), "this bridge's length steps by 4: try 8 cells");
});

test("turned to another direction: the slopes, the decors' rotations and the along-x / along-z pieces turn with it", () => {
  const q = pf("raised"), W = river(20);
  const east = BR.planBridge({ x: 0, z: 0, f: -1 }, { x: 13, z: 0, f: -1 }, 1, W.cellAt, q);
  const north = BR.planBridge({ x: 0, z: 0, f: -1 }, { x: 0, z: 13, f: -1 }, 1, (x, z) => W.cellAt(z, x), q);
  const pick = (p, t) => p.rows.filter((r) => r.t === t).map((r) => [r.id, r.rot ?? null]);
  assert.deepEqual(pick(east, "SwampWoodStairs"), [[8, 90], [8, 270]]);      // (stairs face their rise: E 90, W 270)
  assert.deepEqual(pick(north, "SwampWoodStairs"), [[8, 0], [8, 180]]);     // (N 0, S 180)
  assert.deepEqual(east.rows.filter((r) => /^Slope/.test(r.t)).map((r) => r.t), ["Slope2", "Slope4"]);
  assert.deepEqual(north.rows.filter((r) => /^Slope/.test(r.t)).map((r) => r.t), ["Slope1", "Slope3"]);
  assert.ok(east.rows.some((r) => r.t === "SwampWoodCubeV") && north.rows.some((r) => r.t === "SwampWoodCubeH"));   // (the planks' twin)
  // the railings: rot 0 / 180 along x, 90 / 270 along z
  assert.deepEqual([...new Set(pick(east, "SwampWoodFence").map((p) => p[1]))].sort((a, b) => a - b), [0, 180]);
  assert.deepEqual([...new Set(pick(north, "SwampWoodFence").map((p) => p[1]))].sort((a, b) => a - b), [90, 270]);
});

test("support columns reach the ground under them: a deeper bed, longer logs", () => {
  const q = pf("swamp");
  const shallow = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 8, z: 0, f: -5 }, 1, river(8, { deep: 2 }).cellAt, q);
  const deep = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 8, z: 0, f: -5 }, 1, river(8, { deep: 5 }).cellAt, q);
  const logs = (p) => p.rows.filter((r) => r.t === "SwampWoodLog");
  assert.equal(logs(shallow).length, 16);   // (4 columns from the bed + 1 up to the deck + 2)
  assert.equal(logs(deep).length, 16 + 4 * 3);
  assert.ok(logs(deep).every((r) => r.y >= -9 && r.y <= -3));
});

test("the walk: across and back (green); banks of two heights: one reason, it needs a ramp", () => {
  const t3 = translator3("en");
  for (const q of PREFABS) {
    // (on its centre lane alone: a hole in the deck's middle can't hide behind a side lane that walks)
    for (const L of [q.stockLength, q.stockLength + q.p]) {
      const W = river(L);
      const plan = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: L, z: 0, f: -5 }, 1, W.cellAt, q);
      const w = BR.walkBridge({ ...plan, lanes: [0] }, W.cellAt, W.layerAt);
      assert.ok(w.ok, q.id + " " + L + " " + JSON.stringify(w.reasons));
    }
  }
  const U = river(8, { far: -3 });
  const up = BR.walkBridge(BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 8, z: 0, f: -3 }, 1, U.cellAt, pf("swamp")), U.cellAt, U.layerAt);
  assert.ok(!up.ok);
  assert.deepEqual(up.reasons.map((r) => r.code), ["uneven"]);
  assert.equal(BR.bridgeReason(up.reasons[0], t3), "the far bank is 2 higher: it needs a ramp there");
});

test("bare planks and the gap filler: the deck over the water, logs only where a stretch is too long, railings on open sides", () => {
  const W = river(6), D = river(13, { deep: null });
  const plain = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 6, z: 0, f: -5 }, 2, W.cellAt, "plain");
  assert.equal(plain.rows.filter((r) => r.t === "SwampWoodBridge").length, 10);
  assert.ok(BR.walkBridge(plain, W.cellAt, W.layerAt).ok);
  const far = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 13, z: 0, f: -5 }, 1, D.cellAt, "plain");
  assert.deepEqual(far.problems, [{ code: "tooFar", span: 12, max: BR.MAX_SPAN }]);
  const G = river(4);
  const gap = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 4, z: 0, f: -5 }, 1, G.cellAt, "gapFill");
  assert.deepEqual(gap.rows.filter((r) => r.k === "v").map((r) => [r.t, r.x]), [["SwampWoodCubeH", 1], ["SwampWoodCubeH", 2], ["SwampWoodCubeH", 3]]);
  assert.deepEqual(gap.rows.filter((r) => r.k === "d").map((r) => [r.z, r.rot]), [[-1, 0], [1, 180], [-1, 0], [1, 180], [-1, 0], [1, 180]]);
  assert.ok(BR.walkBridge(gap, G.cellAt, G.layerAt).ok);
  assert.deepEqual(BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 7, z: 0, f: -5 }, 1, river(7).cellAt, "gapFill").problems, [{ code: "gapLong", gap: 6, max: BR.GAP_MAX }]);
});

test("the link: the prefab and the length; a bridge marker round trips and plans the same rows", async () => {
  const W = river(12), q = pf("swamp");
  const plan = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 12, z: 0, f: -5 }, 1, W.cellAt, q);
  assert.equal(BR.encodeBridge(plan), "E|swamp|12|1|2");
  assert.deepEqual(BR.decodeBridge("E|swamp|12|1|2"), { dir: "E", preset: "swamp", run: 12, width: 1, segments: 2 });
  for (const bad of ["", "E|swamp|12", "X|swamp|12|1|2", "E|swamp|x|1|2"]) assert.equal(BR.decodeBridge(bad), null, bad);
  const m = { id: 0, kind: "bridge", floor: "s", locked: false, points: [[0, 0], [12, 0]], fields: BR.fieldsOfBridge(plan, "ponte") };
  const again = (await decode(await encode({ view: { floors: ["s"] }, markers: [m] }))).markers[0];
  assert.deepEqual(again, m);
  assert.deepEqual(BR.planOfBridge(again, W.cellAt, PREFABS).rows.map(key), plan.rows.map(key));
  // what ships: the map edit's rows, each saying how (a baked piece is grafted, a decor placed)
  const rows = BR.editRows(plan);
  assert.ok(rows.every((r) => ["voxel", "decor"].includes(r.kind) && r.ship));
  assert.ok(rows.some((r) => r.tile === "SwampLantern" && r.ship === "placeable") && rows.some((r) => r.tile === "SwampWoodBridge" && r.ship === "bake"));
});

test("the bridge's words exist in every language", () => {
  const keys = Object.keys(WORDS3.en).filter((k) => k.startsWith("br.") || k.startsWith("bp.") || k.startsWith("bridge") || k.endsWith(".bridge") || ["hint.bridgeFar", "rampOffer", "hint.rampFromBank", "passedBridges", "kPlaceBridge", "bPrefab", "bPrefabHelp"].includes(k));
  assert.ok(keys.length >= 24, keys.join());
  for (const lang of Object.keys(WORDS3)) for (const k of keys) assert.ok(WORDS3[lang][k], lang + " " + k);
  for (const id of [...PREFABS.map((q) => q.id), "gapFill", "plain"]) assert.ok(WORDS3.pt["bp." + id], id);
  assert.equal(WORDS3.pt["bp.raised"], "Ponte elevada simples");
});

// ---- the published grid (map3d/c): the two swamp spots asked for
const DATA = new URL("../map3d/", import.meta.url);
const have = existsSync(new URL("meta.json", DATA));
// (the swamp's custom bridges are built in the map now: these tests plan on the water as it was, so the cubes above the
// water in their cells are taken out and the water's own layer put back)
function unbridged(c) {
  if (!c || c.x < 193 || c.x > 230 || c.z < -139 || c.z > -133) return c;
  const wet = c.cubes.find((q) => q.kind === CD.K.water && q.y === -6);
  if (!wet || !c.cubes.some((q) => q.y > -6 && q.kind !== CD.K.water && c.cubes.some((w) => w.y === -7))) return c;
  if (!c.cubes.some((q) => q.y === -5 && q.kind === CD.K.wood)) return c;
  return { ...c, cubes: c.cubes.filter((q) => q.y <= -6), layers: [{ x: c.x, z: c.z, f: -6, stand: -5.2, floor: "s", bad: CD.BAD.water, warn: 0, exits: 15 }] };
}
function grid() {
  const memo = new Map();
  const cellAt = (x, z) => {
    const [a, b] = CD.chunkOf(x, z), k = a + "_" + b;
    if (!memo.has(k)) { const f = new URL(`c/${k}.bin.gz`, DATA); memo.set(k, existsSync(f) ? CD.decodeChunk(gunzipSync(readFileSync(f))) : null); }
    return unbridged(memo.get(k)?.cells.get(x + "," + z));
  };
  return { cellAt, layerAt: (x, z, f) => cellAt(x, z)?.layers.find((l) => l.f === f) || null };
}
test("on the map: the swamp bridge across the channel beside the rope (201,-138), bare planks on the short crossing", { skip: !have && "no map3d/ data" }, () => {
  const G = grid();
  const one = BR.planBridge({ x: 200, z: -137, f: -5 }, { x: 212, z: -137, f: -5 }, 1, G.cellAt, pf("swamp"));
  assert.deepEqual(one.problems, []);
  assert.ok(BR.walkBridge(one, G.cellAt, G.layerAt).ok);
  assert.ok(!BR.walkBridge({ ...one, cols: [] }, G.cellAt, G.layerAt).ok);   // (without the bridge the channel doesn't walk)
  const two = BR.planBridge({ x: 194, z: -138, f: -5 }, { x: 194, z: -134, f: -5 }, 1, G.cellAt, "plain");
  assert.ok(BR.walkBridge(two, G.cellAt, G.layerAt).ok);
});
