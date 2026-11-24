// For the cross tests of the staff tools: node tests/cli.mjs encode|decode|payload|payload1|changes|monsters, input on
// stdin (payload: format 2's head + text; payload1: format 1's payload).
import { encode, decode, payloadOf, changes } from "../maplink.js";
import { MONSTERS } from "../monsters.js";

const input = (await new Promise((ok) => { let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => ok(s)); })).trim();
const cmd = process.argv[2];
if (cmd === "encode") process.stdout.write(await encode(JSON.parse(input)));
else if (cmd === "decode") process.stdout.write(JSON.stringify(await decode(input)));
else if (cmd === "payload") process.stdout.write(Buffer.from(payloadOf(JSON.parse(input))).toString("hex"));
else if (cmd === "payload1") process.stdout.write(Buffer.from(payloadOf(JSON.parse(input), 1)).toString("hex"));
else if (cmd === "changes") process.stdout.write(JSON.stringify(changes(await decode(input))));
else if (cmd === "monsters") process.stdout.write(JSON.stringify(MONSTERS));
else { console.error("usage: node tests/cli.mjs encode|decode|payload|payload1|changes|monsters < input"); process.exit(2); }
