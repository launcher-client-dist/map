// node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode, changes, saveState, runsOf, floorCode, floorOf, LinkError, KINDS } from "../maplink.js";

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

test("a typical link stays short", async () => {
  const many = { view: { x: 0, z: 0, zoom: 0, floors: ["s"] }, markers: [] };
  for (let i = 0; i < 20; i++) many.markers.push({ id: i, kind: "spawn", floor: "s", x: 100 + i * 7, z: -50 + i * 3, fields: { monster: "Orc Infantry", count: 4, radius: 5 } });
  const frag = await encode(many);
  assert.ok(frag.length < 600, "20 spawns: " + frag.length);
});
