// The 3D editor's Fill (map3d/fill.js): the fewest cells between two areas at the same level, filled with a chosen block
// or set (planks with a railing, an embankment down to the ground); the server's walk over it; the link. And the
// bridges' supports: each support column down to the ground under its own cell (two supports, two lengths).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as CD from "../map3d/cdata.js";
import * as FL from "../map3d/fill.js";
import * as BR from "../map3d/bridge.js";
import { encode, decode } from "../maplink.js";
import { WORDS3, translator3 } from "../map3d/words3d.js";

// a world of water at -6 on a bed `bed(x, z)` (default -7), with ground (top -5) where `land(x, z)` says
function world(land, { bed = () => -7, top = () => -5 } = {}) {
  const cells = new Map();
  for (let x = -10; x <= 30; x++) for (let z = -10; z <= 10; z++) {
    const c = { x, z, cubes: [], layers: [] };
    if (land(x, z)) {
      for (let y = -14; y <= top(x, z); y++) c.cubes.push({ y, kind: CD.K[y === top(x, z) ? "grass" : "dirt"], flags: 0 });
      c.layers.push({ x, z, f: top(x, z), stand: top(x, z) + 0.3, floor: "s", bad: 0, warn: 0, exits: 15 });
    } else {
      for (let y = -14; y <= bed(x, z); y++) c.cubes.push({ y, kind: CD.K.dirt, flags: 0 });
      for (let y = bed(x, z) + 1; y <= -6; y++) c.cubes.push({ y, kind: CD.K.water, flags: 0 });
      c.layers.push({ x, z, f: bed(x, z), stand: bed(x, z) + 0.3, floor: "s", bad: CD.BAD.water, warn: 0, exits: 15 });
    }
    cells.set(x + "," + z, c);
  }
  return { cellAt: (x, z) => cells.get(x + "," + z), layerAt: (x, z, f) => cells.get(x + "," + z)?.layers.find((l) => l.f === f) || null };
}
const key = (q) => [q.k, q.id, q.x, q.y, q.z, q.rot ?? ""].join(" ");

test("the fewest cells: straight across a channel; an L when the two areas don't face each other", () => {
  // a channel x 1..4 between two banks
  const W = world((x) => x <= 0 || x >= 5);
  const p = FL.planFill({ x: -2, z: 0, f: -5 }, { x: 7, z: 0, f: -5 }, 1, W.cellAt, "planks");
  assert.deepEqual(p.cells.map((c) => [c.x, c.z]), [[1, 0], [2, 0], [3, 0], [4, 0]]);
  assert.deepEqual(FL.pointsOfFill(p), [[0, 0], [5, 0]]);   // (from the last ground to the first ground)
  assert.ok(FL.walkFill(p, W.cellAt, W.layerAt).ok);
  // a bank to the west (x <= 0, z >= 0) and one to the east (x >= 5, z <= -2): no straight line; the fewest cells turn
  const L = world((x, z) => (x <= 0 && z >= 0) || (x >= 5 && z <= -2));
  const q = FL.planFill({ x: 0, z: 0, f: -5 }, { x: 5, z: -2, f: -5 }, 1, L.cellAt, "planks");
  assert.equal(q.cells.length, 6);   // (5 across and 2 down share their corner: 4 + 2)
  assert.ok(q.corners.length >= 3);
  assert.ok(FL.walkFill(q, L.cellAt, L.layerAt).ok);
  // the same areas, straight across where they face: none needed when they already join
  assert.deepEqual(FL.planFill({ x: -3, z: 0, f: -5 }, { x: -1, z: 0, f: -5 }, 1, W.cellAt, "planks").problems, [{ code: "noGap" }]);
});

test("the blocks: the planks turn with the way they go; the railing on open sides; an embankment down to the ground", () => {
  const W = world((x) => x <= 0 || x >= 4);
  const rail = FL.planFill({ x: 0, z: 0, f: -5 }, { x: 4, z: 0, f: -5 }, 1, W.cellAt, "planksRail");
  assert.deepEqual(rail.rows.filter((r) => r.k === "v").map((r) => r.t), ["SwampWoodCubeH", "SwampWoodCubeH", "SwampWoodCubeH"]);
  // (railings face the walk: on the -z side 0, on the +z side 180; the stock filler's)
  assert.deepEqual(rail.rows.filter((r) => r.k === "d").map((r) => [r.x, r.z, r.y, r.rot]).sort(),
    [[1, -1, -4, 0], [1, 1, -4, 180], [2, -1, -4, 0], [2, 1, -4, 180], [3, -1, -4, 0], [3, 1, -4, 180]].sort());
  const NS = world((x, z) => z <= 0 || z >= 4);
  const along = FL.planFill({ x: 0, z: 0, f: -5 }, { x: 0, z: 4, f: -5 }, 1, NS.cellAt, "planksRail");
  assert.ok(along.rows.filter((r) => r.k === "v").every((r) => r.t === "SwampWoodCubeV"));
  assert.deepEqual([...new Set(along.rows.filter((r) => r.k === "d").map((r) => r.rot))].sort((a, b) => a - b), [90, 270]);
  const dam = FL.planFill({ x: 0, z: 0, f: -5 }, { x: 4, z: 0, f: -5 }, 1, W.cellAt, "mud");
  assert.deepEqual(dam.rows.filter((r) => r.x === 2).map((r) => [r.t, r.y]), [["MudTop", -5], ["MudFill", -6]]);   // (the bed at -7)
  const wide = FL.planFill({ x: 0, z: 0, f: -5 }, { x: 4, z: 0, f: -5 }, 3, W.cellAt, "stone");
  assert.equal(wide.cells.length, 9);
  for (const b of FL.BLOCKS) assert.ok(FL.walkFill(FL.planFill({ x: 0, z: 0, f: -5 }, { x: 4, z: 0, f: -5 }, 1, W.cellAt, b.id), W.cellAt, W.layerAt).ok, b.id);
});

test("red with the reason: two levels (a ramp), too many cells, no way at this level", () => {
  const t3 = translator3("en");
  const U = world((x) => x <= 0 || x >= 4, { top: (x) => (x >= 4 ? -3 : -5) });
  const up = FL.planFill({ x: 0, z: 0, f: -5 }, { x: 4, z: 0, f: -3 }, 1, U.cellAt, "planks");
  assert.ok(up.problems.some((p) => p.code === "uneven"));
  assert.equal(FL.fillReason(up.problems[0], t3), "the far bank is 2 higher: it needs a ramp there");
  assert.ok(!FL.walkFill(up, U.cellAt, U.layerAt).ok);
  const far = world((x) => x <= -9 || x >= 20);
  assert.ok(FL.planFill({ x: -9, z: 0, f: -5 }, { x: 20, z: 0, f: -5 }, 1, far.cellAt, "planks").problems.some((p) => p.code === "tooLong"));
  // a wall between: nothing fillable leads across
  const walled = world((x) => x <= 0 || x >= 4);
  const wc = walled.cellAt;
  const blocked = (x, z) => { const c = wc(x, z); return x === 2 ? { ...c, cubes: [...c.cubes, { y: -5, kind: CD.K.wall, flags: 0 }, { y: -4, kind: CD.K.wall, flags: 0 }] } : c; };
  const nw = FL.planFill({ x: 0, z: 0, f: -5 }, { x: 4, z: 0, f: -5 }, 1, blocked, "planks");
  assert.ok(nw.problems.some((p) => p.code === "noWay"), JSON.stringify(nw.problems));
  assert.equal(FL.fillReason({ code: "noWay" }, t3), "no way to fill at this level between these two areas");
});

test("the link: its corners and its block; the marker round trips and plans the same rows", async () => {
  const L = world((x, z) => (x <= 0 && z >= 0) || (x >= 5 && z <= -2));
  const p = FL.planFill({ x: 0, z: 0, f: -5 }, { x: 5, z: -2, f: -5 }, 2, L.cellAt, "planksRail");
  assert.match(FL.encodeFill(p), /^planksRail\|2\|\d+$/);
  assert.deepEqual(FL.decodeFill("mud|1|4"), { block: "mud", width: 1, cells: 4 });
  for (const bad of ["", "mud|4|1", "nope|1|2", "mud|1"]) assert.equal(FL.decodeFill(bad), null, bad);
  const m = { id: 0, kind: "fill", floor: "s", locked: false, points: FL.pointsOfFill(p), fields: FL.fieldsOfFill(p, "vão") };
  const again = (await decode(await encode({ view: { floors: ["s"] }, markers: [m] }))).markers[0];
  assert.deepEqual(again, m);
  assert.deepEqual(FL.planOfFill(again, L.cellAt).rows.map(key).sort(), p.rows.map(key).sort());
  assert.ok(FL.editRows(p).every((r) => r.ship === "bake"));
});

test("the fill's words exist in every language", () => {
  const keys = Object.keys(WORDS3.en).filter((k) => k.startsWith("fl.") || k.startsWith("fb.") || k.startsWith("fill") || k.endsWith(".fill") || ["hint.fillFar", "passedFills", "kPlaceFill", "fBlock", "fBlockHelp"].includes(k));
  assert.ok(keys.length >= 20, keys.join());
  for (const lang of Object.keys(WORDS3)) for (const k of keys) assert.ok(WORDS3[lang][k], lang + " " + k);
  for (const b of FL.BLOCKS) assert.ok(WORDS3.pt["fb." + b.id], b.id);
  assert.equal(WORDS3.pt["p.fill"], "Preencher");
});

test("a bridge's supports reach the ground under each one: an uneven bed, two supports, two lengths", () => {
  const PF = JSON.parse(readFileSync(new URL("../map3d/bridge_prefabs.json", import.meta.url), "utf8")).prefabs;
  // a channel x 1..7 whose bed falls away to the east: -7 at x 2, -11 at x 6
  const W = world((x) => x <= 0 || x >= 8, { bed: (x) => (x <= 3 ? -7 : -11) });
  const plan = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 8, z: 0, f: -5 }, 1, W.cellAt, PF.find((q) => q.id === "swamp"));
  const logs = plan.rows.filter((r) => r.t === "SwampWoodLog");
  const column = (x, z) => logs.filter((r) => r.x === x && r.z === z).map((r) => r.y).sort((a, b) => a - b);
  // (the stock's logs at the 2nd cell from each end, x 2 and x 6, both sides; from the bed + 1 up to the deck + 2)
  assert.deepEqual(column(2, -1), [-6, -5, -4, -3]);
  assert.deepEqual(column(6, -1), [-10, -9, -8, -7, -6, -5, -4, -3]);
  assert.equal(column(2, 1).length, 4);
  assert.equal(column(6, 1).length, 8);
  assert.ok(BR.walkBridge(plan, W.cellAt, W.layerAt).ok);
  // bare planks too: a log column where a stretch is too long, each to the ground under its own cell
  const D = world((x) => x <= 0 || x >= 20, { bed: (x) => (x < 10 ? -7 : -10) });
  const bare = BR.planBridge({ x: 0, z: 0, f: -5 }, { x: 20, z: 0, f: -5 }, 1, D.cellAt, "plain");
  const feet = [...new Set(bare.rows.filter((r) => r.t === "SwampWoodLog").map((r) => r.x))].map((x) => Math.min(...bare.rows.filter((r) => r.t === "SwampWoodLog" && r.x === x).map((r) => r.y)));
  assert.ok(feet.includes(-6) && feet.includes(-9), JSON.stringify(feet));
});

// ---- the published grid (map3d/c): the swamp portal crossing and a short crossing at (194,-138)->(194,-134)
const DATA = new URL("../map3d/", import.meta.url);
const have = existsSync(new URL("meta.json", DATA));
function grid() {
  const memo = new Map();
  const cellAt = (x, z) => {
    const [a, b] = CD.chunkOf(x, z), k = a + "_" + b;
    if (!memo.has(k)) { const f = new URL(`c/${k}.bin.gz`, DATA); memo.set(k, existsSync(f) ? CD.decodeChunk(gunzipSync(readFileSync(f))) : null); }
    return memo.get(k)?.cells.get(x + "," + z);
  };
  return { cellAt, layerAt: (x, z, f) => cellAt(x, z)?.layers.find((l) => l.f === f) || null };
}
test("on the map: the swamp portal crossing in the fewest cells; the short crossing by rope (195,-138)", { skip: !have && "no map3d/ data" }, () => {
  const G = grid();
  const portal = FL.planFill({ x: 217, z: -134, f: -5 }, { x: 229, z: -136, f: -5 }, 1, G.cellAt, "planks");
  assert.deepEqual(portal.problems, []);
  assert.equal(portal.cells.length, 5);
  assert.ok(FL.walkFill(portal, G.cellAt, G.layerAt).ok);
  assert.ok(!FL.walkFill({ ...portal, cols: [] }, G.cellAt, G.layerAt).ok);   // (without the fill it doesn't walk)
  const short = FL.planFill({ x: 194, z: -138, f: -5 }, { x: 194, z: -134, f: -5 }, 1, G.cellAt, "planksRail");
  assert.equal(short.cells.length, 2);
  assert.ok(FL.walkFill(short, G.cellAt, G.layerAt).ok);
});
