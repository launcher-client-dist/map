// Floor up / down: which floor a step goes to. No DOM here: the page and the tests (node) share it.
import { floorOf } from "./maplink.js";
// floors: the tile set's floors from the top (the surface "s", then 10 .. -16); tiles: {floor: {"0": ["x_y", ...]}}, the
// zoom-0 tiles each floor has (256 cells a side); view: [x0, y0, x1, y1], the view's corners in zoom-0 pixels.

// the zoom-0 tile names a view touches
export function tilesInView([x0, y0, x1, y1]) {
  const out = [];
  for (let tx = Math.floor(Math.min(x0, x1) / 256); tx <= Math.floor(Math.max(x0, x1) / 256); tx++)
    for (let ty = Math.floor(Math.min(y0, y1) / 256); ty <= Math.floor(Math.max(y0, y1) / 256); ty++) out.push(tx + "_" + ty);
  return out;
}

// dir -1: the floor above, +1: the floor below: the next one with a map tile in the view (floors blank there are
// skipped); null at the end or when none has map here
export function nextFloor(floors, tiles, current, dir, view) {
  const here = tilesInView(view);
  for (let i = floors.indexOf(current) + dir; i >= 0 && i < floors.length; i += dir) {
    const have = new Set(tiles[floors[i]]?.["0"] || []);
    if (here.some((k) => have.has(k))) return floors[i];
  }
  return null;
}

// how high a floor is: the slices by their number; the surface between floor 0 and floor 1 (the slices 1 .. 10 are
// buildings' upper floors, 0 and below the ground and the caves under it)
export const level = (f) => (f === "s" ? 0.5 : +f);

// ▲ / ▼ by height (the surface between floor 0 and floor 1): dir -1 up, +1 down. The next floor that matters (it holds
// markers, or a rope's or portal's end: `matters`); none that way: the next one with a map tile in the view (`every`:
// that one, matters or not). null: nothing that way.
export function stepFloor(floors, tiles, current, dir, view, matters = [], every = false) {
  const here = tilesInView(view), lv = level(current);
  const way = floors.filter((f) => (dir < 0 ? level(f) > lv : level(f) < lv))
    .sort((a, b) => (dir < 0 ? level(a) - level(b) : level(b) - level(a)));
  const mapped = (f) => { const have = new Set(tiles[f]?.["0"] || []); return here.some((k) => have.has(k)); };
  if (!every) { const m = way.find((f) => matters.includes(f)); if (m) return m; }
  return way.find(mapped) ?? null;
}

// the floors joined by ropes, holes, portals and elevators that lead from one floor to another: {floor: [floors]}
export function floorLinks(markers) {
  const out = {};
  const add = (a, b) => { (out[a] ||= []).includes(b) || out[a].push(b); };
  for (const m of markers) if (m.dest && m.dest.floor !== m.floor) { add(m.floor, m.dest.floor); add(m.dest.floor, m.floor); }
  for (const k of Object.keys(out)) out[k].sort((a, b) => level(b) - level(a));
  return out;
}

// the markers on each floor: {floor: n}; a floor with none is absent
export function floorCounts(markers) {
  const out = {};
  for (const m of markers) out[m.floor] = (out[m.floor] || 0) + 1;
  return out;
}

// The floor a new side-by-side pane opens on. shown: the panes' floors now. The next floor down from the last pane
// that has markers and isn't shown; else the nearest one up; with no markers left, the next floor down from the last
// pane (then up) that has map in the view (hasMap(floor)), never just the next entry of the list (the top of the
// world, floor 10, from the surface). null: nothing to add.
export function paneFloor(floors, counts, shown, hasMap = () => true) {
  const last = level(shown[shown.length - 1] ?? "s");
  const free = floors.filter((f) => !shown.includes(f));
  const pick = (list) => {
    const down = list.filter((f) => level(f) < last).sort((a, b) => level(b) - level(a));
    const up = list.filter((f) => level(f) > last).sort((a, b) => level(a) - level(b));
    return down[0] ?? up[0] ?? null;
  };
  return pick(free.filter((f) => counts[f] > 0))
    ?? pick(free.filter((f) => hasMap(f)))
    ?? null;
}

// The floors a link opens on: its saved panes, each one with no markers swapped for the busiest floor not shown yet
// (the link's own choice stays when it has markers there, or the end of a rope, hole or portal: landings; a link with
// no markers at all opens as saved).
export function openingFloors(saved, counts, landings = []) {
  if (!Object.keys(counts).length) return saved.slice();
  const busiest = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || level(b) - level(a));
  const out = [];
  for (const f of saved) {
    if ((counts[f] > 0 || landings.includes(f)) && !out.includes(f)) { out.push(f); continue; }
    const next = busiest.find((b) => !out.includes(b) && !saved.includes(b));
    out.push(next ?? f);
  }
  return out;
}

// ---- Owners (tiles/<version>/owner/<floor>/<i>_<j>.png, map_tiles.py): in a floor's band, the cells whose ground
// belongs to another floor (a ledge 2 or more above it: the -7 ledge shown in the -9 band). A pixel's red is that
// floor's link code + 1 (maplink.js floorCode); 0 or transparent: the floor's own. Zoom-0 tiles, one pixel a cell,
// cell (x, z) at canvas pixel (x + 1024, -z + 1024), tile i = floor(x / 256), j = floor(-z / 256) (as map_tiles cuts).
export function ownerTile(x, z) {
  const px = x + 1024, py = -z + 1024;
  const i = Math.floor(px / 256) - 4, j = Math.floor(py / 256) - 4;
  return { key: i + "_" + j, at: (py - (j + 4) * 256) * 256 + (px - (i + 4) * 256) };
}

// the floor a marker put on cell (x, z) of the pane on `floor` belongs to: the owner pixel's floor, else the pane's.
// value: the owner pixel's red (0: the floor's own; undefined: no owner data, the pane's floor)
export function cellFloor(floor, value) {
  return value ? floorOf(value - 1) : floor;
}

// a hole in a pane's view shows the ground below it: a marker of another floor is seen there (dimmed) when that floor is
// the ground's own floor (lookFloor, the owner tile's green), or is the surface and the ground is a slice 0 .. 10 (the
// surface's ground is under the same cells those slices draw: a spawn put on it from the 3D view is the surface's)
export function seenFromAbove(markerFloor, lookFloor) {
  if (lookFloor == null) return false;
  return markerFloor === lookFloor || (markerFloor === "s" && /^\d+$/.test(String(lookFloor)));
}
