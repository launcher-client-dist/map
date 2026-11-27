// The look files of the assets site (assets.opengea.tech: the full look and the Simplified ground), kept in the browser
// (the Cache API) and fetched only when new: kept on the players' machines, a new version downloads only what
// changed.
//
// The site (as the export tool publishes it): latest.json names each kind's manifest; a manifest gives each chunk
// and texture the version folder that holds its file: "a_b": "<V>/<sha16>" is <V>/<kind>/<sha16>.glb.gz, texture name:
// "<V>" is <V>/<kind>/tex/<name>. A file is named by its content and a new version names unchanged files by their old
// URL, so a cached file never goes stale and a new version fetches only the changed ones. URLs no manifest of this
// kind names any more leave the cache. No DOM here: the cache and fetch are passed in (the page: globalThis.caches and
// fetch; the tests: stand-ins).

export const CACHE_NAME = "og-assets";

export class AssetStore {
  // base: the site's root URL (the config's "assetsBase"); kind: "full" | "simplified"
  constructor(base, kind = "full", { fetchImpl = (...a) => globalThis.fetch(...a), caches = globalThis.caches, cacheName = CACHE_NAME } = {}) {
    this.base = new URL(base.endsWith("/") ? base : base + "/");
    this.kind = kind;
    this.fetch = fetchImpl;
    this.caches = caches;
    this.cacheName = cacheName;
    this.cache = null;
    this.manifest = null;
    this.blobs = new Map();       // texture name -> blob: URL (this session)
    this.inflight = new Map();    // texture name -> its one fetch (this session)
    this.stats = { network: 0, cached: 0, bytes: 0, evicted: 0 };
  }

  // latest.json (revalidated), this kind's manifest, the cache opened and this kind's URLs it no longer names dropped
  async init() {
    const lr = await this.fetch(new URL("latest.json", this.base).href, { cache: "no-cache" });
    if (!lr.ok) throw new Error(`assets: latest.json HTTP ${lr.status}`);
    const path = (await lr.json())[this.kind];
    if (!path) throw new Error(`assets: no ${this.kind} in latest.json`);
    const mr = await this.fetch(new URL(path, this.base).href);
    if (!mr.ok) throw new Error(`assets: ${path} HTTP ${mr.status}`);
    this.manifest = await mr.json();
    try { this.cache = this.caches ? await this.caches.open(this.cacheName) : null; } catch { this.cache = null; }
    await this.evict();
    return this;
  }

  get version() { return this.manifest?.version; }
  keys() { return new Set(Object.keys(this.manifest?.chunks || {})); }
  has(key) { return !!this.manifest?.chunks[key]; }
  chunkUrl(key) {
    const [v, h] = this.manifest.chunks[key].split("/");
    return new URL(`${v}/${this.kind}/${h}.glb.gz`, this.base).href;
  }
  textureUrl(name) {
    const v = this.manifest.textures?.[name];
    return v ? new URL(`${v}/${this.kind}/tex/${name}`, this.base).href : null;
  }

  // every URL this kind's manifest names
  wanted() {
    const w = new Set(Object.keys(this.manifest.chunks).map((k) => this.chunkUrl(k)));
    for (const t of Object.keys(this.manifest.textures || {})) w.add(this.textureUrl(t));
    return w;
  }

  async evict() {
    if (!this.cache) return 0;
    const want = this.wanted(), mine = new URL(this.base).href;
    let n = 0;
    for (const req of await this.cache.keys()) {
      // (only this site's files of this kind: the other kind's store keeps its own)
      const url = req.url;
      if (!url.startsWith(mine) || !url.includes(`/${this.kind}/`)) continue;
      if (!want.has(url)) { await this.cache.delete(req); n++; }
    }
    this.stats.evicted += n;
    return n;
  }

  // a file by URL: the cache's copy, else the network's (then kept) -> ArrayBuffer
  async file(url) {
    if (this.cache) {
      const hit = await this.cache.match(url);
      if (hit) { this.stats.cached++; return hit.arrayBuffer(); }
    }
    const r = await this.fetch(url);
    if (!r.ok) throw new Error(`assets: ${url} HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    this.stats.network++;
    this.stats.bytes += buf.byteLength;
    if (this.cache) {
      try { await this.cache.put(url, new Response(buf.slice(0), { headers: { "content-type": r.headers.get("content-type") || "application/octet-stream" } })); }
      catch { /* a full quota: fetched again next time */ }
    }
    return buf;
  }

  chunk(key) { return this.file(this.chunkUrl(key)); }

  // the textures a chunk's glTF names ("tex/<name>") made ready as blob: URLs (from the cache or fetched once, all at
  // once) -> blobFor(url) gives the loader each one
  async textures(gltfJson) {
    await Promise.all((gltfJson.images || []).map((im) => {
      const name = im.uri.split("/").pop();
      if (!this.inflight.has(name)) {
        const url = this.textureUrl(name);
        if (!url) return Promise.reject(new Error(`assets: texture ${name} not in the manifest`));
        this.inflight.set(name, this.file(url).then((buf) => {
          const type = name.endsWith(".webp") ? "image/webp" : "image/png";
          this.blobs.set(name, typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([buf], { type })) : url);
        }));
      }
      return this.inflight.get(name);
    }));
    return this.blobs;
  }

  // the loader's URL modifier: a texture's URL (resolved against the chunk's folder) -> its blob: URL
  blobFor(url) {
    const i = url.lastIndexOf("/tex/");
    return i >= 0 ? this.blobs.get(url.slice(i + 5)) : undefined;
  }
}

// a GLB's JSON chunk (its images, for AssetStore.textures) -> object
export function glbJson(buf) {
  const d = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  if (d.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const n = d.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(d.buffer, d.byteOffset + 20, n)));
}
