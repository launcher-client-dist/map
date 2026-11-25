// For the cross tests of the staff tools: node tests/cli.mjs encode|decode|payload|payload1|changes|schedule|monsters, input on
// stdin (payload: format 2's head + text; payload1: format 1's payload).
import { encode, decode, payloadOf, changes, COLORS } from "../maplink.js";
import { parseLever, leverText } from "../lever.js";
import { MONSTERS } from "../monsters.js";
import { translator } from "../i18n.js";
import { scheduleText } from "../schedule.js";

const input = (await new Promise((ok) => { let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => ok(s)); })).trim();
const cmd = process.argv[2];
if (cmd === "encode") process.stdout.write(await encode(JSON.parse(input)));
else if (cmd === "decode") process.stdout.write(JSON.stringify(await decode(input)));
else if (cmd === "payload") process.stdout.write(Buffer.from(payloadOf(JSON.parse(input))).toString("hex"));
else if (cmd === "payload1") process.stdout.write(Buffer.from(payloadOf(JSON.parse(input), 1)).toString("hex"));
else if (cmd === "changes") process.stdout.write(JSON.stringify(changes(await decode(input))));
else if (cmd === "schedule") {   // a list of schedule codes -> their words in pt and en (maplink.py: the same)
  const codes = JSON.parse(input);
  process.stdout.write(JSON.stringify(Object.fromEntries(["pt", "en"].map((l) => [l, codes.map((c) => scheduleText(c, translator(l)))]))));
}
else if (cmd === "monsters") process.stdout.write(JSON.stringify(MONSTERS));
else if (cmd === "colors") process.stdout.write(JSON.stringify(COLORS));
else if (cmd === "lever") {   // a list of [code, x, z] -> each one's words in pt and en, and its parsed form (maplink.py: the same)
  const rows = JSON.parse(input);
  const fw = { pt: (f) => (f === "s" ? "superfície" : "andar " + f), en: (f) => (f === "s" ? "surface" : "floor " + f) };
  process.stdout.write(JSON.stringify({
    parsed: rows.map(([c]) => parseLever(c)),
    ...Object.fromEntries(["pt", "en"].map((l) => [l, rows.map(([c, x, z]) => leverText(c, translator(l), { x, z }, fw[l]))])),
  }));
}
else { console.error("usage: node tests/cli.mjs encode|decode|payload|payload1|changes|schedule|monsters|colors|lever < input"); process.exit(2); }
