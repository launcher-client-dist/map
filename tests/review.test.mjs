// node --test tests/: review and share (counts, warnings, the diff, the message) and the group edits
import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode, saveState, baselineOf } from "../maplink.js";
import { summarize, warnings, warningCount, diffOf, floorChanges, changeCounts, shareMessage, linkText } from "../review.js";
import { moved, duplicated, middle, inBox } from "../edits.js";
import { translator } from "../i18n.js";

// a made-up hunt: 3 spawns of two monsters on two floors, one locked context spawn, a note by a spawn, a portal with no
// destination, a rope with one, a lever with no action and one that opens a painted area
const sp = (id, floor, x, z, monster, count, locked = false) => ({ id, kind: "spawn", floor, locked, x, z, fields: { monster, count, radius: 2 } });
const HUNT = [
  sp(0, "s", 0, 0, "Wolf", 3), sp(1, "s", 10, 0, "Wolf", 2), sp(2, "-4", 0, 0, "Bear", 1), sp(3, "-4", 20, 20, "Bear", 4, true),
  { id: 4, kind: "note", floor: "s", locked: false, x: 2, z: 1, fields: { text: "two at night" } },
  { id: 5, kind: "portal", floor: "s", locked: false, x: 30, z: 30, fields: {} },
  { id: 6, kind: "rope", floor: "s", locked: false, x: 31, z: 30, dest: { x: 31, z: 30, floor: "-4" }, fields: {} },
  { id: 7, kind: "lever", floor: "-4", locked: false, x: 5, z: 5, fields: {} },
  { id: 8, kind: "area", floor: "-4", locked: false, cells: [[6, 5], [7, 5]], fields: { label: "gate" } },
  { id: 9, kind: "lever", floor: "-4", locked: false, x: 4, z: 5, fields: { pull: "w#8" } },
  { id: 10, kind: "lever", floor: "-4", locked: false, x: 3, z: 5, fields: { pull: "w#99" } },
];

test("summary: monsters, spawns, species by floor, objects, the locked context apart", () => {
  const s = summarize(HUNT);
  assert.equal(s.monsters, 6);
  assert.equal(s.spawns, 3);
  assert.deepEqual(s.species, [["Wolf", 5, { s: 5 }], ["Bear", 1, { "-4": 1 }]]);
  assert.equal(s.floors, 2);
  assert.deepEqual(s.objects, { note: 1, portal: 1, rope: 1, lever: 3, area: 1 });
  assert.deepEqual(s.context, { markers: 1, spawns: 1, monsters: 4 });
});

test("warnings: no destination, a note by a spawn, a lever with no action or a gone area", () => {
  const w = warnings(HUNT);
  assert.deepEqual(w, { noDest: { portal: [5] }, noteNearSpawn: [4], leverNone: [7], leverAreaGone: [10] });
  assert.equal(warningCount(w), 4);
  assert.equal(warningCount(warnings([])), 0);
});

test("the diff: against the link it was saved from, for a player's link and a staff round", async () => {
  // staff sends the hunt; a player moves a spawn, edits the note, removes the portal, adds a spawn, and saves
  const sent = await decode(await encode({ view: { floors: ["s"] }, markers: HUNT }));
  const now = structuredClone(HUNT).filter((m) => m.id !== 5);
  now[0].x = 1;
  now.find((m) => m.id === 4).fields.text = "three at night";
  now.push(sp(11, "s", 40, 40, "Wolf", 1));
  const saved = await decode(await encode(saveState(sent, now, sent.view, "", 12)));
  // the page opens the saved link: Revisar compares with baselineOf(the link), whoever opens it
  const d = diffOf(baselineOf(saved).markers, saved.markers);
  assert.deepEqual([...d.status], [[0, "edited"], [4, "edited"], [11, "new"]]);
  assert.deepEqual(d.removed.map((m) => m.id), [5]);
  assert.deepEqual(d.counts, { new: 1, edited: 2, removed: 1 });
  assert.deepEqual(floorChanges(d, saved.markers), { s: { new: 1, edited: 2, removed: 1 } });
  assert.deepEqual(changeCounts(saved), { new: 1, edited: 2, removed: 1 });
  // the link staff first sent: no changes (its base is its own next id); a map from a blank page: everything new
  assert.deepEqual(diffOf(baselineOf(sent).markers, sent.markers).counts, { new: 0, edited: 0, removed: 0 });
  assert.deepEqual(diffOf([], sent.markers).counts, { new: 11, edited: 0, removed: 0 });
});

test("Share's message: the name as the link, then the counts; brackets can't break the link", () => {
  const t = translator("en"), s = summarize(HUNT);
  const msg = shareMessage({ title: "a [big] map", url: "https://example.test/#2.x", summary: s, counts: { new: 11, edited: 0, removed: 0 },
    kindWord: (k) => t("kind." + k), t });
  assert.equal(msg, [
    "[a (big) map](https://example.test/#2.x)",
    "6 monsters in 3 spawns · 2 floors (+1 context 🔒)",
    "Wolf 5 · Bear 1",
    "Lever 3 · Area 1 · Note 1 · Portal 1 · Rope 1",
    "Changes: 11 new",
  ].join("\n"));
  assert.equal(linkText("  x]\\y "), "x)/y");
  const empty = shareMessage({ title: "", url: "u", summary: summarize([]), counts: { new: 0, edited: 0, removed: 0 }, kindWord: (k) => k, t });
  assert.equal(empty, "[Opengea map](u)\nNo changes");
  // more species than the line names: "+N species"
  const many = summarize(["A", "B", "C", "D", "E", "F", "G"].map((n, i) => sp(i, "s", i, 0, n, 1)));
  assert.match(shareMessage({ title: "m", url: "u", summary: many, counts: { new: 7, edited: 0, removed: 0 }, kindWord: (k) => k, t }), /· \+2 species\n/);
});

test("group edits: move, duplicate (a lever keeps its copied area), the middle, a box", () => {
  const rope = HUNT[6];
  assert.deepEqual(moved(rope, 1, 2).dest, rope.dest);   // a landing on another floor stays
  const portal = { ...HUNT[5], dest: { x: 40, z: 40, floor: "s" } };
  assert.deepEqual(moved(portal, 1, 2).dest, { x: 41, z: 42, floor: "s" });   // on its own floor it moves along
  assert.deepEqual(moved(HUNT[8], 1, 1).cells, [[7, 6], [8, 6]]);
  const [copies, next] = duplicated([HUNT[8], HUNT[9], HUNT[3]], 20);
  assert.equal(next, 23);
  assert.deepEqual(copies.map((m) => m.id), [20, 21, 22]);
  assert.equal(copies[1].fields.pull, "w#20");   // the copied lever opens the copied area
  assert.equal(copies[2].locked, false);
  assert.deepEqual([copies[1].x, copies[1].z], [6, 3]);
  assert.equal(duplicated([HUNT[9]], 30)[0][0].fields.pull, "w#8");   // alone: the same area as the original
  assert.deepEqual(middle([[0, 0], [10, 4], [3, 9]]), [5, 5]);
  assert.deepEqual(inBox(HUNT, "-4", [0, 0], [6, 6]).map((m) => m.id), [2, 7, 8, 9, 10]);
});
