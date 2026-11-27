// node --test tests/: why a Delete or a click did nothing, the crowded spot's cycling pick, the removed marks
import { test } from "node:test";
import assert from "node:assert/strict";
import { whyNotDelete, whyNotPick, deleteMeantMarker, stackAt, nextPick, stackOrder, removedSpots } from "../pick.js";
import { diffOf } from "../review.js";
import { where, encode, decode, saveState, baselineOf } from "../maplink.js";

const editable = (m) => !m.locked;
const ctx = (o) => ({ mode: "edit", tool: "select", selected: null, group: null, staff: false, editable, ...o });

test("Delete: each reason it can't, and none when it can", () => {
  const rope = { id: 1, kind: "rope", locked: false }, ctxm = { id: 2, kind: "spawn", locked: true };
  assert.equal(whyNotDelete(ctx({ selected: rope })), null);
  assert.equal(whyNotDelete(ctx({})), "why.none");
  assert.equal(whyNotDelete(ctx({ tool: "area" })), "why.tool");    // a drawing tool, nothing selected: the tool, not "none"
  assert.equal(whyNotDelete(ctx({ tool: "route" })), "why.tool");
  assert.equal(whyNotDelete(ctx({ selected: ctxm })), "why.locked");
  assert.equal(whyNotDelete(ctx({ selected: ctxm, staff: true })), null);   // staff delete context markers
  assert.equal(whyNotDelete(ctx({ mode: "review", selected: rope })), "why.review");
  assert.equal(whyNotDelete(ctx({ group: [ctxm, { ...ctxm, id: 3 }] })), "why.groupLocked");
  assert.equal(whyNotDelete(ctx({ group: [ctxm, rope] })), null);   // the editable ones go, the locked stay
});

test("a click on a marker ignored by the drawing tools, and only by them", () => {
  for (const t of ["area", "route"]) assert.equal(whyNotPick(t), "why.tool");
  for (const t of ["select", "rope", "spawn", "dest"]) assert.equal(whyNotPick(t), null);
});

test("Delete pressed in a panel field: the marker meant only when the key changes nothing there", () => {
  const f = (o) => ({ key: "Delete", tag: "INPUT", type: "text", value: "orc", start: 3, end: 3, ...o });
  assert.equal(deleteMeantMarker(f({})), true);                          // caret at the end: nothing to delete
  assert.equal(deleteMeantMarker(f({ value: "", start: 0, end: 0 })), true);
  assert.equal(deleteMeantMarker(f({ start: 1, end: 1 })), false);       // text after the caret: the field's
  assert.equal(deleteMeantMarker(f({ start: 0, end: 3 })), false);       // text marked: the field's
  assert.equal(deleteMeantMarker(f({ key: "Backspace" })), false);       // Backspace is always the field's
  assert.equal(deleteMeantMarker(f({ tag: "SELECT", type: undefined })), true);
  assert.equal(deleteMeantMarker(f({ type: "checkbox", start: null, end: null })), true);
  assert.equal(deleteMeantMarker(f({ type: "number", start: null, end: null })), false);   // no caret to read: the field's
});

test("a crowded spot: the markers within the icon's size, and each click on it takes the next", () => {
  // three markers on one cell (on screen at 100,100), one a little apart (110,104), one far (200,100)
  const pts = [{ id: 7, x: 100, y: 100 }, { id: 3, x: 100, y: 100 }, { id: 9, x: 110, y: 104 }, { id: 4, x: 200, y: 100 }, { id: 3, x: 100, y: 100 }];
  const stack = stackAt(pts, 100, 100, 13);
  assert.deepEqual(stack, [3, 7, 9]);   // nearest first, ties by id; a marker drawn twice (its end marker) once
  assert.deepEqual(stackAt(pts, 300, 300, 13), []);
  const order = stackOrder(stack);
  // nothing selected: the click takes what it landed on; then the selected one is on top and each click moves on
  assert.equal(nextPick(order, null, 7), 7);
  assert.equal(nextPick(order, 7, 7), 9);
  assert.equal(nextPick(order, 9, 9), 3);    // round
  assert.equal(nextPick(order, 3, 3), 7);
  assert.equal(nextPick(order, 4, 7), 7);    // the selected one elsewhere: the clicked one
  assert.equal(nextPick(order, 3, 9), 9);    // a click on the part of another one that shows: that one
  assert.equal(nextPick([5], 5, 5), 5);      // alone on its spot: itself
});

test("removed marks: the link's markers deleted, at their spot and where they led; undo takes them away", async () => {
  // a made-up link: a rope down, a portal, an area, a spawn
  const sent = { tiles: "0.2.1", view: { x: 0, z: 0, zoom: 1, floors: ["s"] }, markers: [
    { id: 0, kind: "rope", floor: "s", locked: false, x: 10, z: 10, dest: { x: 11, z: 12, floor: "0" }, fields: {} },
    { id: 1, kind: "portal", floor: "s", locked: false, x: 20, z: 5, dest: { x: 30, z: 5, floor: "s" }, fields: {} },
    { id: 2, kind: "area", floor: "s", locked: false, cells: [[0, 0], [1, 0], [2, 0]], fields: {} },
    { id: 3, kind: "spawn", floor: "s", locked: false, x: 5, z: 5, fields: { monster: "Bear", count: 1, radius: 2 } },
  ], next: 4 };
  const frag = await encode(sent);
  const opened = await decode(frag);
  // the rope and the area deleted, a new note added then deleted in the same visit (it was never in the link)
  const now = opened.markers.filter((m) => m.id !== 0 && m.id !== 2);
  const spots = removedSpots(opened.markers, now, where);
  assert.deepEqual(spots.map((s) => [s.id, s.floor, s.x, s.z, s.end]), [[0, "s", 10, 10, false], [0, "0", 11, 12, true], [2, "s", 1, 0, false]]);
  // the same list the Review diff calls removed: one source of truth
  assert.deepEqual(diffOf(opened.markers, now).removed.map((m) => m.id), [0, 2]);
  // undo (the rope back): its marks go
  assert.deepEqual(removedSpots(opened.markers, [...now, opened.markers[0]], where).map((s) => s.id), [2]);
  // nothing new goes into the link: the saved state of the edit is what maplink.js made before
  const s = saveState(opened, now, opened.view, opened.tiles, 4, "");
  assert.deepEqual(Object.keys(s).sort(), ["base", "markers", "next", "tiles", "view", "was"]);
  // a saved link opened again: its removals still show (the page compares with the link staff sent, as Save does)
  const again = baselineOf(await decode(await encode(s)));
  assert.deepEqual(removedSpots(again.markers, now, where).map((x) => x.id), [0, 0, 2]);
});

test("every new word in the four languages", async () => {
  const { WORDS, LANGS } = await import("../i18n.js");
  const keys = Object.keys(WORDS.en).filter((k) => k.startsWith("why.") || k.startsWith("rm.") || k.startsWith("stack") || k.startsWith("menu"));
  assert.ok(keys.length >= 13, keys.join());
  for (const lang of LANGS) for (const k of keys) assert.ok(WORDS[lang][k], lang + " " + k);
  assert.match(WORDS.pt["why.review"], /entre no modo edição/);
  assert.match(WORDS.pt["why.field"], /^Clique no mapa antes de apagar/);
});
