# Opengea Map

The map page at https://map.opengea.tech: the game's map in its minimap colours, floor by floor, with a small marker
editor. Staff send a link with markers already on it; a player moves, edits, adds or removes markers, presses **Save**
and posts the new link (with its list of changes) back in their ticket.

## Using it

- **Floors:** the selector over each map, and its ▲ ▼ buttons for the floor above or below (the next one with map in
  view; the view stays put; keys PageUp/PageDown or `]` `[` move the pane last pointed at); "Floors side by side"
  shows 2 or 3 at once, moving together.
- **Title:** the box in the bar names the map; the browser tab shows it ("Title - Opengea Map"). A link carries it;
  `?title=...` gives one to a link that has none.
- **Coordinates:** the bar at the bottom shows the cell under the cursor; a click on the map copies a `/pos`-style line.
- **Markers:** monster spawn (monster, how many, radius), point, area (paint cells: brush, rectangle, erase), route,
  note. Select one to drag it, change its fields or delete it. Undo/redo: the buttons, Ctrl+Z, Ctrl+Y.
- **Map things:** rope, lever, hole, door, portal, elevator (the **Objects** menu in the bar; **?** shows what each
  marker is). A rope, hole, portal or elevator can say **where it leads**: place it and the page asks at once (tap the
  spot, on any floor: change the floor above the map first (▲ ▼), or show floors side by side; **Skip** leaves it for
  later). Later: select it, then
  **Change**, **View**, **Remove**, or its destination floor in the panel; drag the small end marker to move it. Same
  floor: a dashed arrow. Another floor: "leads to floor N" on its label, the end marker on that floor, and an arrow
  across the panes when both floors are shown.
- **Locked markers** (🔒) are context: shown, but they can't be moved or changed.
- **Save** gives the link and a summary of what changed against the link you opened: added, moved (from → to), edited
  (field: old → new), removed, and a destination set, moved or removed.
- **Language:** Português, English, Español, 中文 (`?lang=pt|en|es|zh`, else the browser's).

## The link

Everything is in the URL `#fragment` (never sent to the server): `#1.` + base64url(raw deflate(payload)), `1` being the
format version. The format is documented at the top of `maplink.js`. Kinds of markers only get added, never renumbered,
and markers of a kind a page doesn't know are kept unchanged, so old links keep working.

Map things (rope .. elevator) came later as new kinds, ropes, holes, portals and elevators with an optional destination,
and a link may end with its own fields (the title); still format 1: a page from before them keeps such a marker
unchanged and ignores the title.

A made-up example (a locked area "A", a spawn, a point and a note):
`https://map.opengea.tech/?lang=en#1.Y2QIKGdhZGBhYWFiYGTgZU63YWJiACFGRkegAANvVCMjI0t4fk4aEwcLGyMTAwNHSi4jS0ZqUSoLMwMDv1s3IyNXcUFieZ5CZkpqIgMA`

Another, made up too, with a title: one of each map thing, a rope from the surface to floor -4, a portal back up and an
elevator to floor 2:
`https://map.opengea.tech/?lang=en#1.Hci7DoJAEAXQO8AuA_HRWu4XELCwMMbCREJBYWFhO8I2ZnEIEuLnm3jKQ6Ys9kV1uiUR2FprAGwO9ywhSjudenGVJfDq0hBLkEXenaQRENcPcEycnVsyo06zZAl4Xda0ysn-I-QGvG1aCxD74BfpdQLtrl8_jEGPTp8vP-vH9eoGGeUH`

## Files

- `index.html`, `style.css`, `app.js`: the page (Leaflet 1.9.4 from cdnjs, pinned with SRI).
- `maplink.js`: the link format, no DOM (`npm test` runs `tests/` under Node).
- `i18n.js`: the words; `monsters.js`: monster names for spawn markers.
- `tiles/<client version>/<floor>/<zoom>/<x>_<y>.png`: the map, one set per game client version so an old link opens
  on its own map; `tiles/index.json` lists the sets, `tiles/<version>/meta.json` the floors and tiles. Floor `s` is the
  surface; the others are slices by height. Only the coloured pictures are published.

## Running it locally

```
python -m http.server 8000
```
then open http://localhost:8000/ (a module page: opening `index.html` as a file doesn't work).
