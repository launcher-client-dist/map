// The map link format: the page's whole state in the URL #fragment. No DOM here: the page and the tests (node) share it.
// The same format is implemented in Python by the staff tools; change both together (the cross tests check one against
// the other).
//
// fragment: "1." + base64url(raw deflate(payload)), 1 the format version (also the payload's first byte). A newer page
// reads every older version. KINDS only grows; a marker of an unknown kind is kept as raw bytes and written back as is.
//
// payload (u: unsigned LEB128 varint, s: zigzag varint, str: u length + UTF-8):
//   u version | str tile set ("" = newest) | view: s x, s z, s zoom, u panes, u floor code each
//   u base | u next | u markers, marker each | u was, marker each | then, to the end, optional link fields
//   (u key = index * 2 + type, value, as a marker's fields; unknown keys skipped): 0 the map's title (str)
// A link without a title has no field bytes at all (as every link before titles); an older page ignores them.
// base: ids below it were in the link this one was saved from; next: the next free id; was: the earlier state of every
// marker of that link that was moved, edited or removed since.
// marker: u kind | u id | u flags (1 locked) | u floor code | u length | body
//   body: geometry (point: s x, s z; line: u n, then n x (s dx, s dz) from the previous point, the first from 0,0;
//   cells: u runs, each s dz, s dx from the previous run's z and first x, u length-1; runs sorted by z then x;
//   pointdest: s x, s z, u d (0: no destination, else the destination's floor code + 1), and when d: s dx, s dz from
//   x, z), then fields to the end: u key (field index * 2 + type: 0 int as s, 1 str), value. Unknown keys skipped.
// floor code: 0 the surface, else zigzag(slice) + 1.
// In memory a pointdest marker is a point with an optional dest: {x, z, floor} (absolute; no key when there is none).
// The kinds from code 5 on (rope .. elevator) came after the first pages: a page from before them keeps such a marker
// as raw bytes (an unknown kind), so the format version stayed 1.

export const FORMAT = 1;
export const MAX_PAYLOAD = 65536;
export const MAX_TEXT = 300;
export const MAX_MARKERS = 1000;
export const MAX_POINTS = 2000;
export const MAX_CELLS = 40000;
export const MAX_TOTAL = 60000;   // cells and route points of the whole link, markers and was together
export const MAX_TITLE = 60;

// A map's title: someone's text, one line, at most MAX_TITLE characters (Python's maplink.clean_title: the same rule)
export function cleanTitle(text) {
  const strip = (s) => s.replace(/^ +| +$/g, "");   // spaces only: the same on both sides
  const one = strip(String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " "));
  return strip(Array.from(one).slice(0, MAX_TITLE).join(""));
}

// Marker kinds by code: append only, a code is never reused.
export const KINDS = [
  { name: "spawn", geometry: "point", fields: [["monster", "str"], ["count", "int"], ["radius", "int"]] },
  { name: "poi", geometry: "point", fields: [["label", "str"]] },
  { name: "area", geometry: "cells", fields: [["label", "str"]] },
  { name: "route", geometry: "line", fields: [["label", "str"]] },
  { name: "note", geometry: "point", fields: [["text", "str"]] },
  // map things: ropes, holes and portals lead somewhere (an optional destination, on any floor)
  { name: "rope", geometry: "pointdest", fields: [["label", "str"]] },
  { name: "lever", geometry: "point", fields: [["label", "str"]] },
  { name: "hole", geometry: "pointdest", fields: [["label", "str"]] },
  { name: "door", geometry: "point", fields: [["label", "str"]] },
  { name: "portal", geometry: "pointdest", fields: [["label", "str"]] },
  { name: "elevator", geometry: "pointdest", fields: [["label", "str"]] },
];
export const KIND_CODE = Object.fromEntries(KINDS.map((k, i) => [k.name, i]));

export class LinkError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

class Writer {
  constructor() { this.b = []; }
  u(n) {
    n = Math.trunc(Number(n));
    if (!(n >= 0) || !Number.isSafeInteger(n)) throw new LinkError("bad unsigned " + n);
    for (;;) {
      const byte = n % 128;
      n = Math.floor(n / 128);
      if (n) this.b.push(byte | 0x80);
      else { this.b.push(byte); return; }
    }
  }
  s(n) {
    n = Math.round(Number(n));
    if (!Number.isSafeInteger(n)) throw new LinkError("bad number");
    this.u(n >= 0 ? 2 * n : -2 * n - 1);
  }
  str(t) {
    const raw = enc.encode(Array.from(String(t)).slice(0, MAX_TEXT).join(""));
    this.u(raw.length);
    for (const c of raw) this.b.push(c);
  }
  bytes(raw) {
    this.u(raw.length);
    for (const c of raw) this.b.push(c);
  }
  out() { return Uint8Array.from(this.b); }
}

class Reader {
  constructor(b) { this.b = b; this.i = 0; }
  done() { return this.i >= this.b.length; }
  u() {
    let n = 0, mul = 1;
    for (;;) {
      if (this.i >= this.b.length) throw new LinkError("link cut short");
      const byte = this.b[this.i++];
      n += (byte & 0x7f) * mul;
      if (!(byte & 0x80)) return n;
      mul *= 128;
      if (mul > 2 ** 53) throw new LinkError("number too long");
    }
  }
  s() { const n = this.u(); return n % 2 === 0 ? n / 2 : -(n + 1) / 2; }
  raw(n) {
    if (this.i + n > this.b.length) throw new LinkError("link cut short");
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  str() { return Array.from(dec.decode(this.raw(this.u()))).slice(0, MAX_TEXT).join(""); }
}

export function floorCode(f) {
  if (f === "s" || f == null) return 0;
  const n = parseInt(f, 10);
  return (n >= 0 ? 2 * n : -2 * n - 1) + 1;
}

export function floorOf(code) {
  if (code === 0) return "s";
  const n = code - 1;
  return String(n % 2 === 0 ? n / 2 : -(n + 1) / 2);
}

// [[z, x0, length]] of cells [[x, z]], sorted by z then x
export function runsOf(cells) {
  const rows = new Map();
  for (const [x, z] of cells) {
    if (!rows.has(z)) rows.set(z, new Set());
    rows.get(z).add(x);
  }
  const out = [];
  for (const z of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = [...rows.get(z)].sort((a, b) => a - b);
    let start = xs[0], prev = xs[0];
    for (const x of xs.slice(1)) {
      if (x !== prev + 1) { out.push([z, start, prev - start + 1]); start = x; }
      prev = x;
    }
    out.push([z, start, prev - start + 1]);
  }
  return out;
}

function b64urlEncode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new LinkError("bad link data");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function b64Encode(bytes) { return btoa(String.fromCharCode(...bytes)); }
function b64Decode(text) { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)); }

function bodyOf(m) {
  const k = KINDS[KIND_CODE[m.kind]];
  const w = new Writer();
  if (k.geometry === "point") { w.s(m.x); w.s(m.z); }
  else if (k.geometry === "pointdest") {
    w.s(m.x); w.s(m.z);
    if (m.dest) { w.u(floorCode(m.dest.floor ?? "s") + 1); w.s(m.dest.x - m.x); w.s(m.dest.z - m.z); }
    else w.u(0);
  } else if (k.geometry === "line") {
    w.u(m.points.length);
    let px = 0, pz = 0;
    for (const [x, z] of m.points) { w.s(x - px); w.s(z - pz); px = x; pz = z; }
  } else {
    const runs = runsOf(m.cells);
    w.u(runs.length);
    let pz = 0, px = 0;
    for (const [z, x0, n] of runs) { w.s(z - pz); w.s(x0 - px); w.u(n - 1); pz = z; px = x0; }
  }
  const fields = m.fields || {};
  k.fields.forEach(([name, typ], i) => {
    const v = fields[name];
    if (v == null || v === "") return;
    if (typ === "int") { w.u(i * 2); w.s(v); } else { w.u(i * 2 + 1); w.str(v); }
  });
  return w.out();
}

function writeMarker(w, m) {
  let code, body;
  if (m.kind in KIND_CODE) { code = KIND_CODE[m.kind]; body = bodyOf(m); }
  else { code = m.code; body = b64Decode(m.raw); }
  w.u(code);
  w.u(m.id);
  w.u(m.locked ? 1 : 0);
  w.u(floorCode(m.floor ?? "s"));
  w.bytes(body);
}

// budget: {left: cells and route points for the whole link}: runs expand after inflating, so a short link could declare
// millions of cells without it
function readMarker(r, budget = { left: MAX_TOTAL }) {
  const spend = (n) => { budget.left -= n; if (budget.left < 0) throw new LinkError("link too large"); };
  const code = r.u(), id = r.u(), flags = r.u(), floor = floorOf(r.u());
  const body = r.raw(r.u());
  const m = { id, floor, locked: !!(flags & 1) };
  if (code >= KINDS.length) return Object.assign(m, { kind: "unknown" + code, code, raw: b64Encode(body) });
  const k = KINDS[code];
  m.kind = k.name;
  const b = new Reader(body);
  if (k.geometry === "point") { m.x = b.s(); m.z = b.s(); }
  else if (k.geometry === "pointdest") {
    m.x = b.s(); m.z = b.s();
    const d = b.u();
    if (d) { const floor = floorOf(d - 1); m.dest = { x: m.x + b.s(), z: m.z + b.s(), floor }; }
  } else if (k.geometry === "line") {
    const n = b.u();
    if (n > MAX_POINTS) throw new LinkError("route too long");
    spend(n);
    const pts = [];
    let x = 0, z = 0;
    for (let i = 0; i < n; i++) { x += b.s(); z += b.s(); pts.push([x, z]); }
    m.points = pts;
  } else {
    const n = b.u();
    if (n > MAX_POINTS) throw new LinkError("area too large");
    const cells = [];
    let z = 0, x0 = 0;
    for (let i = 0; i < n; i++) {
      z += b.s(); x0 += b.s();
      const len = b.u() + 1;
      if (cells.length + len > MAX_CELLS) throw new LinkError("area too large");
      spend(len);
      for (let x = x0; x < x0 + len; x++) cells.push([x, z]);
    }
    m.cells = cells;
  }
  const fields = {};
  while (!b.done()) {
    const key = b.u(), i = Math.floor(key / 2), typ = key % 2;
    const v = typ ? b.str() : b.s();
    if (i < k.fields.length && (k.fields[i][1] === "str") === !!typ) fields[k.fields[i][0]] = v;
  }
  m.fields = fields;
  return m;
}

export function payloadOf(state) {
  const w = new Writer();
  w.u(FORMAT);
  w.str(state.tiles || "");
  const view = state.view || {};
  w.s(view.x || 0); w.s(view.z || 0); w.s(view.zoom || 0);
  const panes = view.floors && view.floors.length ? view.floors : ["s"];
  w.u(panes.length);
  for (const f of panes) w.u(floorCode(f));
  const markers = state.markers || [], was = state.was || [];
  let next = state.next;
  if (next == null) next = Math.max(-1, ...markers.map((m) => m.id), ...was.map((m) => m.id)) + 1;
  w.u(state.base == null ? next : state.base);
  w.u(next);
  for (const group of [markers, was]) {
    w.u(group.length);
    for (const m of group) writeMarker(w, m);
  }
  const title = cleanTitle(state.title);
  if (title) { w.u(1); w.str(title); }   // field 0, a str
  return w.out();
}

async function pipe(bytes, stream, cap) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  const reader = s.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (cap && total > cap) { await reader.cancel(); throw new LinkError("link too large"); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function encode(state) {
  const packed = await pipe(payloadOf(state), new CompressionStream("deflate-raw"));
  return FORMAT + "." + b64urlEncode(packed);
}

export function fragmentOf(text) {
  text = String(text).trim();
  const i = text.indexOf("#");
  return i >= 0 ? text.slice(i + 1) : text;
}

export async function decode(text) {
  const frag = fragmentOf(text);
  const dot = frag.indexOf(".");
  const head = frag.slice(0, dot), data = frag.slice(dot + 1);
  if (dot < 1 || !/^\d+$/.test(head) || !data) throw new LinkError("not a map link");
  if (+head > FORMAT) throw new LinkError("link format " + head + " is newer than this page");
  let raw;
  try { raw = await pipe(b64urlDecode(data), new DecompressionStream("deflate-raw"), MAX_PAYLOAD); }
  catch (e) { throw e instanceof LinkError ? e : new LinkError("bad link data"); }
  const r = new Reader(raw);
  const version = r.u();
  if (version !== +head) throw new LinkError("link versions disagree");
  const tiles = r.str();
  const view = { x: r.s(), z: r.s(), zoom: r.s() };
  const panes = r.u();
  if (panes > 3) throw new LinkError("too many panes");
  view.floors = [];
  for (let i = 0; i < panes; i++) view.floors.push(floorOf(r.u()));
  const base = r.u(), next = r.u();
  const groups = [], budget = { left: MAX_TOTAL };
  for (let g = 0; g < 2; g++) {
    const n = r.u();
    if (n > MAX_MARKERS) throw new LinkError("too many markers");
    const list = [];
    for (let i = 0; i < n; i++) list.push(readMarker(r, budget));
    groups.push(list);
  }
  const out = { format: version, tiles, view, base, next, markers: groups[0], was: groups[1] };
  while (!r.done()) {   // the link's own fields
    const key = r.u(), v = key % 2 ? r.str() : r.s();
    if (key === 1) { const title = cleanTitle(v); if (title) out.title = title; }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ changes
export function markerBytes(m) {
  const w = new Writer();
  writeMarker(w, m);
  return w.out();
}

export function same(a, b) {
  const x = markerBytes(a), y = markerBytes(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function where(m) {
  if ("x" in m) return [m.x, m.z];
  const pts = m.points || m.cells || [];
  if (!pts.length) return null;
  const sx = pts.reduce((a, p) => a + p[0], 0), sz = pts.reduce((a, p) => a + p[1], 0);
  return [pyRound(sx / pts.length), pyRound(sz / pts.length)];
}

// Python's round(): halves to even, so both sides give the same middle
function pyRound(v) {
  const f = Math.floor(v), d = v - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(v);
}

function geometryKey(m) {
  if ("x" in m) return "p" + m.x + "," + m.z;
  if (m.points) return "l" + m.points.map((p) => p.join(",")).join(";");
  if (m.cells) return "c" + runsOf(m.cells).map((r) => r.join(",")).join(";");
  return "raw" + m.raw;
}

const destKey = (m) => (m.dest ? m.dest.x + "," + m.dest.z + "," + m.dest.floor : "");

// [{op: added|moved|dest|edited|locked|unlocked|removed, id, kind, ...}] in id order (Python's maplink.changes)
// moved: the marker itself (its geometry or floor); dest: its destination {x, z, floor} from -> to (null: none)
export function changes(state) {
  const base = state.base || 0;
  const was = new Map((state.was || []).map((m) => [m.id, m]));
  const now = new Map((state.markers || []).map((m) => [m.id, m]));
  const ids = [...new Set([...was.keys(), ...now.keys()])].sort((a, b) => a - b);
  const out = [];
  for (const id of ids) {
    const a = was.get(id), b = now.get(id);
    if (b && !a) { if (id >= base) out.push({ op: "added", id, kind: b.kind, marker: b }); continue; }
    if (!b) { out.push({ op: "removed", id, kind: a.kind, marker: a }); continue; }
    if (same(a, b)) continue;
    if (geometryKey(a) !== geometryKey(b) || a.floor !== b.floor) {
      const c = { op: "moved", id, kind: b.kind, from: where(a), to: where(b), floor_from: a.floor, floor_to: b.floor };
      for (const key of ["cells", "points"]) {
        if (a[key] && a[key].length !== (b[key] || []).length) { c.size_from = a[key].length; c.size_to = (b[key] || []).length; }
      }
      out.push(c);
    }
    // where a rope, hole or portal leads: set (from null), moved, or removed (to null); apart from the marker's own move
    if (destKey(a) !== destKey(b)) out.push({ op: "dest", id, kind: b.kind, from: a.dest || null, to: b.dest || null });
    const fa = a.fields || {}, fb = b.fields || {};
    for (const name of [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()) {
      if (fa[name] !== fb[name]) out.push({ op: "edited", id, kind: b.kind, field: name, old: fa[name] ?? null, new: fb[name] ?? null });
    }
    if (!!a.locked !== !!b.locked) out.push({ op: b.locked ? "locked" : "unlocked", id, kind: b.kind });
  }
  return out;
}

// The link a saved link was made from, rebuilt from its own `was` and `base`: the markers below base as they were, the
// removed ones back, none of the added. A player who saved, reloaded (the address bar holds the saved link) and saves
// again still gets every change against the link staff sent, not only the ones since the reload.
export function baselineOf(state) {
  const base = state.base || 0;
  const was = new Map((state.was || []).map((m) => [m.id, m]));
  const now = new Set((state.markers || []).map((m) => m.id));
  const markers = (state.markers || []).filter((m) => m.id < base).map((m) => was.get(m.id) || m);
  for (const m of state.was || []) if (!now.has(m.id)) markers.push(m);
  markers.sort((a, b) => a.id - b.id);
  return { ...state, markers, was: [], next: base };
}

// The state to save: the markers now, against the markers of the link the page opened with (opened: its decoded state).
// Markers of that link that changed or were removed go into `was`; ids at or above opened.next are new.
export function saveState(opened, markers, view, tiles, next, title) {
  const now = new Map(markers.map((m) => [m.id, m]));
  const was = [];
  for (const m of opened.markers || []) {
    const n = now.get(m.id);
    if (!n || !same(m, n)) was.push(m);
  }
  const s = { tiles, view, base: opened.next || 0, next, markers, was };
  if (cleanTitle(title)) s.title = cleanTitle(title);
  return s;
}
