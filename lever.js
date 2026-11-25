// What pulling a lever does: the lever's "pull" field, its compact code and its words. No DOM: the page, its tests and
// the staff tools (maplink.py's parse_lever / lever_text: the same rule and the same words in pt and en) share it.
//
// The field is one string, the cells relative to the lever (moving or duplicating the lever carries its action):
//   ""                         not said (no field in the link at all)
//   "w" [secs] "|dx,dz" ...    opens the walls at these cells of the lever's floor (1..MAX_WALLS cells)
//   "w" [secs] "#id"           opens the walls of the area marker #id (its cells)
//   "s|dx,dz,floor"            sends the player to that cell; floor: "s" (the surface) or the floor's number
// secs (1..3600): the walls close again on their own after that many seconds (timed); none: they stay open until the
// lever is pulled again (toggle, the game's default). Anything else is a newer page's action: kept as it is ("other").

export const MAX_WALLS = 32;   // cells of one lever ("|-123,-45" each: well under a field's 300 characters)
export const MAX_SECS = 3600;

const WALLS = /^w([1-9]\d{0,3})?((?:\|-?\d{1,4},-?\d{1,4}){1,32}|#\d{1,6})$/;
const SEND = /^s\|(-?\d{1,5}),(-?\d{1,5}),(s|-?\d{1,2})$/;

// {act: "none" | "walls" | "send" | "other", secs, cells: [[dx, dz]], area: id, to: {dx, dz, floor}, text}
export function parseLever(s) {
  s = String(s ?? "");
  if (!s) return { act: "none" };
  let m = WALLS.exec(s);
  if (m && !(m[1] && +m[1] > MAX_SECS)) {
    const out = { act: "walls", secs: m[1] ? +m[1] : 0 };
    if (m[2][0] === "#") out.area = +m[2].slice(1);
    else out.cells = m[2].slice(1).split("|").map((c) => c.split(",").map(Number));
    return out;
  }
  m = SEND.exec(s);
  if (m) return { act: "send", to: { dx: +m[1], dz: +m[2], floor: m[3] === "s" ? "s" : String(+m[3]) } };
  return { act: "other", text: s };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v) || 0));

// the compact code of {act, secs, cells | area, to} ("" for none; cells kept once each, in the order given, at most
// MAX_WALLS)
export function leverCode(p) {
  if (!p || p.act === "none") return "";
  if (p.act === "other") return String(p.text ?? "");
  if (p.act === "send") {
    const to = p.to || {};
    return `s|${clamp(to.dx, -99999, 99999)},${clamp(to.dz, -99999, 99999)},${to.floor == null || to.floor === "s" ? "s" : clamp(to.floor, -99, 99)}`;
  }
  const secs = p.secs ? clamp(p.secs, 1, MAX_SECS) : 0;
  const head = "w" + (secs || "");
  if (p.area != null) return head + "#" + clamp(p.area, 0, 999999);
  const seen = new Set();
  let out = head, n = 0;
  for (const [dx, dz] of p.cells || []) {
    const k = clamp(dx, -9999, 9999) + "," + clamp(dz, -9999, 9999);
    // once each, at most MAX_WALLS, and the whole code inside a field's MAX_TEXT characters (a link cuts it there)
    if (seen.has(k) || n >= MAX_WALLS || out.length + k.length + 1 > MAX_CODE) continue;
    seen.add(k);
    out += "|" + k;
    n++;
  }
  return n ? out : "";
}
const MAX_CODE = 300;   // maplink.js MAX_TEXT

// the action in words. t: the page's translator (i18n.js, the keys pull.*); at: the lever's {x, z} (a destination
// in absolute cells), floorWord(f): a floor's name
export function leverText(s, t, at = { x: 0, z: 0 }, floorWord = (f) => f) {
  const p = parseLever(s);
  if (p.act === "none") return t("pull.noneText");
  if (p.act === "other") return t("pull.other", p.text);
  if (p.act === "send") return t("pull.sendText", at.x + p.to.dx, at.z + p.to.dz, floorWord(p.to.floor));
  const what = p.area != null ? t("pull.areaText", p.area) : p.cells.length === 1 ? t("pull.walls1") : t("pull.wallsN", p.cells.length);
  return what + " · " + (p.secs ? t("pull.timedText", p.secs) : t("pull.toggleText"));
}

// the cells a lever opens, in absolute cells (an area's from the markers): [[x, z]], or [] when it opens none
export function wallCells(lever, markers) {
  const p = parseLever(lever.fields?.pull);
  if (p.act !== "walls") return [];
  if (p.area != null) return (markers.find((m) => m.id === p.area && m.cells)?.cells || []).map((c) => [...c]);
  return p.cells.map(([dx, dz]) => [lever.x + dx, lever.z + dz]);
}

// the code of a lever dragged by (dx, dz) alone: its wall cells and where it sends stay where they are on the map (as a
// rope's landing stays when the rope is dragged); a group's move or a duplicate keeps the code, so they travel along
export function rebased(s, dx, dz) {
  const p = parseLever(s);
  if (p.act === "send") return leverCode({ ...p, to: { ...p.to, dx: p.to.dx - dx, dz: p.to.dz - dz } });
  if (p.act === "walls" && p.cells) return leverCode({ ...p, cells: p.cells.map(([x, z]) => [x - dx, z - dz]) });
  return String(s ?? "");
}

// the code with every area reference changed by ids (a map {old: new}): a lever duplicated with its area
export function remapArea(s, ids) {
  const p = parseLever(s);
  if (p.act !== "walls" || p.area == null || !(p.area in ids)) return String(s ?? "");
  return leverCode({ ...p, area: ids[p.area] });
}
