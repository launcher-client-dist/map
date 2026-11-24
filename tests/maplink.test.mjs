// node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { encode, decode, changes, saveState, baselineOf, runsOf, floorCode, floorOf, payloadOf, cleanTitle, LinkError, KINDS } from "../maplink.js";
import { WORDS, LANGS } from "../i18n.js";

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
  const s = await decode(await encode(sample));
  assert.equal(s.format, 1);
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
  for (const bad of ["", "#", "#2.AAAA", "#1.!!!", "#1.AAAA", "#x.abc"]) {
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
  for (const frag of Object.values(OLD)) assert.deepEqual(payloadOf(await decode(frag)), inflated(frag));
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
  assert.deepEqual(KINDS.slice(5).map((k) => k.name), ["rope", "lever", "hole", "door", "portal", "elevator"]);
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

test("every language has every word", () => {
  const en = Object.keys(WORDS.en);
  for (const l of LANGS) assert.deepEqual(en.filter((k) => !(k in WORDS[l])), [], l);
  for (const k of KINDS) for (const l of LANGS) assert.ok(WORDS[l]["kind." + k.name] && WORDS[l]["tool." + k.name] && WORDS[l]["help." + k.name], l + " " + k.name);
});

test("a typical link stays short", async () => {
  const many = { view: { x: 0, z: 0, zoom: 0, floors: ["s"] }, markers: [] };
  for (let i = 0; i < 20; i++) many.markers.push({ id: i, kind: "spawn", floor: "s", x: 100 + i * 7, z: -50 + i * 3, fields: { monster: "Orc Infantry", count: 4, radius: 5 } });
  const frag = await encode(many);
  assert.ok(frag.length < 600, "20 spawns: " + frag.length);
});
