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
- **Markers:** monster spawn (monster, how many, radius), boss (picked from the game's bosses or any name typed, when
  it comes, a note: a crown in a ringed disc, the schedule under its name), point, area (paint cells: brush, rectangle,
  erase), route, note. Select one to drag it, change its fields or delete it. Undo/redo: the buttons, Ctrl+Z, Ctrl+Y.
- **Map things:** rope, two-way rope, lever, hole, door, portal, elevator, NPC (name, when it is there, what it sells
  or does) (the **Objects** menu in the bar; **?** shows what each marker is). A two-way rope (goes and comes back) is
  drawn with a head at both ends of its arrow and ↔ on its label; a rope's panel turns it two-way and back.
- **Schedules** (boss, NPC): a picker, Always / Every hour at minute :MM (real clock) / Game time from HH to HH (Day,
  Night), with the words it will show under it (one game day is one real hour: the game window's real minutes too).
  A listed boss with one fixed window fills it in (still editable). In the link: "" always, `h05`, `g18-06`; a free text
  from an older link shows as "Custom: ..." until the picker replaces it.
- **Combat lock** (rope, two-way rope, lever, hole, portal, elevator): a checkbox; ⚔ on the marker and its label: it
  can't be used while the player is in battle. A rope, hole, portal or elevator can say **where it leads**: place it and the page asks at once (tap the
  spot, on any floor: change the floor above the map first (▲ ▼), or show floors side by side; **Skip** leaves it for
  later). Later: select it, then
  **Change**, **View**, **Remove**, or its destination floor in the panel; drag the small end marker to move it. Same
  floor: a dashed arrow. Another floor: "leads to floor N" on its label, the end marker on that floor, and an arrow
  across the panes when both floors are shown.
- **Locked markers** (🔒) are context: shown, but they can't be moved or changed.
- **Save** gives the link and a summary of what changed against the link you opened: added, moved (from → to), edited
  (field: old → new), removed, a destination set, moved or removed, and a rope made two-way (or one-way).
- **Language:** Português, English, Español, 中文 (`?lang=pt|en|es|zh`, else the browser's).

## The link

Everything is in the URL `#fragment` (never sent to the server): `#2.` + base64url(the payload), `2` being the format
version. The format is documented at the top of `maplink.js`. Kinds of markers only get added, never renumbered, and
markers of a kind a page doesn't know are kept unchanged, so old links keep working.

**Format 2** (what Save writes) packs the markers as bits, about half the length of format 1 for the same map:
- an area is its outlines (a start and the length of each side, holes and islands as more loops), not its rows;
- a spawn's monster is its place in `monsters.js` (append only), other names stay text;
- each point is written from the one before it, and a value the same as the previous marker's costs one bit;
- only the text (labels, notes, the title) is deflated; deflate made the packed bits longer.

**Format 1** links (`#1.`, from before) still open as they were; saving one writes it as format 2.

Map things (rope .. elevator) came later as new kinds, ropes, holes, portals and elevators with an optional destination,
and a link may end with its own fields (the title); still format 1: a page from before them keeps such a marker
unchanged and ignores the title. The two-way rope, the boss and the NPC (codes 11..13) came after format 2: each is
a length and a format-1 body, so the page before them keeps such a marker unchanged too. The combat lock is an
"extra" field of the core kinds: in format 2 the records end with link flag 1's extra fields (every format-2 page reads
past them; one from before drops only the lock), in format 1 a field key an older page skips; unset, a link is byte
for byte what it was.

Two made-up format-1 examples, which still open (a locked area "A", a spawn, a point and a note):
`https://map.opengea.tech/?lang=en#1.Y2QIKGdhZGBhYWFiYGTgZU63YWJiACFGRkegAANvVCMjI0t4fk4aEwcLGyMTAwNHSi4jS0ZqUSoLMwMDv1s3IyNXcUFieZ5CZkpqIgMA`

Another, made up too, with a title: one of each map thing, a rope from the surface to floor -4, a portal back up and an
elevator to floor 2:
`https://map.opengea.tech/?lang=en#1.Hci7DoJAEAXQO8AuA_HRWu4XELCwMMbCREJBYWFhO8I2ZnEIEuLnm3jKQ6Ys9kV1uiUR2FprAGwO9ywhSjudenGVJfDq0hBLkEXenaQRENcPcEycnVsyo06zZAl4Xda0ysn-I-QGvG1aCxD74BfpdQLtrl8_jEGPTp8vP-vH9eoGGeUH`

The same two maps saved as format 2:
`https://map.opengea.tech/?lang=en#2.AgBQdwQBAAQEBAAAnMozMrfEJGMdE0FLZmxS0mN0ZMlILUrlKi5ILM9TyExJTQQA`
`https://map.opengea.tech/?lang=en#2.AgUwLjIuMTxQBAIACAYGBgAAaDdjcuLBELUQTQOYoLwWKhjqLkrhJug0ImNPzi9KSVQw5EjMSSxLzEtOZC3ILypJZAOTORypOalliSn5RYwSrhWpuQU5-VYK-UlZqSX5xQop-Qq5iQWJAA`

## Files

- `index.html`, `style.css`, `app.js`: the page (Leaflet 1.9.4 from cdnjs, pinned with SRI).
- `maplink.js`: the link format, no DOM (`npm test` runs `tests/` under Node).
- `i18n.js`: the words; `monsters.js`: monster names for spawn markers; `bosses.js`: the bosses' names (and a fixed
  window to prefill); `schedule.js`: the schedule codes and their words (no DOM).
- `tiles/<client version>/<floor>/<zoom>/<x>_<y>.png`: the map, one set per game client version so an old link opens
  on its own map; `tiles/index.json` lists the sets, `tiles/<version>/meta.json` the floors and tiles. Floor `s` is the
  surface; the others are slices by height. Only the coloured pictures are published.

## Running it locally

```
python -m http.server 8000
```
then open http://localhost:8000/ (a module page: opening `index.html` as a file doesn't work).
