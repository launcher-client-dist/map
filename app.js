// The map page: Leaflet over the game's map tiles, a marker editor, the state in the URL #fragment (maplink.js).
// Everything a link carries was typed by someone: text goes into the page with textContent only, never as HTML.
import * as ML from "./maplink.js";
import { MONSTERS } from "./monsters.js";
import { LANGS, pickLang, translator } from "./i18n.js";

const lang = pickLang();
const t = translator(lang);
const STAFF = new URLSearchParams(location.search).has("staff");
document.documentElement.lang = lang;
document.title = t("title");

// The marker kinds on the page: maplink.js KINDS holds the format; this table how each one looks and is edited.
// A new kind: append it to KINDS (maplink.js and its other implementations), here, and its words in i18n.js.
const KIND_UI = {
  spawn: { color: "#e5484d", glyph: "⚔", fields: { monster: { input: "monster" }, count: { input: "int", min: 1, max: 99, def: 1 }, radius: { input: "int", min: 0, max: 40, def: 3 } } },
  poi: { color: "#f5a524", glyph: "★", fields: { label: { input: "text" } } },
  area: { color: "#30a46c", glyph: "▦", fields: { label: { input: "text" } } },
  route: { color: "#3e8ef7", glyph: "➜", fields: { label: { input: "text" } } },
  note: { color: "#a46cf5", glyph: "✎", fields: { text: { input: "longtext" } } },
};
const TOOLS = ["select", "spawn", "poi", "area", "route", "note"];
const GLYPH = { select: "☝", ...Object.fromEntries(Object.entries(KIND_UI).map(([k, v]) => [k, v.glyph])) };
const UNKNOWN = { color: "#888", glyph: "?", fields: {} };
const ui = (m) => KIND_UI[m.kind] || UNKNOWN;

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
const undoStack = [], redoStack = [];
let panes = [];
let syncing = false;

const byId = (id) => markers.find((m) => m.id === id);
const clone = (x) => structuredClone(x);
const floorLabel = (f) => (f === "s" ? t("surface") : t("floorY", f, (+f + 0.8).toFixed(1)));
const floorShort = (f) => (f === "s" ? t("surface") : t("floor", f));

function snapshot() { return { markers: clone(markers), nextId }; }
function restore(s) { markers = clone(s.markers); nextId = s.nextId; if (selected != null && !byId(selected)) selected = null; }
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
  const box = $("panesBox");
  box.textContent = "";
  floors.forEach((floor, i) => {
    const select = el("select", { "aria-label": t("field.floor") });
    for (const f of tileMeta.floors) select.append(el("option", { value: f }, floorLabel(f)));
    select.value = floor;
    const mapEl = el("div", { class: "map" });
    box.append(el("div", { class: "pane" }, el("div", { class: "pane-head" }, select), mapEl));
    const map = L.map(mapEl, { crs: CRS, minZoom: -2, maxZoom: 5, zoomSnap: 1, attributionControl: false,
      zoomControl: i === 0, doubleClickZoom: false, maxBounds: L.latLngBounds(tileMeta.bounds).pad(0.3), maxBoundsViscosity: 0.8 });
    const p = { floor, map, el: mapEl, base: null, under: null, layer: L.layerGroup().addTo(map), draft: L.layerGroup().addTo(map) };
    panes.push(p);
    setFloor(p, floor);
    select.addEventListener("change", () => { setFloor(p, select.value); refresh(); });
    map.setView(ll(view.x, view.z), view.zoom, { animate: false });
    map.on("move", () => sync(p));
    map.on("mousemove", (e) => showCoords(p, e.latlng));
    map.on("click", (e) => onMapClick(p, e));
    map.on("dblclick", () => { if (tool === "route") finishRoute(); });
    hookPainting(p);
  });
  applyTool();
  refresh();
}

function setFloor(p, floor) {
  p.floor = floor;
  if (p.base) p.map.removeLayer(p.base);
  if (p.under) p.map.removeLayer(p.under);
  p.under = floor === "s" ? null : tileLayer("s", 0.14).addTo(p.map);   // the surface, dim, under a floor below it
  p.base = tileLayer(floor).addTo(p.map);
  p.layer.bringToFront?.();
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
  const span = el("span", {}, text);   // text node: whatever the link holds stays text
  layer.bindTooltip(span, { permanent: true, direction: "top", className: "lbl", offset: [0, -14], ...opts });
}

function labelOf(m) {
  const f = m.fields || {};
  if (m.kind === "spawn") return [f.monster || "?", f.count ? "×" + f.count : ""].join(" ").trim();
  return f.label || f.text || "";
}

function icon(m) {
  const k = ui(m);
  const cls = "mk" + (m.id === selected ? " sel" : "") + (m.locked ? " lock" : "");
  // static glyphs only: no text from the link in this HTML
  return L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13],
    html: `<div class="${cls}" style="background:${k.color}">${m.locked ? "🔒" : k.glyph}</div>` });
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

function drawMarker(p, m) {
  const k = ui(m), sel = m.id === selected;
  const pick = (e) => { L.DomEvent.stopPropagation(e); if (tool === "area" || tool === "route") return; select(m.id); };
  if ("x" in m) {
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
    tip(mk, labelOf(m));
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
  for (const p of panes) drawPane(p);
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  renderPanel();
}

// ------------------------------------------------------------------------------------------------ tools
function applyTool() {
  for (const b of $("tools").children) b.classList.toggle("on", b.dataset.tool === tool);
  for (const p of panes) {
    const paint = tool === "area";
    p.el.classList.toggle("painting", paint);
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
  refresh();
}

function setTool(name) {
  if (tool === "route" && name !== "route") finishRoute();
  tool = name;
  // a drawing tool closes the panel of anything it doesn't work on (on a phone the panel covers half the map)
  const sel = byId(selected);
  if (name !== "select" && !(sel && sel.kind === name && (name === "area" || name === "route"))) selected = null;
  applyTool();
  if (name === "area") toast(t("hintArea"));
  else if (name === "route") toast(t("hintRoute"));
  else if (name !== "select") toast(t("hintPlace"));
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
  commit(() => { const m = newMarker(tool, p.floor, { x, z }); markers.push(m); selected = m.id; });
  setTool("select");
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

function renderPanel() {
  const panel = $("panel");
  const m = byId(selected);
  if (!m) { panel.hidden = true; panel.textContent = ""; return; }
  panel.hidden = false;
  panel.textContent = "";
  const k = ui(m), editable = canEdit(m);
  panel.append(el("h3", {}, el("span", { class: "mk", style: `background:${k.color};width:22px;height:22px;font-size:12px` }, k.glyph),
    KIND_UI[m.kind] ? t("kind." + m.kind) : m.kind, el("span", { class: "id" }, "#" + m.id)));
  if (!(m.kind in KIND_UI)) panel.append(el("div", { class: "note" }, t("unknownKind")));
  else if (m.locked) panel.append(el("div", { class: "note" }, "🔒 " + t("locked")));
  const where = ML.where(m);
  if (where) panel.append(el("div", { class: "id" }, `x ${where[0]} · z ${where[1]}` + (m.cells ? " · " + t("cells", m.cells.length) : m.points ? " · " + t("points", m.points.length) : "")));
  // floor
  panel.append(el("label", {}, t("field.floor")));
  const fs = el("select", { disabled: !editable });
  for (const f of tileMeta.floors) fs.append(el("option", { value: f }, floorLabel(f)));
  fs.value = m.floor;
  fs.addEventListener("change", () => commit(() => { byId(m.id).floor = fs.value; }));
  panel.append(fs);
  for (const [name, f] of Object.entries(k.fields)) {
    panel.append(el("label", {}, t("field." + name)));
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
    el("button", { type: "button", onclick: () => select(null) }, t("close"))));
}

function deleteSelected() {
  const m = byId(selected);
  if (!m || (m.locked && !STAFF)) return;
  commit(() => { markers = markers.filter((x) => x.id !== m.id); selected = null; });
}

// ------------------------------------------------------------------------------------------------ save and changes
function changeLines(state) {
  const lines = [];
  const at = (m) => { const w = ML.where(m); return (w ? `x ${w[0]}, z ${w[1]}` : "?") + ` (${floorShort(m.floor)})`; };
  const what = (m) => {
    const name = KIND_UI[m.kind] ? t("kind." + m.kind) : m.kind;
    const f = m.fields || {};
    if (m.kind === "spawn") return `${name} ${f.monster || "?"}${f.count ? " ×" + f.count : ""}${f.radius ? " r" + f.radius : ""}`;
    const extra = m.cells ? " " + t("cells", m.cells.length) : m.points ? " " + t("points", m.points.length) : "";
    const text = f.label || f.text;
    return name + extra + (text ? ` "${text}"` : "");
  };
  for (const c of ML.changes(state)) {
    const id = "#" + c.id;
    const kind = KIND_UI[c.kind] ? t("kind." + c.kind) : c.kind;
    if (c.op === "added") lines.push(`+ ${id} ${t("added")}: ${what(c.marker)} ${t("at")} ${at(c.marker)}`);
    else if (c.op === "removed") lines.push(`- ${id} ${t("removed")}: ${what(c.marker)} ${t("at")} ${at(c.marker)}`);
    else if (c.op === "moved") {
      const p = (w, f) => (w ? `x ${w[0]}, z ${w[1]}` : "?") + (c.floor_from !== c.floor_to ? ` (${floorShort(f)})` : "");
      const size = c.size_from != null ? `, ${c.size_from} → ${c.size_to}` : "";
      lines.push(`~ ${id} ${kind} ${t("moved")}: ${p(c.from, c.floor_from)} → ${p(c.to, c.floor_to)}${size}`);
    } else if (c.op === "edited") {
      const v = (x) => (x == null ? "∅" : typeof x === "string" ? `"${x}"` : x);
      lines.push(`~ ${id} ${kind} ${t("edited")}: ${t("field." + c.field)}: ${v(c.old)} → ${v(c.new)}`);
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
  const qs = q.toString();
  return location.origin + location.pathname + (qs ? "?" + qs : "") + "#" + frag;
}

async function save() {
  finishRoute();
  const state = ML.saveState(opened, clone(markers), currentView(), tileVersion, nextId);
  const frag = await ML.encode(state);
  const url = linkFor(frag);
  history.replaceState(null, "", location.pathname + location.search + "#" + frag);
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
    tools.append(el("button", { type: "button", class: "tool", "data-tool": name, title: t("tool." + name), onclick: () => setTool(name) },
      el("span", { class: "glyph" }, GLYPH[name]), el("span", { class: "txt" }, " " + t("tool." + name))));
  }
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
  const ls = $("lang");
  for (const l of LANGS) ls.append(el("option", { value: l }, { pt: "Português", en: "English", es: "Español", zh: "中文" }[l]));
  ls.value = lang;
  ls.onchange = () => {
    const q = new URLSearchParams(location.search);
    q.set("lang", ls.value);
    location.search = q.toString();   // the #fragment stays
  };
  $("panes").onchange = () => {
    const n = +$("panes").value, view = currentView();
    const floors = view.floors.slice(0, n);
    while (floors.length < n) {
      const i = tileMeta.floors.indexOf(floors[floors.length - 1]);
      floors.push(tileMeta.floors[Math.min(i + 1, tileMeta.floors.length - 1)]);
    }
    buildPanes(floors, view);
  };
  const dl = $("monsterList");
  for (const m of MONSTERS) dl.append(el("option", { value: m }));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    else if (e.key === "Enter" && tool === "route") finishRoute();
    else if (e.key === "Escape") { draftRoute = null; selected = null; if (tool !== "select") setTool("select"); else refresh(); }
  });
  window.addEventListener("hashchange", () => location.reload());
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
    const lines = changeLines(state);
    if (lines.length) banner(t("linkChanges", lines.length), "", el("button", { type: "button", onclick: () => showChanges(lines) }, t("view")));
  }
  $("panes").value = String(view.floors.length);
  buildPanes(view.floors, view);
  // read-only hooks for the page's browser tests
  window.__panes = panes;
  window.__state = () => ({ markers: clone(markers), nextId, selected, tool });
}

start();
