// When a boss comes or an NPC is out: the schedule field's compact form and its words. No DOM: the page, its tests and
// the staff tools (maplink.py's schedule_text: the same words in pt and en) share it.
//
// The field stays a string (so the link format is unchanged), in one of these forms:
//   ""         always: the normal respawn (no field in the link at all)
//   "hMM"      every real hour at minute MM (00..59): a boss's return
//   "gHH-HH"   from game hour HH to game hour HH (00..23, may wrap past midnight): an NPC's window
// Anything else is a free text from a link made before the picker: shown as "Custom: <text>", kept as it is.
// The game's clock: one game day lasts one real hour.

const HOUR = /^h([0-5]\d)$/;
const GAME = /^g([01]\d|2[0-3])-([01]\d|2[0-3])$/;
const NIGHT = (h) => h >= 18 || h < 6;   // night 18-06, day 06-18

// {mode: "always" | "hour" | "game" | "custom", minute, from, to, text}
export function parseSchedule(s) {
  s = String(s ?? "");
  if (!s) return { mode: "always" };
  let m = HOUR.exec(s);
  if (m) return { mode: "hour", minute: +m[1] };
  m = GAME.exec(s);
  if (m) return { mode: "game", from: +m[1], to: +m[2] };
  return { mode: "custom", text: s };
}

const pad = (n) => String(n).padStart(2, "0");

// the compact form of {mode, minute, from, to} ("" for always)
export function scheduleCode(p) {
  if (p.mode === "hour") return "h" + pad(Math.max(0, Math.min(59, Math.round(+p.minute) || 0)));
  if (p.mode === "game") {
    const h = (v) => pad(Math.max(0, Math.min(23, Math.round(+v) || 0)));
    return "g" + h(p.from) + "-" + h(p.to);
  }
  if (p.mode === "custom") return String(p.text ?? "");
  return "";
}

// "day", "night" or "" for a game window [from, to) (hours, wrapping past midnight; from == to: the whole day)
export function windowTag(from, to) {
  if (from === to) return "";
  const hours = [];
  for (let h = from; h !== to; h = (h + 1) % 24) hours.push(h);
  if (hours.every(NIGHT)) return "night";
  if (hours.every((h) => !NIGHT(h))) return "day";
  return "";
}

// The schedule in words. t: the page's translator (i18n.js); the keys sched.*
export function scheduleText(s, t) {
  const p = parseSchedule(s);
  if (p.mode === "always") return t("sched.alwaysText");
  if (p.mode === "hour") return t("sched.hourText", pad(p.minute));
  if (p.mode === "custom") return t("sched.custom", p.text);
  if (p.from === p.to) return t("sched.gameAllText");
  const tag = windowTag(p.from, p.to);
  return t("sched.gameText", pad(p.from), pad(p.to)) + (tag ? ` (${t("sched." + tag + "Tag")})` : "")
    + " · " + t("sched.realText", realMinute(p.from), realMinute(p.to));
}

// A game hour on the real clock: one game day is one real hour, so game hour h starts at real minute h * 2.5 of every
// hour (01h -> ":02:30", 04h -> ":10")
export function realMinute(h) {
  const s = h * 150;
  return ":" + pad(Math.floor(s / 60)) + (s % 60 ? ":" + pad(s % 60) : "");
}
