// Edits of several markers at once (multi-select, duplicate): no DOM, the page and its tests share it. Each returns new
// markers; the page commits the result as one undo step.
import { remapArea } from "./lever.js";

// a marker moved by (dx, dz): its point, cells or route points, and its destination when on the same floor (a rope's
// landing on another floor stays where it is unless `dest` says to move it too)
export function moved(m, dx, dz, dest = false) {
  const n = structuredClone(m);
  if ("x" in n) { n.x += dx; n.z += dz; }
  if (n.cells) n.cells = n.cells.map(([x, z]) => [x + dx, z + dz]);
  if (n.points) n.points = n.points.map(([x, z]) => [x + dx, z + dz]);
  if (n.dest && (dest || n.dest.floor === m.floor)) n.dest = { ...n.dest, x: n.dest.x + dx, z: n.dest.z + dz };
  return n;
}

// copies of the markers, by (dx, dz), with new ids from next: [copies, next after them]. A copied lever that opens a
// copied area opens the copy. The copies are never locked (a context marker's copy is the proposer's own).
export function duplicated(list, next, dx = 2, dz = -2) {
  const ids = {};
  const out = list.map((m) => { const n = moved(m, dx, dz, true); ids[m.id] = n.id = next++; n.locked = false; return n; });
  for (const n of out) if (n.kind === "lever" && n.fields?.pull) n.fields.pull = remapArea(n.fields.pull, ids);
  return [out, next];
}

// the middle of several markers' places ([x, z], rounded): where a group is when it moves to a click
export function middle(points) {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]), zs = points.map((p) => p[1]);
  return [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...zs) + Math.max(...zs)) / 2)];
}

// markers inside a box of cells (corners in any order): a point inside, an area or a route with any cell or point inside
export function inBox(markers, floor, [x0, z0], [x1, z1]) {
  const lx = Math.min(x0, x1), hx = Math.max(x0, x1), lz = Math.min(z0, z1), hz = Math.max(z0, z1);
  const inside = ([x, z]) => x >= lx && x <= hx && z >= lz && z <= hz;
  return markers.filter((m) => m.floor === floor && ("x" in m ? inside([m.x, m.z]) : (m.cells || m.points || []).some(inside)));
}
