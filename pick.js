// Selecting and deleting made clear: why a Delete or a click did nothing, which marker a click on a crowded spot
// selects, and where the markers the link had and this edit removed were. No DOM: the page and its tests share it.

// the kinds whose removed mark also goes over where they led
const LEADS = ["rope", "rope2", "hole", "portal", "elevator"];

// why Delete (the key, the panel's button, the menu) can't delete now: an i18n key, or null when it can.
// s: { mode, tool, selected (the marker or null), group (the selection's markers when 2 or more, else null),
//      staff, editable(m) (the page's own rule) }
export function whyNotDelete(s) {
  if (s.mode !== "edit") return "why.review";
  if (s.group && s.group.length) return s.group.some(s.editable) ? null : "why.groupLocked";
  if (!s.selected) return s.tool === "area" || s.tool === "route" ? "why.tool" : "why.none";
  if (s.selected.locked && !s.staff) return "why.locked";
  return null;
}

// a Delete key pressed in one of the panel's fields while a marker is selected: true when the key changes nothing in
// the field (a list, or the caret at the end with nothing marked), so the person meant the marker; Backspace and a
// Delete that removes text stay the field's own. f: { key, tag ("INPUT", "TEXTAREA", "SELECT"), type, value, start, end }
export function deleteMeantMarker(f) {
  if (f.key !== "Delete") return false;
  if (f.tag === "SELECT" || f.type === "checkbox" || f.type === "radio") return true;
  if (f.start == null) return false;   // (a field with no caret to read: its own)
  return f.start === f.end && f.end >= String(f.value ?? "").length;
}

// why a click on a marker selects nothing: the active tool draws there (an area, a route), else null
export function whyNotPick(tool) {
  return tool === "area" || tool === "route" ? "why.tool" : null;
}

// the markers stacked under a click: of `points` ([{id, x, y}] on screen, in pixels), the ids within `radius` of
// (x, y), nearest first; equal distances by id (a stable order: the same click gives the same list)
export function stackAt(points, x, y, radius) {
  const seen = new Set(), out = [];
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > radius || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push([d, p.id]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, id]) => id);
}

// the marker a click on a stack selects: the clicked one, unless the click landed on the selected one (it is drawn on
// top, so a click again on the spot does): then the next after it in the stack, round. A click on the part of another
// marker that shows takes that one.
export function nextPick(stack, selected, clicked) {
  const i = stack.indexOf(selected);
  if (clicked !== selected || i < 0 || stack.length < 2) return clicked;
  return stack[(i + 1) % stack.length];
}

// the order a stack keeps while one of it is selected: the ids sorted (a click lands on the top one, which changes as
// the selection changes, so the nearest-first order of each click would jump about)
export const stackOrder = (ids) => [...ids].sort((a, b) => a - b);

// where to draw a removed mark: for each marker of `base` (the link as opened) that `markers` no longer has, its spot
// and, for a kind that leads somewhere, its destination: [{id, kind, floor, x, z, end}] (end: the destination).
// An area or a route: its middle (where(m)); a marker with no place gives none.
export function removedSpots(base, markers, where) {
  const now = new Set(markers.map((m) => m.id));
  const out = [];
  for (const m of base) {
    if (now.has(m.id)) continue;
    const at = "x" in m ? [m.x, m.z] : where(m);
    if (at) out.push({ id: m.id, kind: m.kind, floor: m.floor, x: at[0], z: at[1], end: false });
    if (m.dest && LEADS.includes(m.kind)) out.push({ id: m.id, kind: m.kind, floor: m.dest.floor, x: m.dest.x, z: m.dest.z, end: true });
  }
  return out;
}
