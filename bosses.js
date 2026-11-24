// The game's bosses for the boss marker's list: display names only (a custom name is typed freely), and for a boss
// that comes back in one fixed window every game day, that window as a schedule code (schedule.js) to prefill the
// picker (editable). A boss with no code here has more than one window, or none fixed. Append or edit by name.
export const BOSSES = [
  ["Alpha Wolf", ""],
  ["Bridge Troll", ""],
  ["Brother Rossi", "g01-02"],
  ["Capozzi The Bandit", "g01-04"],
  ["Conquest Champion", ""],
  ["Gaglio The Bandit", "g01-04"],
  ["Great Lintwurm", "g01-04"],
  ["Mateo The Bandit", "g01-04"],
  ["Minerva", ""],
  ["Pestilence Knight", ""],
  ["Skal Brawler", ""],
  ["The Augur", "g01-04"],
  ["The Black Knight", "g01-04"],
  ["The Blackhat", ""],
  ["The Broodmother", "g01-04"],
  ["The Gardener", ""],
  ["Tock", ""],
];

// the boss's prefill code by name (case does not matter), "" when none; its name as listed, or null
export function bossOf(name) {
  const n = String(name ?? "").trim().toLowerCase();
  const b = BOSSES.find(([x]) => x.toLowerCase() === n);
  return b ? { name: b[0], schedule: b[1] } : null;
}
