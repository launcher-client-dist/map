# Opengea Map

The map page at https://map.opengea.tech: the game's map in its minimap colours, floor by floor, with a small marker
editor. Staff send a link with markers already on it; a player moves, edits, adds or removes markers, presses **Save**
and posts the new link (with its list of changes) back in their ticket.

## Using it

- **Floors:** the selector over each map; "Floors side by side" shows 2 or 3 at once, moving together.
- **Coordinates:** the bar at the bottom shows the cell under the cursor; a click on the map copies a `/pos`-style line.
- **Markers:** monster spawn (monster, how many, radius), point, area (paint cells: brush, rectangle, erase), route,
  note. Select one to drag it, change its fields or delete it. Undo/redo: the buttons, Ctrl+Z, Ctrl+Y.
- **Locked markers** (🔒) are context: shown, but they can't be moved or changed.
- **Save** gives the link and a summary of what changed against the link you opened: added, moved (from → to), edited
  (field: old → new), removed.
- **Language:** Português, English, Español, 中文 (`?lang=pt|en|es|zh`, else the browser's).

## The link

Everything is in the URL `#fragment` (never sent to the server): `#1.` + base64url(raw deflate(payload)), `1` being the
format version. The format is documented at the top of `maplink.js`. Kinds of markers only get added, never renumbered,
and markers of a kind a page doesn't know are kept unchanged, so old links keep working.

A made-up example (a locked area "A", a spawn, a point and a note):
`https://map.opengea.tech/?lang=en#1.Y2QIKGdhZGBhYWFiYGTgZU63YWJiACFGRkegAANvVCMjI0t4fk4aEwcLGyMTAwNHSi4jS0ZqUSoLMwMDv1s3IyNXcUFieZ5CZkpqIgMA`

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
