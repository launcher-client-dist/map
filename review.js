// Review and share: what a map proposes (counted), what to check before sending it, what changed against the link it
// was saved from, and the message Share copies. No DOM: the page and its tests (node) share it.
import { same, changes, where } from "./maplink.js";
import { parseLever } from "./lever.js";

// the teleport-like kinds that lead somewhere (a destination) and the ones whose missing destination is a warning
const LEADS = ["rope", "rope2", "hole", "portal", "elevator"];
const NOTE_NEAR = 4;   // a note this close to a spawn (cells, same floor) reads as the spawn's observation

const count = (m) => Math.max(1, Math.round(+m.fields?.count) || 1);

// What a map proposes, its locked context markers apart (what exists today, put in by staff): monsters (a spawn's count,
// 1 when unset), spawns, species [[name, monsters, {floor: monsters}]] the most first, the floors with a proposed
// marker, and every other kind's count; context: the locked ones' spawns and monsters, and how many markers.
export function summarize(markers) {
  const out = { monsters: 0, spawns: 0, species: [], floors: 0, objects: {}, context: { markers: 0, spawns: 0, monsters: 0 } };
  const by = new Map(), floors = new Set();
  for (const m of markers) {
    if (m.locked) {
      out.context.markers++;
      if (m.kind === "spawn") { out.context.spawns++; out.context.monsters += count(m); }
      continue;
    }
    floors.add(m.floor);
    if (m.kind !== "spawn") { out.objects[m.kind] = (out.objects[m.kind] || 0) + 1; continue; }
    const n = count(m), name = m.fields?.monster || "?";
    out.spawns++;
    out.monsters += n;
    const s = by.get(name) || { n: 0, floors: {} };
    s.n += n;
    s.floors[m.floor] = (s.floors[m.floor] || 0) + n;
    by.set(name, s);
  }
  out.species = [...by].map(([name, s]) => [name, s.n, s.floors]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  out.floors = floors.size;
  return out;
}

// What to look at before sending (the map's own markers, context left out): each kind that leads somewhere with no
// destination {kind: [ids]}, notes next to a spawn (they read as its observation), levers with no action, levers that
// open an area no longer on the map
export function warnings(markers) {
  const mine = markers.filter((m) => !m.locked);
  const noDest = {};
  for (const m of mine) if (LEADS.includes(m.kind) && !m.dest) (noDest[m.kind] ||= []).push(m.id);
  const spawns = markers.filter((m) => m.kind === "spawn");
  const noteNearSpawn = mine.filter((n) => n.kind === "note" && spawns.some((s) => s.floor === n.floor
    && Math.hypot(s.x - n.x, s.z - n.z) <= NOTE_NEAR)).map((m) => m.id);
  const leverNone = [], leverAreaGone = [];
  for (const m of mine) {
    if (m.kind !== "lever") continue;
    const p = parseLever(m.fields?.pull);
    if (p.act === "none") leverNone.push(m.id);
    else if (p.act === "walls" && p.area != null && !markers.some((a) => a.id === p.area && a.cells)) leverAreaGone.push(m.id);
  }
  return { noDest, noteNearSpawn, leverNone, leverAreaGone };
}

export function warningCount(w) {
  return Object.values(w.noDest).reduce((a, ids) => a + ids.length, 0) + w.noteNearSpawn.length + w.leverNone.length + w.leverAreaGone.length;
}

// The map against the link it was saved from (base: that link's markers, maplink.js baselineOf): each marker now "new"
// (not in it) or "edited" (moved, edited, made another kind, locked...; same id), the ones of it gone (removed, as they
// were), and the counts
export function diffOf(base, markers) {
  const before = new Map(base.map((m) => [m.id, m]));
  const status = new Map();
  for (const m of markers) {
    const b = before.get(m.id);
    if (!b) status.set(m.id, "new");
    else if (!same(b, m)) status.set(m.id, "edited");
  }
  const now = new Set(markers.map((m) => m.id));
  const removed = base.filter((m) => !now.has(m.id));
  const counts = { new: 0, edited: 0, removed: removed.length };
  for (const v of status.values()) counts[v]++;
  return { status, removed, counts };
}

// the changes on each floor {floor: {new, edited, removed}} (the floors card)
export function floorChanges(diff, markers) {
  const out = {};
  const add = (f, k) => { (out[f] ||= { new: 0, edited: 0, removed: 0 })[k]++; };
  for (const m of markers) if (diff.status.has(m.id)) add(m.floor, diff.status.get(m.id));
  for (const m of diff.removed) add(m.floor, "removed");
  return out;
}

// a saved link's own changes, counted by marker (what its banner will say to whoever opens it): {new, edited, removed}
export function changeCounts(state) {
  const by = new Map();
  for (const c of changes(state)) {
    const k = c.op === "added" ? "new" : c.op === "removed" ? "removed" : "edited";
    if (!by.has(c.id) || k !== "edited") by.set(c.id, k);
  }
  const out = { new: 0, edited: 0, removed: 0 };
  for (const k of by.values()) out[k]++;
  return out;
}

// A Discord link's text: one line, no brackets (they would end the link early) and no backslash
export const linkText = (title) => String(title).replace(/[[\]\\]/g, (c) => (c === "[" ? "(" : c === "]" ? ")" : "/")).replace(/\s+/g, " ").trim();

// Share's message, summary first: the map's name as a Discord link to it, then what it proposes, its objects and its
// changes (counts only; the list opens in the link). t: the page's translator (msg.*); kindWord(kind): a kind's name.
// lines: how many species the second line names before "+N".
export function shareMessage({ title, url, summary, counts, kindWord, t, species = 5 }) {
  const out = [`[${linkText(title) || t("msg.untitled")}](${url})`];
  if (summary.spawns) {
    out.push(t(summary.floors === 1 ? "msg.monsters1" : "msg.monsters", summary.monsters, summary.spawns, summary.floors)
      + (summary.context.markers ? " " + t("msg.context", summary.context.markers) : ""));
    const names = summary.species.slice(0, species).map(([name, n]) => `${name} ${n}`);
    if (summary.species.length > species) names.push(t("msg.moreSpecies", summary.species.length - species));
    out.push(names.join(" · "));
  } else if (summary.context.markers) out.push(t("msg.context", summary.context.markers).trim());
  const objects = Object.entries(summary.objects).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (objects.length) out.push(objects.map(([k, n]) => `${kindWord(k)} ${n}`).join(" · "));
  const parts = [];
  for (const k of ["new", "edited", "removed"]) if (counts[k]) parts.push(t(counts[k] === 1 ? `msg.${k}1` : `msg.${k}`, counts[k]));
  out.push(parts.length ? t("msg.changes", parts.join(" · ")) : t("msg.noChanges"));
  return out.join("\n");
}

// where a marker is, for the lists ([x, z] or null): maplink.js where()
export { where };
