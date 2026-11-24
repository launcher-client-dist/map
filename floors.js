// Floor up / down: which floor a step goes to. No DOM here: the page and the tests (node) share it.
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
