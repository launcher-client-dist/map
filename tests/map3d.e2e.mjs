// The 3D view in a real browser, end to end: place a rope post and its landing by clicking the 3D view, a spawn in the
// canal, and check that the page's link holds them (the same markers the 2D page makes) and that the check flags the
// canal. Needs Microsoft Edge (or Chrome: BROWSER=path) and the map3d/ test data; not in `npm test`.
//   node tests/map3d.e2e.mjs [--shots DIR]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { decode } from "../maplink.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER = process.env.BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".bin": "application/octet-stream", ".glb": "model/gltf-binary" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a static server of the repo
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const profile = await mkdtemp(join(tmpdir(), "map3d-e2e-"));
const dbg = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(BROWSER, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--remote-debugging-port=${dbg}`,
  `--user-data-dir=${profile}`, "--window-size=1440,900", "--no-first-run", "about:blank"], { stdio: "ignore" });

let ws, seq = 0, netBytes = 0;
const waiting = new Map();
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, no) => waiting.set(id, { ok, no }));
}
async function js(expr) {
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(expr + ": " + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
async function clickAt(x, y, modifiers = 0) {
  // (the 3D view's own cards sit over its canvas: a click meant for the map must land on the canvas)
  assert.equal(await js(`document.elementFromPoint(${x}, ${y})?.className`), "v3d-canvas", `the canvas is under (${Math.round(x)}, ${Math.round(y)})`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers });
  await sleep(150);
}
async function moveTo(x, y) { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await sleep(120); }
// a key as the keyboard sends it (modifiers: 2 Ctrl)
async function key(k, code, vk, modifiers = 0) {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(k.length === 1 && !modifiers ? { text: k } : {}) });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(150);
}
async function shot(name) {
  if (!shots) return;
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  await writeFile(join(shots, name), Buffer.from(r.data, "base64"));
  console.log("shot", join(shots, name));
}

let failed = false;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* starting */ }
    if (!target) await sleep(200);
  }
  assert.ok(target, "the browser's page");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") console.error("page:", m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) console.error("page " + m.params.type + ":", m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Network.loadingFinished") netBytes += m.params.encodedDataLength || 0;
    // (leaving a page with edits not shared asks first: the test says yes)
    if (m.method === "Page.javascriptDialogOpening") cdp("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.no(new Error(m.error.message)) : w.ok(m.result); }
  });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  const nav = await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/?lang=en&view=3d&at=-238,174&zoom=1.3` });
  if (nav.errorText) throw new Error("navigate: " + nav.errorText);
  await sleep(1500);
  const up = await js(`(async () => { for (let i = 0; i < 200 && !window.__v3d; i++) await new Promise((r) => setTimeout(r, 100));
    if (!window.__v3d) return location.href + " | body: " + document.body.className + " | 3d: " + !!document.getElementById("view3d") + " | " + (document.querySelector(".v3d-msg")?.textContent || "");
    await window.__v3d.ready; return true; })()`);
  assert.equal(up, true, "the 3D view opened");
  const st = await js("window.__v3d.state()");
  assert.ok(st.chunks > 0, "chunks loaded");

  // a rope post on the street and its landing a few cells away, both by clicks on the 3D view
  await js(`document.querySelector('[data-place=rope]').click()`);
  // (each spot measured just before its click: a placed marker opens its panel, and the view gets narrower)
  const post = await js("window.__v3d.screenOf(-234, 175)");
  assert.ok(post, "the post's cell is on the screen");
  await clickAt(post.x, post.y);
  await sleep(300);
  const land = await js("window.__v3d.screenOf(-237, 178)");
  assert.ok(land, "the landing's cell is on the screen");
  if (process.env.DEBUG) console.log("after post:", JSON.stringify(await js("(() => { const s = window.__v3d.state(); return { tool: s.tool, pending: s.pending, sel: window.__state().selected, n: window.__state().markers.length }; })()")),
    "land", JSON.stringify(land), "pick", JSON.stringify(await js(`(() => { const p = window.__v3d.pick(${land.x}, ${land.y}); return p && { x: p.x, z: p.z, y: p.y, level: p.level, layer: !!p.layer }; })()`)));
  await clickAt(land.x, land.y);
  if (process.env.DEBUG) console.log("after land:", JSON.stringify(await js("(() => { const s = window.__v3d.state(); return { tool: s.tool, pending: s.pending, markers: window.__state().markers }; })()")));
  await js(`document.querySelector('[data-place=rope]').click()`);   // the tool off again

  // a spawn in the canal: placed (the page lets a mapper place anything), flagged red by the check
  await js(`document.querySelector('[data-place=spawn]').click()`);
  await sleep(300);
  const canal = await js("window.__v3d.screenOf(-245, 176)");
  await clickAt(canal.x, canal.y);
  await js(`document.querySelector('[data-place=spawn]').click()`);
  await sleep(700);   // (the address bar is written 400 ms after an edit)

  const state = await js("window.__state()");
  const rope = state.markers.find((m) => m.kind === "rope");
  assert.ok(rope, "a rope post was placed: " + JSON.stringify(state.markers));
  assert.deepEqual([rope.x, rope.z, rope.floor], [-234, 175, "s"]);
  assert.deepEqual(rope.dest, { x: -237, z: 178, floor: "s" });
  const spawnM = state.markers.find((m) => m.kind === "spawn");
  assert.deepEqual([spawnM.x, spawnM.z, spawnM.floor], [-245, 176, "s"]);

  // the link round trip: the address bar's fragment decodes to the same markers
  const hash = await js("location.hash");
  const dec = await decode(hash);
  const r2 = dec.markers.find((m) => m.kind === "rope");
  assert.deepEqual([r2.x, r2.z, r2.floor, r2.dest], [-234, 175, "s", { x: -237, z: 178, floor: "s" }]);
  assert.ok(dec.markers.some((m) => m.kind === "spawn" && m.x === -245 && m.z === 176));

  // the check: the canal spawn is a problem (under water), the rope and its landing are not
  const probs = (await js("window.__v3d.state()")).problems;
  const sp = probs.find((p) => p.kind === "spawn");
  assert.ok(sp && sp.level === "bad" && sp.reasons.some((r) => r.code === "water"), "canal spawn flagged: " + JSON.stringify(probs));
  assert.ok(!probs.some((p) => p.kind === "rope"), "the rope pair passes: " + JSON.stringify(probs));
  await js(`window.dispatchEvent(new Event("resize"))`);
  await sleep(300);
  await shot("05_placed_by_click.png");

  // copy and paste: the rope selected, Ctrl+C, the cursor on another cell, Ctrl+V: a second rope there, its landing along
  const post2 = await js("window.__v3d.screenOf(-234, 175)");
  await clickAt(post2.x, post2.y);   // (no tool armed: selects the rope)
  await key("c", "KeyC", 67, 2);
  const there = await js("window.__v3d.screenOf(-232, 176)");
  await moveTo(there.x, there.y);
  await key("v", "KeyV", 86, 2);
  await sleep(500);
  await shot("pasted.png");
  const ropes = (await js("window.__state()")).markers.filter((m) => m.kind === "rope");
  assert.equal(ropes.length, 2, "a pasted rope: " + JSON.stringify(ropes));
  const copy = ropes.find((m) => m.x === -232 && m.z === 176);
  assert.ok(copy && copy.dest && copy.dest.x === -235 && copy.dest.z === 179, "the copy at the cursor, its landing moved along: " + JSON.stringify(ropes));

  // the map's blocks: a click on the house's roof shows the whole roof; Alt+click one block
  await key("Escape", "Escape", 27);
  const roof = await js("window.__v3d.screenOf(-226, 177)");
  await clickAt(roof.x, roof.y);
  const whole = (await js("window.__v3d.state()")).asset;
  assert.ok(whole && whole.kind === "roof" && whole.n > 1, "the whole roof: " + JSON.stringify(whole));
  await shot("asset_whole.png");
  await clickAt(roof.x, roof.y, 1);
  const one = (await js("window.__v3d.state()")).asset;
  assert.ok(one && one.n === 1, "Alt: one block: " + JSON.stringify(one));
  await shot("asset_one.png");

  // the keys: ? lists them; ] / [ step the floors; , lowers the cut
  await key("?", "Slash", 191);
  assert.equal(await js("!document.querySelector('.v3d-help').hidden"), true, "the shortcuts list");
  await key("Escape", "Escape", 27);
  await key("[", "BracketLeft", 219);
  assert.notEqual((await js("window.__v3d.state()")).floor, "all", "[ steps down a floor");
  await key(",", "Comma", 188);
  assert.ok((await js("window.__v3d.state()")).cut != null, ", lowers the cut");
  // W held: the view's centre glides up the screen (north at the start); after E (a 90° turn) W goes east
  const hold = async (k, code, vk, ms) => {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(k.length === 1 ? { text: k } : {}) });
    await sleep(ms);
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    await sleep(200);
  };
  await key("0", "Digit0", 48);   // (all floors: no cut moving with the floor)
  const s0 = await js("window.__v3d.state()");
  assert.equal(s0.yaw, 0);
  await hold("w", "KeyW", 87, 500);
  const s1 = await js("window.__v3d.state()");
  assert.ok(s1.z - s0.z > 1 && Math.abs(s1.x - s0.x) < 0.01, `W moved north: ${JSON.stringify([s0.x, s0.z, s1.x, s1.z])}`);
  assert.equal(s1.moving, 0, "released: no more moving");
  await key("e", "KeyE", 69);
  await hold("w", "KeyW", 87, 500);
  const s2 = await js("window.__v3d.state()");
  assert.ok(s2.x - s1.x > 1 && Math.abs(s2.z - s1.z) < 0.01, `after E, W moved east: ${JSON.stringify([s1.x, s1.z, s2.x, s2.z])}`);
  await hold("ArrowDown", "ArrowDown", 40, 300);
  const s3 = await js("window.__v3d.state()");
  assert.ok(s2.x - s3.x > 0.5, `ArrowDown moved back west: ${JSON.stringify([s2.x, s3.x])}`);
  // typing in a field: the keys stay in the field
  await js(`document.getElementById("gotoBox").focus()`);
  await hold("w", "KeyW", 87, 300);
  const s4 = await js("window.__v3d.state()");
  assert.ok(Math.abs(s4.x - s3.x) < 1e-9 && Math.abs(s4.z - s3.z) < 1e-9, "no move while typing");
  await js(`document.getElementById("gotoBox").blur()`);

  // the sliders are held while dragged: pressed on the thumb, moved 60 px, released (the mouse never leaves the left
  // button between): the value follows; the view under them does not pan
  const thumb = (sel, vertical) => js(`(() => { const el = document.querySelector("${sel}"), r = el.getBoundingClientRect();
    const min = +el.min, max = +el.max, v = +el.value; let f = max > min ? (v - min) / (max - min) : 0;
    if (${vertical}) f = 1 - f;
    return ${vertical} ? { x: r.left + r.width / 2, y: r.top + 8 + f * (r.height - 16) } : { x: r.left + 8 + f * (r.width - 16), y: r.top + r.height / 2 }; })()`);
  const drag = async (from, dx, dy) => {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
    for (let k = 1; k <= 6; k++) {   // (in steps, as a hand moves: the value follows while held)
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (dx * k) / 6, y: from.y + (dy * k) / 6, button: "left", buttons: 1 });
      await sleep(40);
    }
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: from.x + dx, y: from.y + dy, button: "left", buttons: 0, clickCount: 1 });
    await sleep(250);
  };
  const c0 = await js("window.__v3d.state()");
  const cutFrom = await thumb(".v3d-hslider", false);
  await drag(cutFrom, -60, 0);
  const c1 = await js("window.__v3d.state()");
  const cutTop = await js(`+document.querySelector(".v3d-hslider").max`);
  const before = c0.cut == null ? cutTop : c0.cut;
  assert.ok(c1.cut != null && before - c1.cut >= 5, `the cut followed the drag 60 px left: ${before} -> ${c1.cut}`);
  assert.ok(Math.abs(c1.x - c0.x) < 1e-9 && Math.abs(c1.z - c0.z) < 1e-9 && c1.yaw === c0.yaw, "the view did not pan while the cut slider was held");
  assert.equal(await js(`document.querySelector(".v3d-hslider").classList.contains("held")`), false, "released");
  // a click on the cut track's right end jumps there: no cut
  const trackEnd = await js(`(() => { const r = document.querySelector(".v3d-hslider").getBoundingClientRect(); return { x: r.right - 3, y: r.top + r.height / 2 }; })()`);
  await drag(trackEnd, 0, 0);
  assert.equal((await js("window.__v3d.state()")).cut, null, "a click on the track's end: no cut");
  // the floor slider: from the top (all floors) 60 px down: a floor below, the view where it was
  await key("0", "Digit0", 48);
  const f0 = await js("window.__v3d.state()");
  await drag(await thumb(".v3d-vslider", true), 0, 60);
  const f1 = await js("window.__v3d.state()");
  assert.ok(f0.floor === "all" && f1.floor !== "all", `the floor followed the drag 60 px down: ${f0.floor} -> ${f1.floor}`);
  assert.equal(await js(`document.querySelector(".v3d-stops .on")?.dataset.floor`), f1.floor, "the floor list follows");
  assert.ok(Math.abs(f1.x - f0.x) < 1e-9 && Math.abs(f1.z - f0.z) < 1e-9, "the view did not pan while the floor slider was held");
  // and its keys still work (focused, the arrow moves one stop)
  await key("ArrowUp", "ArrowUp", 38);
  assert.notEqual((await js("window.__v3d.state()")).floor, f1.floor, "the focused slider's arrow key steps a floor");
  await shot("sliders_dragged.png");
  console.log("main flow passed", new Date().toISOString());
  // one view on DevTools' "Fast 3G" network (562.5 ms latency, ~180 KB/s down), the cache off, as a first visit: how
  // long until every chunk in view is drawn (the page, three.js, the data); a number for the report, not a limit
  await cdp("Network.enable");
  await cdp("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 });
  netBytes = 0;
  console.log("fast 3G: navigating", new Date().toISOString());
  const t3g = Date.now();
  await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/?lang=en&view=3d&at=-234,175` });
  // (short checks from here, one a second: a long evaluate would die with the page the navigation replaces)
  let loaded = null;
  for (let i = 0; i < 300 && !loaded; i++) {
    await sleep(1000);
    try {
      const r = await cdp("Runtime.evaluate", { returnByValue: true, expression: `(() => { const v = window.__v3d, st = document.querySelector(".v3d-status");
        return v && v.state().chunks > 0 && st && st.hidden ? { chunks: v.state().chunks, look: v.state().look } : null; })()` });
      loaded = r.result?.value || null;
    } catch { /* (the page between two documents) */ }
    if (i % 15 === 14) console.log(`fast 3G: ${i + 1} s, ${(netBytes / 1e6).toFixed(2)} MB so far`);
  }
  const ms3g = Date.now() - t3g;
  await cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  assert.ok(loaded, "the view loaded on Fast 3G");
  console.log(`fast 3G: one view (the street, look ${loaded.look}, ${loaded.chunks} chunks) drawn in ${(ms3g / 1000).toFixed(1)} s, ${(netBytes / 1e6).toFixed(2)} MB over the network`);
  console.log("ok: rope post + landing placed by clicks, a spawn in the canal flagged red, the link round trip holds them; copy/paste, whole roof / one block, the keys; W A S D move along the view's heading; the floor and cut sliders held while dragged");
} catch (e) {
  failed = true;
  console.error("FAIL", e);
} finally {
  try { ws?.close(); } catch { /* closed */ }
  browser.kill();
  server.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
