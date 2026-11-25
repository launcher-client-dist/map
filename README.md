# Opengea Map

The map page at https://map.opengea.tech: the game's map in its minimap colours, floor by floor, with a small marker
editor. Staff send a link with markers already on it; a player moves, edits, adds or removes markers, presses **Save**
and posts the new link (with its list of changes) back in their ticket.

## Using it

- **The page:** the bar on one line (the map's name, **Go to**, Edit / Review, undo, redo, language, open a file,
  **Share**); the tools in a rail on the left (on a phone: Select, Spawn, Objects, Note, More at the bottom); the
  marker's panel docked on the right (on a phone a drawer); the status bar at the bottom. `app.js` builds all of it, so
  an older cached `index.html` still works.
- **Floors:** the floors card over the maps lists every floor with markers and how many, the floors each one's ropes
  and portals join (⇅), a preview on hover, "+ N floors without markers", and 1 / 2 / 3 floors side by side (a new
  pane opens on the next floor down with markers, else the next with map in view). A click shows the floor in the pane
  last clicked and brings its markers into view. Each pane's selector shows the counts too; its ▲ ▼ go up or down by
  height (the surface between floor 0 and floor 1) to the next floor that matters (markers, or a rope's end), else the
  next with map in view, and their tooltip names it; Shift goes to every floor with map. Keys: PageUp/PageDown or `]`
  `[`. A link opens on its saved floors, any of them without markers swapped for the busiest one.
- **Go to** (Ctrl+K or `/`): paste the game's `/pos` line (or the page's, or `x, z`, or `x, y, z`): go there on the floor
  it names (the game prints "floor N" on the surface too, so the page offers that floor first when it has map at the
  spot, and the surface), **Mark here**, and the markers near it. Also a floor ("andar -4"), a marker by name or
  monster, or a map link to open.
- **Labels:** Auto (on hover, the selected marker, wide areas, and every name from zoom 4 in), Always, Never (on
  hover); this browser remembers it. A spawn of several monsters shows ×N on its marker.
- **Title:** the box in the bar names the map; the browser tab shows it ("Title - Opengea Map"). A link carries it;
  `?title=...` gives one to a link that has none.
- **Coordinates:** the status bar shows the cell under the cursor (a click on it copies its `/pos`-style line); a click
  on the map in Select copies it too.
- **Link size:** the status bar shows the link's length live (and Share's message's), amber from 1,800 characters and
  red past Discord's 2,000. Past it, **Share** offers **Download file**: a `.txt` with the message and the whole change
  list, to attach in the ticket. **Open a file** (or a file dropped on the page) opens the link in it.
- **Stamp mode:** a place tool stays armed after each click (Esc, Select or **Done** ends it). For spawns the bar over
  the map holds what the next one gets: the monster (typed, or a chip of the ones on this map), how many and the radius;
  editing or tapping a spawn sets them too. A rope, hole or portal asks where it leads, then the tool is armed again.
  On a phone the bar sits at the bottom and a placed spawn opens no drawer.
- **Several at once:** Shift+click adds or takes off a marker, Shift+drag selects a box (locked context markers stay
  out). The panel then offers **Move** (then a tap: the group's middle goes there, on that pane's floor), **Duplicate**
  (also Ctrl+D, for one marker too: copies a little apart, selected), **To floor** and **Delete**; dragging one of them
  moves them all. Each is one undo step.
- **Review** (for everyone): look only (nothing moves or changes). The panel sums up what the map proposes (monsters,
  spawns, species, floors, the locked context apart; monsters by species with a bar per floor; objects) and what to
  check before sending (ropes, holes and portals without a destination, notes next to a spawn, levers with no action
  or whose area is gone; **show** goes to each). On the map, what changed against the link this one was saved from:
  a green halo on the new ones, amber on the moved or edited, the removed ones faded where they were; **Only changes**
  hides the rest; the floors card counts the changes per floor; the **Changes** tab lists them (a click goes there).
- **Share:** the map's name (editable there), the message as Discord shows it, summary first: the name as the link,
  what it proposes and its objects, its changes counted (the list opens in the link's "View"); the meter; what to check.
- **Markers:** monster spawn (the monster typed, or picked from the ones already on this map; how many, − / +; the
  radius as buttons, the circle and a sentence saying what it means; how many of that monster the map holds; an
  **observation**, shown under its name with ✎ on the marker), boss (picked from the game's bosses or any name typed, when
  it comes, a note: a crown in a ringed disc, the schedule under its name), point, area (paint cells: brush, rectangle,
  erase; a **colour** from swatches), route, note. Select one to drag it, change its fields or delete it. Undo/redo: the
  buttons, Ctrl+Z, Ctrl+Y.
- **Map things:** rope, two-way rope, lever, hole, door, portal, elevator, NPC (name, when it is there, what it sells
  or does) (in the rail, one click each; on a phone the **Objects** menu; **Legend** shows what each marker is). A two-way rope (goes and comes back) is
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
  across the panes when both floors are shown. A portal can wear the game's purple, blue or red (its marker and arrow).
- **A lever's action** ("When pulled"): Not said / **Opens walls** / **Takes the player**. Walls: the cells marked on the
  map (each tap adds or takes off one, at most 32) or an area of the map, and **Toggle** (open until pulled again, the
  game's default) or **Timed** (10 / 30 / 60 / 120 s or another number); drawn as hatched cells with a line from the
  lever. Takes the player: a tap on any floor shown; drawn like a rope's arrow. A sentence says what it does.
- **Locked markers** (🔒) are context: shown, but they can't be moved or changed.
- **The change list** (the banner's "View", Review's Changes tab, the file) says what changed against the link you
  opened: added, moved (from → to), edited (field: old → new; a lever's action and a colour in words), removed, a
  destination set, moved or removed, and a rope made two-way (or one-way).
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
for byte what it was. A spawn's observation, an area's and a portal's colour (an index in `COLORS`) and a lever's
action (`lever.js`: a short code with its cells relative to the lever, so moving or duplicating it carries the action)
are extra fields the same way: a map that uses none of them keeps its exact bytes; each costs a few characters when
used (a colour about 4, a lever's area about 8, an observation its deflated text).

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
- `floors.js`: which floor a step, a new pane or an opened link goes to, the counts and the rope links per floor;
  `goto.js`: what a text in Go to means (a `/pos`, `x, z`, a floor, a search). No DOM; `tests/ui.test.mjs`.
- `lever.js`: a lever's action code and its words; `review.js`: the summary, the checks, the diff and Share's
  message; `edits.js`: moving, duplicating and boxing several markers. No DOM; `tests/review.test.mjs`.
- `tiles/<client version>/<floor>/<zoom>/<x>_<y>.png`: the map, one set per game client version so an old link opens
  on its own map; `tiles/index.json` lists the sets, `tiles/<version>/meta.json` the floors and tiles. Floor `s` is the
  surface; the others are slices by height. Only the coloured pictures are published.

## Running it locally

```
python -m http.server 8000
```
then open http://localhost:8000/ (a module page: opening `index.html` as a file doesn't work).
