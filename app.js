// The map page: Leaflet over the game's map tiles, a marker editor, the state in the URL #fragment (maplink.js).
// Everything a link carries was typed by someone: text goes into the page with textContent only, never as HTML.
import * as ML from "./maplink.js";
import * as FL from "./floors.js";
import * as GT from "./goto.js";
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
// the map things: on a phone one menu ("Objects", the ＋), each kind with its icon, name and one line; on a computer
// listed in the tool rail (the two-way rope from a rope's panel)
const THINGS = ["rope", "rope2", "lever", "hole", "door", "portal", "elevator", "npc"];
// the tool rail, top to bottom ("|" a group line); on a phone the bar at the bottom holds PHONE_TOOLS, the rest in "More"
const RAIL = ["select", "spawn", "boss", "poi", "area", "route", "note", "|", "rope", "hole", "portal", "door", "lever", "elevator", "npc", "|", "legend"];
const PHONE_TOOLS = ["select", "spawn", "things", "note", "more"];
const MORE_TOOLS = ["boss", "poi", "area", "route", "legend"];
// labels on the map: auto (on hover, the selected marker, areas, and every name from this zoom in), always, never
// (on hover only)
const LABEL_ZOOM = 4;
const LINK_WARN = 1800, LINK_MAX = 2000;   // Discord's message limit: the link's size, live, warns from LINK_WARN
const PHONE = matchMedia("(max-width: 720px)");   // style.css's phone layout
// a field's word in the panel and the change list: its own (a boss's or an NPC's label) or the field's
const fieldWord = (kind, name) => t(KIND_UI[kind]?.fields?.[name]?.word || "field." + name);
// a two-way rope: an arrow both ways
const arrowOf = (m) => (m.kind === "rope2" ? "↔" : "→");
const GLYPH = { select: "☝", legend: "?", things: "＋", more: "⋯", ...Object.fromEntries(Object.entries(KIND_UI).map(([k, v]) => [k, v.glyph])) };
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
let mode = "edit";   // "edit" or "review" (review: look only; what changed comes next round)
let lastCell = null;   // {x, z, floor}: the cell under the cursor (or the last tap): the status bar copies its /pos
let focusPane = null;   // the pane the floors card and Go to change: the last one clicked (else the first)
// a viewer's own settings (this browser only, never in a link): the labels mode, the floors card folded
const pref = {
  get(k, def) { try { return localStorage.getItem("opengea.map." + k) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem("opengea.map." + k, v); } catch { /* private window: this visit only */ } },
};
let labelsMode = ["auto", "always", "never"].includes(pref.get("labels")) ? pref.get("labels") : "auto";
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
  focusPane = null;
  const box = $("panesBox");
  box.textContent = "";
  floors.forEach((floor, i) => {
    const select = el("select", { "aria-label": t("field.floor") });
    const counts = FL.floorCounts(markers);
    for (const f of tileMeta.floors) select.append(el("option", { value: f }, floorOptionText(f, counts)));
    select.value = floor;
    const mapEl = el("div", { class: "map" });
    // the floor above / below (the next one with map in view), the view kept where it is
    const up = el("button", { type: "button", class: "fnav", title: t("floorUp") + " (PageUp, ])", "aria-label": t("floorUp") }, "▲");
    const down = el("button", { type: "button", class: "fnav", title: t("floorDown") + " (PageDown, [)", "aria-label": t("floorDown") }, "▼");
    const head = el("div", { class: "pane-head" }, select, up, down);
    const paneEl = el("div", { class: "pane" }, head, mapEl);
    box.append(paneEl);
    const map = L.map(mapEl, { crs: CRS, minZoom: -2, maxZoom: 5, zoomSnap: 1, attributionControl: false,
      zoomControl: i === 0, doubleClickZoom: false, maxBounds: L.latLngBounds(tileMeta.bounds).pad(0.3), maxBoundsViscosity: 0.8 });
    const p = { floor, map, el: mapEl, head, select, up, down, base: null, under: null, layer: L.layerGroup().addTo(map), draft: L.layerGroup().addTo(map) };
    panes.push(p);
    setFloor(p, floor);
    select.addEventListener("change", () => { setFloor(p, select.value); refresh(); });
    up.addEventListener("click", (e) => stepFloor(p, -1, e.shiftKey));
    down.addEventListener("click", (e) => stepFloor(p, 1, e.shiftKey));
    mapEl.addEventListener("pointerenter", () => { activePane = p; });
    paneEl.addEventListener("pointerdown", () => { activePane = p; if (focusPane !== p) { focusPane = p; paintFloorCard(); } });
    map.on("moveend", () => { paintFloorNav(p); measureLinkSoon(); });
    map.setView(ll(view.x, view.z), view.zoom, { animate: false });
    map.on("move", () => { sync(p); drawLinksSoon(); });
    map.on("zoomend resize", drawLinksSoon);
    // auto labels: every name from LABEL_ZOOM in, an area's when it is wide enough on screen
    map.on("zoomend", () => { if (labelsMode === "auto") drawPane(p); });
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
  paintPaneCount();
  applyTool();
  refresh();
}

// the pane the floors card and Go to act on
const targetPane = () => (panes.includes(focusPane) ? focusPane : panes[0]);

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

// ---- floor up / down, by height (the surface between floor 0 and floor 1): the next floor that matters (markers, or
// the end of a rope, hole, portal or elevator of this map), else the next with map in the pane's view; Shift: every
// floor with map in view (Setzer, 11-25: the game's floors don't follow a neat order, the arrows follow the ones that
// matter). The view stays where it is unless the floor has nothing in view: then its markers come into view.
let activePane = null;   // the pane the shortcuts move: the last one pointed at

// the floors that matter on this map
function floorsThatMatter() {
  const out = new Set(markers.map((m) => m.floor));
  for (const m of markers) if (m.dest) out.add(m.dest.floor);
  return [...out];
}

// dir -1: the floor above, +1: the floor below; null when there is none (the rule: floors.js stepFloor)
function nextFloor(p, dir, every = false) {
  return FL.stepFloor(tileMeta.floors, tileMeta.tiles, p.floor, dir, viewCorners(p), floorsThatMatter(), every);
}
// a pane's view corners in zoom-0 pixels
function viewCorners(p) {
  const b = p.map.getBounds();
  const a = p.map.project(b.getNorthWest(), 0), c = p.map.project(b.getSouthEast(), 0);
  return [a.x, a.y, c.x, c.y];
}

function stepFloor(p, dir, every = false) {
  const f = p && nextFloor(p, dir, every);
  if (!f) return;
  focusPane = p;
  const have = new Set(tileMeta.tiles[f]?.["0"] || []);
  showFloor(f, FL.tilesInView(viewCorners(p)).some((k) => have.has(k)));   // map here: the view stays
}

// the arrows: off at the end, and their tooltip names where they go (and how many markers it holds)
function paintFloorNav(p) {
  if (!p.up || !tileMeta) return;
  try { p.map.getCenter(); } catch { return; }   // no view yet (a pane being built): its first moveend paints it
  const counts = FL.floorCounts(markers);
  for (const [b, dir, word, keys] of [[p.up, -1, "floorUp", "PageUp, ]"], [p.down, 1, "floorDown", "PageDown, ["]]) {
    const f = nextFloor(p, dir);
    b.disabled = !f;
    b.title = f ? `${t(word)}: ${floorOptionText(f, counts)} (${keys}; ${t("floorShift")})` : t(word);
  }
}

// the bottom bar names the floor the pane now shows (the cursor may not have moved)
function showCoordsFloor(p) {
  if (lastCell) showCell(lastCell.x, lastCell.z, p.floor);
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
  showCell(x, z, p.floor);
}
// the status bar's cell (a click on it copies its /pos line)
function showCell(x, z, floor) {
  lastCell = { x, z, floor };
  $("cur").textContent = `x ${x} · z ${z} · ${floorShort(floor)}`;
  $("cur").disabled = false;
}

// ------------------------------------------------------------------------------------------------ drawing
function tip(layer, text, opts = {}) {
  if (!text) return;
  const span = text instanceof Node ? text : el("span", {}, text);   // text nodes: whatever the link holds stays text
  layer.bindTooltip(span, { permanent: true, direction: "top", className: "lbl", offset: [0, -14], ...opts });
}

// a marker's name on the map all the time, or on hover only (the labels mode: auto, always, never)
function labelShown(p, m) {
  if (labelsMode === "always") return true;
  if (labelsMode === "never") return false;
  return m.id === selected || p.map.getZoom() >= LABEL_ZOOM || (!!m.cells && areaWide(p, m));
}
// an area wide enough on screen to carry its name (auto labels: a big zone named, a small entrance on hover)
function areaWide(p, m) {
  let x0 = Infinity, x1 = -Infinity;
  for (const [x] of m.cells) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return (x1 - x0 + 1) * 2 ** p.map.getZoom() >= 120;
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
    html: `<div class="${cls}" style="background:${k.color};--ring:${k.color}">${m.locked ? "🔒" : k.svg || k.glyph}${m.fields?.combat ? '<span class="badge cb">⚔</span>' : ""}${countBadge(m)}</div>` });
}
// a spawn of more than one monster: ×N on its corner (a number only: nothing typed goes into this HTML)
function countBadge(m) {
  const n = m.kind === "spawn" ? Math.round(+m.fields?.count) : 0;
  return n > 1 && n < 1000 ? `<span class="badge n">×${n}</span>` : "";
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

const canEdit = (m) => m && mode === "edit" && !m.locked && m.kind in KIND_UI;

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
    const permanent = labelShown(p, m);
    if (m.kind === "boss" || m.kind === "npc") tip(mk, whoWhen(m), { permanent, ...(BIG[m.kind] ? { offset: [0, -18] } : {}) });
    else tip(mk, m.kind === "rope2" ? ("↔ " + text).trim() : text, { permanent });   // a two-way rope: ↔ always
    mk.addTo(p.layer);
    return;
  }
  if (m.cells) {
    const style = { color: k.color, weight: 0, fillOpacity: sel ? 0.45 : 0.3, interactive: tool === "select" };
    const poly = L.polygon(rings(m.cells), style).on("click", pick).addTo(p.layer);
    L.polyline(outline(m.cells), { color: sel ? "#ffe066" : k.color, weight: sel ? 3 : 2, dashArray: m.locked ? "4 4" : null, interactive: false }).addTo(p.layer);
    const c = ML.where(m);
    if (c && labelOf(m) && labelShown(p, m)) {
      const anchor = L.marker(ll(c[0], c[1]), { icon: L.divIcon({ className: "", iconSize: [0, 0] }), interactive: false }).addTo(p.layer);
      tip(anchor, (m.locked ? "🔒 " : "") + labelOf(m), { offset: [0, 0], direction: "center" });
    } else if (labelOf(m)) tip(poly, (m.locked ? "🔒 " : "") + labelOf(m), { permanent: false, sticky: true, offset: [0, -10] });
    if (sel && canEdit(m)) moveHandle(p, m);
    return poly;
  }
  if (m.points) {
    const line = L.polyline(m.points.map(([x, z]) => ll(x, z)), { color: sel ? "#ffe066" : k.color, weight: sel ? 5 : 4,
      dashArray: m.locked ? "6 6" : null, interactive: tool === "select" }).on("click", pick).addTo(p.layer);
    const [x1, z1] = m.points[m.points.length - 1];
    L.circleMarker(ll(m.points[0][0], m.points[0][1]), { radius: 5, color: "#fff", fillColor: k.color, fillOpacity: 1, weight: 2, interactive: false }).addTo(p.layer);
    L.circleMarker(ll(x1, z1), { radius: 7, color: "#fff", fillColor: k.color, fillOpacity: 1, weight: 2, interactive: false }).addTo(p.layer);
    if (labelOf(m)) tip(line, (m.locked ? "🔒 " : "") + labelOf(m), { direction: "center", offset: [0, 0], permanent: labelShown(p, m), sticky: !labelShown(p, m) });
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
  paintFloorCard();
  for (const p of panes) paintFloorNav(p);
  paintCount();
  for (const id of ["undo", "undoM"]) if ($(id)) $(id).disabled = !undoStack.length || mode !== "edit";
  for (const id of ["redo", "redoM"]) if ($(id)) $(id).disabled = !redoStack.length || mode !== "edit";
  renderPanel();
  measureLinkSoon();
}

// ------------------------------------------------------------------------------------------------ tools
function applyTool() {
  paintTools();
  refresh();
}

// the bar, the sub-bar and the maps' cursor for the tool (no redraw of the markers)
function paintTools() {
  const thing = activeThing();
  const now = tool === "dest" ? byId(destFor)?.kind : tool;
  // the rail: the tool in use (a rope's destination being picked: the rope; a two-way rope: the rope's button)
  for (const b of document.querySelectorAll("[data-tool]")) {
    const on = b.dataset.tool === now || (now === "rope2" && b.dataset.tool === "rope")
      || (b.dataset.tool === "things" && !!thing) || (b.dataset.tool === "more" && MORE_TOOLS.includes(now));
    b.classList.toggle("on", on);
    if (b.closest("#tools")) b.setAttribute("aria-pressed", String(on));
  }
  // the phone's Objects button wears the chosen thing's marker while it is in use
  const tb = document.querySelector("#tools [data-tool=things]");
  if (tb) tb.firstChild.replaceWith(thing ? dotNode(thing, "glyph mk mini") : glyphNode("things", "glyph mk mini plain"));
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
  sub.hidden = !sub.childNodes.length;
}

function setTool(name) {
  closeMenus();
  if (name === "legend") { showLegend(); return; }
  if (name === "things") { toggleThings(); return; }
  if (name === "more") { toggleMenu("moreMenu"); return; }
  if (mode !== "edit" && name !== "select") { toast(t("reviewNoEdit")); return; }
  if (tool === "route" && name !== "route") finishRoute();
  destFor = null;
  tool = name;
  // on a phone a drawing tool closes the panel of anything it doesn't work on (the drawer covers half the map); on a
  // computer the docked panel stays (closing and reopening it on every placement would shift the map each time)
  const sel = byId(selected);
  if (name !== "select" && PHONE.matches && !(sel && sel.kind === name && (name === "area" || name === "route"))) selected = null;
  applyTool();
  if (name === "area") toast(t("hintArea"));
  else if (name === "route") toast(t("hintRoute"));
  else if (name !== "select") toast(`${t("kind." + name)}: ${t("hintPlace")}`);
}

// ---- the phone's menus: the map things (rope .. NPC: icon, name, one line each) and "More" (the other tools, labels,
// floors side by side, review, redo, language, open a file)
const menuRow = (kind, word, help, onclick, attrs = {}) => el("button", { type: "button", role: "menuitem", onclick, ...attrs },
  dotNode(kind, "mk"), el("div", {}, el("b", {}, word), help ? el("span", {}, help) : null));

function buildMenus() {
  const things = el("div", { id: "thingsMenu", class: "menu", role: "menu", hidden: true });
  for (const kind of THINGS) things.append(menuRow(kind, t("kind." + kind), t("help." + kind), () => { closeMenus(); setTool(kind); }, { "data-kind": kind }));
  const more = el("div", { id: "moreMenu", class: "menu", role: "menu", hidden: true });
  for (const name of MORE_TOOLS) {
    const word = name === "legend" ? t("legend") : t("tool." + name);
    more.append(menuRow(name, word, name === "legend" ? t("legendTitle") : t("help." + name), () => { closeMenus(); setTool(name); }, { "data-tool": name }));
  }
  more.append(el("div", { class: "menu-sets" },
    el("div", { class: "set" }, el("span", {}, t("labels")), labelsSeg()),
    el("div", { class: "set" }, el("span", {}, t("sideBySide")), panesSeg()),
    el("div", { class: "set" }, el("span", {}, t("modeWord")), modeSeg()),
    el("div", { class: "set" },
      el("button", { type: "button", id: "redoM", onclick: () => { closeMenus(); redo(); } }, "↷ " + t("redo")),
      el("button", { type: "button", onclick: () => { closeMenus(); openFile(); } }, "📂 " + t("openFile"))),
    el("div", { class: "set" }, el("span", {}, t("lang")), langSelect())));
  document.body.append(things, more);
  // a tap anywhere else closes them
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".menu, [data-tool=things], [data-tool=more]")) closeMenus();
  }, true);
  window.addEventListener("resize", closeMenus);
}

function toggleThings() {
  toggleMenu("thingsMenu");
  for (const b of $("thingsMenu").children) b.classList.toggle("on", b.dataset.kind === activeThing());
}

// a menu by its button: under it, or over it when the button is low on the screen (the phone's bottom bar); inside
// the screen (a phone: the whole width less a margin)
function toggleMenu(id) {
  const menu = $(id), btn = document.querySelector(`#tools [data-tool=${id === "moreMenu" ? "more" : "things"}]`);
  if (!menu.hidden) { closeMenus(); return; }
  closeMenus();
  menu.hidden = false;
  const r = btn.getBoundingClientRect(), w = Math.min(340, innerWidth - 16);
  menu.style.width = w + "px";
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  if (r.top > innerHeight / 2) { menu.style.top = ""; menu.style.bottom = innerHeight - r.top + 6 + "px"; }
  else { menu.style.bottom = ""; menu.style.top = r.bottom + 4 + "px"; }
  menu.style.maxHeight = (r.top > innerHeight / 2 ? r.top - 16 : innerHeight - r.bottom - 16) + "px";
  btn.setAttribute("aria-expanded", "true");
  (menu.querySelector(".on") || menu.querySelector("button")).focus();
}

function closeMenus() {
  let was = false;
  for (const id of ["thingsMenu", "moreMenu"]) {
    const menu = $(id);
    if (menu && !menu.hidden) { menu.hidden = true; was = true; }
  }
  for (const b of document.querySelectorAll("#tools [aria-expanded=true]")) b.setAttribute("aria-expanded", "false");
  return was;
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
    showCell(x, z, p.floor);
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
  // the head: what it is, its number, close; under it where it is and its /pos
  panel.append(el("div", { class: "hd" }, dotNode(m.kind in KIND_UI ? m.kind : "?", "mk head"),
    el("h3", {}, KIND_UI[m.kind] ? t("kind." + m.kind) : m.kind), el("span", { class: "id" }, "#" + m.id),
    el("button", { type: "button", class: "x", "data-act": "close", title: t("close") + " (Esc)", "aria-label": t("close"), onclick: () => select(null) }, "✕")));
  const where = ML.where(m);
  if (where) {
    panel.append(el("div", { class: "sub" },
      el("span", {}, `${floorShort(m.floor)} · x ${where[0]}, z ${where[1]}` + (m.cells ? " · " + t("cells", m.cells.length) : m.points ? " · " + t("points", m.points.length) : "")),
      el("button", { type: "button", class: "chip", onclick: () => copy(posLine(where[0], where[1], m.floor)) }, t("copyPos"))));
  }
  const body = el("div", { class: "body" });
  panel.append(body);
  if (!(m.kind in KIND_UI)) body.append(el("div", { class: "note" }, t("unknownKind")));
  else if (m.locked) body.append(el("div", { class: "note" }, "🔒 " + t("locked")));
  else if (mode !== "edit") body.append(el("div", { class: "note" }, t("reviewNoEdit")));
  // a rope made two-way (goes and comes back) and back: the same marker, its kind swapped
  if (m.kind === "rope" || m.kind === "rope2") {
    const two = el("input", { type: "checkbox", disabled: !editable });
    two.checked = m.kind === "rope2";
    two.addEventListener("change", () => commit(() => { byId(m.id).kind = two.checked ? "rope2" : "rope"; }));
    body.append(el("label", { class: "check" }, two, t("field.twoWay")));
  }
  if (leads(m.kind)) destSection(body, m, editable);
  if (m.kind === "spawn") spawnFields(body, m, editable);
  else for (const [name, f] of Object.entries(k.fields)) {
    body.append(el("label", {}, fieldWord(m.kind, name)));
    if (f.input === "schedule") { schedulePicker(body, m, editable); continue; }
    if (f.input === "check") { body.lastChild.remove(); checkField(body, m, name, editable); continue; }
    if (f.input === "boss") { bossInput(body, m, editable); continue; }
    const v = m.fields?.[name] ?? "";
    let input;
    if (f.input === "longtext") input = el("textarea", { maxlength: ML.MAX_TEXT, disabled: !editable });
    else input = el("input", { type: "text", maxlength: 120, disabled: !editable, autocomplete: "off" });
    input.value = v;
    input.addEventListener("change", () => setField(m.id, name, input.value.trim()));
    body.append(input);
  }
  // its floor (each with its markers' count)
  body.append(el("label", {}, t("field.floor")));
  const fs = el("select", { disabled: !editable });
  const counts = FL.floorCounts(markers);
  for (const f of tileMeta.floors) fs.append(el("option", { value: f }, floorOptionText(f, counts)));
  fs.value = m.floor;
  fs.addEventListener("change", () => commit(() => { byId(m.id).floor = fs.value; }));
  body.append(fs);
  if (STAFF) {
    const box = el("input", { type: "checkbox", disabled: mode !== "edit" });
    box.checked = !!m.locked;
    box.addEventListener("change", () => commit(() => { byId(m.id).locked = box.checked; }));
    body.append(el("label", { class: "check" }, box, t("lock")));
  }
  panel.append(el("div", { class: "ft" },
    el("button", { type: "button", class: "danger", "data-act": "delete", disabled: mode !== "edit" || (!editable && !(STAFF && m.kind in KIND_UI)), onclick: deleteSelected }, t("del"))));
}

// one field of a marker: a value, or none ("" / null: the field goes); a changed value is one undo step
function setField(id, name, val) {
  commit(() => {
    const n = byId(id);
    if (!canEdit(n) || (n.fields[name] ?? null) === (val === "" ? null : val)) return false;
    if (val === "" || val == null) delete n.fields[name]; else n.fields[name] = val;
  });
}

// ---- a spawn: which monster (typed, or one already on this map as a chip), how many (− / +), how far they roam
// (buttons, the circle on the map live), the sentence of what that means, and how many of that monster the map holds
const RADII = [0, 1, 2, 3, 5, 8, 12];
const clampInt = (v, f) => Math.max(f.min, Math.min(f.max, Math.round(+v) || 0));

// the spawns' monsters on this map: [[name, {n: monsters, floors: {floor: monsters}}]], the most first
function speciesOnMap() {
  const by = new Map();
  for (const m of markers) {
    if (m.kind !== "spawn" || !m.fields?.monster) continue;
    const s = by.get(m.fields.monster) || { n: 0, floors: {} };
    const c = Math.max(1, Math.round(+m.fields.count) || 1);
    s.n += c;
    s.floors[m.floor] = (s.floors[m.floor] || 0) + c;
    by.set(m.fields.monster, s);
  }
  return [...by].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
}

function spawnFields(body, m, editable) {
  const F = KIND_UI.spawn.fields, f = m.fields || {};
  const monster = f.monster ?? "", count = f.count ?? null, radius = f.radius ?? null;
  const fl = (word, hint) => el("div", { class: "fl" }, el("span", {}, word), hint ? el("span", { class: "hint" }, hint) : null);
  // the monster: typed (the game's names as suggestions, any other name kept as typed), or a chip
  body.append(fl(t("field.monster"), editable ? t("typeOrPick") : null));
  const input = el("input", { type: "text", maxlength: 60, disabled: !editable, list: "monsterList", autocomplete: "off", placeholder: t("monsterPlaceholder") });
  input.value = monster;
  input.addEventListener("change", () => {
    const typed = input.value.trim();
    setField(m.id, "monster", MONSTERS.find((x) => x.toLowerCase() === typed.toLowerCase()) || typed);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  body.append(input);
  const species = speciesOnMap().slice(0, 8);
  if (editable && species.length && !(species.length === 1 && species[0][0] === monster)) {
    body.append(fl(t("usedHere")));
    body.append(el("div", { class: "chips" }, species.map(([name, s]) =>
      el("button", { type: "button", class: "chip" + (name === monster ? " on" : ""), "aria-pressed": String(name === monster),
        onclick: () => { input.value = name; setField(m.id, "monster", name); } }, name, el("i", {}, String(s.n))))));
  }
  // how many: − [n] +
  const n = el("input", { type: "number", min: F.count.min, max: F.count.max, step: 1, inputmode: "numeric", disabled: !editable, "aria-label": t("field.count") });
  n.value = count ?? "";
  n.addEventListener("change", () => setField(m.id, "count", n.value.trim() === "" ? null : clampInt(n.value, F.count)));
  const step = (d) => setField(m.id, "count", clampInt((+count || 1) + d, F.count));
  body.append(fl(t("field.count")), el("div", { class: "stepper" },
    el("button", { type: "button", "data-act": "less", disabled: !editable || (+count || 1) <= F.count.min, "aria-label": "−1", onclick: () => step(-1) }, "−"),
    n,
    el("button", { type: "button", "data-act": "more", disabled: !editable || (+count || 1) >= F.count.max, "aria-label": "+1", onclick: () => step(1) }, "+")));
  // how far: the usual radii as buttons (a link's other value shows as its own button), and any other in the box
  const radii = RADII.includes(+radius) || radius == null ? RADII : [...RADII, +radius].sort((a, b) => a - b);
  const seg = el("div", { class: "seg radius", role: "group", "aria-label": t("field.radius") }, radii.map((r) =>
    el("button", { type: "button", class: +radius === r && radius != null ? "on" : "", "aria-pressed": String(+radius === r && radius != null), disabled: !editable,
      onclick: () => setField(m.id, "radius", r) }, String(r))));
  const other = el("input", { type: "number", min: F.radius.min, max: F.radius.max, step: 1, inputmode: "numeric", disabled: !editable, class: "other", "aria-label": t("radiusOther"), title: t("radiusOther") });
  other.value = radius != null && !radii.includes(+radius) ? radius : "";
  other.addEventListener("change", () => setField(m.id, "radius", other.value.trim() === "" ? null : clampInt(other.value, F.radius)));
  other.placeholder = t("radiusOtherShort");
  body.append(fl(t("radiusWord"), t("cellsWord")), el("div", { class: "radius-row" }, seg, other));
  // what it means, in words
  body.append(el("div", { class: "preview" }, spawnSentence(monster, +count || 1, radius)));
  // the same monster on the whole map
  const mine = monster && speciesOnMap().find(([name]) => name === monster);
  if (mine) {
    const floors = Object.entries(mine[1].floors).sort((a, b) => FL.level(b[0]) - FL.level(a[0]));
    const per = floors.length > 1 ? " · " + floors.map(([fl2, c]) => `${floorShort(fl2)}: ${c}`).join(" · ") : "";
    body.append(el("div", { class: "preview total" }, t(floors.length > 1 ? "onMapN" : "onMap1", mine[1].n, monster, floors.length) + per));
  }
}

function spawnSentence(monster, count, radius) {
  if (!monster) return t("spawnSayNone");
  const who = `${count} × ${monster}`;
  if (radius == null) return t("spawnSayNoR", who);
  return t(+radius === 0 ? "spawnSay0" : +radius === 1 ? "spawnSay1" : "spawnSay", who, radius);
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
  if (!m || mode !== "edit" || (m.locked && !STAFF)) return;
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
  // past Discord's 2,000 characters: the file to attach in the ticket instead (the link inside it, unchanged)
  const over = url.length > LINK_MAX || message.length > LINK_MAX;
  if (over) d.append(el("p", { class: "warn" }, t("overFile", url.length.toLocaleString(lang), message.length.toLocaleString(lang))));
  else if (message.length > 1900) d.append(el("p", { class: "warn" }, t("long", message.length)));
  d.append(el("div", { class: "row" },
    el("button", { type: "button", onclick: () => copy(url, true) }, t("copyLink")),
    el("button", { type: "button", class: over ? "" : "primary", onclick: () => copy(message, true) }, t("copyAll")),
    el("button", { type: "button", class: over ? "primary" : "", "data-act": "download", onclick: () => download(message) }, "⬇ " + t("downloadFile")),
    el("button", { type: "button", onclick: () => d.close() }, t("close"))));
  d.showModal();
}

// ---- a map as a file: Share downloads the message (the change list and the link) as a .txt to attach on Discord;
// "Open a file" (or a file dropped on the page) opens the link inside it. The link is the same bytes either way.
function download(text) {
  const name = (ML.cleanTitle(mapTitle) || t("fileName")).replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, " ").trim().slice(0, 60) || "map";
  const a = el("a", { href: URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain;charset=utf-8" })), download: name + ".txt" });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(t("downloaded", name + ".txt"));
}

// the first map link in a text (a whole URL, or a bare "#2...." fragment): its fragment, else null
function linkIn(text) {
  const m = String(text).match(/#([12]\.[A-Za-z0-9_-]{8,})/);
  return m ? m[1] : null;
}

function openLinkFrag(frag) {
  if ("#" + frag === location.hash) { location.reload(); return; }
  location.hash = frag;   // hashchange: the page reloads on it
}

function openFile() { $("fileIn").click(); }

async function readFile(file) {
  if (!file) return;
  if (file.size > 2_000_000) { toast(t("fileNoLink", file.name)); return; }
  const frag = linkIn(await file.text());
  if (frag) openLinkFrag(frag); else toast(t("fileNoLink", file.name));
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
// The page's frame, made here and not in index.html (a cached older index.html with this script still works):
// the bar (title, Go to, Edit / Review, undo, redo, language, open a file, Share), the tool rail, the maps with the
// floors card, the labels switch and the tool's sub-bar over them, the docked panel, the status bar.
function buildFrame() {
  const iconBtn = (id, glyph, word, onclick) => el("button", { type: "button", id, class: "icon", title: word, "aria-label": word, onclick }, glyph);
  const bar = el("header", { id: "bar" },
    el("div", { class: "brand", "aria-hidden": "true" }, "🗺"),
    el("input", { id: "mapTitle", type: "text", autocomplete: "off", spellcheck: "false" }),
    gotoBox(),
    el("div", { class: "bar-right" },
      modeSeg(),
      iconBtn("undo", "↶", t("undo") + " (Ctrl+Z)", undo),
      iconBtn("redo", "↷", t("redo") + " (Ctrl+Y)", redo),
      langSelect("lang"),
      iconBtn("openFile", "📂", t("openFileHelp"), openFile),
      el("button", { type: "button", id: "save", class: "primary", title: t("shareHelp"), onclick: save }, t("share"))));
  const rail = el("nav", { id: "tools", role: "toolbar", "aria-label": t("toolsWord"), "aria-orientation": "vertical" });
  // one list in the order both read (keys, screen readers): the phone's Objects after Spawn, More last
  const order = RAIL.filter((n) => n !== "|");
  order.splice(order.indexOf("spawn") + 1, 0, "things");
  for (const name of [...order, "more"]) rail.append(toolButton(name));
  // the group lines: before the objects and before the legend (computer only)
  rail.querySelector("[data-tool=rope]").before(el("div", { class: "grp desk" }, t("tool.things")));
  rail.querySelector("[data-tool=legend]").before(el("div", { class: "sep desk" }));
  const mapArea = el("div", { id: "mapArea" },
    el("main", { id: "panesBox" }),
    el("div", { id: "subtools", hidden: true }),
    el("div", { id: "floorCard", role: "region", "aria-label": t("floorsWord") }),
    el("div", { id: "labelsCtl", class: "float" }, el("span", {}, t("labels") + ":"), labelsSeg()));
  const status = el("footer", { id: "coords" },
    el("button", { type: "button", id: "cur", disabled: true, title: t("statusCopy"), onclick: () => lastCell && copy(posLine(lastCell.x, lastCell.z, lastCell.floor)) }, "x · z"),
    el("span", { class: "hint" }, t("statusCopy")),
    el("span", { id: "count" }),
    el("span", { id: "meter", role: "status", title: t("meterHelp") }, el("span", { class: "txt" }), el("span", { class: "bar" }, el("i"))));
  const file = el("input", { id: "fileIn", type: "file", accept: ".txt,.md,.json,text/plain", hidden: true });
  file.addEventListener("change", () => { readFile(file.files[0]); file.value = ""; });
  document.body.replaceChildren(bar, el("div", { id: "banner", hidden: true }),
    el("div", { id: "work" }, rail, mapArea, el("aside", { id: "panel", hidden: true, "aria-label": t("panelWord") })),
    status, el("div", { id: "toast", hidden: true, role: "status", "aria-live": "polite" }),
    el("dialog", { id: "dialog" }), el("datalist", { id: "monsterList" }), file);
  buildMenus();
  // a map file dropped anywhere on the page opens it
  addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
  addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); readFile(e.dataTransfer.files[0]); } });
  // the panel docks beside the maps: when it opens or closes (or the window changes) the maps measure again with their
  // left edge still (what was under the cursor stays there), and the selected marker stays in view
  new ResizeObserver(() => {
    for (const p of panes) p.map.invalidateSize({ animate: false, pan: false });
    const m = byId(selected), w = m && ML.where(m);
    const p = w && panes.find((q) => q.floor === m.floor);
    if (p && !p.map.getBounds().pad(-0.08).contains(ll(w[0], w[1]))) p.map.panInside(ll(w[0], w[1]), { padding: [40, 40], animate: false });
    drawLinksSoon();
  }).observe($("panesBox"));
}

// a tool's button: the rail on a computer (icon and a short word), the bottom bar on a phone
function toolButton(name) {
  const word = name === "legend" ? t("legend") : name === "more" ? t("more") : t("tool." + name);
  const phone = PHONE_TOOLS.includes(name), desk = name !== "things" && name !== "more";
  const cls = "tool" + (phone ? " phone" : "") + (desk ? " desk" : "");
  const attrs = { type: "button", class: cls, "data-tool": name, title: name === "things" ? t("thingsTitle") : word + (KIND_UI[name] ? ": " + t("help." + name) : ""),
    "aria-label": word, onclick: () => setTool(name) };
  if (name === "things" || name === "more") Object.assign(attrs, { "aria-haspopup": "menu", "aria-expanded": "false" });
  const icon = KIND_UI[name] ? dotNode(name, "glyph mk mini") : glyphNode(name, "glyph mk mini plain");
  return el("button", attrs, icon, el("span", { class: "txt" }, t("short." + name) !== "short." + name ? t("short." + name) : word));
}

// segmented controls (the bar, the floors card, the phone's More menu: each copy painted together)
function segOf(attr, items, now, onpick, label) {
  return el("div", { class: "seg", role: "group", "aria-label": label }, items.map(([v, word, title]) =>
    el("button", { type: "button", [attr]: v, class: String(now) === String(v) ? "on" : "", "aria-pressed": String(String(now) === String(v)), title: title || word,
      onclick: () => onpick(v) }, word)));
}
function paintSeg(attr, now) {
  for (const b of document.querySelectorAll(`[${attr}]`)) {
    const on = b.getAttribute(attr) === String(now);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}
const modeSeg = () => segOf("data-mode", [["edit", t("edit")], ["review", t("review"), t("reviewHelp")]], mode, setMode, t("modeWord"));
const labelsSeg = () => segOf("data-labels", [["auto", t("labelsAuto"), t("labelsAutoHelp")], ["always", t("labelsAlways")], ["never", t("labelsNever"), t("labelsNeverHelp")]], labelsMode, setLabels, t("labels"));
const panesSeg = () => segOf("data-panes", [[1, "1"], [2, "2"], [3, "3"]], 1, (n) => { closeMenus(); setPaneCount(+n); }, t("panes"));
const paintPaneCount = () => { paintSeg("data-panes", panes.length); document.body.classList.toggle("one-pane", panes.length === 1); };

function langSelect(id) {
  const ls = el("select", { id, "aria-label": t("lang"), title: t("lang") });
  const names = { pt: "Português", en: "English", es: "Español", zh: "中文" };
  for (const l of LANGS) ls.append(el("option", { value: l, title: names[l] }, l === "zh" ? names[l] : l.toUpperCase()));
  ls.value = lang;
  ls.onchange = () => {
    const q = new URLSearchParams(location.search);
    q.set("lang", ls.value);
    location.search = q.toString();   // the #fragment stays
  };
  return ls;
}

function setLabels(v) {
  labelsMode = v;
  pref.set("labels", v);
  paintSeg("data-labels", v);
  for (const p of panes) drawPane(p);
}

// Edit / Review. Review this round: look only (nothing moves or changes; the tools wait); what changed, counted and on
// the map, comes next round.
function setMode(v) {
  if (v === mode) return;
  closeMenus();
  if (tool === "route") finishRoute();
  mode = v;
  document.body.classList.toggle("review", mode === "review");
  paintSeg("data-mode", mode);
  if (mode === "review") { tool = "select"; destFor = null; toast(t("reviewSoon")); }
  applyTool();
}

// ---- the floors card: every floor with markers and how many; the floors shown (with their pane's number when side
// by side); "+ N floors without markers" opens the rest; 1 / 2 / 3 side by side. A floor: the pane last clicked shows
// it, and when none of its markers is in view the view goes to them.
let floorsOpen = false;
function paintFloorCard() {
  const card = $("floorCard");
  if (!card || !tileMeta) return;
  const counts = FL.floorCounts(markers), target = targetPane();
  const folded = pref.get("floorsFolded", "0") === "1";
  card.textContent = "";
  card.classList.toggle("folded", folded);
  card.append(el("button", { type: "button", class: "h", "aria-expanded": String(!folded), title: t("floorsFold"),
    onclick: () => { pref.set("floorsFolded", folded ? "0" : "1"); paintFloorCard(); } },
  el("span", {}, t("floorsWord")), el("span", {}, folded ? "▸" : t("markersWord"))));
  if (folded) return;
  const shownIn = (f) => panes.map((p, i) => (p.floor === f ? i + 1 : 0)).filter(Boolean);
  const withMarkers = tileMeta.floors.filter((f) => counts[f] || shownIn(f).length);
  const empty = tileMeta.floors.filter((f) => !withMarkers.includes(f));
  const list = el("div", { class: "rows" });
  const links = FL.floorLinks(markers);
  for (const f of floorsOpen ? tileMeta.floors : withMarkers) {
    const ins = shownIn(f), to = links[f] || [];
    const row = el("button", { type: "button", "data-floor": f,
      class: "f" + (target.floor === f ? " on" : ins.length ? " shown" : "") + (counts[f] ? "" : " empty"),
      "aria-pressed": String(target.floor === f), title: floorLabel(f) + (to.length ? " · " + t("floorLinksTo", to.map(floorShort).join(", ")) : ""),
      onclick: () => { hidePreview(); showFloor(f); } },
    el("b", {}, floorShort(f)),
    panes.length > 1 && ins.length ? el("span", { class: "pn" }, ins.join("·")) : null,
    counts[f] ? el("span", { class: "c" }, String(counts[f])) : null,
    // where this floor's ropes, holes and portals lead (and what leads here)
    to.length ? el("small", { class: "to" }, "⇅ " + to.map((x) => (x === "s" ? t("surfaceShort") : x)).join(" · ")) : null);
    row.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") showPreview(f, row); });
    row.addEventListener("pointerleave", hidePreview);
    row.addEventListener("focus", () => showPreview(f, row));
    row.addEventListener("blur", hidePreview);
    list.append(row);
  }
  card.append(list);
  if (empty.length) list.append(el("button", { type: "button", class: "more", onclick: () => { floorsOpen = !floorsOpen; paintFloorCard(); } },
    floorsOpen ? t("floorsLess") : t("floorsMore", empty.filter((f) => !shownIn(f).length).length)));
  card.append(el("div", { class: "side" }, el("span", {}, t("sideBySide")), panesSeg()));
  paintPaneCount();
}

// a floor's preview beside the card (hover or focus on its row): its map around the centre of the pane the card acts
// on, two pixels a cell, and its markers as dots (the floor layers beside the minimap Setzer asked for, 11-25)
const PREV_W = 120, PREV_H = 84, PREV_S = 2;
function showPreview(f, row) {
  if (PHONE.matches) return;
  let box = $("floorPreview");
  if (!box) { box = el("div", { id: "floorPreview", "aria-hidden": "true" }); document.body.append(box); }
  const c = targetPane().map.getCenter(), cx = Math.round(c.lng), cz = Math.round(c.lat);
  const x0 = cx - PREV_W / 2, y0 = -cz - PREV_H / 2;   // zoom-0 pixels: column x, row -z
  const map = el("div", { class: "pv-map" });
  const have = new Set(tileMeta.tiles[f]?.["0"] || []);
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + PREV_W) / 256); tx++) {
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + PREV_H) / 256); ty++) {
      if (!have.has(tx + "_" + ty)) continue;
      const img = el("img", { src: `tiles/${tileVersion}/${f}/0/${tx}_${ty}.png`, alt: "" });
      Object.assign(img.style, { left: (tx * 256 - x0) * PREV_S + "px", top: (ty * 256 - y0) * PREV_S + "px", width: 256 * PREV_S + "px" });
      map.append(img);
    }
  }
  for (const m of markers) {
    const w = m.floor === f && ML.where(m);
    if (!w || w[0] < x0 || w[0] > x0 + PREV_W || -w[1] < y0 || -w[1] > y0 + PREV_H) continue;
    const dot = el("i", {});
    Object.assign(dot.style, { left: (w[0] - x0) * PREV_S + "px", top: (-w[1] - y0) * PREV_S + "px", background: ui(m).color });
    map.append(dot);
  }
  const counts = FL.floorCounts(markers);
  box.replaceChildren(map, el("div", { class: "cap" }, floorOptionText(f, counts)));
  const r = row.getBoundingClientRect(), card = $("floorCard").getBoundingClientRect();
  Object.assign(box.style, { right: innerWidth - card.left + 8 + "px", top: Math.max(8, Math.min(r.top - 20, innerHeight - PREV_H * PREV_S - 40)) + "px" });
  box.hidden = false;
}
function hidePreview() { if ($("floorPreview")) $("floorPreview").hidden = true; }

// a floor from the card, Go to or the arrows: the pane last clicked shows it; its markers come into view when none
// is in view (keep: the view stays)
function showFloor(f, keep = false) {
  const p = targetPane();
  if (p.floor !== f) setFloor(p, f);
  const mine = markers.filter((m) => m.floor === f).map(ML.where).filter(Boolean);
  const view = p.map.getBounds();
  if (!keep && mine.length && !mine.some(([x, z]) => view.contains(ll(x, z)))) {
    p.map.fitBounds(L.latLngBounds(mine.map(([x, z]) => ll(x, z))).pad(0.15), { maxZoom: 3, animate: false });
  }
  refresh();
  showCoordsFloor(p);
}

// the status bar: how many markers on how many floors
function paintCount() {
  const c = $("count");
  if (!c) return;
  const floors = Object.keys(FL.floorCounts(markers)).length;
  c.textContent = markers.length ? t(floors === 1 ? "statusCount1" : "statusCount", markers.length, floors) : t("statusNone");
}

// ---- the link's size, live (Discord's message limit is 2,000 characters): the status bar's meter, a warning from
// LINK_WARN, and past LINK_MAX: Share offers the file
let meterTimer = 0, meterSeq = 0, meterWas = 0;
function measureLinkSoon() {
  clearTimeout(meterTimer);
  meterTimer = setTimeout(measureLink, 250);
}
async function measureLink() {
  if (!tileMeta || !panes.length || !$("meter")) return;
  const seq = ++meterSeq;
  let link, msg;
  try {
    // what Share gives: the link, and the message (the change list and the link) that goes to Discord
    const state = ML.saveState(opened, clone(markers), currentView(), tileVersion, nextId, mapTitle);
    const frag = await ML.encode(state), url = linkFor(frag);
    link = url.length;
    msg = (summaryText(changeLines(await ML.decode(frag))) + "\n" + url).length;
  } catch { return; }
  if (seq !== meterSeq) return;
  const n = Math.max(link, msg), num = (v) => v.toLocaleString(lang);
  const box = $("meter"), level = n > LINK_MAX ? "over" : n >= LINK_WARN ? "near" : "";
  box.className = level;
  box.querySelector(".txt").textContent = msg > link + 40 ? t("meter2", num(link), num(msg), num(LINK_MAX)) : t("meter", num(link), num(LINK_MAX));
  box.querySelector("i").style.width = Math.min(100, (n / LINK_MAX) * 100).toFixed(1) + "%";
  // on screen once each time an edit crosses a line upward (a link that opens long says it in the meter only)
  if (meterWas && level && (meterWas <= LINK_MAX && n > LINK_MAX || meterWas < LINK_WARN && n >= LINK_WARN && n <= LINK_MAX)) toast(t(level === "over" ? "meterOver" : "meterNear", n));
  meterWas = n;
}

// ---- Go to: a /pos line or x, z (go there, mark it, what is near it); a floor; a marker by name; another map link
let gotoRows = [], gotoAt = 0, gotoSeq = 0;
function gotoBox() {
  const input = el("input", { id: "gotoBox", type: "search", autocomplete: "off", spellcheck: "false", placeholder: t("gotoPlaceholder"),
    "aria-label": t("gotoWord"), role: "combobox", "aria-expanded": "false", "aria-controls": "gotoMenu" });
  const menu = el("div", { id: "gotoMenu", role: "listbox", hidden: true });
  input.addEventListener("input", gotoUpdate);
  input.addEventListener("focus", () => { if (input.value.trim()) gotoUpdate(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); gotoMove(e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === "Enter") { e.preventDefault(); gotoRows[gotoAt]?.act(); }
    else if (e.key === "Escape") { if (!menu.hidden) { e.stopPropagation(); gotoClose(); } else input.blur(); }
  });
  input.addEventListener("blur", () => setTimeout(gotoClose, 150));
  return el("div", { id: "goto" }, el("span", { class: "lens", "aria-hidden": "true" }, "⌕"), input, menu);
}

function gotoClose() {
  $("gotoMenu").hidden = true;
  $("gotoBox").setAttribute("aria-expanded", "false");
}

function gotoMove(d) {
  if (!gotoRows.length) return;
  gotoAt = (gotoAt + d + gotoRows.length) % gotoRows.length;
  for (const [i, b] of [...$("gotoMenu").querySelectorAll(".r")].entries()) b.classList.toggle("on", i === gotoAt);
}

// what a marker is called, for the search and the lists: its name, monster, label, note
const searchText = (m) => [labelOf(m), m.fields?.label, m.fields?.name, m.fields?.text, KIND_UI[m.kind] ? t("kind." + m.kind) : ""].filter(Boolean).join(" ");

async function gotoUpdate() {
  const q = $("gotoBox").value.trim(), seq = ++gotoSeq;
  if (!q || !tileMeta) { gotoClose(); return; }
  const groups = [];
  const place = GT.parsePlace(q), frag = linkIn(q);
  if (frag) groups.push([t("gotoLinkGroup"), [{ icon: "poi", title: t("gotoLink"), sub: t("gotoLinkSub"), act: () => openLinkFrag(frag) }]]);
  else if (place) {
    const floors = (await GT.placeFloors(place, tileMeta.floors, hasMapAt)) ?? [targetPane().floor];
    if (seq !== gotoSeq) return;
    const go = floors.map((f, i) => ({ icon: "poi", title: t("gotoGo", place.x, place.z, floorShort(f)), sub: t("gotoGoSub"), key: i ? null : "Enter", act: () => goTo(place.x, place.z, f) }));
    if (mode === "edit") go.push({ glyph: "＋", title: t("gotoMark"), sub: t("gotoMarkSub", floorShort(floors[0])), act: () => markHere(place.x, place.z, floors[0]) });
    groups.push([t("gotoPlace"), go]);
    const near = GT.nearMarkers(markers, place.x, place.z, floors[0], ML.where, 40, 5);
    if (near.length) groups.push([t("gotoNear"), near.map(({ m, d }) => markerRow(m, t("cellsAway", d)))]);
  } else {
    const f = GT.parseFloor(q, tileMeta.floors), counts = FL.floorCounts(markers);
    if (f) groups.push([t("floorsWord"), [{ glyph: "≡", title: floorLabel(f), sub: counts[f] ? t("floorHas", counts[f]) : t("floorEmpty"), act: () => showFloor(f) }]]);
    const hits = GT.searchMarkers(markers, q, searchText, 8);
    if (hits.length) groups.push([t("gotoFound"), hits.map((m) => markerRow(m))]);
  }
  gotoRows = groups.flatMap(([, rows]) => rows);
  gotoAt = 0;
  const menu = $("gotoMenu");
  menu.textContent = "";
  if (!gotoRows.length) menu.append(el("div", { class: "empty" }, t("gotoNone")));
  let i = 0;
  for (const [title, rows] of groups) {
    menu.append(el("div", { class: "grp" }, title));
    for (const r of rows) {
      const n = i++;
      menu.append(el("button", { type: "button", role: "option", class: "r" + (n === 0 ? " on" : ""), tabindex: -1,
        onpointerdown: (e) => e.preventDefault(),   // the box keeps the focus (its blur would close the menu first)
        onclick: () => r.act() },
      r.icon ? dotNode(r.icon) : el("span", { class: "mk mini plain" }, r.glyph || "·"),
      el("div", {}, el("b", {}, r.title), r.sub ? el("span", {}, r.sub) : null),
      r.key ? el("span", { class: "kbd" }, r.key) : null));
    }
  }
  menu.append(el("div", { class: "foot" }, t("gotoHelp")));
  menu.hidden = false;
  $("gotoBox").setAttribute("aria-expanded", "true");
}

function markerRow(m, extra) {
  const w = ML.where(m);
  return { icon: m.kind in KIND_UI ? m.kind : null, glyph: "?", title: labelOf(m) || (KIND_UI[m.kind] ? t("kind." + m.kind) : m.kind),
    sub: [floorShort(m.floor), extra, m.locked ? "🔒 " + t("context") : ""].filter(Boolean).join(" · "),
    act: () => { gotoClose(); if (w) goTo(w[0], w[1], m.floor, m.id); } };
}

// centre the maps on a cell: the pane last clicked shows its floor (unless one already does); a ring shows the spot
function goTo(x, z, floor, id = null) {
  gotoClose();
  let p = panes.find((q) => q.floor === floor);
  if (!p) { p = targetPane(); setFloor(p, floor); }
  p.map.setView(ll(x, z), Math.max(p.map.getZoom(), 3), { animate: false });
  showCell(x, z, floor);
  if (id != null) selected = id;
  refresh();
  const ring = L.circleMarker(ll(x, z), { radius: 16, color: "#ffe066", weight: 3, fill: false, interactive: false, className: "pulse" }).addTo(p.map);
  setTimeout(() => ring.remove(), 2600);
}

function markHere(x, z, floor) {
  goTo(x, z, floor);
  commit(() => { const m = newMarker("poi", floor, { x, z }); markers.push(m); selected = m.id; });
}

// is there map on a floor at a cell? (the zoom-0 tile's pixel: one pixel a cell; a tile the set doesn't have: no)
const tileCanvas = new Map();
function hasMapAt(floor, x, z) {
  const tx = Math.floor(x / 256), ty = Math.floor(-z / 256), name = tx + "_" + ty;
  if (!(tileMeta.tiles[floor]?.["0"] || []).includes(name)) return Promise.resolve(false);
  const url = `tiles/${tileVersion}/${floor}/0/${name}.png`;
  if (!tileCanvas.has(url)) tileCanvas.set(url, new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      done(g);
    };
    img.onerror = () => done(null);
    img.src = url;
  }));
  return tileCanvas.get(url).then((g) => !g || g.getImageData(x - tx * 256, -z - ty * 256, 1, 1).data[3] > 0);
}

function buildBar() {
  buildFrame();
  const tb = $("mapTitle");
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
  const dl = $("monsterList");
  for (const m of [...MONSTERS].sort()) dl.append(el("option", { value: m }));   // the list itself is append only
  // the bosses' names for the boss marker (made here, not in index.html: a cached older index.html still works)
  document.body.append(el("datalist", { id: "bossList" }, BOSSES.map(([name]) => el("option", { value: name }))));
  document.addEventListener("keydown", (e) => {
    // Escape in a select (the floors) or a field of the panel leaves it (a field keeps what was typed), then works as
    // it does on the map; Ctrl+K or "/" goes to the Go-to box
    const mod = e.ctrlKey || e.metaKey;
    if ((mod && e.key.toLowerCase() === "k") || (e.key === "/" && !e.target.closest("input, textarea, select"))) {
      e.preventDefault(); $("gotoBox").focus(); $("gotoBox").select(); return;
    }
    if (e.key === "Escape" && e.target.closest("select, #panel input, #panel textarea")) e.target.blur();
    else if (e.target.closest("input, textarea, select")) return;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    else if (e.key === "Enter" && tool === "route") finishRoute();
    else if (!mod && (e.key === "PageUp" || e.key === "]" || e.key === "}")) { e.preventDefault(); stepFloor(activePane || panes[0], -1, e.shiftKey); }
    else if (!mod && (e.key === "PageDown" || e.key === "[" || e.key === "{")) { e.preventDefault(); stepFloor(activePane || panes[0], 1, e.shiftKey); }
    else if (e.key === "Escape" && closeMenus()) return;
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
  buildPanes(view.floors, view);
  // read-only hooks for the page's browser tests
  Object.defineProperty(window, "__panes", { get: () => panes });   // the panes now (side by side rebuilds them)
  window.__state = () => ({ markers: clone(markers), nextId, selected, tool, destFor });
  window.addEventListener("resize", drawLinksSoon);
}

start();
