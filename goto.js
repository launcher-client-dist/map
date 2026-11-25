// The "Go to" box: what a typed or pasted text means. No DOM here: the page and the tests (node) share it.
//
// A place: the game's /pos line ("[pos] x -271.0, y -1.2, z 283.0 (floor -2)"), this page's own copy of it (the same,
// or "[pos] x 12.0, z -40.0 (surface)"), "x, z", or "x, y, z". The game prints "(floor N)" with N = round(y - 0.8) on
// the surface too (standing on a hill at y 3.3 says "floor 2"), so a floor tag or a y names a slice that may or may not
// be where the player stood: the page offers that slice when it has map at the spot, and the surface.

const NUM = "(-?\\d+(?:[.,]\\d+)?)";
const num = (s) => +String(s).replace(",", ".");

// {x, z, y (or null), tag ("s", a floor id, or null)}, or null when the text is not a place
export function parsePlace(text) {
  let s = String(text ?? "").toLowerCase().trim();
  if (!s) return null;
  let tag = null;
  const surf = s.match(/\(\s*surface\s*\)/), fl = s.match(/\(\s*floor\s*(-?\d+)\s*\)/);
  if (surf) tag = "s";
  else if (fl) tag = String(+fl[1]);   // "-0" -> "0"
  s = s.replace(/\([^)]*\)/g, " ").replace(/\[pos\]/g, " ");
  const named = (k) => s.match(new RegExp(`(?:^|[^a-z])${k}\\s*[:=]?\\s*${NUM}`));
  const nx = named("x"), nz = named("z"), ny = named("y");
  let x, y = null, z;
  if (nx && nz) {
    x = num(nx[1]); z = num(nz[1]);
    if (ny) y = num(ny[1]);
  } else {
    // bare numbers: "x, z" or "x, y, z" (a comma between numbers separates them; "1,5" alone is not a decimal here)
    if (/[a-z]/.test(s.replace(/\b[xyz]\b/g, ""))) return null;   // words: a search, not a place
    const ns = [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => +m[0]);
    if (ns.length === 2) [x, z] = ns;
    else if (ns.length === 3) [x, y, z] = ns;
    else return null;
  }
  if (![x, z].every(Number.isFinite)) return null;
  return { x: Math.round(x) || 0, z: Math.round(z) || 0, y: y == null || !Number.isFinite(y) ? null : y, tag };
}

// The floors a place may be on, the likeliest first: a "(surface)" tag: the surface; a floor tag or a y: that slice
// (when the page has it and hasMap(floor, x, z) says there is map at the spot) and the surface; neither: null (the
// floor shown now).
export async function placeFloors(place, floors, hasMap = async () => true) {
  if (place.tag === "s") return ["s"];
  const n = place.tag ?? (place.y != null ? String(Math.round(place.y - 0.8)) : null);
  if (n == null) return null;
  const slice = String(+n);
  const out = [];
  if (floors.includes(slice) && (await hasMap(slice, place.x, place.z))) out.push(slice);
  out.push("s");
  return out;
}

// "andar -4", "floor -4", "piso -4", "-4 层", "superfície" / "surface" / "superficie" / "地面": that floor id; else null
export function parseFloor(text, floors) {
  const s = fold(text).trim();
  if (/^(superficie|surface|地面|sup\.?)$/.test(s)) return "s";
  const m = s.match(/^(?:andar|floor|piso|level|第)\s*(-?\d+)\s*层?$/) || s.match(/^(-?\d+)\s*层$/);
  if (!m) return null;
  const f = String(+m[1]);
  return floors.includes(f) ? f : null;
}

// lower case, no accents: "Superfície" ~ "superficie"
export function fold(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// markers whose words (textOf(m): name, monster, label, note) hold every word of the query, the best first (a word
// at the start of the text first, then the shortest text)
export function searchMarkers(markers, query, textOf, max = 8) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const m of markers) {
    const t = fold(textOf(m));
    if (!t || !words.every((w) => t.includes(w))) continue;
    hits.push([t.startsWith(words[0]) ? 0 : 1, t.length, m]);
  }
  return hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, max).map((h) => h[2]);
}

// the markers on a floor within r cells of (x, z), the nearest first: [{m, d}] (d rounded, in cells)
export function nearMarkers(markers, x, z, floor, where, r = 40, max = 5) {
  const out = [];
  for (const m of markers) {
    if (m.floor !== floor) continue;
    const w = where(m);
    if (!w) continue;
    const d = Math.hypot(w[0] - x, w[1] - z);
    if (d <= r) out.push({ m, d: Math.round(d) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}
