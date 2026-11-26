// node --test tests/: the page's rules that need no browser (floors, the Go-to box)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { floorCounts, paneFloor, openingFloors, level, stepFloor, floorLinks } from "../floors.js";
import { parsePlace, placeFloors, parseFloor, searchMarkers, nearMarkers, fold } from "../goto.js";

const FLOORS = JSON.parse(readFileSync(new URL("../tiles/0.2.1/meta.json", import.meta.url))).floors;

// Two made-up maps: a big one (89 markers on 8 floors) and a small one (11 on the surface): floor -> count
const BIG = { s: 36, 4: 2, 0: 16, "-4": 22, "-5": 1, "-11": 9, "-13": 1, "-14": 2 };
const SMALL = { s: 11 };

test("floor counts", () => {
  const ms = [{ floor: "s" }, { floor: "s" }, { floor: "-4" }];
  assert.deepEqual(floorCounts(ms), { s: 2, "-4": 1 });
  assert.equal(Object.values(BIG).reduce((a, b) => a + b), 89);
});

test("levels: the surface between floor 0 and floor 1", () => {
  assert.ok(level("1") > level("s") && level("s") > level("0") && level("0") > level("-16"));
});

test("a new side-by-side pane: never the top of the world", () => {
  // the small map: markers on the surface only. Before: floor 10 (the list's next entry). Now: the floor under the surface
  // with map in view (0 here), never 10.
  const mapEverywhere = () => true;
  assert.equal(paneFloor(FLOORS, SMALL, ["s"], mapEverywhere), "0");
  assert.equal(paneFloor(FLOORS, SMALL, ["s"], (f) => +f < -2), "-3");   // 0 .. -2 blank in view: skipped
  // the big map: s and -11 shown; the next floor down from -11 with markers: -13; from s alone: 4? no, down first: 0
  assert.equal(paneFloor(FLOORS, BIG, ["s"]), "0");
  assert.equal(paneFloor(FLOORS, BIG, ["s", "-11"]), "-13");
  assert.equal(paneFloor(FLOORS, BIG, ["-14"]), "-13");               // the deepest: the nearest one up
  assert.equal(paneFloor(FLOORS, BIG, ["s", "0"]), "-4");
  // every floor with markers shown: the next one down with map
  assert.equal(paneFloor(FLOORS, { s: 1, 0: 1 }, ["s", "0"], (f) => f === "-1"), "-1");
  assert.equal(paneFloor(FLOORS, {}, ["-16"], () => false), null);
});

test("▲ ▼ by height through the floors that matter (the floors don't follow a neat order)", () => {
  const all = Object.fromEntries(FLOORS.map((f) => [f, { 0: ["0_0"] }]));   // map everywhere in view
  const view = [10, 10, 20, 20];
  const matters = Object.keys(BIG);   // s, 4, 0, -4, -5, -11, -13, -14
  assert.equal(stepFloor(FLOORS, all, "s", 1, view, matters), "0");     // down from the surface: 0, not 10
  assert.equal(stepFloor(FLOORS, all, "0", 1, view, matters), "-4");    // -1 .. -3 hold nothing: skipped
  assert.equal(stepFloor(FLOORS, all, "0", -1, view, matters), "s");    // up from 0: the surface
  assert.equal(stepFloor(FLOORS, all, "s", -1, view, matters), "4");    // up from the surface: floor 4 (1 .. 3 empty)
  assert.equal(stepFloor(FLOORS, all, "0", 1, view, matters, true), "-1");   // Shift: every floor
  assert.equal(stepFloor(FLOORS, all, "-14", 1, view, matters), "-15");  // past the last that matters: map in view
  assert.equal(stepFloor(FLOORS, { "-16": {} }, "-14", 1, view, matters), null);
  assert.equal(stepFloor(FLOORS, all, "s", 1, view, []), "0");          // nothing matters: the next with map, by height
});

test("floor links: which floors the link's ropes and portals join", () => {
  const ms = [
    { floor: "0", dest: { floor: "3" } }, { floor: "0", dest: { floor: "6" } }, { floor: "s", dest: { floor: "0" } },
    { floor: "s", dest: { floor: "s" } }, { floor: "-4" },
  ];
  assert.deepEqual(floorLinks(ms), { 0: ["6", "3", "s"], 3: ["0"], 6: ["0"], s: ["0"] });
});

test("a link opens on floors with markers: an empty saved floor is swapped for the busiest one", () => {
  assert.deepEqual(openingFloors(["s", "-11"], BIG), ["s", "-11"]);   // both have markers: as saved
  assert.deepEqual(openingFloors(["10"], BIG), ["s"]);                // the surface holds 36
  assert.deepEqual(openingFloors(["s", "10"], BIG), ["s", "-4"]);     // then floor -4 (22)
  assert.deepEqual(openingFloors(["s", "7"], BIG), ["s", "-4"]);
  assert.deepEqual(openingFloors(["7"], {}), ["7"]);                     // no markers: as saved
  assert.deepEqual(openingFloors(["s", "-2"], { s: 3 }, ["-2"]), ["s", "-2"]);   // a rope lands on -2: kept
  assert.deepEqual(openingFloors(["s", "9"], { s: 3 }), ["s", "9"]);     // nothing else to show: kept
});

test("Go to: the game's /pos, the page's copy, x z, x y z", () => {
  assert.deepEqual(parsePlace("[pos] x -352.0, y -10.2, z 332.0 (floor -11)"), { x: -352, z: 332, y: -10.2, tag: "-11" });
  assert.deepEqual(parsePlace("[pos] x -271.0, y -1.2, z 283.0 (floor -2)"), { x: -271, z: 283, y: -1.2, tag: "-2" });
  assert.deepEqual(parsePlace("[pos] x -0.0, y 1.3, z 0.0 (floor 0)"), { x: 0, z: 0, y: 1.3, tag: "0" });
  assert.deepEqual(parsePlace("[pos] x 12.0, z -40.0 (surface)"), { x: 12, z: -40, y: null, tag: "s" });
  assert.deepEqual(parsePlace("-352, 332"), { x: -352, z: 332, y: null, tag: null });
  assert.deepEqual(parsePlace("  -352 332 "), { x: -352, z: 332, y: null, tag: null });
  assert.deepEqual(parsePlace("-352, -10.2, 332"), { x: -352, z: 332, y: -10.2, tag: null });
  assert.deepEqual(parsePlace("x: 10 z: -5"), { x: 10, z: -5, y: null, tag: null });
  assert.equal(parsePlace("swamp troll"), null);
  assert.equal(parsePlace("andar -4"), null);
  assert.equal(parsePlace("12"), null);
  assert.equal(parsePlace(""), null);
});

test("Go to: which floor a place is on", async () => {
  const has = async (f) => f === "-11";
  assert.deepEqual(await placeFloors(parsePlace("[pos] x -352.0, y -10.2, z 332.0 (floor -11)"), FLOORS, has), ["-11", "s"]);
  // the game's "(floor 2)" on a hill of the surface: no map on slice 2 there: the surface first, slice 2 still offered
  assert.deepEqual(await placeFloors(parsePlace("[pos] x 0.0, y 3.3, z 0.0 (floor 2)"), FLOORS, has), ["s", "2"]);
  assert.deepEqual(await placeFloors(parsePlace("x 1 z 2 (surface)"), FLOORS, has), ["s"]);
  assert.deepEqual(await placeFloors(parsePlace("-352, -10.2, 332"), FLOORS, has), ["-11", "s"]);   // a bare y
  assert.equal(await placeFloors(parsePlace("-352, 332"), FLOORS, has), null);                      // the floor shown
  assert.deepEqual(await placeFloors({ x: 0, z: 0, y: null, tag: "-40" }, FLOORS, has), ["s"]);       // no such slice
});

test("Go to: floors and markers by name", () => {
  assert.equal(parseFloor("andar -4", FLOORS), "-4");
  assert.equal(parseFloor("Floor 0", FLOORS), "0");
  assert.equal(parseFloor("Superfície", FLOORS), "s");
  assert.equal(parseFloor("第 -11 层", FLOORS), "-11");
  assert.equal(parseFloor("andar -99", FLOORS), null);
  assert.equal(parseFloor("troll", FLOORS), null);
  const ms = [
    { id: 1, floor: "s", x: 0, z: 0, t: "Swamp Troll ×3" },
    { id: 2, floor: "s", x: 10, z: 0, t: "Entrada da cidade" },
    { id: 3, floor: "-4", x: 3, z: 4, t: "Cave Troll" },
    { id: 4, floor: "s", x: 100, z: 0, t: "Troll bridge" },
  ];
  assert.deepEqual(searchMarkers(ms, "troll", (m) => m.t).map((m) => m.id), [4, 3, 1]);
  assert.deepEqual(searchMarkers(ms, "ENTRADA cid", (m) => m.t).map((m) => m.id), [2]);
  assert.deepEqual(searchMarkers(ms, "  ", (m) => m.t), []);
  assert.equal(fold("Superfície Ação"), "superficie acao");
  const near = nearMarkers(ms, 0, 0, "s", (m) => [m.x, m.z], 40);
  assert.deepEqual(near.map((n) => [n.m.id, n.d]), [[1, 0], [2, 10]]);
});

test("owners: a cell's owner tile and pixel, as map_tiles.py cuts them", async () => {
  const { ownerTile } = await import("../floors.js");
  assert.deepEqual(ownerTile(0, 0), { key: "0_0", at: 0 });
  // Setzer's sign at (108, -246): canvas pixel (1132, 1270) -> tile 0_0, row 246, column 108
  assert.deepEqual(ownerTile(108, -246), { key: "0_0", at: 246 * 256 + 108 });
  assert.deepEqual(ownerTile(-1, 1), { key: "-1_-1", at: 255 * 256 + 255 });
  assert.deepEqual(ownerTile(256, -256), { key: "1_1", at: 0 });
});

test("owners: a marker takes the floor whose ledge the band shows, else the pane's", async () => {
  const { cellFloor } = await import("../floors.js");
  const { floorCode } = await import("../maplink.js");
  assert.equal(cellFloor("-9", floorCode("-7") + 1), "-7");   // the -7 ledge in the -9 band (red 15)
  assert.equal(floorCode("-7") + 1, 15);                      // tools/maplink.py floor_code("-7") + 1: the same red
  assert.equal(cellFloor("-9", floorCode("s") + 1), "s");
  assert.equal(cellFloor("-9", 0), "-9");                     // the floor's own cell
  assert.equal(cellFloor("-9", undefined), "-9");             // no owner data (an old tile set): the pane's floor
});
