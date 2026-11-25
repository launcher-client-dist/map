// node --test tests/ : the drafts a browser keeps of a map's work (draft.js). Made-up markers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode, saveState, baselineOf } from "../maplink.js";
import { draftKey, signature, store, toOffer, whenText, PREFIX, MAX_DRAFTS } from "../draft.js";

const SENT = {
  tiles: "0.2.1", view: { x: 10, z: -20, zoom: 2, floors: ["s"] }, base: 3, next: 3, was: [],
  markers: [
    { id: 0, kind: "spawn", floor: "s", locked: false, x: 10, z: -20, fields: { monster: "Wolf", count: 3, radius: 2 } },
    { id: 1, kind: "poi", floor: "s", locked: true, x: 0, z: 0, fields: { label: "gate" } },
    { id: 2, kind: "note", floor: "-4", locked: false, x: 5, z: 5, fields: { text: "here" } },
  ],
};

// a Storage in memory (localStorage's calls)
function memory(limit = Infinity) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const size = [...m.entries()].filter(([x]) => x !== k).reduce((a, [x, y]) => a + x.length + y.length, 0) + k.length + String(v).length;
      if (size > limit) throw new Error("QuotaExceededError");
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
    m,
  };
}

// a player's edit of the sent link, saved as the page saves it (against the link's baseline)
async function edited(from) {
  const opened = baselineOf(from);
  const markers = structuredClone(from.markers);
  markers[0].x += 4;
  markers.push({ id: 3, kind: "poi", floor: "s", locked: false, x: 1, z: 1, fields: { label: "new" } });
  return decode(await encode(saveState(opened, markers, from.view, from.tiles, 4, "")));
}

test("one draft key for the sent link, a player's saved link of it and a reload of either", async () => {
  const sent = await decode(await encode(SENT));
  const saved = await edited(sent);
  const again = await edited(saved);   // saved twice (a reload, then Save): still against the sent link
  assert.equal(draftKey(sent), draftKey(saved));
  assert.equal(draftKey(sent), draftKey(again));
  const other = structuredClone(SENT);
  other.markers[1].x = 9;
  assert.notEqual(draftKey(await decode(await encode(other))), draftKey(sent));
  // a page opened with no link, and the link its first edit writes into the address bar (a reload opens that): one key
  const blank = { markers: [], next: 0, base: 0, was: [] };
  const first = await decode(await encode(saveState(blank, [{ id: 0, kind: "poi", floor: "s", locked: false, x: 3, z: 4, fields: {} }],
    SENT.view, SENT.tiles, 1, "")));
  assert.equal(draftKey(null), draftKey(first));
  assert.notEqual(draftKey(null), draftKey(sent));
  // the view and the title don't make another map
  assert.equal(draftKey(await decode(await encode({ ...SENT, view: { x: 99, z: 9, zoom: 0, floors: ["-4"] }, title: "x" }))), draftKey(sent));
});

test("a draft is offered only where it differs from the link being opened", async () => {
  const sent = await decode(await encode(SENT));
  const saved = await edited(sent);
  const s = store(memory());
  const key = draftKey(sent);
  s.put(key, { frag: (await encode(saved)).toString(), at: 1, sig: signature(saved.markers, ""), changes: 2 });
  assert.ok(toOffer(s, key, signature(sent.markers, "")));          // the link from Discord: the draft has more
  assert.equal(toOffer(s, key, signature(saved.markers, "")), null);  // the draft's own link: nothing to offer
  assert.ok(toOffer(s, key, signature(saved.markers, "a name")));     // a title is work too
  assert.equal(toOffer(s, "another", signature(sent.markers, "")), null);
  s.drop(key);
  assert.equal(toOffer(s, key, signature(sent.markers, "")), null);
});

test("the store keeps the newest drafts, makes room when full, and survives a storage that throws", () => {
  const mem = memory();
  const s = store(mem);
  for (let i = 0; i < MAX_DRAFTS + 5; i++) assert.ok(s.put("k" + i, { frag: "2.x" + i, at: 1000 + i, sig: "s" }));
  assert.equal(s.list().length, MAX_DRAFTS);
  assert.equal(s.get("k0"), null);
  assert.equal(s.get("k" + (MAX_DRAFTS + 4)).frag, "2.x" + (MAX_DRAFTS + 4));
  // nothing of the page's other settings is touched
  mem.setItem("opengea.map.labels", "always");
  s.put("z", { frag: "2.z", at: 5000, sig: "s" });
  assert.equal(mem.getItem("opengea.map.labels"), "always");
  // full: the oldest drafts go until the new one fits
  const small = memory(300);
  const t = store(small);
  for (let i = 0; i < 4; i++) t.put("a" + i, { frag: "2." + "y".repeat(40), at: i, sig: "s" });
  assert.ok(t.put("big", { frag: "2." + "w".repeat(120), at: 99, sig: "s" }));
  assert.equal(t.get("a0"), null);
  assert.ok(t.get("big"));
  // a storage that throws on everything: no error, nothing kept
  const bad = { get length() { throw new Error("blocked"); }, key() { throw new Error("blocked"); }, getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const b = store(bad);
  assert.equal(b.put("k", { frag: "2.x", at: 1, sig: "s" }), false);
  assert.equal(b.get("k"), null);
  assert.deepEqual(b.list(), []);
  assert.ok([...mem.m.keys()].filter((k) => k.startsWith(PREFIX)).length <= MAX_DRAFTS);
});

test("when a draft was kept, in words: the time today, the day and time before", () => {
  const now = new Date(2026, 10, 25, 18, 30).getTime();
  assert.equal(whenText(new Date(2026, 10, 25, 18, 20).getTime(), now, "pt"), "18:20");
  assert.equal(whenText(new Date(2026, 10, 24, 9, 5).getTime(), now, "pt"), "24/11 09:05");
});

test("a reviewer's flags are no other map: the same key and the same signature with or without them", async () => {
  const sent = await decode(await encode(SENT));
  const flagged = structuredClone(sent);
  flagged.markers[0].fields = { ...flagged.markers[0].fields, flag: "on a rock" };
  const again = await decode(await encode(flagged));
  assert.equal(draftKey(again), draftKey(sent));
  assert.equal(signature(again.markers, ""), signature(sent.markers, ""));
});
