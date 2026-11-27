// The map link format: the page's whole state in the URL #fragment. No DOM here: the page and the tests (node) share it.
// The same format is implemented in Python by the staff tools; change both together (the cross tests check one against
// the other).
//
// fragment: "2." + base64url(raw deflate(payload)), 2 the format version (also the payload's first byte). Save writes
// format 2; every older version still opens (links in old messages keep working). KINDS only grows; a marker of an
// unknown kind is kept as raw bytes and written back as is.
//
// ---- format 2 (the same header as format 1, then the markers as bits, then their text)
// fragment: "2." + base64url(head + raw deflate(text)): the head is not deflated (its bits are already dense, and
// deflate made them longer); the text is, alone, and left out when empty. When deflating it all is shorter (speckled
// areas), the bytes are instead 0 + raw deflate(head + text) (a head starts with 2, never 0).
// head: u 2 | str tile set | view: s x, s z, s zoom, u panes, u floor code each | u base | u next
//   | u markers | u was | u link flags (0; 1: records end with extra fields, from a page that added fields to a kind;
//   any other bit: a newer format) | records: markers then was, as bits, padded to a byte.
// text: the strings the records left out (str each, in record order) | link fields to the end, as format 1 (0: the
//   title). payloadOf gives head + text (the bytes both sides must agree on).
// bits (least significant first in each byte): g(v) Elias gamma of v >= 1 (k zeros, a one, then v's k low bits);
//   e_k(v) = g(v >> k + 1) then v's k low bits; z_k(v) = e_k(zigzag v).
// record (each group starts with no previous record and the point at the view's x, z):
//   kind: 1 (as the previous record) or 0 g(code + 1) | id: z_0(id - previous id - 1) |
//   floor and lock: 1 (as the previous record) or 0 g(floor code * 2 + locked + 1) | then by the kind:
//   - a code from CORE_KINDS (11) on: g(length + 1) and a format-1 body (bytes): such kinds stay self-contained, so a
//     page that doesn't know one keeps it as raw bytes;
//   - point: z_3(x - px), z_3(z - pz), then (px, pz) = (x, z); pointdest: a point, 1 bit destination, and when set
//     g(its floor code + 1), z_3(dx), z_3(dz) from the point; line: g(n + 1), each point z_3 from the previous one (the
//     first from px, pz), then (px, pz) = the first point;
//   - cells: 1 bit how: 0 runs: g(runs + 1), each z_0(dz), z_3(dx) from the previous run's z and first x (the first
//     from pz, px), e_2(length - 1); 1 outlines: g(loops + 1), each loop z_3(dx), z_3(dz) of its first corner from the
//     previous loop's (the first from px, pz), g(corners / 2 - 1), then every side but the last two: the first 1 bit
//     (0 east, 1 west), the others 1 bit turn (0 left, 1 right), each g(length); sides alternate east-west and
//     north-south, and the last two close the loop. The cells are those inside an odd number of loops (rows read
//     left to right); the writer takes whichever way is shorter. Then (px, pz) = the area's first cell (z, then x).
//   - fields, in the kind's order, each 1 bit present: int: 1 (as this kind's previous value) or 0 z_1(v); the spawn's
//     monster: 1 listed (1 as the previous listed one, or 0 e_4(index in MONSTERS)) or 0 a string; str: a string
//     (its text comes after the records). With link flag 1: g(n + 1) extra fields, each g(key + 1) (index * 2 + type)
//     and z_1(v) or a string (a page that doesn't know them drops them): a core kind's extra fields (KINDS), e.g. the
//     teleport kinds' combat lock; set only when some marker has one.
//   A listed monster this page's MONSTERS doesn't have yet (a newer page's) reads as "#index" and is written back so.
//
// ---- format 1 (still read; same() and markerBytes() use its marker bytes)
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
// as raw bytes (an unknown kind), so the format version stayed 1. The same for rope2 (a two-way rope), boss and npc
// (codes 11..13, format 2's length + format-1 body path): a page from before them keeps them as they are.

import { MONSTERS } from "./monsters.js";

export const FORMAT = 2;          // the format Save writes; decode reads every format up to it
export const CORE_KINDS = 11;     // format 2 packs kinds 0..10 as bits; a later kind carries a length and a format-1 body
const K_POS = 3, K_INT = 1, K_MON = 4, K_RUN = 2;   // the Exp-Golomb orders of format 2
export const MAX_PAYLOAD = 65536;
export const MAX_TEXT = 300;
export const MAX_MARKERS = 1000;
export const MAX_POINTS = 2000;
export const MAX_CELLS = 40000;
export const MAX_TOTAL = 60000;   // cells and route points of the whole link, markers and was together
export const MAX_TITLE = 60;
const MAX_CORNERS = 8000;          // corners of one area's outlines (format 2)
const MAX_SIDE = 1 << 20;          // one side of an outline, in cells
const MAX_MONSTER = 999999;

// A map's title: someone's text, one line, at most MAX_TITLE characters (Python's maplink.clean_title: the same rule)
export function cleanTitle(text) {
  const strip = (s) => s.replace(/^ +| +$/g, "");   // spaces only: the same on both sides
  const one = strip(String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " "));
  return strip(Array.from(one).slice(0, MAX_TITLE).join(""));
}

// Marker kinds by code: append only, a code is never reused. extra: fields added to a kind after format 2 packed its
// fields as bits, keyed after them (index fields.length + j): in a format-1 body as any field (an older page skips the
// key), in a format-2 record in the extra section of link flag 1 (an older page reads past it). Unset, a link is byte
// for byte what it was. Each kind's extra list only grows at its end (a field's key is its place). The extra fields:
//   combat: a teleport-like object that can't be used while the player is in battle (1; absent: no lock)
//   note (spawn): an observation shown under the monster's name
//   color (area, portal): an index in COLORS (absent: the kind's own colour)
//   pull (lever): what pulling it does, lever.js's compact code (absent: not said)
//   flag (every kind, the last of its extra): a problem a reviewer marked on this marker, in words (absent: none); the
//     page rings it in red and lists it under Review's Problems. A note to the map's owner, not a change: changes()
//     leaves it out (FLAG).
const COMBAT = ["combat", "int"];
export const FLAG = "flag";
const FLAG_F = [FLAG, "str"];
export const KINDS = [
  { name: "spawn", geometry: "point", fields: [["monster", "str"], ["count", "int"], ["radius", "int"]], extra: [["note", "str"], FLAG_F] },
  { name: "poi", geometry: "point", fields: [["label", "str"]], extra: [FLAG_F] },
  { name: "area", geometry: "cells", fields: [["label", "str"]], extra: [["color", "int"], FLAG_F] },
  { name: "route", geometry: "line", fields: [["label", "str"]], extra: [FLAG_F] },
  { name: "note", geometry: "point", fields: [["text", "str"]], extra: [FLAG_F] },
  // map things: ropes, holes and portals lead somewhere (an optional destination, on any floor)
  { name: "rope", geometry: "pointdest", fields: [["label", "str"]], extra: [COMBAT, FLAG_F] },
  { name: "lever", geometry: "point", fields: [["label", "str"]], extra: [COMBAT, ["pull", "str"], FLAG_F] },
  { name: "hole", geometry: "pointdest", fields: [["label", "str"]], extra: [COMBAT, FLAG_F] },
  { name: "door", geometry: "point", fields: [["label", "str"]], extra: [FLAG_F] },
  { name: "portal", geometry: "pointdest", fields: [["label", "str"]], extra: [COMBAT, ["color", "int"], FLAG_F] },
  { name: "elevator", geometry: "pointdest", fields: [["label", "str"]], extra: [COMBAT, FLAG_F] },
  // from CORE_KINDS on: each one a length and a format-1 body (a page from before keeps it as raw bytes)
  { name: "rope2", geometry: "pointdest", fields: [["label", "str"]], extra: [COMBAT, FLAG_F] },   // a two-way rope: goes and comes back
  { name: "boss", geometry: "point", fields: [["monster", "str"], ["schedule", "str"], ["label", "str"]], extra: [FLAG_F] },
  { name: "npc", geometry: "point", fields: [["name", "str"], ["schedule", "str"], ["label", "str"]], extra: [FLAG_F] },
  // a ramp proposal (the 3D editor's Ramp): points [low end, high end]; lo, hi: the cube each end stands on (its top
  // is the ground there); width 1..3 cells; ground: the look's ground kind (grass, dirt, sand, rock, paved, snow, wood,
  // other); pieces: "<N|E|S|W><width>|" and each column's cube count in order (map3d/ramp.js: encodePieces)
  { name: "ramp", geometry: "line", fields: [["label", "str"], ["lo", "int"], ["hi", "int"], ["width", "int"], ["ground", "str"], ["pieces", "str"]], extra: [FLAG_F] },
];
export const KIND_CODE = Object.fromEntries(KINDS.map((k, i) => [k.name, i]));
// The colours an area or a portal can wear, by the index the color field holds (append only; 0 is never written: no
// field is the kind's own colour). The page holds their shades; the staff tools their names.
export const COLORS = ["", "yellow", "green", "pink", "red", "white", "blue", "purple", "orange"];
// a kind's fields, then its extra ones (format 1 keys them in this order)
export const allFields = (k) => (k.extra ? [...k.fields, ...k.extra] : k.fields);

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
  allFields(k).forEach(([name, typ], i) => {
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
function spender(budget) {
  return (n) => { budget.left -= n; if (budget.left < 0) throw new LinkError("link too large"); };
}

function readMarker(r, budget = { left: MAX_TOTAL }) {
  const code = r.u(), id = r.u(), flags = r.u(), floor = floorOf(r.u());
  const body = r.raw(r.u());
  const m = { id, floor, locked: !!(flags & 1) };
  if (code >= KINDS.length) return Object.assign(m, { kind: "unknown" + code, code, raw: b64Encode(body) });
  return readBody(m, code, body, budget);
}

// a format-1 body into marker m (format 2 keeps this for the kinds from CORE_KINDS on)
function readBody(m, code, body, budget) {
  const spend = spender(budget);
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
    const every = allFields(k);
    if (i < every.length && (every[i][1] === "str") === !!typ) fields[every[i][0]] = v;
  }
  m.fields = fields;
  return m;
}

// ------------------------------------------------------------------------------------------------ format 2: bits
const int = (n) => {
  n = Math.round(Number(n));
  if (!Number.isSafeInteger(n)) throw new LinkError("bad number");
  return n;
};

class BitWriter {
  constructor() { this.b = []; this.acc = 0; this.n = 0; this.len = 0; }
  bit(v) {
    if (v) this.acc |= 1 << this.n;
    this.len++;
    if (++this.n === 8) { this.b.push(this.acc); this.acc = 0; this.n = 0; }
  }
  bits(v, k) { for (let i = 0; i < k; i++) { this.bit(v % 2); v = Math.floor(v / 2); } }
  gamma(v) {   // v >= 1: k zeros, a one, then v's k low bits
    if (!(v >= 1) || !Number.isSafeInteger(v) || v > 2 ** 48) throw new LinkError("bad number " + v);
    let k = 0;
    while (2 ** (k + 1) <= v) k++;
    for (let i = 0; i < k; i++) this.bit(0);
    this.bit(1);
    this.bits(v - 2 ** k, k);
  }
  eg(v, k) { const p = 2 ** k; this.gamma(Math.floor(v / p) + 1); this.bits(v % p, k); }
  sg(v, k) { this.eg(v >= 0 ? 2 * v : -2 * v - 1, k); }
  bytes(raw) { this.gamma(raw.length + 1); for (const c of raw) this.bits(c, 8); }
  append(o) { for (const c of o.b) this.bits(c, 8); this.bits(o.acc, o.n); }
  out() { return this.n ? [...this.b, this.acc] : this.b; }
}

class BitReader {
  constructor(b, i) { this.b = b; this.i = i; this.n = 0; }
  bit() {
    if (this.i >= this.b.length) throw new LinkError("link cut short");
    const v = (this.b[this.i] >> this.n) & 1;
    if (++this.n === 8) { this.n = 0; this.i++; }
    return v;
  }
  bits(k) { let v = 0, p = 1; for (let i = 0; i < k; i++) { v += this.bit() * p; p *= 2; } return v; }
  gamma() {
    let k = 0;
    while (!this.bit()) if (++k > 48) throw new LinkError("number too long");
    return 2 ** k + this.bits(k);
  }
  eg(k) { return (this.gamma() - 1) * 2 ** k + this.bits(k); }
  sg(k) { const n = this.eg(k); return n % 2 === 0 ? n / 2 : -(n + 1) / 2; }
  bytes() {
    const n = this.gamma() - 1;
    if (n > MAX_PAYLOAD) throw new LinkError("link too large");
    const out = new Uint8Array(n);
    for (let j = 0; j < n; j++) out[j] = this.bits(8);
    return out;
  }
  end() { return this.n ? this.i + 1 : this.i; }   // the first byte after the bits
}

// A spawn's monster as its index in MONSTERS (-1: not listed, written as text). "#n" is a newer page's listed monster
// this page doesn't know yet, kept by its number.
export function monsterIndex(name) {
  name = String(name);
  const i = MONSTERS.indexOf(name);
  if (i >= 0) return i;
  const m = /^#(\d{1,6})$/.exec(name);
  return m && +m[1] >= MONSTERS.length ? +m[1] : -1;
}

export const monsterName = (i) => (i < MONSTERS.length ? MONSTERS[i] : "#" + i);

// The outlines of an area (its cells as runsOf gives them): loops of corners, each starting at a corner whose first
// side runs east or west; null when they would not give back exactly these cells. Directed sides keep the area on their
// left; where two cells touch only at a corner the walk turns right (the staff tools walk the same way: the same bits).
export function outlinesOf(runs) {
  const key = (x, z) => x + "," + z;
  const inside = new Set();
  for (const [z, x0, n] of runs) for (let x = x0; x < x0 + n; x++) inside.add(key(x, z));
  const out = new Map();   // vertex key -> [[x, z] ...] where its sides lead
  const vertices = [];
  const side = (ax, az, bx, bz) => {
    const k = key(ax, az);
    if (!out.has(k)) { out.set(k, []); vertices.push([ax, az]); }
    out.get(k).push([bx, bz]);
  };
  for (const [z, x0, n] of runs) {
    for (let x = x0; x < x0 + n; x++) {
      if (!inside.has(key(x, z - 1))) side(x, z, x + 1, z);
      if (!inside.has(key(x + 1, z))) side(x + 1, z, x + 1, z + 1);
      if (!inside.has(key(x, z + 1))) side(x + 1, z + 1, x, z + 1);
      if (!inside.has(key(x - 1, z))) side(x, z + 1, x, z);
    }
  }
  vertices.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const used = new Set();
  const loops = [];
  for (const [vx, vz] of vertices) {
    for (const [tx, tz] of out.get(key(vx, vz))) {
      if (used.has(key(vx, vz) + ">" + key(tx, tz))) continue;
      const walk = [[vx, vz]];
      let ax = vx, az = vz, bx = tx, bz = tz;
      for (;;) {
        used.add(key(ax, az) + ">" + key(bx, bz));
        walk.push([bx, bz]);
        const free = out.get(key(bx, bz)).filter(([cx, cz]) => !used.has(key(bx, bz) + ">" + key(cx, cz)));
        if (!free.length) break;
        const rx = bx + (bz - az), rz = bz - (bx - ax);   // a right turn
        const next = free.find(([cx, cz]) => cx === rx && cz === rz) || free[0];
        ax = bx; az = bz; bx = next[0]; bz = next[1];
      }
      walk.pop();   // back at its start
      const n = walk.length, corners = [];
      for (let i = 0; i < n; i++) {
        const a = walk[(i + n - 1) % n], b = walk[i], c = walk[(i + 1) % n];
        if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) corners.push(b);
      }
      const s = corners.findIndex((c, i) => c[1] === corners[(i + 1) % corners.length][1]);
      if (s < 0 || corners.length < 4 || corners.length % 2) return null;
      loops.push([...corners.slice(s), ...corners.slice(0, s)]);
    }
  }
  let back;
  try { back = runsOfOutlines(loops, { left: Infinity }); } catch { return null; }
  if (back.length !== runs.length || back.some((r, i) => r[0] !== runs[i][0] || r[1] !== runs[i][1] || r[2] !== runs[i][2])) return null;
  return loops;
}

// [[z, x0, length]] inside an odd number of the loops (each a list of corners, sides alternating east-west and
// north-south), sorted by z then x; budget.left: cells still allowed
function runsOfOutlines(loops, budget) {
  const rows = new Map();
  let crossings = 0;
  for (const cs of loops) {
    for (let i = 0; i < cs.length; i++) {
      const [ax, az] = cs[i], [bx, bz] = cs[(i + 1) % cs.length];
      if (ax !== bx) continue;
      const lo = Math.min(az, bz), hi = Math.max(az, bz);
      crossings += hi - lo;
      if (crossings > 2 * MAX_CELLS) throw new LinkError("area too large");
      for (let z = lo; z < hi; z++) {
        if (!rows.has(z)) rows.set(z, []);
        rows.get(z).push(ax);
      }
    }
  }
  const runs = [];
  let cells = 0;
  for (const z of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = rows.get(z).sort((a, b) => a - b);
    if (xs.length % 2) throw new LinkError("bad area");
    let last = null;
    for (let i = 0; i < xs.length; i += 2) {
      const a = xs[i], b = xs[i + 1];
      if (a === b) continue;
      cells += b - a;
      if (cells > MAX_CELLS || cells > budget.left) throw new LinkError("area too large");
      if (last && last[1] + last[2] === a) last[2] += b - a;   // two loops side by side: one run
      else { last = [z, a, b - a]; runs.push(last); }
    }
  }
  return runs;
}

function cellsOfRuns(runs) {
  const cells = [];
  for (const [z, x0, n] of runs) for (let x = x0; x < x0 + n; x++) cells.push([x, z]);
  return cells;
}

function writeCells(w, cells, c) {
  const runs = runsOf(cells.map(([x, z]) => [int(x), int(z)]));
  const a = new BitWriter();
  a.bit(0);
  a.gamma(runs.length + 1);
  let pz = c.z, px = c.x;
  for (const [z, x0, n] of runs) { a.sg(z - pz, 0); a.sg(x0 - px, K_POS); a.eg(n - 1, K_RUN); pz = z; px = x0; }
  let best = a;
  const loops = runs.length ? outlinesOf(runs) : null;
  if (loops) {
    const b = new BitWriter();
    b.bit(1);
    b.gamma(loops.length + 1);
    let lx = c.x, lz = c.z;
    for (const cs of loops) {
      b.sg(cs[0][0] - lx, K_POS); b.sg(cs[0][1] - lz, K_POS);
      [lx, lz] = cs[0];
      b.gamma(cs.length / 2 - 1);
      let dx = 1, dz = 0;
      for (let i = 0; i < cs.length - 2; i++) {
        const [ax, az] = cs[i], [bx, bz] = cs[i + 1];
        const ux = Math.sign(bx - ax), uz = Math.sign(bz - az);
        if (i === 0) b.bit(ux > 0 ? 0 : 1);
        else b.bit(ux === -dz && uz === dx ? 0 : 1);   // 0: a left turn
        b.gamma(Math.abs(bx - ax) + Math.abs(bz - az));
        dx = ux; dz = uz;
      }
    }
    if (b.len < a.len) best = b;
  }
  w.append(best);
  if (runs.length) { c.x = runs[0][1]; c.z = runs[0][0]; }
}

function readCells(r, c, budget) {
  let runs;
  if (!r.bit()) {
    const n = r.gamma() - 1;
    if (n > MAX_POINTS) throw new LinkError("area too large");
    runs = [];
    let z = c.z, x0 = c.x, cells = 0;
    for (let i = 0; i < n; i++) {
      z += r.sg(0); x0 += r.sg(K_POS);
      const len = r.eg(K_RUN) + 1;
      cells += len;
      if (cells > MAX_CELLS || cells > budget.left) throw new LinkError("area too large");
      runs.push([z, x0, len]);
    }
  } else {
    const n = r.gamma() - 1;
    const loops = [];
    let lx = c.x, lz = c.z, corners = 0;
    for (let i = 0; i < n; i++) {
      lx += r.sg(K_POS); lz += r.sg(K_POS);
      const count = 2 * (r.gamma() + 1);
      corners += count;
      if (corners > MAX_CORNERS) throw new LinkError("area too large");
      const cs = [[lx, lz]];
      let x = lx, z = lz, dx = 1, dz = 0;
      for (let j = 0; j < count - 2; j++) {
        if (j === 0) dx = r.bit() ? -1 : 1;
        else if (r.bit()) [dx, dz] = [dz, -dx];   // right
        else [dx, dz] = [-dz, dx];                // left
        const len = r.gamma();
        if (len > MAX_SIDE) throw new LinkError("area too large");
        x += dx * len; z += dz * len;
        cs.push([x, z]);
      }
      cs.push([lx, z]);   // the last two sides close the loop
      loops.push(cs);
    }
    runs = runsOfOutlines(loops, budget);
  }
  const cells = cellsOfRuns(runs);
  spender(budget)(cells.length);
  if (runs.length) { c.x = runs[0][1]; c.z = runs[0][0]; }
  return cells;
}

const context = (x, z) => ({ kind: -1, fl: -1, id: -1, x, z, mon: -1, ints: {} });

function writeRecord(w, m, c, slots) {
  const known = m.kind in KIND_CODE;
  const code = known ? KIND_CODE[m.kind] : int(m.code);
  if (!known && code < CORE_KINDS) throw new LinkError("unknown kind " + m.kind);
  if (code === c.kind) w.bit(1); else { w.bit(0); w.gamma(code + 1); }
  c.kind = code;
  const id = int(m.id);
  w.sg(id - c.id - 1, 0);
  c.id = id;
  const fl = floorCode(m.floor ?? "s") * 2 + (m.locked ? 1 : 0);
  if (fl === c.fl) w.bit(1); else { w.bit(0); w.gamma(fl + 1); }
  c.fl = fl;
  if (code >= CORE_KINDS) { w.bytes(known ? bodyOf(m) : b64Decode(m.raw)); return; }
  const k = KINDS[code];
  if (k.geometry === "point" || k.geometry === "pointdest") {
    const x = int(m.x), z = int(m.z);
    w.sg(x - c.x, K_POS); w.sg(z - c.z, K_POS);
    c.x = x; c.z = z;
    if (k.geometry === "pointdest") {
      if (m.dest) {
        w.bit(1);
        w.gamma(floorCode(m.dest.floor ?? "s") + 1);
        w.sg(int(m.dest.x) - x, K_POS); w.sg(int(m.dest.z) - z, K_POS);
      } else w.bit(0);
    }
  } else if (k.geometry === "line") {
    const pts = m.points.map(([x, z]) => [int(x), int(z)]);
    w.gamma(pts.length + 1);
    let px = c.x, pz = c.z;
    for (const [x, z] of pts) { w.sg(x - px, K_POS); w.sg(z - pz, K_POS); px = x; pz = z; }
    if (pts.length) { c.x = pts[0][0]; c.z = pts[0][1]; }
  } else writeCells(w, m.cells, c);
  const fields = m.fields || {};
  k.fields.forEach(([name, typ], i) => {
    const v = fields[name];
    if (v == null || v === "") { w.bit(0); return; }
    w.bit(1);
    if (typ === "int") {
      const n = int(v), at = code + "." + i;
      if (c.ints[at] === n) w.bit(1); else { w.bit(0); w.sg(n, K_INT); }
      c.ints[at] = n;
    } else if (code === KIND_CODE.spawn && name === "monster") {
      const idx = monsterIndex(v);
      if (idx < 0) { w.bit(0); slots.push(v); return; }
      w.bit(1);
      if (idx === c.mon) w.bit(1); else { w.bit(0); w.eg(idx, K_MON); }
      c.mon = idx;
    } else slots.push(v);
  });
}

// [[key, type, value]] of a core-kind marker's extra fields that are set (format 2's extra section)
function extrasOf(m) {
  const code = KIND_CODE[m.kind];
  if (code == null || code >= CORE_KINDS) return [];
  const k = KINDS[code], fields = m.fields || {};
  return (k.extra || []).map(([name, typ], j) => [(k.fields.length + j) * 2 + (typ === "str" ? 1 : 0), typ, fields[name]])
    .filter(([, , v]) => v != null && v !== "");
}

// a core-kind record's extra section (link flag 1): g(n + 1), each g(key + 1) and z_1(v) or a string
function writeExtras(w, m, slots) {
  const ex = extrasOf(m);
  w.gamma(ex.length + 1);
  for (const [key, typ, v] of ex) { w.gamma(key + 1); if (typ === "int") w.sg(int(v), K_INT); else slots.push(v); }
}

// slots: [fields, name] the strings after the records go to, in order ([null] for a field this page drops)
function readRecord(r, c, slots, budget, extra) {
  const code = r.bit() ? c.kind : r.gamma() - 1;
  if (code < 0) throw new LinkError("bad link data");
  c.kind = code;
  const id = c.id + 1 + r.sg(0);
  if (id < 0) throw new LinkError("bad link data");
  c.id = id;
  const fl = r.bit() ? c.fl : r.gamma() - 1;
  if (fl < 0) throw new LinkError("bad link data");
  c.fl = fl;
  const m = { id, floor: floorOf(Math.floor(fl / 2)), locked: fl % 2 === 1 };
  if (code >= CORE_KINDS) {
    const body = r.bytes();
    if (code >= KINDS.length) return Object.assign(m, { kind: "unknown" + code, code, raw: b64Encode(body) });
    return readBody(m, code, body, budget);
  }
  const k = KINDS[code];
  m.kind = k.name;
  if (k.geometry === "point" || k.geometry === "pointdest") {
    m.x = c.x + r.sg(K_POS); m.z = c.z + r.sg(K_POS);
    c.x = m.x; c.z = m.z;
    if (k.geometry === "pointdest" && r.bit()) {
      const floor = floorOf(r.gamma() - 1);
      m.dest = { x: m.x + r.sg(K_POS), z: m.z + r.sg(K_POS), floor };
    }
  } else if (k.geometry === "line") {
    const n = r.gamma() - 1;
    if (n > MAX_POINTS) throw new LinkError("route too long");
    spender(budget)(n);
    const pts = [];
    let x = c.x, z = c.z;
    for (let i = 0; i < n; i++) { x += r.sg(K_POS); z += r.sg(K_POS); pts.push([x, z]); }
    m.points = pts;
    if (n) { c.x = pts[0][0]; c.z = pts[0][1]; }
  } else m.cells = readCells(r, c, budget);
  const fields = {};
  k.fields.forEach(([name, typ], i) => {
    if (!r.bit()) return;
    if (typ === "int") {
      const at = code + "." + i;
      if (r.bit()) { if (!(at in c.ints)) throw new LinkError("bad link data"); }
      else c.ints[at] = r.sg(K_INT);
      fields[name] = c.ints[at];
    } else if (code === KIND_CODE.spawn && name === "monster" && r.bit()) {
      if (!r.bit()) {
        const idx = r.eg(K_MON);
        if (idx > MAX_MONSTER) throw new LinkError("bad link data");
        c.mon = idx;
      } else if (c.mon < 0) throw new LinkError("bad link data");
      fields[name] = monsterName(c.mon);
    } else { fields[name] = ""; slots.push([fields, name]); }
  });
  if (extra) {   // fields added to this kind later (its extra; a newer page's unknown ones are read past and dropped)
    const n = r.gamma() - 1;
    if (n > 64) throw new LinkError("bad link data");
    for (let i = 0; i < n; i++) {
      const key = r.gamma() - 1, j = Math.floor(key / 2) - k.fields.length, typ = key % 2;
      const def = j >= 0 ? (k.extra || [])[j] : null;
      const name = def && (def[1] === "str") === !!typ ? def[0] : null;
      if (typ) { if (name) fields[name] = ""; slots.push(name ? [fields, name] : [null]); }
      else { const v = r.sg(K_INT); if (name) fields[name] = v; }
    }
  }
  m.fields = fields;
  return m;
}

function header(w, state, version) {
  w.u(version);
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
  return [markers, was, int(view.x || 0), int(view.z || 0)];
}

// Format 2's [head, text] (see the top)
function partsOf(state) {
  const w = new Writer();
  const [markers, was, vx, vz] = header(w, state, 2);
  w.u(markers.length);
  w.u(was.length);
  const ext = [...markers, ...was].some((m) => extrasOf(m).length);
  w.u(ext ? 1 : 0);   // link flags (1: records end with extra fields; none set: 0, the link as before)
  const bits = new BitWriter(), slots = [];
  for (const group of [markers, was]) {
    const c = context(vx, vz);
    for (const m of group) {
      writeRecord(bits, m, c, slots);
      if (ext && (KIND_CODE[m.kind] ?? CORE_KINDS) < CORE_KINDS) writeExtras(bits, m, slots);
    }
  }
  for (const byte of bits.out()) w.b.push(byte);
  const t = new Writer();
  for (const s of slots) t.str(s);
  const title = cleanTitle(state.title);
  if (title) { t.u(1); t.str(title); }   // field 0, a str
  return [w.out(), t.out()];
}

// The payload, uncompressed: format 2 (Save) unless version 1 is asked (the tests' old links)
export function payloadOf(state, version = FORMAT) {
  if (version === 1) return payloadV1(state);
  const [head, text] = partsOf(state);
  const out = new Uint8Array(head.length + text.length);
  out.set(head); out.set(text, head.length);
  return out;
}

function payloadV1(state) {
  const w = new Writer();
  w.u(1);
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
  const [head, text] = partsOf(state);
  const packed = text.length ? await pipe(text, new CompressionStream("deflate-raw")) : new Uint8Array(0);
  let out = new Uint8Array(head.length + packed.length);
  out.set(head); out.set(packed, head.length);
  const whole = new Uint8Array(head.length + text.length);
  whole.set(head); whole.set(text, head.length);
  const all = await pipe(whole, new CompressionStream("deflate-raw"));
  if (all.length + 1 < out.length) { out = new Uint8Array(all.length + 1); out.set(all, 1); }   // 0: all deflated
  return FORMAT + "." + b64urlEncode(out);
}

async function inflate(bytes) {
  try { return await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_PAYLOAD); }
  catch (e) { throw e instanceof LinkError ? e : new LinkError("bad link data"); }
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
  const bytes = b64urlDecode(data);
  // format 2: only its text is deflated, unless the first byte is 0 (all of it)
  const all = +head === 1 || bytes[0] === 0;
  const raw = +head === 1 ? await inflate(bytes) : bytes[0] === 0 ? await inflate(bytes.subarray(1)) : bytes;
  if (raw.length > MAX_PAYLOAD) throw new LinkError("link too large");
  let r = new Reader(raw);
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
  if (version === 1) {
    for (let g = 0; g < 2; g++) {
      const n = r.u();
      if (n > MAX_MARKERS) throw new LinkError("too many markers");
      const list = [];
      for (let i = 0; i < n; i++) list.push(readMarker(r, budget));
      groups.push(list);
    }
  } else {
    const counts = [r.u(), r.u()], flags = r.u();
    if (counts.some((n) => n > MAX_MARKERS)) throw new LinkError("too many markers");
    if (flags > 1) throw new LinkError("link format " + head + " is newer than this page");
    const bits = new BitReader(raw, r.i), slots = [];
    for (const n of counts) {
      const c = context(view.x, view.z), list = [];
      for (let i = 0; i < n; i++) list.push(readRecord(bits, c, slots, budget, flags & 1));
      groups.push(list);
    }
    const end = bits.end();
    if (all) r.i = end;
    else r = new Reader(end < raw.length ? await inflate(raw.subarray(end)) : new Uint8Array(0));
    for (const [fields, name] of slots) { const v = r.str(); if (fields) fields[name] = v; }
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

// The same marker, leaving out a reviewer's flag (a note to the owner, never a change: Review, was and the change list
// all compare through here)
export function same(a, b) {
  const x = markerBytes(unflagged(a)), y = markerBytes(unflagged(b));
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function unflagged(m) {
  if (!m.fields || m.fields[FLAG] == null) return m;
  const fields = { ...m.fields };
  delete fields[FLAG];
  return { ...m, fields };
}

// [marker] that carry a reviewer's flag, in id order
export function flagged(markers) {
  return (markers || []).filter((m) => m.fields && m.fields[FLAG]).sort((a, b) => a.id - b.id);
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

// [{op: added|kind|moved|dest|edited|locked|unlocked|removed, id, kind, ...}] in id order (Python's maplink.changes)
// kind: the marker became another kind (a rope made two-way and back), from -> to; moved: the marker itself (its
// geometry or floor); dest: its destination {x, z, floor} from -> to (null: none)
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
    if (a.kind !== b.kind) out.push({ op: "kind", id, kind: b.kind, from: a.kind, to: b.kind });
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
      if (name !== FLAG && fa[name] !== fb[name]) out.push({ op: "edited", id, kind: b.kind, field: name, old: fa[name] ?? null, new: fb[name] ?? null });
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
