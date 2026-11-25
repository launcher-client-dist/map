// node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync, deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { encode, decode, changes, saveState, baselineOf, runsOf, floorCode, floorOf, payloadOf, cleanTitle, LinkError, KINDS, KIND_CODE, CORE_KINDS, FORMAT, outlinesOf, monsterIndex, COLORS, FLAG, flagged, same } from "../maplink.js";
import { parseLever, leverCode, leverText, wallCells, remapArea, rebased, MAX_WALLS } from "../lever.js";
import { MONSTERS } from "../monsters.js";
import { WORDS, LANGS, translator } from "../i18n.js";
import { parseSchedule, scheduleCode, scheduleText, windowTag } from "../schedule.js";
import { BOSSES, bossOf } from "../bosses.js";
import { nextFloor, tilesInView } from "../floors.js";

const sample = {
  tiles: "0.2.1",
  view: { x: 120, z: -40, zoom: 1, floors: ["s", "-3"] },
  markers: [
    { id: 0, kind: "spawn", floor: "s", locked: false, x: 120, z: -40, fields: { monster: "Wolf", count: 5, radius: 4 } },
    { id: 1, kind: "poi", floor: "-3", locked: true, x: -7, z: 300, fields: { label: "entrada" } },
    { id: 2, kind: "area", floor: "s", locked: false, cells: [[1, 1], [2, 1], [3, 1], [1, 2], [5, 2]], fields: { label: "A" } },
    { id: 3, kind: "route", floor: "s", locked: false, points: [[0, 0], [10, -5], [12, 30]], fields: {} },
    { id: 4, kind: "note", floor: "10", locked: false, x: 0, z: 0, fields: { text: "olá 你好 \"<b>x</b>\"" } },
  ],
};

test("round trip keeps every kind", async () => {
  const frag = await encode(sample);
  assert.ok(frag.startsWith("2."));   // Save writes format 2
  const s = await decode(frag);
  assert.equal(s.format, 2);
  assert.equal(s.tiles, "0.2.1");
  assert.deepEqual(s.view, sample.view);
  assert.equal(s.base, 5);
  assert.equal(s.next, 5);
  assert.deepEqual(s.markers, sample.markers);
  assert.deepEqual(s.was, []);
  assert.deepEqual(changes(s), []);
});

test("floor codes", () => {
  for (const f of ["s", "0", "1", "-1", "10", "-16"]) assert.equal(floorOf(floorCode(f)), f);
});

test("runs", () => {
  assert.deepEqual(runsOf([[3, 1], [1, 1], [2, 1], [5, 1], [0, -2]]), [[-2, 0, 1], [1, 1, 3], [1, 5, 1]]);
});

test("save records added, moved, edited, removed against the opened link", async () => {
  const opened = await decode(await encode(sample));
  const markers = structuredClone(opened.markers);
  markers[0].x += 3;                       // moved
  markers[0].fields.count = 8;             // edited
  markers.splice(4, 1);                    // removed (note)
  markers.push({ id: 5, kind: "spawn", floor: "s", locked: false, x: 1, z: 2, fields: { monster: "Bear", count: 2 } });
  const saved = await decode(await encode(saveState(opened, markers, opened.view, opened.tiles, 6)));
  const ops = changes(saved).map((c) => c.op + "#" + c.id + (c.field ? ":" + c.field : ""));
  assert.deepEqual(ops, ["moved#0", "edited#0:count", "removed#4", "added#5"]);
  const moved = changes(saved)[0];
  assert.deepEqual([moved.from, moved.to], [[120, -40], [123, -40]]);
  // saving the saved link again unchanged: no changes
  const again = await decode(await encode(saveState(saved, saved.markers, saved.view, saved.tiles, saved.next)));
  assert.deepEqual(changes(again), []);
});

test("a saved link rebuilds the link it came from: a second save keeps the first round's changes", async () => {
  const opened = await decode(await encode(sample));
  const markers = structuredClone(opened.markers);
  markers[1].fields.label = "saída";
  markers.splice(3, 1);
  markers.push({ id: 5, kind: "note", floor: "s", locked: false, x: 3, z: 3, fields: { text: "new" } });
  const first = await decode(await encode(saveState(opened, markers, opened.view, opened.tiles, 6)));
  const base = baselineOf(first);
  assert.deepEqual(base.markers, opened.markers);
  assert.equal(base.next, 5);
  // reload, move the new note, save again: still every change against the original
  const again = structuredClone(first.markers);
  again.find((m) => m.id === 5).x = 4;
  const second = await decode(await encode(saveState(base, again, first.view, first.tiles, first.next)));
  assert.deepEqual(changes(second).map((c) => c.op + "#" + c.id), ["edited#1", "removed#3", "added#5"]);
});

test("a short link can't declare millions of cells", async () => {
  // 1000 markers of 40000 cells each, a few hundred bytes deflated
  const big = { view: { floors: ["s"] }, markers: [] };
  const row = Array.from({ length: 200 }, (_, x) => [x, 0]);
  for (let i = 0; i < 400; i++) big.markers.push({ id: i, kind: "area", floor: "s", cells: row, fields: {} });
  await assert.rejects(decode(await encode(big)), /too large/);
});

test("an unknown kind survives unchanged", async () => {
  const s = await decode(await encode(sample));
  // forge a link with kind code 99 by re-encoding a raw marker
  s.markers.push({ id: 9, kind: "unknown99", code: 99, floor: "s", locked: false, raw: btoa("\x02\x04xyz") });
  const back = await decode(await encode(s));
  assert.equal(back.markers.at(-1).kind, "unknown99");
  assert.equal(back.markers.at(-1).raw, btoa("\x02\x04xyz"));
  assert.ok(KINDS.length < 99);
});

test("bad links are refused", async () => {
  for (const bad of ["", "#", "#2.AAAA", "#3.AAAA", "#2.!!!", "#2.Ag", "#1.!!!", "#1.AAAA", "#x.abc"]) {
    await assert.rejects(decode(bad), LinkError, bad);
  }
});

// ------------------------------------------------------------------------------------------------ map things
// Links made before the map-thing kinds existed, with what they decoded to then (made-up markers). They must open
// exactly as before, and be written back byte for byte.
const OLD = {
  readme: "1.Y2QIKGdhZGBhYWFiYGTgZU63YWJiACFGRkegAANvVCMjI0t4fk4aEwcLGyMTAwNHSi4jS0ZqUSoLMwMDv1s3IyNXcUFieZ5CZkpqIgMA",
  saved: "1.Y2Q10DPSMwwoZ2FkYGFhZmJgZOBlTrdhYmIAIUZGRwZGBgaehGpGlvD8nDQmDhY2RiYGBp6UXEaO1LySosS85FRmkBLeqEZGVDUcKbmMLBmpRakszAwM_G7djIxcxQWJ5XkKmSmpiQA",
};
const OLD_README = {
  format: 1, tiles: "", view: { x: 40, z: -60, zoom: 2, floors: ["s"] }, base: 4, next: 4, was: [],
  markers: [
    { id: 0, floor: "s", locked: true, kind: "area", cells: [[30, -52], [31, -52], [32, -52], [30, -51], [31, -51], [32, -51], [30, -50], [31, -50], [32, -50]], fields: { label: "A" } },
    { id: 1, floor: "s", locked: false, kind: "spawn", x: 45, z: -65, fields: { monster: "Wolf", count: 4, radius: 3 } },
    { id: 2, floor: "s", locked: false, kind: "poi", x: 50, z: -55, fields: { label: "here" } },
    { id: 3, floor: "s", locked: false, kind: "note", x: 35, z: -70, fields: { text: "spawn idea" } },
  ],
};
const inflated = (frag) => new Uint8Array(inflateRawSync(Buffer.from(frag.split(".")[1], "base64url")));

test("links from before the map things open exactly as before", async () => {
  assert.deepEqual(await decode(OLD.readme), OLD_README);
  const saved = await decode(OLD.saved);
  assert.deepEqual(changes(saved).map((c) => [c.op, c.id, c.field ?? null]), [["moved", 1, null], ["edited", 2, "label"], ["removed", 3, null]]);
  for (const frag of Object.values(OLD)) assert.deepEqual(payloadOf(await decode(frag), 1), inflated(frag));
  // Save writes them as format 2, the same markers and change list
  const again = await decode(await encode(saved));
  assert.equal(again.format, 2);
  assert.deepEqual(again.markers, saved.markers);
  assert.deepEqual(changes(again), changes(saved));
});

const things = {
  tiles: "0.2.1",
  view: { x: 10, z: 20, zoom: 2, floors: ["s", "-4"] },
  markers: [
    { id: 0, kind: "rope", floor: "s", locked: false, x: 11, z: 22, dest: { x: 13, z: 21, floor: "-4" }, fields: { label: "corda 1" } },
    { id: 1, kind: "lever", floor: "-4", locked: false, x: 5, z: 5, fields: { label: "alavanca" } },
    { id: 2, kind: "hole", floor: "s", locked: false, x: -3, z: 8, fields: {} },
    { id: 3, kind: "door", floor: "s", locked: true, x: 0, z: 0, fields: { label: "porta" } },
    { id: 4, kind: "portal", floor: "-4", locked: false, x: 100, z: -100, dest: { x: -100, z: 100, floor: "s" }, fields: { label: "portal" } },
  ],
};

test("map things round trip, with and without a destination", async () => {
  const s = await decode(await encode(things));
  assert.deepEqual(s.markers, things.markers);
  assert.ok(!("dest" in s.markers[2]));
  assert.deepEqual(KINDS.slice(5).map((k) => k.name), ["rope", "lever", "hole", "door", "portal", "elevator", "rope2", "boss", "npc"]);
  assert.deepEqual(KINDS.slice(0, 5).map((k) => k.name), ["spawn", "poi", "area", "route", "note"]);   // never reordered
  // an elevator leads to another floor like a rope
  const lift = { view: { floors: ["s"] }, markers: [{ id: 0, kind: "elevator", floor: "-2", locked: false, x: 4, z: 4, dest: { x: 4, z: 4, floor: "3" }, fields: { label: "elevador" } }] };
  assert.deepEqual((await decode(await encode(lift))).markers, lift.markers);
});

test("a destination set, moved and removed are their own changes, apart from a move", async () => {
  const opened = await decode(await encode(things));
  const m = structuredClone(opened.markers);
  m[0].dest = { x: 14, z: 21, floor: "-4" };          // destination moved
  m[2].dest = { x: -3, z: 8, floor: "-1" };           // destination set (straight down)
  m[4].x += 2;                                        // the portal moved, its destination not
  delete m[4].dest;                                   // ... and its destination removed
  m.push({ id: 5, kind: "rope", floor: "s", locked: false, x: 1, z: 1, dest: { x: 1, z: 2, floor: "s" }, fields: {} });
  const saved = await decode(await encode(saveState(opened, m, opened.view, opened.tiles, 6)));
  const got = changes(saved).map((c) => [c.op, c.id]);
  assert.deepEqual(got, [["dest", 0], ["dest", 2], ["moved", 4], ["dest", 4], ["added", 5]]);
  const c = changes(saved);
  assert.deepEqual([c[0].from, c[0].to], [{ x: 13, z: 21, floor: "-4" }, { x: 14, z: 21, floor: "-4" }]);
  assert.deepEqual([c[1].from, c[1].to], [null, { x: -3, z: 8, floor: "-1" }]);
  assert.deepEqual([c[3].from, c[3].to], [{ x: -100, z: 100, floor: "s" }, null]);
  // the marker moved with its destination fixed: a move only
  const m2 = structuredClone(opened.markers);
  m2[0].x += 1;
  const s2 = await decode(await encode(saveState(opened, m2, opened.view, opened.tiles, 5)));
  assert.deepEqual(changes(s2).map((x) => x.op), ["moved"]);
});

test("a map's title: carried, cleaned, capped, and only bytes after everything an older page reads", async () => {
  const s = await decode(await encode({ ...things, title: "  Caverna\tdo leste \n" }));
  assert.equal(s.title, "Caverna do leste");
  assert.ok(!("title" in (await decode(await encode(things)))));   // no title: no key, as before
  const long = await decode(await encode({ ...things, title: "x".repeat(80) + "你好" }));
  assert.equal(long.title, "x".repeat(60));
  assert.equal(cleanTitle("🙂".repeat(70)).length, 60 * 2);   // 60 characters, not 60 UTF-16 units
  // the untitled payload is a prefix of the titled one: a page from before titles reads the same link
  const plain = payloadOf(things), titled = payloadOf({ ...things, title: "Mapa" });
  assert.deepEqual(titled.slice(0, plain.length), plain);
  assert.ok(titled.length > plain.length);
  // Save keeps it
  const opened = await decode(await encode(things));
  const saved = await decode(await encode(saveState(opened, opened.markers, opened.view, opened.tiles, opened.next, "Novo")));
  assert.equal(saved.title, "Novo");
  assert.deepEqual(changes(saved), []);
});

test("floor up / down: the next floor with map in view, none past the ends", () => {
  const floors = ["s", "10", "9", "8", "-1"];
  const all = ["-1_-1", "0_-1", "-1_0", "0_0"];
  const tiles = { s: { 0: all }, 10: { 0: all }, 9: { 0: ["5_5"] }, 8: { 0: all }, "-1": { 0: ["0_0"] } };
  const view = [-100, -100, 100, 100];   // touches the four middle tiles
  assert.equal(nextFloor(floors, tiles, "s", -1, view), null);           // the surface is the top
  assert.equal(nextFloor(floors, tiles, "s", 1, view), "10");
  assert.equal(nextFloor(floors, tiles, "10", 1, view), "8");            // 9 has no map here: skipped
  assert.equal(nextFloor(floors, tiles, "8", -1, view), "10");
  assert.equal(nextFloor(floors, tiles, "8", 1, view), "-1");
  assert.equal(nextFloor(floors, tiles, "8", 1, [-300, -300, -200, -200]), null);   // -1 has no map in that corner
  assert.equal(nextFloor(floors, tiles, "-1", 1, view), null);           // the bottom
  assert.deepEqual(tilesInView([10, 10, 300, 20]), ["0_0", "1_0"]);
});

test("every language has every word", () => {
  const en = Object.keys(WORDS.en);
  for (const l of LANGS) assert.deepEqual(en.filter((k) => !(k in WORDS[l])), [], l);
  for (const k of KINDS) for (const l of LANGS) assert.ok(WORDS[l]["kind." + k.name] && WORDS[l]["tool." + k.name] && WORDS[l]["help." + k.name], l + " " + k.name);
});

test("a typical link stays short", async () => {
  const many = { view: { x: 0, z: 0, zoom: 0, floors: ["s"] }, markers: [] };
  for (let i = 0; i < 20; i++) many.markers.push({ id: i, kind: "spawn", floor: "s", x: 100 + i * 7, z: -50 + i * 3, fields: { monster: "Orc Infantry", count: 4, radius: 5 } });
  const frag = await encode(many);
  assert.ok(frag.length < 150, "20 spawns: " + frag.length);
});

// ------------------------------------------------------------------------------------------------ format 2
// made-up shapes: a ring (a hole), two islands, one cell, thin lines, cells touching only at a corner, a blob
const rect = (x0, z0, w, h) => { const c = []; for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) c.push([x, z]); return c; };
const minus = (a, b) => { const k = new Set(b.map((c) => c.join())); return a.filter((c) => !k.has(c.join())); };
const sorted = (cells) => [...new Map(cells.map((c) => [c.join(), c])).values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
function blob(seed, n) {   // a random 4-connected blob with bays and holes (a small LCG: the same on every run)
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cells = new Map([["0,0", [0, 0]]]);
  while (cells.size < n) {
    const [x, z] = [...cells.values()][Math.floor(rnd() * cells.size)];
    const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)];
    cells.set(x + dx + "," + (z + dz), [x + dx, z + dz]);
  }
  return [...cells.values()].filter(() => rnd() > 0.08);   // some holes
}
const SHAPES = {
  ring: minus(rect(0, 0, 9, 7), rect(3, 2, 3, 3)),
  ringWithIsland: [...minus(rect(-20, 40, 12, 12), rect(-17, 43, 6, 6)), [-14, 46]],
  islands: [...rect(0, 0, 3, 3), ...rect(10, -5, 2, 6)],
  oneCell: [[-300, 250]],
  row: rect(5, 5, 40, 1),
  column: rect(5, 5, 1, 40),
  diagonal: Array.from({ length: 12 }, (_, i) => [i, i]),
  pinch: [[0, 0], [1, 1], [1, 0], [2, 2], [3, 1]],
  checker: rect(0, 0, 8, 8).filter(([x, z]) => (x + z) % 2 === 0),
  blob: blob(7, 900),
  bigBlob: blob(11, 3000),
};

test("format 2 areas: every shape comes back cell for cell, outlines where they are shorter", async () => {
  for (const [name, cells] of Object.entries(SHAPES)) {
    const state = { view: { x: 3, z: -2, floors: ["s"] }, markers: [{ id: 0, kind: "area", floor: "-4", locked: false, cells, fields: { label: name } }] };
    const back = await decode(await encode(state));
    assert.deepEqual(back.markers[0].cells, sorted(cells), name);
    const loops = outlinesOf(runsOf(cells));
    assert.ok(loops, name + ": outlines give the cells back");
  }
  assert.equal(outlinesOf(runsOf(SHAPES.ring)).length, 2);            // outside and the hole
  assert.equal(outlinesOf(runsOf(SHAPES.ringWithIsland)).length, 3);  // and the island in it
  assert.equal(outlinesOf(runsOf(SHAPES.pinch)).length, 1);           // walked through the corner-touching cells
  // a blob's outlines are far shorter than its rows (holes and all)
  const area = (cells) => ({ view: { floors: ["s"] }, markers: [{ id: 0, kind: "area", floor: "s", cells, fields: {} }] });
  const v2 = payloadOf(area(SHAPES.bigBlob)).length, v1 = payloadOf(area(SHAPES.bigBlob), 1).length;
  assert.ok(v2 < v1 * 0.6, v2 + " vs " + v1);
});

test("format 2 spawns: a listed monster is its index, another name is text, a newer page's index comes back", async () => {
  const spawn = (id, monster) => ({ id, kind: "spawn", floor: "s", locked: false, x: id, z: 0, fields: { monster, count: 2, radius: 3 } });
  const state = { view: { floors: ["s"] }, markers: [spawn(0, "Wolf"), spawn(1, "Wolf"), spawn(2, "Bear"), spawn(3, "Battle Dummy"), spawn(4, "#500"), spawn(5, "#3")] };
  const back = await decode(await encode(state));
  assert.deepEqual(back.markers, state.markers);
  const text = new TextDecoder().decode(payloadOf(state));
  assert.ok(!text.includes("Wolf") && !text.includes("Bear") && text.includes("Battle Dummy") && text.includes("#3"));
  assert.equal(monsterIndex("#500"), 500);
  assert.equal(monsterIndex("#3"), -1);   // a typed "#3" stays text: 3 is a listed monster here
  // the list only grows: today's names keep their places
  assert.deepEqual(MONSTERS.slice(0, 4), ["Amphitere", "Ancient Snake", "Bandit", "Banshee"]);
  assert.equal(MONSTERS.indexOf("Wolf"), 77);
  assert.equal(MONSTERS.indexOf("Young Amphitere"), 78);
});

test("format 2: a short link can't declare a huge area, and bad bits are refused", async () => {
  // one loop, sides 2^20 long: 2^40 cells in a few bytes
  const head = [2, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0];   // version, tiles "", view 0 0 0, 1 pane s, base 1, next 1, 1 marker, 0 was, flags 0
  const bits = [];
  const put = (v, k) => { for (let i = 0; i < k; i++) bits.push(Math.floor(v / 2 ** i) % 2); };
  const gamma = (v) => { let k = 0; while (2 ** (k + 1) <= v) k++; put(0, k); bits.push(1); put(v - 2 ** k, k); };
  bits.push(0); gamma(3);      // kind area
  gamma(1);                    // id 0
  bits.push(0); gamma(1);      // floor s, unlocked
  bits.push(1); gamma(2);      // outlines, 1 loop
  gamma(1); put(0, 3); gamma(1); put(0, 3);   // its first corner at 0, 0 (two z_3(0))
  gamma(1);                    // 4 corners
  bits.push(0); gamma(2 ** 20);   // east 2^20
  bits.push(0); gamma(2 ** 20);   // north 2^20
  const bytes = [...head];
  for (let i = 0; i < bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b, j) => a + b * 2 ** j, 0));
  const frag = "2." + Buffer.from(bytes).toString("base64url");
  await assert.rejects(decode(frag), /too large/);
  // a link flag this page doesn't know: a newer format
  const flagged = Buffer.from([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2]).toString("base64url");
  await assert.rejects(decode("2." + flagged), /newer/);
});

test("format 2 is frozen: the README's format-2 example opens as its format-1 twin", async () => {
  const v2 = "2.AgBQdwQBAAQEBAAAnMozMrfEJGMdE0FLZmxS0mN0ZMlILUrlKi5ILM9TyExJTQQA";
  const s = await decode(v2);
  assert.deepEqual({ ...s, format: 1 }, OLD_README);
  const head = Buffer.from(v2.slice(2), "base64url");
  assert.deepEqual([...payloadOf(s).slice(0, 15)], [...head.slice(0, 15)]);   // the head: written the same today
});

test("format 2 keeps a later kind's marker as bytes, and a lever, a note and a route as they were", async () => {
  const s = { view: { x: 50, z: 50, floors: ["s"] }, title: "Mapa", markers: [
    { id: 0, kind: "route", floor: "s", locked: false, points: [[50, 50], [60, 55], [61, 80]], fields: { label: "caminho" } },
    { id: 2, kind: "lever", floor: "-3", locked: true, x: 40, z: 45, fields: {} },
    { id: 7, kind: "unknown20", code: 20, floor: "s", locked: false, raw: btoa("\x04\x06abc") },
    { id: 8, kind: "note", floor: "-3", locked: true, x: 0, z: -900, fields: { text: "olá 你好" } },
  ], was: [{ id: 1, kind: "area", floor: "s", locked: false, cells: [], fields: {} }] };
  const back = await decode(await encode(s));
  assert.deepEqual(back.markers, s.markers);
  assert.deepEqual(back.was, s.was);
  assert.equal(back.title, "Mapa");
  assert.equal(FORMAT, 2);
});

// ------------------------------------------------------------------------------------------------ rope2, boss, npc
const later = {
  tiles: "0.2.1",
  view: { x: 10, z: 20, zoom: 2, floors: ["s", "-4"] },
  markers: [
    { id: 0, kind: "rope2", floor: "s", locked: false, x: 11, z: 22, dest: { x: 13, z: 21, floor: "-4" }, fields: { label: "corda dupla" } },
    { id: 1, kind: "rope", floor: "s", locked: false, x: 30, z: 30, dest: { x: 30, z: 31, floor: "s" }, fields: {} },
    { id: 2, kind: "boss", floor: "s", locked: true, x: -40, z: 55, fields: { monster: "Rubellus", schedule: "toda hora no :05", label: "chefe" } },
    { id: 3, kind: "npc", floor: "-4", locked: false, x: 7, z: -8, fields: { name: "Gavin", schedule: "noite (01h-04h do jogo)", label: "vende cordas" } },
    { id: 4, kind: "rope2", floor: "-4", locked: false, x: 2, z: 2, fields: {} },
  ],
};

test("a two-way rope, a boss and an NPC: kinds 11..13, round trip in both formats", async () => {
  assert.deepEqual(KINDS.slice(CORE_KINDS).map((k) => k.name), ["rope2", "boss", "npc"]);
  assert.deepEqual((await decode(await encode(later))).markers, later.markers);
  const v1 = "1." + Buffer.from(deflateRawSync(payloadOf(later, 1))).toString("base64url");
  assert.deepEqual((await decode(v1)).markers, later.markers);
});

test("a rope made two-way (or one-way) is its own change", async () => {
  const opened = await decode(await encode(later));
  const m = structuredClone(opened.markers);
  m[0].kind = "rope";
  m[1].kind = "rope2";
  m[1].x += 1;
  const saved = await decode(await encode(saveState(opened, m, opened.view, opened.tiles, 5)));
  assert.deepEqual(changes(saved).map((c) => [c.op, c.id, c.from?.toString() ?? null]),
    [["kind", 0, "rope2"], ["kind", 1, "rope"], ["moved", 1, "30,30"]]);
});

// ------------------------------------------------------------------------------------------------ schedules, bosses
test("schedules: each mode's compact code, its words, and an older link's free text kept", async () => {
  const pt = translator("pt"), en = translator("en");
  assert.deepEqual(parseSchedule(""), { mode: "always" });
  assert.deepEqual(parseSchedule("h05"), { mode: "hour", minute: 5 });
  assert.deepEqual(parseSchedule("g18-06"), { mode: "game", from: 18, to: 6 });
  for (const s of ["h60", "h5", "g24-01", "g1-4", "toda hora no :05"]) assert.deepEqual(parseSchedule(s), { mode: "custom", text: s });
  for (const s of ["", "h00", "h59", "g00-23", "g18-06"]) assert.equal(scheduleCode(parseSchedule(s)), s);
  assert.equal(scheduleCode({ mode: "hour", minute: 99 }), "h59");
  assert.equal(scheduleText("h05", pt), "toda hora real, no :05");
  assert.equal(scheduleText("g01-04", pt), "das 01h às 04h do jogo (noite) · :02:30–:10 de cada hora real");
  assert.equal(scheduleText("g06-18", en), "from 06:00 to 18:00 game time (day) · :15–:45 of every real hour");
  assert.equal(scheduleText("g02-00", pt), "das 02h às 00h do jogo · :05–:00 de cada hora real");   // day and night: no tag
  assert.equal(scheduleText("", pt), "sempre (respawn normal)");
  assert.equal(scheduleText("noite", pt), "Personalizado: noite");
  assert.equal(windowTag(18, 6), "night");
  // in a link: a boss every hour at :05, an NPC out at night, an older link's free text
  const s = { view: { floors: ["s"] }, markers: [
    { id: 0, kind: "boss", floor: "s", locked: false, x: 1, z: 1, fields: { monster: "The Broodmother", schedule: "h05" } },
    { id: 1, kind: "npc", floor: "s", locked: false, x: 2, z: 2, fields: { name: "Gavin", schedule: "g18-06" } },
    { id: 2, kind: "boss", floor: "s", locked: false, x: 3, z: 3, fields: { monster: "Meu Chefe", schedule: "toda hora no :05" } },
    { id: 3, kind: "boss", floor: "s", locked: false, x: 4, z: 4, fields: { monster: "Alpha Wolf" } },
  ] };
  assert.deepEqual((await decode(await encode(s))).markers, s.markers);
});

test("the boss list: every name once, sorted, each prefill a game window", () => {
  const names = BOSSES.map(([n]) => n);
  assert.deepEqual(names, [...new Set(names)].sort());
  for (const [, code] of BOSSES) assert.ok(code === "" || parseSchedule(code).mode === "game", code);
  assert.deepEqual(bossOf("the broodmother"), { name: "The Broodmother", schedule: "g01-04" });
  assert.equal(bossOf("Meu Chefe"), null);
});

test("combat lock: a teleport-like object's extra field, set, unset (the link as before) and a change of its own", async () => {
  const rope = { id: 0, kind: "rope", floor: "s", locked: false, x: 1, z: 1, dest: { x: 2, z: 2, floor: "-1" }, fields: { label: "a" } };
  const s = { view: { floors: ["s"] }, markers: [rope, { ...structuredClone(rope), id: 1, kind: "rope2" }, { id: 2, kind: "door", floor: "s", locked: false, x: 0, z: 0, fields: {} }] };
  const plain = payloadOf(s);
  assert.equal(plain[11], 0);   // no lock: link flags 0, the bytes as before
  const locked = structuredClone(s);
  locked.markers[0].fields.combat = 1;
  locked.markers[1].fields.combat = 1;
  assert.equal(payloadOf(locked)[11], 1);   // set: link flag 1, an extra section after each record
  assert.deepEqual((await decode(await encode(locked))).markers, locked.markers);
  const v1 = "1." + Buffer.from(deflateRawSync(payloadOf(locked, 1))).toString("base64url");
  assert.deepEqual((await decode(v1)).markers, locked.markers);
  for (const k of ["rope", "rope2", "lever", "hole", "portal", "elevator"]) assert.deepEqual(KINDS[KIND_CODE[k]].extra[0], ["combat", "int"], k);
  const opened = await decode(await encode(s));
  const saved = await decode(await encode(saveState(opened, locked.markers, opened.view, opened.tiles, 3)));
  assert.deepEqual(changes(saved).map((c) => [c.op, c.id, c.field, c.new]), [["edited", 0, "combat", 1], ["edited", 1, "combat", 1]]);
});

// ---- the fields of round 2: a spawn's note, an area's and a portal's colour, a lever's action (extra fields: a map
// without them is byte for byte what it was; an older page opens a map with them and drops them)
const SMALL = JSON.parse(readFileSync(new URL("./fixtures/small_map.json", import.meta.url)));

test("a map without the new fields: the same fragment as before them (frozen)", async () => {
  assert.equal(await encode(SMALL.state), SMALL.every);
  const combat = structuredClone(SMALL.state);
  for (const i of [6, 7, 12]) combat.markers[i].fields.combat = 1;
  assert.equal(await encode(combat), SMALL.combat);
});

const withNew = () => {
  const s = structuredClone(SMALL.state);
  s.markers[0].fields.note = "they come at night";
  s.markers[3].fields.color = 1;
  s.markers[10].fields.color = 7;
  s.markers[7].fields.pull = "w30|1,0|2,0";
  return s;
};

test("the new fields: set, round trip in both formats, unset gives the link as before", async () => {
  const s = withNew();
  // the link flags (this map's head: version, tiles, view, 2 panes, base, next, counts): 0 before, 1 with them
  assert.equal(payloadOf(SMALL.state)[17], 0);
  assert.equal(payloadOf(s)[17], 1);
  assert.deepEqual((await decode(await encode(s))).markers, s.markers);
  const v1 = "1." + Buffer.from(deflateRawSync(payloadOf(s, 1))).toString("base64url");
  assert.deepEqual((await decode(v1)).markers, s.markers);
  // each one alone, and with the combat lock
  for (const [i, name, v] of [[0, "note", "x"], [3, "color", 4], [10, "color", 6], [7, "pull", "s|3,-2,-4"], [7, "pull", "w#3"]]) {
    const one = structuredClone(SMALL.state);
    one.markers[i].fields[name] = v;
    one.markers[10].fields.combat = 1;
    assert.deepEqual((await decode(await encode(one))).markers, one.markers, name);
  }
  // cleared again (the field gone, not 0 or ""): the frozen fragment
  const back = withNew();
  for (const m of back.markers) for (const k of ["note", "color", "pull"]) delete m.fields[k];
  assert.equal(await encode(back), SMALL.every);
  assert.deepEqual(KINDS[KIND_CODE.lever].extra.slice(0, -1), [["combat", "int"], ["pull", "str"]]);   // (then the flag)
  assert.deepEqual(KINDS[KIND_CODE.portal].extra.slice(0, -1), [["combat", "int"], ["color", "int"]]);
  assert.equal(COLORS[0], "");
});

test("the new fields: an older page (kinds without them) opens the map and drops only them", async () => {
  const frag = await encode(withNew()), frag1 = "1." + Buffer.from(deflateRawSync(payloadOf(withNew(), 1))).toString("base64url");
  const saved = KINDS.map((k) => k.extra);
  try {
    for (const k of KINDS) if (k.extra) k.extra = k.extra.filter(([n]) => n === "combat");
    for (const k of KINDS) if (k.extra && !k.extra.length) delete k.extra;
    for (const f of [frag, frag1]) {
      const s = await decode(f);
      const want = structuredClone(SMALL.state).markers;
      assert.deepEqual(s.markers, want);
      assert.equal(s.title, SMALL.state.title);
    }
  } finally { KINDS.forEach((k, i) => { if (saved[i]) k.extra = saved[i]; }); }
});

test("the new fields are their own changes", async () => {
  const opened = await decode(await encode(SMALL.state));
  const s = withNew();
  const saved = await decode(await encode(saveState(opened, s.markers, opened.view, opened.tiles, 15, s.title)));
  assert.deepEqual(changes(saved).map((c) => [c.op, c.id, c.field, c.new]),
    [["edited", 0, "note", "they come at night"], ["edited", 3, "color", 1], ["edited", 7, "pull", "w30|1,0|2,0"], ["edited", 10, "color", 7]]);
});

test("a lever's action: each form's code, its words, caps, and an unknown code kept", () => {
  const t = translator("en");
  for (const [code, p] of [
    ["", { act: "none" }],
    ["w|1,0|2,0", { act: "walls", secs: 0, cells: [[1, 0], [2, 0]] }],
    ["w30|-1,-2", { act: "walls", secs: 30, cells: [[-1, -2]] }],
    ["w#12", { act: "walls", secs: 0, area: 12 }],
    ["w120#3", { act: "walls", secs: 120, area: 3 }],
    ["s|5,-3,-4", { act: "send", to: { dx: 5, dz: -3, floor: "-4" } }],
    ["s|0,0,s", { act: "send", to: { dx: 0, dz: 0, floor: "s" } }],
  ]) {
    assert.deepEqual(parseLever(code), p, code);
    assert.equal(leverCode(p), code, code);
  }
  for (const odd of ["w", "w0|1,1", "w3601|1,1", "x|1", "s|1,2", "w|1,2|"]) assert.equal(parseLever(odd).act, "other", odd);
  assert.equal(leverCode({ act: "other", text: "w" }), "w");
  // cells once each, at most MAX_WALLS, never past a field's 300 characters
  const many = Array.from({ length: 50 }, (_, i) => [i, -i]);
  assert.equal(parseLever(leverCode({ act: "walls", cells: [...many, [0, 0]] })).cells.length, MAX_WALLS);
  const far = Array.from({ length: 40 }, (_, i) => [-9000 - i, -9000]);
  const code = leverCode({ act: "walls", secs: 3600, cells: far });
  assert.ok(code.length <= 300 && parseLever(code).act === "walls", code.length);
  assert.equal(leverCode({ act: "walls", cells: [] }), "");
  assert.equal(leverText("w30|1,0|2,0", t), "opens 2 wall cells · they close on their own after 30 s");
  assert.equal(leverText("w#4", t), "opens the walls of area #4 · they stay open until it is pulled again");
  assert.equal(leverText("s|5,-3,-4", t, { x: 10, z: 10 }, (f) => "floor " + f), "takes the player to x 15, z 7 (floor -4)");
  // relative cells: the lever's wall cells follow it; an area's are the area's
  const lever = { x: 10, z: 20, fields: { pull: "w|1,0|0,-1" } };
  assert.deepEqual(wallCells(lever, []), [[11, 20], [10, 19]]);
  assert.deepEqual(wallCells({ x: 0, z: 0, fields: { pull: "w#5" } }, [{ id: 5, cells: [[1, 1]] }]), [[1, 1]]);
  assert.equal(remapArea("w9#5", { 5: 8 }), "w9#8");
  assert.equal(remapArea("w9#5", { 6: 8 }), "w9#5");
  // a lever dragged alone by (2, -1): its walls and its target stay where they are on the map; an area's stays as is
  assert.equal(rebased("w30|1,0|0,-1", 2, -1), "w30|-1,1|-2,0");
  assert.deepEqual(wallCells({ x: 12, z: 19, fields: { pull: rebased("w|1,0|0,-1", 2, -1) } }, []), [[11, 20], [10, 19]]);
  assert.equal(rebased("s|5,-3,-4", 2, -1), "s|3,-2,-4");
  assert.equal(rebased("w#5", 2, -1), "w#5");
  assert.equal(rebased("", 2, -1), "");
});

test("what the new fields cost: nothing when unused, a few characters each when used", async () => {
  const len = async (s) => (await encode(s)).length;
  const base = await len(SMALL.state), out = {};
  for (const [name, set] of [
    ["spawn note (18 chars)", (s) => { s.markers[0].fields.note = "they come at night"; }],
    ["area colour", (s) => { s.markers[3].fields.color = 1; }],
    ["portal colour", (s) => { s.markers[10].fields.color = 7; }],
    ["lever: 2 wall cells, 30 s", (s) => { s.markers[7].fields.pull = "w30|1,0|2,0"; }],
    ["lever: an area", (s) => { s.markers[7].fields.pull = "w#3"; }],
    ["lever: sends to", (s) => { s.markers[7].fields.pull = "s|12,-7,-4"; }],
  ]) { const s = structuredClone(SMALL.state); set(s); out[name] = (await len(s)) - base; }
  console.log("link characters added on a 15-marker map of", base, "characters:", JSON.stringify(out));
  for (const [name, n] of Object.entries(out)) assert.ok(n > 0 && n <= 40, name + ": " + n);
});

// ---- a reviewer's flag: the last extra field of every kind (made-up markers)
const withFlags = () => {
  const s = structuredClone(SMALL.state);
  s.markers.forEach((m, i) => { if (i % 3 === 0) m.fields = { ...m.fields, [FLAG]: "problem " + i }; });
  return s;
};

test("a flag: every kind's last extra field, round trip in both formats, unset gives the link as before", async () => {
  assert.ok(KINDS.every((k) => k.extra && k.extra[k.extra.length - 1][0] === FLAG));
  const s = withFlags();
  assert.ok(new Set(s.markers.filter((m) => m.fields[FLAG]).map((m) => m.kind)).size >= 3);
  assert.deepEqual((await decode(await encode(s))).markers, s.markers);
  const v1 = "1." + Buffer.from(deflateRawSync(payloadOf(s, 1))).toString("base64url");
  assert.deepEqual((await decode(v1)).markers, s.markers);
  assert.equal(await encode(SMALL.state), SMALL.every);   // no flag: the frozen fragment
  assert.deepEqual(flagged(s.markers).map((m) => m.id), s.markers.filter((_, i) => i % 3 === 0).map((m) => m.id));
});

test("a flag is not a change: same(), changes, Save's was and the baseline leave it out", async () => {
  const opened = await decode(await encode(SMALL.state));
  const now = structuredClone(withFlags().markers);
  assert.ok(same(opened.markers[0], now[0]));
  const saved = saveState(opened, now, opened.view, opened.tiles, opened.next);
  assert.deepEqual(saved.was, []);
  const back = await decode(await encode(saved));
  assert.deepEqual(changes(back), []);
  assert.equal(flagged(back.markers).length, flagged(now).length);
  // a real change beside a flag: only the change
  now[1].x += 3;
  const two = await decode(await encode(saveState(opened, now, opened.view, opened.tiles, opened.next)));
  assert.deepEqual(changes(two).map((c) => [c.op, c.id]), [["moved", now[1].id]]);
  assert.equal(baselineOf(two).markers.find((m) => m.id === now[0].id).fields[FLAG], "problem 0");
});

test("a flag on an older page (kinds without it): dropped, everything else kept", async () => {
  const frag = await encode(withFlags());
  const saved = KINDS.map((k) => k.extra);
  try {
    KINDS.forEach((k) => { k.extra = k.extra.filter(([n]) => n !== FLAG); if (!k.extra.length) delete k.extra; });
    const old = await decode(frag);
    assert.deepEqual(old.markers, SMALL.state.markers);
  } finally { KINDS.forEach((k, i) => { k.extra = saved[i]; }); }
});
