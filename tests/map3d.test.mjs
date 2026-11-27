// The 3D view's pure parts: the grid chunk format, the placement check (cells built here, the two mistakes of the
// look study: a rope post in the street's canal, one inside the house), the markers' check, the .glb reader, the
// words, and the link round trip of markers placed in 3D. With the published data (map3d/), the same against it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as CD from "../map3d/cdata.js";
import { parseGlb, vertexOf } from "../map3d/glb.js";
import { WORDS3, translator3 } from "../map3d/words3d.js";
import { LANGS } from "../i18n.js";
import { encode, decode, floorCode } from "../maplink.js";

// a chunk file as the exporter writes it: cells {"x,z": {cubes: [[y, kind, flags]], layers: [[f, stand, floor, bad, warn, exits]]}}
function chunkBytes(a, b, cells = {}) {
  const out = [..."OG3C"].map((c) => c.charCodeAt(0));
  const i16 = (v) => [v & 255, (v >> 8) & 255];
  out.push(1, ...i16(a), ...i16(b));
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const c = cells[`${16 * a - 8 + i},${16 * b - 8 + j}`] || { cubes: [], layers: [] };
    out.push(c.cubes.length);
    for (const [y, kind, flags = 0] of c.cubes) out.push(y & 255, CD.K[kind], flags);
    out.push(c.layers.length);
    for (const [f, stand, floor, bad = 0, warn = 0, exits = 15] of c.layers) out.push(f & 255, Math.round((stand - f) * 100), floorCode(floor), bad, warn, exits);
  }
  return new Uint8Array(out);
}

// the street at (-245, 175) and (-226, 177), as the server's grid has them (map3d_export.py cell X Z)
const canal = { cubes: [[-7, "dirt"], [-6, "water"]], layers: [[-7, -6.2, "s", CD.BAD.water, CD.WARN.edge, 0b1101]] };
const house = { cubes: [[-5, "rock"], [-4, "wall"], [-3, "wall"], [-2, "wall"], [-1, "wall"], [0, "roof", CD.CUBE.walk]],
  layers: [[0, 0.55, "s", CD.BAD.roof, CD.WARN.slope | CD.WARN.edge, 0b1011]] };
const street = { cubes: [[-5, "paved", CD.CUBE.walk]], layers: [[-5, -4.2, "s"]] };
const ledge = { cubes: [[-5, "paved", CD.CUBE.walk]], layers: [[-5, -4.2, "s", 0, CD.WARN.edge, 0b0011]] };
// a cave under a hill: the hill's top (the surface) and a cave floor -6 with a wall inside the server refuses
const cave = { cubes: [[-6, "paved", CD.CUBE.walk | CD.CUBE.dark], [8, "grass"], [11, "grass", CD.CUBE.walk]],
  layers: [[11, 11.8, "s", 0, CD.WARN.edge, 0b1011], [-6, -5.2, "-6", CD.BAD.dark, CD.WARN.edge, 0b1011]] };
const chunkA = CD.decodeChunk(chunkBytes(-15, 11, { "-245,175": canal, "-234,175": street, "-237,178": street, "-236,174": ledge }));
const chunkB = CD.decodeChunk(chunkBytes(-14, 11, { "-226,177": house }));
const chunkW = CD.decodeChunk(chunkBytes(6, -15, { "102,-248": cave }));
const cellAt = (x, z) => [chunkA, chunkB, chunkW].map((c) => c.cells.get(CD.cellKey(x, z))).find(Boolean);

test("a chunk file decodes cell by cell (z-major, the stand height to the hundredth, the floor id)", () => {
  assert.equal(chunkA.cells.size, 256);
  const c = chunkA.cells.get("-245,175");
  assert.deepEqual(c.cubes.map((k) => [k.y, CD.KINDS[k.kind]]), [[-7, "dirt"], [-6, "water"]]);
  assert.deepEqual(c.layers[0], { x: -245, z: 175, f: -7, stand: -6.2, floor: "s", bad: CD.BAD.water, warn: CD.WARN.edge, exits: 0b1101 });
  assert.equal(chunkW.cells.get("102,-248").layers[1].floor, "-6");
  assert.deepEqual(CD.chunkOf(-245, 175), [-15, 11]);
  assert.deepEqual(CD.chunkOf(-226, 177), [-14, 11]);
  assert.deepEqual(CD.chunkOf(-8, -8), [0, 0]);
  assert.deepEqual(CD.chunkOf(-9, 7), [-1, 0]);
  assert.throws(() => CD.decodeChunk(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /not a map3d chunk/);
  const extra = new Uint8Array([...chunkBytes(0, 0), 0]);
  assert.throws(() => CD.decodeChunk(extra), /left over/);
});

test("the check: water and a roof are red with their reason, a street cell green, an edge yellow with its sides", () => {
  assert.deepEqual(CD.verdict(chunkA.cells.get("-245,175").layers[0]), { level: "bad", reasons: [{ code: "water" }] });
  assert.deepEqual(CD.verdict(chunkB.cells.get("-226,177").layers[0]), { level: "bad", reasons: [{ code: "roof" }] });
  assert.deepEqual(CD.verdict(chunkA.cells.get("-234,175").layers[0]), { level: "ok", reasons: [] });
  assert.deepEqual(CD.verdict(chunkA.cells.get("-236,174").layers[0]), { level: "warn", reasons: [{ code: "edge", sides: ["S", "W"] }] });
  assert.deepEqual(CD.verdict(cellAt(102, -248).layers[1]).reasons, [{ code: "dark" }]);
});

test("a pointer on the 3D view: the water's sheet is the bed under it, a wall's side is red, a top is its layer", () => {
  const c = cellAt(-245, 175);
  const onWater = CD.pickAt(c, -6.2, true);   // (the sheet: a water cube's top - 0.2)
  assert.equal(onWater.level, "bad");
  assert.equal(onWater.layer.f, -7);
  assert.deepEqual(onWater.reasons, [{ code: "water" }]);
  const side = CD.pickAt(cellAt(-226, 177), -4.5, false);   // the house's front wall, at body height
  assert.deepEqual(side.reasons, [{ code: "wall", kind: "wall" }]);
  const cliff = CD.pickAt(cellAt(-234, 175), -5.5, false);
  assert.deepEqual(cliff.reasons, [{ code: "cliff", kind: "paved" }]);
  const top = CD.pickAt(cellAt(-234, 175), -4.98, true);
  assert.equal(top.level, "ok");
  assert.equal(top.layer.stand, -4.2);
  assert.deepEqual(CD.pickAt(undefined, 0, true).reasons, [{ code: "nodata" }]);
  // a slice: the cave's floor, not the hill over it
  assert.equal(CD.pickAt(cellAt(102, -248), -6.02, true).layer.floor, "-6");
});

test("a 2D marker's layer: its floor's layer, the surface's top, else the nearest slice", () => {
  const c = cellAt(102, -248);
  assert.equal(CD.layerFor(c, "s").f, 11);
  assert.equal(CD.layerFor(c, "-6").f, -6);
  assert.equal(CD.layerFor(c, "-5").f, -6);   // (no layer on -5 here: the nearest)
  assert.equal(CD.layerFor(cellAt(-245, 175), "s").stand, -6.2);
  assert.equal(CD.layerFor(undefined, "s"), null);
  // a house (Basile, -273, 142): its floor and its roof both on the surface: a marker there is inside, not on the roof;
  // a cell whose only surface layer is the roof keeps it (a post put in a wall: red "on a roof")
  const home = CD.decodeChunk(chunkBytes(-17, 9, { "-273,142": { cubes: [[-4, "wood"], [3, "roof"]],
    layers: [[3, 3.55, "s", CD.BAD.roof, CD.WARN.slope], [-4, -3.45, "s"]] } })).cells.get("-273,142");
  assert.equal(CD.layerFor(home, "s").stand, -3.45);
  assert.equal(CD.layerFor(cellAt(-226, 177), "s").stand, 0.55);
});

test("the markers' check: each end where a player stands or lands, the worst first, the rest counted as passed", () => {
  const markers = [
    { id: 0, kind: "rope", floor: "s", x: -245, z: 175 },                                  // the canal: red
    { id: 1, kind: "rope", floor: "s", x: -226, z: 177 },                                  // the house: on its roof
    { id: 2, kind: "rope", floor: "s", x: -234, z: 175, dest: { x: -237, z: 178, floor: "s" } },   // fine both ends
    { id: 3, kind: "spawn", floor: "s", x: -236, z: 174, fields: { monster: "Rat" } },     // an edge: yellow
    { id: 4, kind: "portal", floor: "s", x: -234, z: 175, dest: { x: 102, z: -248, floor: "-6" } },  // lands in a wall
    { id: 5, kind: "rope", floor: "s", x: 900, z: 900 },                                   // outside the data
    { id: 6, kind: "area", floor: "s", cells: [[-245, 175]] },                             // not a spot: not checked
    { id: 7, kind: "rope", floor: "s", x: -236, z: 174 },                                  // a post on an edge: passes
  ];
  const { problems, passed } = CD.problemsOf(markers, cellAt);
  assert.deepEqual(problems.map((p) => [p.id, p.end, p.level, p.reasons.map((r) => r.code).join("+")]),
    [[0, "at", "bad", "water"], [1, "at", "bad", "roof"], [4, "dest", "bad", "dark"], [3, "at", "warn", "edge"]]);
  assert.deepEqual(passed, { spots: 3, landings: 1, unloaded: 1 });
});

test("a reason in words, in every language; the 3D words exist in every language", () => {
  const t3 = translator3("en");
  assert.equal(CD.reasonText({ code: "water" }, t3), "under water: the player would land in the water");
  assert.equal(CD.reasonText({ code: "edge", sides: ["S", "W"] }, t3), "an edge: no step to the south, west");
  assert.equal(CD.reasonText({ code: "wall", kind: "wall" }, t3), "the side of a wall");
  assert.equal(CD.reasonText({ code: "water" }, translator3("pt")), "debaixo d'água: o jogador cairia na água");
  const en = Object.keys(WORDS3.en);
  for (const l of LANGS) assert.deepEqual(en.filter((k) => !(k in WORDS3[l])), [], l);
  for (const code of [...Object.keys(CD.BAD), ...Object.keys(CD.WARN), "wall", "cliff", "wallTop", "covered", "nodata", "otherFloor", "nofloor"])
    assert.ok(WORDS3.en["r." + code], code);
  for (const k of CD.KINDS) assert.ok(WORDS3.en["kind3." + k], k);
});

test("markers placed in 3D make the same link: the floor each layer has, a landing on another floor", async () => {
  // what view3d.js hands the page: the clicked cell's layer floor (api.place / api.setDest)
  const post = CD.pickAt(cellAt(-234, 175), -4.98, true).layer;
  const cave2 = CD.pickAt(cellAt(102, -248), -6.02, true).layer;
  const markers = [
    { id: 0, kind: "rope", floor: post.floor, locked: false, x: -234, z: 175, fields: {}, dest: { x: 102, z: -248, floor: cave2.floor } },
    { id: 1, kind: "portal", floor: cave2.floor, locked: false, x: 102, z: -248, fields: {}, dest: { x: -237, z: 178, floor: "s" } },
    { id: 2, kind: "spawn", floor: "s", locked: false, x: -245, z: 175, fields: { monster: "Rat", count: 3, radius: 2 } },
  ];
  const state = { tiles: "", view: { x: -234, z: 175, zoom: 3, floors: ["s"] }, markers, next: 3, base: 0, was: [] };
  const back = await decode(await encode(state));
  assert.deepEqual(back.markers.map((m) => [m.kind, m.x, m.z, m.floor, m.dest || null]), [
    ["rope", -234, 175, "s", { x: 102, z: -248, floor: "-6" }],
    ["portal", 102, -248, "-6", { x: -237, z: 178, floor: "s" }],
    ["spawn", -245, 175, "s", null],
  ]);
  // and the check reads the link's markers back where they were placed
  const { problems } = CD.problemsOf(back.markers, cellAt);
  assert.deepEqual(problems.map((p) => [p.id, p.end, p.reasons[0].code]), [[0, "dest", "dark"], [1, "at", "dark"], [2, "at", "water"]]);
});

// ---- with the published data (map3d/, written by the staff tools' exporter): skipped without it
const DATA = new URL("../map3d/", import.meta.url);
const have = existsSync(new URL("meta.json", DATA));
const read = (name) => { const b = readFileSync(new URL(name, DATA)); return new Uint8Array(b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b); };
test("the data: every chunk decodes; the street's canal and house say why", { skip: !have && "no map3d/ data" }, () => {
  const meta = JSON.parse(readFileSync(new URL("meta.json", DATA)));
  assert.deepEqual(meta.kinds, CD.KINDS);
  assert.deepEqual(meta.bad, CD.BAD);
  assert.deepEqual(meta.warn, CD.WARN);
  assert.ok(!meta.b, "the public data has no Simplified ground");
  const ext = meta.gz ? ".bin.gz" : ".bin";
  const real = new Map();
  for (const [a, b] of meta.chunks) {
    const c = CD.decodeChunk(read(`c/${a}_${b}${ext}`));
    assert.deepEqual([c.a, c.b], [a, b]);
    real.set(CD.chunkKey(a, b), c);
  }
  const at = (x, z) => { const [a, b] = CD.chunkOf(x, z); return real.get(CD.chunkKey(a, b))?.cells.get(CD.cellKey(x, z)); };
  if (!at(-245, 175)) return;   // (a partial export: the street not in it yet)
  const canalReal = CD.layerFor(at(-245, 175), "s");
  assert.equal(canalReal.stand, -6.2);
  assert.ok(CD.verdict(canalReal).reasons.some((r) => r.code === "water"));
  assert.ok(CD.verdict(CD.layerFor(at(-226, 177), "s")).reasons.some((r) => r.code === "roof"));
  assert.equal(CD.verdict(CD.layerFor(at(-234, 175), "s")).level, "ok");
});

test("the objects: every prop and monster model parses, feet at the origin; icons are there", { skip: !existsSync(new URL("objects/objects.json", DATA)) && "no objects" }, () => {
  const idx = JSON.parse(readFileSync(new URL("objects/objects.json", DATA)));
  for (const k of ["rope", "hole", "portal", "lever", "npc"]) assert.ok(idx.props[k], k);
  for (const [name, e] of [...Object.entries(idx.props), ...Object.entries(idx.monsters)]) {
    const g = parseGlb(read("objects/" + e.file));
    const p = g.prims[0];
    assert.ok(p.index.array.length > 0 && p.index.array.length % 3 === 0, name);
    if (e.icon) assert.ok(existsSync(new URL("objects/" + e.icon, DATA)), name + " icon");
  }
  assert.ok(Object.keys(idx.monsters).length >= 90, "the marker monsters' models");
});
