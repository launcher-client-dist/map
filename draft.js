// A map's work kept in this browser between visits: after each edit the page writes the state Share would give (the same
// fragment) as a draft of the link it was opened from, and keeps the address bar on it; opening that link again with a
// draft that differs from it offers the draft back. No DOM here (tests/draft.test.mjs).
//
// A draft's key is the link's baseline (maplink.js baselineOf: the markers of the link staff sent, rebuilt from a saved
// link's own change list), so the link from Discord, a player's own saved link of it and a reload of either share one
// draft. The drafts live in localStorage under "opengea.map.draft.<key>", the newest MAX_DRAFTS kept.

import { baselineOf, payloadOf, cleanTitle, unflagged } from "./maplink.js";

export const PREFIX = "opengea.map.draft.";
export const MAX_DRAFTS = 30;

// FNV-1a over bytes, 52 bits as hex (a key, not a secret)
function hash(bytes) {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return (h >> 12n).toString(16).padStart(13, "0");
}

// the bytes of a set of markers (and a title), in id order, apart from where the map looks
const bytesOf = (markers, next, title) => payloadOf({ tiles: "", view: { x: 0, z: 0, zoom: 0, floors: ["s"] }, base: next, next,
  markers: [...markers].sort((a, b) => a.id - b.id), was: [], title: cleanTitle(title) }, 1);

// The draft key of an opened link's decoded state (null: a page opened with no link: an empty map, the same key as
// the link its first edit writes into the address bar, whose baseline is empty too)
export function draftKey(state) {
  const b = state ? baselineOf(state) : { markers: [], next: 0 };
  // (a reviewer's flags are no other map: the flagged link shares the draft of the link it flags)
  return hash(bytesOf(b.markers.map(unflagged), b.next ?? 0, ""));
}

// What a map holds now (its markers and title), flags left out: a draft differing from the link being opened is
// offered back (a flagged link and its owner's draft of the same work: nothing to offer)
export function signature(markers, title) {
  return hash(bytesOf(markers.map(unflagged), 0, title));
}

// The store over a Storage-like object (getItem, setItem, removeItem, key, length); every call survives a storage that
// throws (a private window, blocked site data): the draft is then this visit's only
export function store(storage) {
  const safe = (fn, def) => { try { return fn(); } catch { return def; } };
  const all = () => safe(() => {
    const out = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX)) {
        const d = safe(() => JSON.parse(storage.getItem(k)), null);
        out.push({ key: k.slice(PREFIX.length), at: d && +d.at || 0 });
      }
    }
    return out;
  }, []);
  const drop = (key) => safe(() => storage.removeItem(PREFIX + key));
  return {
    get(key) {
      const d = safe(() => JSON.parse(storage.getItem(PREFIX + key)), null);
      return d && typeof d.frag === "string" && d.frag ? d : null;
    },
    // keep a draft: {frag, at (ms), sig, changes, title}; the oldest go past MAX_DRAFTS, or when the storage is full
    put(key, draft) {
      const text = JSON.stringify(draft);
      for (let tries = 0; tries < 5; tries++) {
        if (safe(() => { storage.setItem(PREFIX + key, text); return true; }, false)) break;
        const old = all().filter((d) => d.key !== key).sort((a, b) => a.at - b.at)[0];
        if (!old) return false;
        drop(old.key);
      }
      const rest = all().sort((a, b) => b.at - a.at);
      for (const d of rest.slice(MAX_DRAFTS)) drop(d.key);
      return this.get(key) != null;
    },
    drop,
    list: all,
  };
}

// The draft to offer when a link opens: one for its key that differs from what the link holds (sig), else null
export function toOffer(drafts, key, sig) {
  const d = drafts.get(key);
  return d && d.sig !== sig ? d : null;
}

// When a draft was kept, in words: "18:20" today, else "25/11 18:20" (lang's own order)
export function whenText(at, now = Date.now(), lang = "pt") {
  const d = new Date(at), n = new Date(now);
  const time = d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === n.toDateString()) return time;
  return d.toLocaleDateString(lang, { day: "2-digit", month: "2-digit" }) + " " + time;
}
