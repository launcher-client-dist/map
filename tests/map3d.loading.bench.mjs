// How fast the 3D view's Complete look arrives: opens a link in headless Edge/Chrome and times (a) the view in front of
// the camera (chunks within 1 of the focus) all Complete, (b) every chunk loaded Complete. Not in `npm test`.
//   node tests/map3d.loading.bench.mjs --root DIR --frag "#2...." [--secs 60] [--zoom 1..4] [--mbps 20] [--shot-at 10 --shot FILE] [--label L]
// DIR: the map repo's folder to serve (compare main's against a branch's). The page is patched on the fly to expose its state.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
const arg = (k, d) => (process.argv.includes("--" + k) ? process.argv[process.argv.indexOf("--" + k) + 1] : d);
const ROOT = arg("root"), FRAG = arg("frag"), SECS = +arg("secs", 60), SHOT_AT = +arg("shot-at", 0), SHOT = arg("shot"), LABEL = arg("label", "run"), ZOOM = arg("zoom", ""), MBPS = +arg("mbps", 0);
const BROWSER = process.env.BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".bin": "application/octet-stream", ".glb": "model/gltf-binary", ".gz": "application/gzip" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  try {
    let body = await readFile(join(ROOT, path));
    if (path.endsWith("map3d/view3d.js")) body = Buffer.from(body.toString().replace("const chunks = new Map();", "const chunks = new Map(); window.__m3 = { chunks, get S() { return S; }, get fSet() { return fSet; } };"));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const profile = await mkdtemp(join(tmpdir(), "m3bench-"));
const dbg = 9800 + Math.floor(Math.random() * 100);
const GL = process.env.OG_GPU === "0" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=d3d11", "--ignore-gpu-blocklist"];
const browser = spawn(BROWSER, ["--headless=new", ...GL, `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, "--window-size=1440,900", "--no-first-run", "about:blank"], { stdio: "ignore" });
let tabs;
for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs[0]) break; } catch {} await sleep(200); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d.result ?? d); waiting.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((ok) => { const id = ++seq; waiting.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, returnByValue: true })).result?.value;
await cdp("Page.enable");
if (MBPS) { await cdp("Network.enable"); await cdp("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: MBPS * 125000, uploadThroughput: MBPS * 125000 }); }
const t0 = Date.now();
await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/?view=3d${ZOOM ? "&zoom=" + ZOOM : ""}${FRAG}` });
const probe = `(() => { const m = window.__m3; if (!m) return null; const S = m.S, a0 = Math.round(Math.round(S.x) / 16), b0 = Math.round(Math.round(S.z) / 16);
  let near = 0, nearDone = 0, all = 0, allDone = 0;
  for (const ch of m.chunks.values()) { const k = ch.a + "_" + ch.b; if (!m.fSet.has(k)) continue; all++; if (ch.fMesh) allDone++;
    if (Math.abs(ch.a - a0) <= 1 && Math.abs(ch.b - b0) <= 1) { near++; if (ch.fMesh) nearDone++; } }
  return { near, nearDone, all, allDone, n: m.chunks.size, loading: [...m.chunks.values()].filter((c) => c.fLoading).length }; })()`;
let tNear = null, tAll = null, shot = false, last = null;
while ((Date.now() - t0) / 1000 < SECS) {
  await sleep(250);
  const t = (Date.now() - t0) / 1000, p = await js(probe);
  if (!p) continue;
  last = p;
  if (SHOT && SHOT_AT && !shot && t >= SHOT_AT) { shot = true; const r = await cdp("Page.captureScreenshot", { format: "png" }); await writeFile(SHOT, Buffer.from(r.data, "base64")); }
  if (tNear == null && p.near && p.nearDone === p.near) tNear = t;
  if (tAll == null && p.all && p.allDone === p.all && p.n >= p.all) { tAll = t; if (tNear != null) break; }
}
console.log(JSON.stringify({ label: LABEL, tNear, tAll, last }));
ws.close(); browser.kill(); server.close();
await sleep(500); await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(0);
