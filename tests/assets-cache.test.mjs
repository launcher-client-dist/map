// The assets site's browser cache: a new version downloads only the files whose content changed (an unchanged chunk
// keeps its earlier version's URL); URLs no manifest names any more leave the cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AssetStore, glbJson } from "../map3d/assets-cache.js";

const BASE = "https://assets.example/";

// a site in the layout fulllook_export.py publishes (format 2)
function site() {
  const files = new Map(), latest = {};
  const put = (path, body) => files.set(BASE + path, typeof body === "string" ? new TextEncoder().encode(body) : body);
  // chunks: {key: content}; a content an earlier version of the kind published keeps that version's file
  const held = {};
  const publish = (version, kind, chunks, textures = {}) => {
    const man = { format: 2, kind, version, chunks: {}, textures: {} };
    for (const [key, content] of Object.entries(chunks)) {
      const h = content.padEnd(16, "0").slice(0, 16);
      held[kind] ??= {};
      if (!held[kind][h]) { held[kind][h] = version; put(`${version}/${kind}/${h}.glb.gz`, new Uint8Array([1, 2, 3, content.length])); }
      man.chunks[key] = `${held[kind][h]}/${h}`;
    }
    for (const [name, v] of Object.entries(textures)) {
      man.textures[name] = v;
      if (v === version) put(`${version}/${kind}/tex/${name}`, new Uint8Array([9, 9]));
    }
    put(`${version}/${kind}/manifest.json`, JSON.stringify(man));
    latest[kind] = `${version}/${kind}/manifest.json`;
    put("latest.json", JSON.stringify(latest));
  };
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const b = files.get(url);
    return b ? new Response(b.slice(0)) : new Response("missing", { status: 404 });
  };
  return { publish, fetchImpl, asked };
}

// the Cache API's surface, in memory
function caches() {
  const store = new Map();
  const cache = {
    async match(url) { const b = store.get(url); return b ? new Response(b.slice(0)) : undefined; },
    async put(url, resp) { store.set(url, new Uint8Array(await resp.arrayBuffer())); },
    async keys() { return [...store.keys()].map((url) => ({ url })); },
    async delete(req) { return store.delete(req.url); },
  };
  return { store, caches: { open: async () => cache } };
}

test("a new version fetches only the chunks whose content changed, and drops the URLs it no longer names", async () => {
  const s = site(), c = caches();
  s.publish("v1", "full", { "0_0": "aaaa", "0_1": "bbbb", "1_0": "cccc" });
  const one = await new AssetStore(BASE, "full", { fetchImpl: s.fetchImpl, caches: c.caches }).init();
  for (const k of one.keys()) await one.chunk(k);
  assert.equal(one.stats.network, 3);
  await one.chunk("0_0");
  assert.equal(one.stats.network, 3, "a second read comes from the cache");

  // v2: 0_1 changed, 1_0 gone, 2_2 new; 0_0 the same content (still v1's file)
  s.publish("v2", "full", { "0_0": "aaaa", "0_1": "bbb2", "2_2": "dddd" });
  s.asked.length = 0;
  const two = await new AssetStore(BASE, "full", { fetchImpl: s.fetchImpl, caches: c.caches }).init();
  assert.equal(two.version, "v2");
  assert.equal(two.chunkUrl("0_0"), `${BASE}v1/full/aaaa000000000000.glb.gz`, "an unchanged chunk keeps its v1 URL");
  assert.equal(two.stats.evicted, 2, "the old 0_1 and 1_0 left the cache");
  for (const k of two.keys()) await two.chunk(k);
  assert.deepEqual(s.asked.filter((u) => u.endsWith(".glb.gz")).sort(),
    [`${BASE}v2/full/bbb2000000000000.glb.gz`, `${BASE}v2/full/dddd000000000000.glb.gz`]);
  assert.equal(two.stats.cached, 1, "0_0 came from the cache");
  assert.equal(c.store.size, 3);
});

test("the two kinds share one cache without evicting each other", async () => {
  const s = site(), c = caches();
  s.publish("v1", "full", { "0_0": "aaaa" });
  s.publish("v1", "simplified", { "0_0": "ssss" });
  const full = await new AssetStore(BASE, "full", { fetchImpl: s.fetchImpl, caches: c.caches }).init();
  const simp = await new AssetStore(BASE, "simplified", { fetchImpl: s.fetchImpl, caches: c.caches }).init();
  await full.chunk("0_0");
  await simp.chunk("0_0");
  await new AssetStore(BASE, "full", { fetchImpl: s.fetchImpl, caches: c.caches }).init();
  assert.equal(c.store.size, 2, "the full store's eviction left the simplified file");
});

test("textures come from the version that holds them, once each, and are kept", async () => {
  const s = site(), c = caches();
  s.publish("v1", "full", { "0_0": "aaaa" }, { "t1.webp": "v1" });
  s.publish("v2", "full", { "0_0": "aaa2" }, { "t1.webp": "v1", "t2.p8.png": "v2" });
  const st = await new AssetStore(BASE, "full", { fetchImpl: s.fetchImpl, caches: c.caches }).init();
  const json = { images: [{ uri: "tex/t1.webp" }, { uri: "tex/t2.p8.png" }, { uri: "tex/t1.webp" }] };
  await Promise.all([st.textures(json), st.textures(json)]);
  const tex = s.asked.filter((u) => u.includes("/tex/")).sort();
  assert.deepEqual(tex, [`${BASE}v1/full/tex/t1.webp`, `${BASE}v2/full/tex/t2.p8.png`], "one request a texture, from its version");
  assert.ok(st.blobFor(`${BASE}v2/full/tex/t1.webp`), "the loader's URL (resolved against the chunk's folder) finds it");
  s.asked.length = 0;
  const again = await new AssetStore(BASE, "full", { fetchImpl: s.fetchImpl, caches: c.caches }).init();
  await again.textures(json);
  assert.equal(s.asked.filter((u) => u.includes("/tex/")).length, 0, "the textures came from the cache");
});

test("without a Cache API (a private window) it still works, from the network", async () => {
  const s = site();
  s.publish("v1", "full", { "0_0": "aaaa" });
  const st = await new AssetStore(BASE, "full", { fetchImpl: s.fetchImpl, caches: undefined }).init();
  assert.equal((await st.chunk("0_0")).byteLength, 4);
  await st.chunk("0_0");
  assert.equal(st.stats.network, 2);
});

test("glbJson reads a GLB's JSON chunk", () => {
  const js = new TextEncoder().encode(JSON.stringify({ images: [{ uri: "tex/a.webp" }] }).padEnd(48, " "));
  const b = new Uint8Array(20 + js.length), d = new DataView(b.buffer);
  d.setUint32(0, 0x46546c67, true); d.setUint32(4, 2, true); d.setUint32(8, b.length, true);
  d.setUint32(12, js.length, true); d.setUint32(16, 0x4e4f534a, true); b.set(js, 20);
  assert.equal(glbJson(b.buffer).images[0].uri, "tex/a.webp");
});
