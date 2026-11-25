// The map page: Leaflet over the game's map tiles, a marker editor, the state in the URL #fragment (maplink.js).
// Everything a link carries was typed by someone: text goes into the page with textContent only, never as HTML.
import * as ML from "./maplink.js";
import * as FL from "./floors.js";
import { MONSTERS } from "./monsters.js";
import { LANGS, pickLang, translator } from "./i18n.js";
import { parseSchedule, scheduleCode, scheduleText } from "./schedule.js";
import { BOSSES, bossOf } from "./bosses.js";

const lang = pickLang();
const t = translator(lang);
const STAFF = new URLSearchParams(location.search).has("staff");
document.documentElement.lang = lang;
document.title = t("title");

// The marker kinds on the page: maplink.js KINDS holds the format; this table how each one looks and is edited.
// A new kind: append it to KINDS (maplink.js and its other implementations), here, and its words in i18n.js.
// Map things draw a small SVG (static markup of this file, never text from a link), white on the kind's colour.
const svg = (body) => `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const KIND_UI = {
  spawn: { color: "#e5484d", glyph: "⚔", fields: { monster: { input: "monster" }, count: { input: "int", min: 1, max: 99, def: 1 }, radius: { input: "int", min: 0, max: 40, def: 3 } } },
  // a boss: like a spawn, with when it comes (free text) under its name; a crown, a bigger disc with a ring
  boss: { color: "#8e1b3b", svg: svg('<path d="M2.5 13.5h11"/><path d="M3.2 11 2 4.6l3.4 2.9L8 2.8l2.6 4.7L14 4.6 12.8 11Z"/>'),
    fields: { monster: { input: "boss" }, schedule: { input: "schedule" }, label: { input: "text", word: "field.bossLabel" } } },
  poi: { color: "#f5a524", glyph: "★", fields: { label: { input: "text" } } },
  area: { color: "#30a46c", glyph: "▦", fields: { label: { input: "text" } } },
  route: { color: "#3e8ef7", glyph: "➜", fields: { label: { input: "text" } } },
  note: { color: "#a46cf5", glyph: "✎", fields: { text: { input: "longtext" } } },
  // map things (ropes, holes and portals lead somewhere: maplink.js's pointdest geometry)
  rope: { color: "#a86f3c", svg: svg('<path d="M8 1.5v2"/><circle cx="8" cy="5" r="1.5"/><path d="M8 6.5c-2.2 1.1-2.2 2.9 0 4s2.2 2.9 0 4"/>'), fields: { label: { input: "text" }, combat: { input: "check" } } },
  // a two-way rope (goes and comes back): the rope with an arrow up and one down; its line has a head at both ends
  rope2: { color: "#a86f3c", svg: svg('<path d="M8 1.5v2"/><circle cx="8" cy="5" r="1.5"/><path d="M8 6.5c-2.2 1.1-2.2 2.9 0 4s2.2 2.9 0 4"/><path d="M3 8V2.2M1.4 3.8 3 2.2l1.6 1.6M13 8v5.8M11.4 12.2 13 13.8l1.6-1.6" stroke-width="1.4"/>'), fields: { label: { input: "text" }, combat: { input: "check" } } },
  lever: { color: "#d6409f", svg: svg('<path d="M2.5 13.5h11"/><path d="M5 13.5a3 3 0 0 1 6 0"/><path d="M8 11 11.2 4.2"/><circle cx="11.6" cy="3.4" r="1.6" fill="currentColor"/>'), fields: { label: { input: "text" }, combat: { input: "check" } } },
  hole: { color: "#26292e", svg: svg('<path d="M8 1.5v4M6 3.8l2 2 2-2"/><ellipse cx="8" cy="10.5" rx="6" ry="3.5"/><ellipse cx="8" cy="11" rx="3.3" ry="1.7" fill="currentColor"/>'), fields: { label: { input: "text" }, combat: { input: "check" } } },
  door: { color: "#5b6b82", svg: svg('<path d="M4 14.5V3.5A1.5 1.5 0 0 1 5.5 2h5A1.5 1.5 0 0 1 12 3.5v11"/><path d="M2.5 14.5h11"/><circle cx="10" cy="8.8" r=".8" fill="currentColor"/>'), fields: { label: { input: "text" } } },
  portal: { color: "#0fa3b8", svg: svg('<ellipse cx="8" cy="8" rx="4.6" ry="6.5"/><ellipse cx="8" cy="8" rx="2" ry="3.4"/><path d="M1.5 4.5l1 .6M14.5 11.5l-1-.6"/>'), fields: { label: { input: "text" }, combat: { input: "check" } } },
  elevator: { color: "#4c4fc9", svg: svg('<rect x="3" y="1.8" width="10" height="12.4" rx="1.6"/><path d="M8 3.9 10.3 6.6H5.7Z" fill="currentColor" stroke-width="1"/><path d="M8 12.1 5.7 9.4h4.6Z" fill="currentColor" stroke-width="1"/>'), fields: { label: { input: "text" }, combat: { input: "check" } } },
  // an NPC: who, when (free text) under the name, what it sells or does
  npc: { color: "#5e7d1f", svg: svg('<circle cx="8" cy="4.8" r="2.6"/><path d="M3 14.5c0-3 2.2-5.2 5-5.2s5 2.2 5 5.2"/>'),
    fields: { name: { input: "text" }, schedule: { input: "schedule" }, label: { input: "text", word: "field.npcLabel" } } },
};
// the map things: one menu in the bar ("Objects"), each kind with its icon, name and one line
const THINGS = ["rope", "rope2", "lever", "hole", "door", "portal", "elevator", "npc"];
const TOOLS = ["select", "spawn", "boss", "poi", "area", "route", "note", "things", "legend"];
// a field's word in the panel and the change list: its own (a boss's or an NPC's label) or the field's
const fieldWord = (kind, name) => t(KIND_UI[kind]?.fields?.[name]?.word || "field." + name);
// a two-way rope: an arrow both ways
const arrowOf = (m) => (m.kind === "rope2" ? "↔" : "→");
const GLYPH = { select: "☝", legend: "?", things: "＋", ...Object.fromEntries(Object.entries(KIND_UI).map(([k, v]) => [k, v.glyph])) };
const UNKNOWN = { color: "#888", glyph: "?", fields: {} };
const ui = (m) => KIND_UI[m.kind] || UNKNOWN;
// a kind whose marker can lead somewhere (rope, hole, portal)
const leads = (kind) => ML.KINDS[ML.KIND_CODE[kind]]?.geometry === "pointdest";
// the glyph of a kind or tool as a node: its SVG (static markup) or its text character
function glyphNode(name, cls = "glyph") {
  const s = document.createElement("span");
  s.className = cls;
  if (KIND_UI[name]?.svg) s.innerHTML = KIND_UI[name].svg; else s.textContent = GLYPH[name] ?? "?";
  return s;
}
// the kind's marker as a small disc (the legend, the panel, the sub-bar)
function dotNode(kind, cls = "mk mini") {
  const d = glyphNode(kind, cls);
  d.style.background = (KIND_UI[kind] || UNKNOWN).color;
  return d;
}

// One cell is one pixel at zoom 0; cell (x, z) covers pixel column x and row -z (north = +z up).
const CRS = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(1, 0.5, -1, 0.5) });
const ll = (x, z) => L.latLng(z, x);
const cellOf = (latlng) => [Math.round(latlng.lng), Math.round(latlng.lat)];
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

// ------------------------------------------------------------------------------------------------ state
let tileIndex, tileMeta, tileVersion;
let opened = { markers: [], next: 0, base: 0, was: [] };   // the link as opened: what Save compares against
let markers = [];
let nextId = 0;
let selected = null;   // marker id
let tool = "select";
let areaMode = "brush";
let draftRoute = null;   // {floor, points}
let destFor = null;   // the "dest" tool: the id of the rope, hole or portal whose destination the next tap sets
let mapTitle = "";   // the map's title (the link's, else ?title=): the tab and the header show it
const undoStack = [], redoStack = [];
let panes = [];
let syncing = false;

const byId = (id) => markers.find((m) => m.id === id);
const clone = (x) => structuredClone(x);
const floorLabel = (f) => (f === "s" ? t("surface") : t("floorY", f, (+f + 0.8).toFixed(1)));
const floorShort = (f) => (f === "s" ? t("surface") : t("floor", f));
const leadsText = (f) => (f === "s" ? t("leadsSurface") : t("leadsFloor", f));
const spotText = (d) => `x ${d.x}, z ${d.z} (${floorShort(d.floor)})`;

function snapshot() { return { markers: clone(markers), nextId, mapTitle }; }
function restore(s) {
  markers = clone(s.markers); nextId = s.nextId;
  if (selected != null && !byId(selected)) selected = null;
  if (s.mapTitle !== mapTitle) { mapTitle = s.mapTitle; showTitle(); }
}

// the title in the tab ("<title> - Opengea Map") and in the header's box; text only (document.title and .value)
function showTitle() {
  document.title = mapTitle ? t("titleWith", mapTitle) : t("title");
  const box = $("mapTitle");
  if (box.value !== mapTitle) box.value = mapTitle;
}
// every change to the markers goes through here: one undo step each
function commit(fn) {
  const before = snapshot();
  const ok = fn();
  if (ok === false) return;
  undoStack.push(before);
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  refresh();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); refresh(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); refresh(); }

// ------------------------------------------------------------------------------------------------ tiles
const TileLayer = L.TileLayer.extend({
  getTileUrl(c) {
    const have = tileMeta.tiles[this.options.floor];
    if (!have || !(have[String(c.z)] || []).includes(c.x + "_" + c.y)) return BLANK;
    return `tiles/${tileVersion}/${this.options.floor}/${c.z}/${c.x}_${c.y}.png`;
  },
});
function tileLayer(floor, opacity = 1) {
  return new TileLayer("", {
    floor, opacity, tileSize: 256, minZoom: -2, maxZoom: 5, minNativeZoom: -2, maxNativeZoom: 0, noWrap: true,
    bounds: L.latLngBounds(tileMeta.bounds), keepBuffer: 4,
  });
}

// ------------------------------------------------------------------------------------------------ panes
function buildPanes(floors, view) {
  for (const p of panes) p.map.remove();
  panes = [];
  activePane = null;
  const box = $("panesBox");
  box.textContent = "";
  floors.forEach((floor, i) => {
    const select = el("select", { "aria-label": t("field.floor") });
    for (const f of tileMeta.floors) select.append(el("option", { value: f }, floorLabel(f)));
    select.value = floor;
    const mapEl = el("div", { class: "map" });
    // the floor above / below (the next one with map in view), the view kept where it is
    const up = el("button", { type: "button", class: "fnav", title: t("floorUp") + " (PageUp, ])", "aria-label": t("floorUp") }, "▲");
    const down = el("button", { type: "button", class: "fnav", title: t("floorDown") + " (PageDown, [)", "aria-label": t("floorDown") }, "▼");
    box.append(el("div", { class: "pane" }, el("div", { class: "pane-head" }, select, up, down), mapEl));
    const map = L.map(mapEl, { crs: CRS, minZoom: -2, maxZoom: 5, zoomSnap: 1, attributionControl: false,
      zoomControl: i === 0, doubleClickZoom: false, maxBounds: L.latLngBounds(tileMeta.bounds).pad(0.3), maxBoundsViscosity: 0.8 });
    const p = { floor, map, el: mapEl, select, up, down, base: null, under: null, layer: L.layerGroup().addTo(map), draft: L.layerGroup().addTo(map) };
    panes.push(p);
    setFloor(p, floor);
    select.addEventListener("change", () => { setFloor(p, select.value); refresh(); });
    up.addEventListener("click", () => stepFloor(p, -1));
    down.addEventListener("click", () => stepFloor(p, 1));
    mapEl.addEventListener("pointerenter", () => { activePane = p; });
    mapEl.addEventListener("pointerdown", () => { activePane = p; });
    map.on("moveend", () => paintFloorNav(p));
    map.setView(ll(view.x, view.z), view.zoom, { animate: false });
    map.on("move", () => { sync(p); drawLinksSoon(); });
    map.on("zoomend resize", drawLinksSoon);
    map.on("mousemove", (e) => showCoords(p, e.latlng));
    map.on("click", (e) => onMapClick(p, e));
    map.on("dblclick", () => { if (tool === "route") finishRoute(); });
    hookPainting(p);
  });
  // over the panes: the arrows of ropes, holes and portals from one pane's floor to another's
  box.append(document.createElementNS(SVGNS, "svg"));
  box.lastChild.id = "links";
  // Each map measured its box when it was created, before the later panes split the screen: measure again and
  // centre every pane on the link's view, or the first pane's centre falls outside what it shows.
  for (const p of panes) {
    p.map.invalidateSize({ animate: false });
    p.map.setView(ll(view.x, view.z), view.zoom, { animate: false });
  }
  applyTool();
  refresh();
}

// 1 to 3 floors side by side: the panes kept keep their floors; a new one opens on the next floor down that has
// markers (floors.js paneFloor), else the next floor down with map in view, never the top of the world
function setPaneCount(n) {
  const view = currentView();
  const floors = view.floors.slice(0, n);
  const counts = FL.floorCounts(markers);
  const corners = viewCorners(panes[0]);
  const hasMap = (f) => { const have = new Set(tileMeta.tiles[f]?.["0"] || []); return FL.tilesInView(corners).some((k) => have.has(k)); };
  while (floors.length < n) floors.push(FL.paneFloor(tileMeta.floors, counts, floors, hasMap) ?? floors[floors.length - 1]);
  buildPanes(floors, view);
}

// the floor selects' words: each floor's name and how many markers it holds
function floorOptionText(f, counts) {
  return counts[f] ? t("floorCount", floorLabel(f), counts[f]) : floorLabel(f);
}
function paintFloorSelects() {
  const counts = FL.floorCounts(markers);
  for (const p of panes) for (const o of p.select.options) o.textContent = floorOptionText(o.value, counts);
}

function setFloor(p, floor) {
  p.floor = floor;
  if (p.select && p.select.value !== floor) p.select.value = floor;
  if (p.base) p.map.removeLayer(p.base);
  if (p.under) p.map.removeLayer(p.under);
  p.under = floor === "s" ? null : tileLayer("s", 0.14).addTo(p.map);   // the surface, dim, under a floor below it
  p.base = tileLayer(floor).addTo(p.map);
  p.layer.bringToFront?.();
  paintFloorNav(p);
}

// ---- floor up / down. tileMeta.floors runs from the top (the surface, then 10 .. -16); a step skips floors with no
// map tile in the pane's view (blank there), and the view stays where it is.
let activePane = null;   // the pane the shortcuts move: the last one pointed at

// dir -1: the floor above, +1: the floor below; null when there is none with map here (the rule: floors.js)
function nextFloor(p, dir) {
  return FL.nextFloor(tileMeta.floors, tileMeta.tiles, p.floor, dir, viewCorners(p));
}
// a pane's view corners in zoom-0 pixels
function viewCorners(p) {
  const b = p.map.getBounds();
  const a = p.map.project(b.getNorthWest(), 0), c = p.map.project(b.getSouthEast(), 0);
  return [a.x, a.y, c.x, c.y];
}

function stepFloor(p, dir) {
  const f = p && nextFloor(p, dir);
  if (!f) return;
  setFloor(p, f);
  refresh();
  showCoordsFloor(p);
}

function paintFloorNav(p) {
  if (!p.up || !tileMeta) return;
  try { p.map.getCenter(); } catch { return; }   // no view yet (a pane being built): its first moveend paints it
  p.up.disabled = !nextFloor(p, -1);
  p.down.disabled = !nextFloor(p, 1);
}

// the bottom bar names the floor the pane now shows (the cursor may not have moved)
function showCoordsFloor(p) {
  $("coords").textContent = $("coords").textContent.replace(/[^·]*$/, " " + floorLabel(p.floor));
}

function sync(src) {
  if (syncing) return;
  syncing = true;
  for (const p of panes) if (p !== src) p.map.setView(src.map.getCenter(), src.map.getZoom(), { animate: false });
  syncing = false;
}

function currentView() {
  const m = panes[0].map, c = m.getCenter();
  return { x: Math.round(c.lng), z: Math.round(c.lat), zoom: m.getZoom(), floors: panes.map((p) => p.floor) };
}

function posLine(x, z, floor) {
  return floor === "s" ? `[pos] x ${x.toFixed(1)}, z ${z.toFixed(1)} (surface)`
    : `[pos] x ${x.toFixed(1)}, y ${(+floor + 0.8).toFixed(1)}, z ${z.toFixed(1)} (floor ${floor})`;
}

function showCoords(p, latlng) {
  const [x, z] = cellOf(latlng);
  $("coords").textContent = `x ${x} · z ${z} · ${floorLabel(p.floor)}`;
}

// ------------------------------------------------------------------------------------------------ drawing
function tip(layer, text, opts = {}) {
  if (!text) return;
  const span = text instanceof Node ? text : el("span", {}, text);   // text nodes: whatever the link holds stays text
  layer.bindTooltip(span, { permanent: true, direction: "top", className: "lbl", offset: [0, -14], ...opts });
}

function labelOf(m) {
  const f = m.fields || {};
  if (m.kind === "spawn") return [f.monster || "?", f.count > 1 ? "×" + f.count : ""].join(" ").trim();
  if (m.kind === "boss") return f.monster || "?";
  if (m.kind === "npc") return f.name || f.label || "";
  return f.label || f.text || "";
}

// a boss's or an NPC's label on the map: its name, its own label, and when it is there on a line under them
function whoWhen(m) {
  const f = m.fields || {};
  const lines = [labelOf(m) || t("kind." + m.kind)];
  if (f.label && f.label !== labelOf(m)) lines.push(f.label);
  const out = el("span", {}, lines.join(" · "));
  if (f.schedule) out.append(el("br"), el("small", { class: "sched" }, "🕑 " + scheduleText(f.schedule, t)));
  return out;
}

const BIG = { boss: 34 };   // a boss: a bigger disc with a ring
function icon(m) {
  const k = ui(m), size = BIG[m.kind] || 26;
  const cls = "mk" + (BIG[m.kind] ? " " + m.kind : "") + (m.id === selected ? " sel" : "") + (m.locked ? " lock" : "");
  // static glyphs only: no text from the link in this HTML
  return L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<div class="${cls}" style="background:${k.color};--ring:${k.color}">${m.locked ? "🔒" : k.svg || k.glyph}${m.fields?.combat ? '<span class="badge cb">⚔</span>' : ""}</div>` });
}

function rings(cells) {
  return ML.runsOf(cells).map(([z, x0, n]) => [[ll(x0 - 0.5, z - 0.5), ll(x0 + n - 0.5, z - 0.5), ll(x0 + n - 0.5, z + 0.5), ll(x0 - 0.5, z + 0.5)]]);
}

function outline(cells) {
  const set = new Set(cells.map(([x, z]) => x + "," + z));
  const segs = [];
  for (const [x, z] of cells) {
    if (!set.has(x + 1 + "," + z)) segs.push([ll(x + 0.5, z - 0.5), ll(x + 0.5, z + 0.5)]);
    if (!set.has(x - 1 + "," + z)) segs.push([ll(x - 0.5, z - 0.5), ll(x - 0.5, z + 0.5)]);
    if (!set.has(x + "," + (z + 1))) segs.push([ll(x - 0.5, z + 0.5), ll(x + 0.5, z + 0.5)]);
    if (!set.has(x + "," + (z - 1))) segs.push([ll(x - 0.5, z - 0.5), ll(x + 0.5, z - 0.5)]);
  }
  return segs;
}

const canEdit = (m) => m && !m.locked && m.kind in KIND_UI;

// ---- where ropes, holes and portals lead
// Same floor: a dashed arrow on that floor's panes. Another floor: "leads to floor N" on the marker's label, a small end
// marker on the destination's floor, and, when both floors are shown side by side, an arrow across the panes (drawLinks).
function destLabel(m) {
  const name = KIND_UI[m.kind] ? t("kind." + m.kind) : m.kind;
  return (m.kind === "rope2" ? "↔ " : "") + t("destOf", labelOf(m) ? `${name} "${labelOf(m)}"` : `${name} #${m.id}`);
}

function setDest(id, x, z, floor) {
  commit(() => {
    const n = byId(id);
    if (!canEdit(n) || !leads(n.kind)) return false;
    if (n.dest && n.dest.x === x && n.dest.z === z && n.dest.floor === floor) return false;
    n.dest = { x, z, floor };
  });
}

function startDestPick(id) {
  if (tool === "route") finishRoute();
  destFor = id;
  selected = id;
  tool = "dest";
  applyTool();
  toast(t("hintDestFloor"));   // the sub-bar says "tap where it leads"; this, how to reach another floor
}

function drawDest(p, m) {
  const d = m.dest, k = ui(m), sel = m.id === selected;
  if (m.floor === p.floor && d.floor === p.floor) {
    const line = [ll(m.x, m.z), ll(d.x, d.z)];
    L.polyline(line, { color: "#000", weight: sel ? 6 : 5, opacity: 0.35, interactive: false }).addTo(p.layer);
    L.polyline(line, { color: sel ? "#ffe066" : k.color, weight: sel ? 3.5 : 2.5, dashArray: "7 5", interactive: false }).addTo(p.layer);
    // a chevron at the middle, pointing to the destination (+z is up on the screen); a two-way rope: one at each end,
    // pointing out, just clear of the end markers (offsets in pixels: the same at every zoom)
    const deg = (Math.atan2(-(d.z - m.z), d.x - m.x) * 180) / Math.PI;
    const chev = (x, z, angle, back) => L.marker(ll(x, z), { interactive: false, keyboard: false,
      icon: L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8],
        html: `<div class="chev" style="transform:rotate(${angle.toFixed(1)}deg) translateX(${-back}px);color:${sel ? "#ffe066" : k.color}">${svg('<path d="M5 3l6 5-6 5" stroke-width="2.6"/>')}</div>` }) }).addTo(p.layer);
    if (m.kind === "rope2") { chev(d.x, d.z, deg, 18); chev(m.x, m.z, deg + 180, 21); }
    else chev((m.x + d.x) / 2, (m.z + d.z) / 2, deg, 0);
  }
  if (d.floor !== p.floor) return;
  // the end marker: the kind's icon, smaller; drag it to move the destination, tap it to select its rope
  const end = L.marker(ll(d.x, d.z), { draggable: canEdit(m) && tool !== "dest", autoPan: true, zIndexOffset: sel ? 900 : -100, keyboard: false,
    icon: L.divIcon({ className: "", iconSize: [20, 20], iconAnchor: [10, 10],
      html: `<div class="mk end${sel ? " sel" : ""}" style="background:${k.color}">${k.svg || k.glyph}</div>` }) });
  end.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    if (tool === "dest") { const [x, z] = cellOf(e.latlng); setDest(destFor, x, z, p.floor); endDestPick(); }
    else if (tool !== "area" && tool !== "route") select(m.id);
  });
  end.on("dragend", () => { const [x, z] = cellOf(end.getLatLng()); selected = m.id; setDest(m.id, x, z, p.floor); });
  // its own floor's label only when the rope is selected or on the other floor (hover elsewhere): nothing cluttered
  const text = destLabel(m);
  if (sel || m.floor !== p.floor) end.bindTooltip(el("span", {}, text), { direction: "bottom", className: "lbl end", offset: [0, 8], permanent: sel });
  end.addTo(p.layer);
}

function endDestPick() {
  if (tool !== "dest") return;
  tool = "select";
  const id = destFor;
  destFor = null;
  selected = id;
  $("toast").hidden = true;   // its hint is done; on a phone it would sit over the panel
  applyTool();
}

const SVGNS = "http://www.w3.org/2000/svg";
let linksQueued = false;
function drawLinksSoon() {
  if (linksQueued) return;
  linksQueued = true;
  requestAnimationFrame(() => { linksQueued = false; drawLinks(); });
}

// arrows across panes: a marker on one shown floor whose destination is on another shown floor
function drawLinks() {
  const box = $("panesBox"), layer = $("links");
  if (!layer) return;
  layer.textContent = "";
  if (panes.length < 2) return;
  const origin = box.getBoundingClientRect();
  const paneOf = (floor) => panes.find((p) => p.floor === floor);
  const at = (p, x, z) => {
    const r = p.el.getBoundingClientRect(), c = p.map.latLngToContainerPoint(ll(x, z));
    if (c.x < 0 || c.y < 0 || c.x > r.width || c.y > r.height) return null;   // out of its pane's view: no arrow
    return [r.left - origin.left + c.x, r.top - origin.top + c.y];
  };
  const add = (tag, attrs) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    layer.append(e);
  };
  // the selected one last, on top
  const list = markers.filter((m) => m.dest && m.dest.floor !== m.floor).sort((a, b) => (a.id === selected) - (b.id === selected));
  for (const m of list) {
    const pa = paneOf(m.floor), pb = paneOf(m.dest.floor);
    if (!pa || !pb) continue;
    const a = at(pa, m.x, m.z), b = at(pb, m.dest.x, m.dest.z);
    if (!a || !b) continue;
    const sel = m.id === selected, color = sel ? "#ffe066" : ui(m).color;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 30) continue;
    // stop short of the end marker; an arrow head there (a two-way rope: at the start too)
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const s = [a[0] + ux * 14, a[1] + uy * 14], e = [b[0] - ux * 12, b[1] - uy * 12];
    const line = `M${s[0].toFixed(1)} ${s[1].toFixed(1)}L${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
    add("path", { d: line, stroke: "#000", "stroke-width": sel ? 6 : 5, "stroke-opacity": 0.35, fill: "none" });
    add("path", { d: line, stroke: color, "stroke-width": sel ? 3.5 : 2.5, "stroke-dasharray": "7 5", fill: "none", opacity: sel ? 1 : 0.85 });
    const h = 9, w = 5;
    const head = (p, vx, vy) => {   // a head at p pointing along (vx, vy)
      const l = [p[0] - vx * h - vy * w, p[1] - vy * h + vx * w], r = [p[0] - vx * h + vy * w, p[1] - vy * h - vx * w];
      add("path", { d: `M${p.join(" ")}L${l.join(" ")}L${r.join(" ")}Z`, fill: color, stroke: "#000", "stroke-opacity": 0.4 });
    };
    head(e, ux, uy);
    if (m.kind === "rope2") head(s, -ux, -uy);
  }
}

function drawMarker(p, m) {
  const k = ui(m), sel = m.id === selected;
  const pick = (e) => {
    L.DomEvent.stopPropagation(e);
    // picking a destination: a tap on any marker or shape sets it there (a rope may land on a painted area)
    if (tool === "dest") { const [x, z] = cellOf(e.latlng); setDest(destFor, x, z, p.floor); endDestPick(); return; }
    if (tool === "area" || tool === "route") return;
    select(m.id);
  };
  if ("x" in m) {
    if (m.dest) drawDest(p, m);
    if (m.kind === "spawn" && m.fields?.radius) {
      L.circle(ll(m.x, m.z), { radius: m.fields.radius, color: k.color, weight: 1, fillOpacity: 0.12, interactive: false }).addTo(p.layer);
    }
    const mk = L.marker(ll(m.x, m.z), { icon: icon(m), draggable: canEdit(m), autoPan: true, zIndexOffset: sel ? 1000 : 0 });
    mk.on("click", pick);
    mk.on("dragstart", () => { selected = m.id; });
    mk.on("dragend", () => {
      const [x, z] = cellOf(mk.getLatLng());
      commit(() => { const n = byId(m.id); if (!n || (n.x === x && n.z === z)) return false; n.x = x; n.z = z; });
    });
    const label = labelOf(m), away = m.dest && m.dest.floor !== m.floor ? leadsText(m.dest.floor) : "";
    const text = [label, away, m.fields?.combat ? "⚔ " + t("combatOn") : ""].filter(Boolean).join(" · ");
    if (m.kind === "boss" || m.kind === "npc") tip(mk, whoWhen(m), BIG[m.kind] ? { offset: [0, -18] } : {});
    else tip(mk, m.kind === "rope2" ? ("↔ " + text).trim() : text);   // a two-way rope: ↔ always
    mk.addTo(p.layer);
    return;
  }
  if (m.cells) {
    const style = { color: k.color, weight: 0, fillOpacity: sel ? 0.45 : 0.3, interactive: tool === "select" };
    const poly = L.polygon(rings(m.cells), style).on("click", pick).addTo(p.layer);
    L.polyline(outline(m.cells), { color: sel ? "#ffe066" : k.color, weight: sel ? 3 : 2, dashArray: m.locked ? "4 4" : null, interactive: false }).addTo(p.layer);
    const c = ML.where(m);
    if (c && labelOf(m)) {
      const anchor = L.marker(ll(c[0], c[1]), { icon: L.divIcon({ className: "", iconSize: [0, 0] }), interactive: false }).addTo(p.layer);
      tip(anchor, (m.locked ? "🔒 " : "") + labelOf(m), { offset: [0, 0], direction: "center" });
    }
    if (sel && canEdit(m)) moveHandle(p, m);
    return poly;
  }
  if (m.points) {
    const line = L.polyline(m.points.map(([x, z]) => ll(x, z)), { color: sel ? "#ffe066" : k.color, weight: sel ? 5 : 4,
      dashArray: m.locked ? "6 6" : null, interactive: tool === "select" }).on("click", pick).addTo(p.layer);
    const [x1, z1] = m.points[m.points.length - 1];
    L.circleMarker(ll(m.points[0][0], m.points[0][1]), { radius: 5, color: "#fff", fillColor: k.color, fillOpacity: 1, weight: 2, interactive: false }).addTo(p.layer);
    L.circleMarker(ll(x1, z1), { radius: 7, color: "#fff", fillColor: k.color, fillOpacity: 1, weight: 2, interactive: false }).addTo(p.layer);
    if (labelOf(m)) tip(line, (m.locked ? "🔒 " : "") + labelOf(m), { direction: "center", offset: [0, 0] });
    if (sel && canEdit(m)) {
      m.points.forEach(([x, z], i) => {
        const h = L.marker(ll(x, z), { draggable: true, icon: L.divIcon({ className: "", html: '<div class="handle"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) });
        h.on("dragend", () => {
          const [nx, nz] = cellOf(h.getLatLng());
          commit(() => { const n = byId(m.id); if (!n) return false; n.points[i] = [nx, nz]; });
        });
        h.on("click", (e) => L.DomEvent.stopPropagation(e));
        h.addTo(p.layer);
      });
      moveHandle(p, m);
    }
  }
}

// a square handle at the middle of an area or route: drag it to move the whole shape
function moveHandle(p, m) {
  const c = ML.where(m);
  if (!c) return;
  const h = L.marker(ll(c[0], c[1]), { draggable: true, zIndexOffset: 2000,
    icon: L.divIcon({ className: "", html: '<div class="handle move">✥</div>', iconSize: [22, 22], iconAnchor: [11, 11] }) });
  h.on("click", (e) => L.DomEvent.stopPropagation(e));
  h.on("dragend", () => {
    const [nx, nz] = cellOf(h.getLatLng());
    const dx = nx - c[0], dz = nz - c[1];
    commit(() => {
      const n = byId(m.id);
      if (!n || (!dx && !dz)) return false;
      if (n.cells) n.cells = n.cells.map(([x, z]) => [x + dx, z + dz]);
      if (n.points) n.points = n.points.map(([x, z]) => [x + dx, z + dz]);
    });
  });
  h.addTo(p.layer);
}

function drawPane(p) {
  p.layer.clearLayers();
  const mine = markers.filter((m) => m.floor === p.floor);
  // areas under routes under points; the selected one last
  const order = (m) => (m.cells ? 0 : m.points ? 1 : 2) + (m.id === selected ? 3 : 0);
  for (const m of mine.sort((a, b) => order(a) - order(b))) drawMarker(p, m);
  // the end markers of ropes, holes and portals from other floors that land on this one
  for (const m of markers) if (m.dest && m.dest.floor === p.floor && m.floor !== p.floor) drawDest(p, m);
  drawDraft(p);
}

function drawDraft(p, preview) {
  p.draft.clearLayers();
  if (draftRoute && draftRoute.floor === p.floor && draftRoute.points.length) {
    L.polyline(draftRoute.points.map(([x, z]) => ll(x, z)), { color: "#ffe066", weight: 4, dashArray: "6 6", interactive: false }).addTo(p.draft);
    for (const [x, z] of draftRoute.points) L.circleMarker(ll(x, z), { radius: 5, color: "#000", fillColor: "#ffe066", fillOpacity: 1, weight: 2, interactive: false }).addTo(p.draft);
  }
  if (preview && preview.length) {
    L.polygon(rings(preview), { color: areaMode === "erase" ? "#e5484d" : "#ffe066", weight: 0, fillOpacity: 0.5, interactive: false }).addTo(p.draft);
  }
}

function refresh() {
  // picking a destination for a marker that is gone or locked now (undo, delete): stop picking
  if (tool === "dest" && !canEdit(byId(destFor))) { tool = "select"; destFor = null; paintTools(); }
  for (const p of panes) drawPane(p);
  drawLinksSoon();
  paintFloorSelects();
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  renderPanel();
}

// ------------------------------------------------------------------------------------------------ tools
function applyTool() {
  paintTools();
  refresh();
}

// the bar, the sub-bar and the maps' cursor for the tool (no redraw of the markers)
function paintTools() {
  const thing = activeThing();
  for (const b of $("tools").children) b.classList.toggle("on", b.dataset.tool === (thing ? "things" : tool === "dest" ? byId(destFor)?.kind : tool));
  // the menu's button wears the chosen thing's marker while it is in use
  const tb = document.querySelector("[data-tool=things]");
  if (tb) tb.firstChild.replaceWith(thing ? dotNode(thing, "glyph mk mini") : glyphNode("things"));
  for (const p of panes) {
    const paint = tool === "area";
    p.el.classList.toggle("painting", paint);
    p.el.classList.toggle("picking", tool === "dest");
    if (paint) p.map.dragging.disable(); else p.map.dragging.enable();
  }
  const sub = $("subtools");
  sub.textContent = "";
  if (tool === "area") {
    for (const mode of ["brush", "rect", "erase"]) {
      sub.append(el("button", { type: "button", class: areaMode === mode ? "on" : "", onclick: () => { areaMode = mode; applyTool(); } }, t(mode)));
    }
    sub.append(el("button", { type: "button", onclick: () => { selected = null; refresh(); toast(t("hintArea")); } }, t("newArea")));
  }
  if (tool === "route") {
    sub.append(el("button", { type: "button", class: "primary", onclick: finishRoute }, t("finish")));
    sub.append(el("button", { type: "button", onclick: () => { draftRoute = null; refresh(); } }, t("cancel")));
  }
  if (tool === "dest") {
    const m = byId(destFor);
    sub.append(el("span", { class: "pick" }, dotNode(m?.kind), " " + t("pickDest")));
    sub.append(el("button", { type: "button", onclick: endDestPick }, m?.dest ? t("cancel") : t("skip")));
  }
}

function setTool(name) {
  if (name === "legend") { showLegend(); return; }
  if (tool === "route" && name !== "route") finishRoute();
  destFor = null;
  tool = name;
  // a drawing tool closes the panel of anything it doesn't work on (on a phone the panel covers half the map)
  const sel = byId(selected);
  if (name !== "select" && !(sel && sel.kind === name && (name === "area" || name === "route"))) selected = null;
  applyTool();
  if (name === "area") toast(t("hintArea"));
  else if (name === "route") toast(t("hintRoute"));
  else if (name !== "select") toast(`${t("kind." + name)}: ${t("hintPlace")}`);
}

// ---- the map things' menu: rope, lever, hole, door, portal, elevator (icon, name, one line each)
function buildThingsMenu() {
  const menu = el("div", { id: "thingsMenu", role: "menu", hidden: true });
  for (const kind of THINGS) {
    menu.append(el("button", { type: "button", role: "menuitem", "data-kind": kind, onclick: () => { closeThings(); setTool(kind); } },
      dotNode(kind, "mk"), el("div", {}, el("b", {}, t("kind." + kind)), el("span", {}, t("help." + kind)))));
  }
  document.body.append(menu);
  // a tap anywhere else closes it
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !e.target.closest("#thingsMenu, [data-tool=things]")) closeThings();
  }, true);
  window.addEventListener("resize", closeThings);
}

function toggleThings() {
  const menu = $("thingsMenu"), btn = document.querySelector("[data-tool=things]");
  if (!menu.hidden) { closeThings(); return; }
  menu.hidden = false;
  // under its button, inside the screen (a phone: the whole width less a margin)
  const r = btn.getBoundingClientRect(), w = Math.min(320, innerWidth - 16);
  menu.style.width = w + "px";
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  menu.style.top = r.bottom + 4 + "px";
  btn.setAttribute("aria-expanded", "true");
  for (const b of menu.children) b.classList.toggle("on", b.dataset.kind === activeThing());
  (menu.querySelector(".on") || menu.firstChild).focus();
}

function closeThings() {
  const menu = $("thingsMenu");
  if (!menu || menu.hidden) return false;
  menu.hidden = true;
  document.querySelector("[data-tool=things]")?.setAttribute("aria-expanded", "false");
  return true;
}

// the map thing being placed (or whose destination is being picked), else null
function activeThing() {
  const k = tool === "dest" ? byId(destFor)?.kind : tool;
  return THINGS.includes(k) ? k : null;
}

// what each marker is: every kind's icon, name and one line, and how a destination is drawn
function showLegend() {
  const d = $("dialog");
  d.textContent = "";
  const list = el("ul", { class: "legend" });
  for (const kind of Object.keys(KIND_UI)) {
    list.append(el("li", {}, dotNode(kind, "mk"), el("div", {}, el("b", {}, t("kind." + kind)), el("span", {}, t("help." + kind)))));
  }
  d.append(el("h2", {}, t("legendTitle")), list, el("p", {}, t("legendArrow")),
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => d.close() }, t("close"))));
  d.showModal();
}

function newMarker(kind, floor, geo) {
  const fields = {};
  for (const [name, f] of Object.entries(KIND_UI[kind].fields)) if (f.def != null) fields[name] = f.def;
  return { id: nextId++, kind, floor, locked: false, ...geo, fields };
}

function onMapClick(p, e) {
  const [x, z] = cellOf(e.latlng);
  if (tool === "select") {
    selected = null;
    refresh();
    copy(posLine(x, z, p.floor));
    return;
  }
  if (tool === "area") return;
  if (tool === "dest") { setDest(destFor, x, z, p.floor); endDestPick(); return; }
  if (tool === "route") {
    const sel = byId(selected);
    if (!draftRoute && canEdit(sel) && sel.kind === "route" && sel.floor === p.floor) {
      commit(() => { sel.points.push([x, z]); });   // extend the selected route
      return;
    }
    if (!draftRoute || draftRoute.floor !== p.floor) draftRoute = { floor: p.floor, points: [] };
    const last = draftRoute.points[draftRoute.points.length - 1];
    if (!last || last[0] !== x || last[1] !== z) draftRoute.points.push([x, z]);
    refresh();
    return;
  }
  const kind = tool;
  let id;
  commit(() => { const m = newMarker(kind, p.floor, { x, z }); markers.push(m); selected = id = m.id; });
  // a rope, hole or portal asks at once where it leads (Skip leaves it unset)
  if (leads(kind)) startDestPick(id);
  else setTool("select");
}

function finishRoute() {
  if (!draftRoute) return;
  const d = draftRoute;
  draftRoute = null;
  if (d.points.length >= 2) commit(() => { const m = newMarker("route", d.floor, { points: d.points }); markers.push(m); selected = m.id; });
  else refresh();
}

// area painting: one finger or the mouse paints (brush), spans a rectangle (rect) or erases; two fingers move the map
function hookPainting(p) {
  const touches = new Set();
  let stroke = null;
  const cellAt = (ev) => cellOf(p.map.mouseEventToLatLng(ev));
  const brush = (c, set) => set.add(c[0] + "," + c[1]);
  const rectCells = (a, b) => {
    const out = [];
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
      for (let z = Math.min(a[1], b[1]); z <= Math.max(a[1], b[1]); z++) out.push(x + "," + z);
    return out;
  };
  const cellsOf = () => (areaMode === "rect" && stroke.end ? rectCells(stroke.start, stroke.end) : [...stroke.set]).map((k) => k.split(",").map(Number));
  p.el.addEventListener("pointerdown", (ev) => {
    if (tool !== "area") return;
    if (ev.pointerType === "touch") touches.add(ev.pointerId);
    if (touches.size > 1) { stroke = null; drawDraft(p); p.map.dragging.enable(); return; }   // a pinch or a pan
    if (ev.button > 0 || ev.target.closest(".leaflet-control")) return;
    const c = cellAt(ev);
    stroke = { start: c, end: c, set: new Set() };
    brush(c, stroke.set);
    p.el.setPointerCapture?.(ev.pointerId);
    drawDraft(p, cellsOf());
  });
  p.el.addEventListener("pointermove", (ev) => {
    if (!stroke || tool !== "area") return;
    const c = cellAt(ev);
    if (areaMode === "rect") stroke.end = c;
    else {   // fill the gap from the last cell, so a fast stroke has no holes
      const [x0, z0] = stroke.last || stroke.start, n = Math.max(Math.abs(c[0] - x0), Math.abs(c[1] - z0));
      for (let i = 1; i <= n; i++) brush([Math.round(x0 + ((c[0] - x0) * i) / n), Math.round(z0 + ((c[1] - z0) * i) / n)], stroke.set);
      stroke.last = c;
    }
    drawDraft(p, cellsOf());
  });
  const end = (ev) => {
    touches.delete(ev.pointerId);
    if (touches.size === 0 && tool === "area") p.map.dragging.disable();
    if (!stroke || tool !== "area") return;
    const cells = cellsOf();
    stroke = null;
    drawDraft(p);
    paint(p.floor, cells);
  };
  p.el.addEventListener("pointerup", end);
  p.el.addEventListener("pointercancel", (ev) => { touches.delete(ev.pointerId); stroke = null; drawDraft(p); });
}

function paint(floor, cells) {
  if (!cells.length) return;
  const sel = byId(selected);
  const target = canEdit(sel) && sel.kind === "area" && sel.floor === floor ? sel : null;
  if (areaMode === "erase") {
    if (!target) return;
    const drop = new Set(cells.map(([x, z]) => x + "," + z));
    commit(() => {
      const left = target.cells.filter(([x, z]) => !drop.has(x + "," + z));
      if (left.length === target.cells.length) return false;
      if (!left.length) { markers = markers.filter((m) => m !== target); selected = null; } else target.cells = left;
    });
    return;
  }
  commit(() => {
    if (target) {
      const have = new Set(target.cells.map(([x, z]) => x + "," + z));
      const add = cells.filter(([x, z]) => !have.has(x + "," + z));
      if (!add.length) return false;
      target.cells = target.cells.concat(add);
    } else {
      const m = newMarker("area", floor, { cells });
      markers.push(m);
      selected = m.id;
    }
  });
}

// ------------------------------------------------------------------------------------------------ the edit panel
function select(id) { selected = id; refresh(); }

// A click in the panel after typing in one of its fields: the press moves the focus, the field's change commits and
// re-renders the panel, and the release lands on a new button, so the click is lost (the first Close, a chip, a
// stepper, Delete). While a press is held in the panel, its re-render for the same marker waits until the click is
// through.
let panelHeld = false, panelStale = false, panelShows = null;
function hookPanel() {
  $("panel").addEventListener("pointerdown", () => { panelHeld = true; }, true);
  const release = () => {
    if (!panelHeld) return;
    setTimeout(() => {   // after the click (dispatched with the release, in the same task)
      panelHeld = false;
      if (panelStale) { panelStale = false; renderPanel(); }
    }, 0);
  };
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
}

function renderPanel() {
  const panel = $("panel");
  const m = byId(selected);
  if (panelHeld && m && m.id === panelShows && tool !== "dest" && !panel.hidden) { panelStale = true; return; }
  panelShows = m && tool !== "dest" ? m.id : null;
  // while a destination is picked the panel steps aside (on a phone it would cover half the map)
  if (!m || tool === "dest") { panel.hidden = true; panel.textContent = ""; return; }
  panel.hidden = false;
  panel.textContent = "";
  const k = ui(m), editable = canEdit(m);
  panel.append(el("h3", {}, dotNode(m.kind in KIND_UI ? m.kind : "?", "mk head"), KIND_UI[m.kind] ? t("kind." + m.kind) : m.kind, el("span", { class: "id" }, "#" + m.id)));
  if (!(m.kind in KIND_UI)) panel.append(el("div", { class: "note" }, t("unknownKind")));
  else if (m.locked) panel.append(el("div", { class: "note" }, "🔒 " + t("locked")));
  const where = ML.where(m);
  if (where) panel.append(el("div", { class: "id" }, `x ${where[0]} · z ${where[1]}` + (m.cells ? " · " + t("cells", m.cells.length) : m.points ? " · " + t("points", m.points.length) : "")));
  // floor
  panel.append(el("label", {}, t("field.floor")));
  const fs = el("select", { disabled: !editable });
  const counts = FL.floorCounts(markers);
  for (const f of tileMeta.floors) fs.append(el("option", { value: f }, floorOptionText(f, counts)));
  fs.value = m.floor;
  fs.addEventListener("change", () => commit(() => { byId(m.id).floor = fs.value; }));
  panel.append(fs);
  // a rope made two-way (goes and comes back) and back: the same marker, its kind swapped
  if (m.kind === "rope" || m.kind === "rope2") {
    const two = el("input", { type: "checkbox", disabled: !editable });
    two.checked = m.kind === "rope2";
    two.addEventListener("change", () => commit(() => { byId(m.id).kind = two.checked ? "rope2" : "rope"; }));
    panel.append(el("label", { class: "check" }, two, t("field.twoWay")));
  }
  if (leads(m.kind)) destSection(panel, m, editable);
  for (const [name, f] of Object.entries(k.fields)) {
    panel.append(el("label", {}, fieldWord(m.kind, name)));
    if (f.input === "schedule") { schedulePicker(panel, m, editable); continue; }
    if (f.input === "check") { panel.lastChild.remove(); checkField(panel, m, name, editable); continue; }
    if (f.input === "boss") { bossInput(panel, m, editable); continue; }
    const v = m.fields?.[name] ?? "";
    let input;
    if (f.input === "longtext") input = el("textarea", { maxlength: ML.MAX_TEXT, disabled: !editable });
    else if (f.input === "int") input = el("input", { type: "number", min: f.min, max: f.max, step: 1, inputmode: "numeric", disabled: !editable });
    else input = el("input", { type: "text", maxlength: f.input === "monster" ? 60 : 120, disabled: !editable, list: f.input === "monster" ? "monsterList" : null, autocomplete: "off" });
    input.value = v;
    input.addEventListener("change", () => commit(() => {
      const n = byId(m.id);
      let val = input.value.trim();
      if (f.input === "int") val = val === "" ? null : Math.max(f.min, Math.min(f.max, Math.round(+val) || 0));
      if (f.input === "monster") val = MONSTERS.find((x) => x.toLowerCase() === val.toLowerCase()) || val;
      if ((n.fields[name] ?? null) === (val === "" ? null : val)) return false;
      if (val === "" || val == null) delete n.fields[name]; else n.fields[name] = val;
    }));
    panel.append(input);
  }
  if (STAFF) {
    const box = el("input", { type: "checkbox" });
    box.checked = !!m.locked;
    box.addEventListener("change", () => commit(() => { byId(m.id).locked = box.checked; }));
    panel.append(el("label", { class: "check" }, box, t("lock")));
  }
  panel.append(el("div", { class: "row" },
    el("button", { type: "button", class: "danger", disabled: !editable && !(STAFF && m.kind in KIND_UI), onclick: deleteSelected }, t("del")),
    el("button", { type: "button", "data-act": "close", onclick: () => select(null) }, t("close"))));
}

// a yes/no field (a teleport-like object's combat lock): a checkbox, 1 when ticked, no field when not
function checkField(panel, m, name, editable) {
  const box = el("input", { type: "checkbox", disabled: !editable });
  box.checked = !!m.fields?.[name];
  box.addEventListener("change", () => commit(() => {
    const n = byId(m.id);
    if (box.checked) n.fields[name] = 1; else delete n.fields[name];
  }));
  panel.append(el("label", { class: "check", title: t("combatHelp") }, box, "⚔ " + fieldWord(m.kind, name)));
}

// ---- a boss's or an NPC's schedule: a picker (always / every real hour at a minute / a game-time window), stored as
// schedule.js's compact code; a free text from an older link shows as "Custom: ..." until the picker replaces it
const pad2 = (n) => String(n).padStart(2, "0");
let pickerFor = null;   // the marker whose free-text schedule is being replaced with the picker
const GAME_DEFAULT = { boss: "g01-04", npc: "g06-18" };   // the game window a click on "Game time" starts from

function setSchedule(id, code) {
  commit(() => {
    const n = byId(id);
    if (!canEdit(n) || (n.fields.schedule ?? "") === code) return false;
    if (code) n.fields.schedule = code; else delete n.fields.schedule;
  });
}

function schedulePicker(panel, m, editable) {
  const code = m.fields?.schedule ?? "", p = parseSchedule(code);
  const box = el("div", { class: "sched-pick" });
  panel.append(box);
  if (p.mode === "custom" && pickerFor !== m.id) {
    box.append(el("div", { class: "note" }, t("sched.custom", p.text)));
    if (editable) box.append(el("div", { class: "row tight" }, el("button", { type: "button", onclick: () => { pickerFor = m.id; renderPanel(); } }, t("sched.usePicker"))));
    return;
  }
  const starts = {
    always: "",
    hour: p.mode === "hour" ? code : "h00",
    game: p.mode === "game" ? code : GAME_DEFAULT[m.kind] || "g06-18",
  };
  const seg = el("div", { class: "seg", role: "group", "aria-label": fieldWord(m.kind, "schedule") });
  for (const mode of ["always", "hour", "game"]) {
    seg.append(el("button", { type: "button", class: p.mode === mode ? "on" : "", "aria-pressed": String(p.mode === mode), disabled: !editable,
      onclick: () => setSchedule(m.id, starts[mode]) }, t("sched." + mode)));
  }
  box.append(seg);
  if (p.mode === "hour") {
    const min = el("input", { type: "number", min: 0, max: 59, step: 1, inputmode: "numeric", disabled: !editable, "aria-label": t("sched.atMinute") });
    min.value = pad2(p.minute);
    min.addEventListener("change", () => setSchedule(m.id, scheduleCode({ mode: "hour", minute: min.value })));
    box.append(el("div", { class: "sched-row" }, el("span", {}, t("sched.atMinute")), min));
  }
  if (p.mode === "game") {
    const hourSelect = (v, word) => {
      const s = el("select", { disabled: !editable, "aria-label": word });
      for (let h = 0; h < 24; h++) s.append(el("option", { value: h }, pad2(h) + "h"));
      s.value = String(v);
      return s;
    };
    const from = hourSelect(p.from, t("sched.from")), to = hourSelect(p.to, t("sched.to"));
    const pick = () => setSchedule(m.id, scheduleCode({ mode: "game", from: from.value, to: to.value }));
    from.addEventListener("change", pick);
    to.addEventListener("change", pick);
    box.append(el("div", { class: "sched-row" }, el("span", {}, t("sched.from")), from, el("span", {}, t("sched.to")), to));
    box.append(el("div", { class: "sched-row" },
      el("button", { type: "button", class: code === "g06-18" ? "on" : "", disabled: !editable, onclick: () => setSchedule(m.id, "g06-18") }, t("sched.day")),
      el("button", { type: "button", class: code === "g18-06" ? "on" : "", disabled: !editable, onclick: () => setSchedule(m.id, "g18-06") }, t("sched.night"))));
  }
  // the live preview: what the label and the change list will say
  box.append(el("div", { class: "sched-preview" }, "🕑 " + scheduleText(code, t)));
  if (p.mode === "game") box.append(el("div", { class: "id" }, t("sched.gameHint")));
}

// a boss's name: the game's bosses as suggestions (bosses.js), or any other name typed freely; a listed boss with one
// fixed window fills the schedule in (still editable), unless a schedule of another kind was set by hand
function bossInput(panel, m, editable) {
  const input = el("input", { type: "text", maxlength: 60, disabled: !editable, list: "bossList", autocomplete: "off", placeholder: t("bossPlaceholder") });
  input.value = m.fields?.monster ?? "";
  input.addEventListener("change", () => {
    const typed = input.value.trim(), known = bossOf(typed);
    const val = known ? known.name : typed;
    let filled = null;
    commit(() => {
      const n = byId(m.id);
      const was = n.fields.monster ?? "";
      if (was === val) return false;
      if (val) n.fields.monster = val; else delete n.fields.monster;
      const old = n.fields.schedule ?? "", before = bossOf(was)?.schedule ?? "";
      if (known?.schedule && (old === "" || old === before)) { n.fields.schedule = known.schedule; filled = known.name; }
    });
    if (filled) toast(t("sched.prefilled", filled));
  });
  panel.append(input, el("div", { class: "id" }, t("bossHint")));
}

// a rope's, hole's or portal's destination: set it by a tap, change its floor, show it, remove it
function destSection(panel, m, editable) {
  panel.append(el("label", {}, t("field.dest")));
  const d = m.dest;
  if (!d) {
    panel.append(el("div", { class: "id" }, t("destNone")));
    if (editable) panel.append(el("div", { class: "row tight" }, el("button", { type: "button", class: "primary", onclick: () => startDestPick(m.id) }, t("setDest"))));
    return;
  }
  panel.append(el("div", { class: "dest" }, dotNode(m.kind), spotText(d)));
  const fs = el("select", { disabled: !editable, "aria-label": t("field.destFloor") });
  for (const f of tileMeta.floors) fs.append(el("option", { value: f }, floorLabel(f)));
  fs.value = d.floor;
  fs.addEventListener("change", () => setDest(m.id, d.x, d.z, fs.value));
  panel.append(el("label", {}, t("field.destFloor")), fs);
  panel.append(el("div", { class: "row tight" },
    editable ? el("button", { type: "button", onclick: () => startDestPick(m.id) }, t("changeDest")) : null,
    el("button", { type: "button", onclick: () => showDest(d) }, t("view")),
    editable ? el("button", { type: "button", onclick: () => commit(() => { delete byId(m.id).dest; }) }, t("removeDest")) : null));
}

// bring a destination into view: centre the panes on it, and when no pane shows its floor, switch the last one to it
function showDest(d) {
  if (!panes.some((p) => p.floor === d.floor)) setFloor(panes[panes.length - 1], d.floor);
  panes[0].map.setView(ll(d.x, d.z), Math.max(panes[0].map.getZoom(), 2));
  refresh();
}

function deleteSelected() {
  const m = byId(selected);
  if (!m || (m.locked && !STAFF)) return;
  commit(() => { markers = markers.filter((x) => x.id !== m.id); selected = null; });
}

// ------------------------------------------------------------------------------------------------ save and changes
function changeLines(state) {
  const lines = [];
  const at = (m) => {
    const w = ML.where(m);
    return (w ? `x ${w[0]}, z ${w[1]}` : "?") + ` (${floorShort(m.floor)})` + (m.dest ? ` ${arrowOf(m)} ${spotText(m.dest)}` : "");
  };
  const what = (m) => {
    const name = KIND_UI[m.kind] ? t("kind." + m.kind) : m.kind;
    const f = m.fields || {};
    if (m.kind === "spawn") return `${name} ${f.monster || "?"}${f.count ? " ×" + f.count : ""}${f.radius ? " r" + f.radius : ""}`;
    if (m.kind === "boss" || m.kind === "npc") {
      const who = m.kind === "boss" ? f.monster : f.name;
      return name + (who ? ` "${who}"` : "") + (f.schedule ? ` (🕑 ${scheduleText(f.schedule, t)})` : "") + (f.label ? ` "${f.label}"` : "");
    }
    const extra = (m.cells ? " " + t("cells", m.cells.length) : m.points ? " " + t("points", m.points.length) : "")
      + (f.combat ? " ⚔ " + t("combatOn") : "");
    const text = f.label || f.text;
    return name + extra + (text ? ` "${text}"` : "");
  };
  for (const c of ML.changes(state)) {
    const id = "#" + c.id;
    const kind = KIND_UI[c.kind] ? t("kind." + c.kind) : c.kind;
    if (c.op === "added") lines.push(`+ ${id} ${t("added")}: ${what(c.marker)} ${t("at")} ${at(c.marker)}`);
    else if (c.op === "removed") lines.push(`- ${id} ${t("removed")}: ${what(c.marker)} ${t("at")} ${at(c.marker)}`);
    else if (c.op === "kind") {   // a rope made two-way, or back
      const word = (k) => (KIND_UI[k] ? t("kind." + k) : k);
      lines.push(`~ ${id} ${word(c.from)} ${t("kindChanged")} ${word(c.to)}`);
    }
    else if (c.op === "moved") {
      const p = (w, f) => (w ? `x ${w[0]}, z ${w[1]}` : "?") + (c.floor_from !== c.floor_to ? ` (${floorShort(f)})` : "");
      const size = c.size_from != null ? `, ${c.size_from} → ${c.size_to}` : "";
      lines.push(`~ ${id} ${kind} ${t("moved")}: ${p(c.from, c.floor_from)} → ${p(c.to, c.floor_to)}${size}`);
    } else if (c.op === "dest") {
      if (!c.from) lines.push(`~ ${id} ${kind} ${t("destSet")}: ${spotText(c.to)}`);
      else if (!c.to) lines.push(`~ ${id} ${kind} ${t("destRemoved")} (${t("was")} ${spotText(c.from)})`);
      else lines.push(`~ ${id} ${kind} ${t("destMoved")}: ${spotText(c.from)} → ${spotText(c.to)}`);
    } else if (c.op === "edited") {
      // a schedule in words (its compact form is for the link only)
      const v = (x) => (c.field === "schedule" ? scheduleText(x ?? "", t) : x == null ? "∅" : typeof x === "string" ? `"${x}"` : x);
      if (c.field === "combat") lines.push(`~ ${id} ${kind}: ⚔ ${t(c.new ? "combatOn" : "combatOff")}`);
      else lines.push(`~ ${id} ${kind} ${t("edited")}: ${fieldWord(c.kind, c.field)}: ${v(c.old)} → ${v(c.new)}`);
    } else lines.push(`~ ${id} ${kind} ${t(c.op + "Op")}`);
  }
  return lines;
}

function summaryText(lines, max = 12) {
  const head = lines.length > 1 ? t("changesN", lines.length) : lines.length ? t("changes1") : t("noChanges");
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(t("more", lines.length - max));
  return [head, ...shown].join("\n");
}

function linkFor(frag) {
  const q = new URLSearchParams(location.search);
  q.delete("staff");
  q.delete("title");   // the saved link carries its title in the fragment (or none, if it was cleared)
  const qs = q.toString();
  return location.origin + location.pathname + (qs ? "?" + qs : "") + "#" + frag;
}

async function save() {
  finishRoute();
  const state = ML.saveState(opened, clone(markers), currentView(), tileVersion, nextId, mapTitle);
  const frag = await ML.encode(state);
  const url = linkFor(frag);
  // the address bar: the saved link, ?staff kept, ?title dropped (the fragment holds the title now)
  const here = new URLSearchParams(location.search);
  here.delete("title");
  history.replaceState(null, "", location.pathname + (here.toString() ? "?" + here : "") + "#" + frag);
  const lines = changeLines(await ML.decode(frag));
  const message = summaryText(lines) + "\n" + url;
  const d = $("dialog");
  d.textContent = "";
  const pre = el("pre", {}, message);
  d.append(el("h2", {}, t("saveTitle")), el("p", {}, t("saveHelp")), pre);
  if (message.length > 1900) d.append(el("p", { class: "warn" }, t("long", message.length)));
  d.append(el("div", { class: "row" },
    el("button", { type: "button", onclick: () => copy(url, true) }, t("copyLink")),
    el("button", { type: "button", class: "primary", onclick: () => copy(message, true) }, t("copyAll")),
    el("button", { type: "button", onclick: () => d.close() }, t("close"))));
  d.showModal();
}

function showChanges(lines) {
  const d = $("dialog");
  d.textContent = "";
  d.append(el("h2", {}, summaryText(lines, 999).split("\n")[0]), el("pre", {}, lines.join("\n")),
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => d.close() }, t("close"))));
  d.showModal();
}

async function copy(text, quiet) {
  try { await navigator.clipboard.writeText(text); toast(t("copied", quiet ? "" : text)); }
  catch { toast(t("copyFail")); }
}

let toastTimer;
function toast(text) {
  const box = $("toast");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), 2600);
}

function banner(text, cls, button) {
  const b = $("banner");
  b.textContent = text;
  b.className = cls || "";
  if (button) b.append(button);
  b.hidden = false;
}

// ------------------------------------------------------------------------------------------------ start
function buildBar() {
  const tools = $("tools");
  for (const name of TOOLS) {
    const word = name === "legend" ? t("legend") : t("tool." + name);
    const attrs = { type: "button", class: "tool" + (name === "legend" ? " icon" : ""), "data-tool": name, title: word,
      "aria-label": word, onclick: () => setTool(name) };
    if (name === "things") {   // the map things' menu: its button shows the chosen one's marker
      Object.assign(attrs, { title: t("thingsTitle"), "aria-haspopup": "menu", "aria-expanded": "false", onclick: toggleThings });
      tools.append(el("button", attrs, glyphNode("things"), el("span", { class: "txt" }, " " + word), el("span", { class: "caret" }, "▾")));
      continue;
    }
    tools.append(el("button", attrs, glyphNode(name), el("span", { class: "txt" }, " " + word)));
  }
  buildThingsMenu();
  const label = (id, glyph, word) => {
    $(id).append(el("span", { class: "glyph" }, glyph), el("span", { class: "txt" }, " " + word));
    $(id).title = word;
  };
  label("undo", "↶", t("undo"));
  label("redo", "↷", t("redo"));
  $("save").textContent = t("save");
  $("undo").onclick = undo;
  $("redo").onclick = redo;
  $("save").onclick = save;
  $("panesLabel").textContent = t("panes");
  // the map's title: typed in the header; one undo step per change. Made here, not in index.html, so a cached older
  // index.html with this script still works.
  const tb = el("input", { id: "mapTitle", type: "text", autocomplete: "off", spellcheck: "false" });
  $("settings").before(tb);
  tb.placeholder = t("mapTitle");
  tb.title = t("mapTitle");
  tb.setAttribute("aria-label", t("mapTitle"));
  tb.maxLength = ML.MAX_TITLE;
  tb.addEventListener("input", () => { document.title = ML.cleanTitle(tb.value) ? t("titleWith", ML.cleanTitle(tb.value)) : t("title"); });
  tb.addEventListener("change", () => {
    const v = ML.cleanTitle(tb.value);
    if (v === mapTitle) { tb.value = mapTitle; return; }
    commit(() => { mapTitle = v; });
    showTitle();
  });
  tb.addEventListener("keydown", (e) => { if (e.key === "Enter") tb.blur(); });
  const ls = $("lang");
  for (const l of LANGS) ls.append(el("option", { value: l }, { pt: "Português", en: "English", es: "Español", zh: "中文" }[l]));
  ls.value = lang;
  ls.onchange = () => {
    const q = new URLSearchParams(location.search);
    q.set("lang", ls.value);
    location.search = q.toString();   // the #fragment stays
  };
  $("panes").onchange = () => setPaneCount(+$("panes").value);
  const dl = $("monsterList");
  for (const m of [...MONSTERS].sort()) dl.append(el("option", { value: m }));   // the list itself is append only
  // the bosses' names for the boss marker (made here, not in index.html: a cached older index.html still works)
  document.body.append(el("datalist", { id: "bossList" }, BOSSES.map(([name]) => el("option", { value: name }))));
  document.addEventListener("keydown", (e) => {
    // Escape in a select (the floors, the panes) leaves it, then works as it does on the map
    if (e.key === "Escape" && e.target.closest("select")) e.target.blur();
    else if (e.target.closest("input, textarea, select")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    else if (e.key === "Enter" && tool === "route") finishRoute();
    else if (!mod && (e.key === "PageUp" || e.key === "]")) { e.preventDefault(); stepFloor(activePane || panes[0], -1); }
    else if (!mod && (e.key === "PageDown" || e.key === "[")) { e.preventDefault(); stepFloor(activePane || panes[0], 1); }
    else if (e.key === "Escape" && closeThings()) return;
    else if (e.key === "Escape" && tool === "dest") endDestPick();
    else if (e.key === "Escape") { draftRoute = null; selected = null; if (tool !== "select") setTool("select"); else refresh(); }
  });
  window.addEventListener("hashchange", () => location.reload());
  hookPanel();
}

async function start() {
  buildBar();
  tileIndex = await (await fetch("tiles/index.json")).json();
  let state = null;
  if (location.hash.length > 1) {
    try { state = await ML.decode(location.hash); }
    catch (e) { banner(t("badLink", e.message), "error"); }
  }
  tileVersion = tileIndex.latest;
  if (state && state.tiles && tileIndex.sets[state.tiles]) tileVersion = state.tiles;
  else if (state && state.tiles) banner(t("oldTiles", state.tiles));
  tileMeta = await (await fetch(`tiles/${tileVersion}/meta.json`)).json();
  let view = { x: 0, z: 0, zoom: -1, floors: ["s"] };
  if (state) {
    // a player's Save always compares with the link staff sent (rebuilt from the saved link's own change list, so a
    // reload after a Save loses nothing); staff (?staff=1) start a new round from the link as it is
    opened = STAFF ? state : ML.baselineOf(state);
    markers = clone(state.markers);
    nextId = state.next;
    view = state.view;
    const known = (f) => tileMeta.floors.includes(f);
    view.floors = (view.floors.length ? view.floors : ["s"]).map((f) => (known(f) ? f : "s"));
    // a saved pane on a floor with no markers opens on the busiest floor not shown (the view only: the link is as it was)
    view.floors = FL.openingFloors(view.floors, FL.floorCounts(markers), markers.filter((m) => m.dest).map((m) => m.dest.floor));
    const lines = changeLines(state);
    if (lines.length) banner(t("linkChanges", lines.length), "", el("button", { type: "button", onclick: () => showChanges(lines) }, t("view")));
  }
  // the title: the link's own, else ?title= (someone's text either way: cleaned, shown as text only)
  mapTitle = state?.title || ML.cleanTitle(new URLSearchParams(location.search).get("title"));
  showTitle();
  $("panes").value = String(view.floors.length);
  buildPanes(view.floors, view);
  // read-only hooks for the page's browser tests
  Object.defineProperty(window, "__panes", { get: () => panes });   // the panes now (side by side rebuilds them)
  window.__state = () => ({ markers: clone(markers), nextId, selected, tool, destFor });
  window.addEventListener("resize", drawLinksSoon);
}

start();
