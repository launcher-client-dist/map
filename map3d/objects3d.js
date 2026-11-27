// The objects an editor places, drawn in the 3D view two ways (the Objects pill: ?objects=a|c):
//   a · markers: a shaped token per kind in its colour, a monster's icon and a count badge (light, readable far away)
//   c · models: the game's own model (map3d/objects: the props of the map things and the monsters a spawn or a boss can
//       name, flat colours like the grid) with a's ground ring or spawn area and a label; a's token when zoomed out, and
//       for a kind or a species with no model
// Inside the view's world group: game coordinates (x east, y up, z north), a marker's feet at the group's origin.
import { parseGlb } from "./glb.js";

const KIND_RGB = { rope: "#ff7a1a", rope2: "#ff7a1a", hole: "#19d3d3", portal: "#a35cff", elevator: "#5b5ff0", lever: "#ff3d8b",
  spawn: "#e5322d", boss: "#ffc233", npc: "#7bc043", poi: "#f5c518", door: "#8fa3bf", note: "#d6dae2" };
const PORTAL_RGB = { 4: "#e5484d", 6: "#3e8ef7", 7: "#a35cff" };   // maplink COLORS: red, blue, purple
// the model a prop kind wears; how high its origin sits over the floor's top (the hole is set into the ground)
const PROP = { rope: ["rope", 0], rope2: ["rope", 0], hole: ["hole", 0.45], portal: ["portal", 0], lever: ["lever", 0] };

// a fetched file, unpacked when it is gzipped (the data is stored gzipped: GitHub Pages serves it as it is)
export async function unpack(buf) {
  if (!buf) return null;
  const b = new Uint8Array(buf);
  if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
    return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }
  return buf;
}

export function createObjects(THREE, { base, t, onChange = () => {} }) {
  const models = new Map();    // key -> {geo, scale, size} once loaded
  const loading = new Map();   // key -> Promise
  let index = { props: {}, monsters: {} };
  const modelMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const icons = new Map();
  const entry = (key) => index.props[key] || index.monsters[key];

  function load(key) {
    const e = entry(key);
    if (!e || models.has(key) || loading.has(key)) return;
    loading.set(key, (async () => {
      try {
        const res = await fetch(new URL("objects/" + e.file, base));
        const g = parseGlb(await unpack(await res.arrayBuffer()));
        const p = g.prims[0];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(p.position.array, p.position.stride), 3, 0, false));
        geo.setAttribute("color", new THREE.BufferAttribute(p.color.array, 4, true));
        geo.setIndex(new THREE.BufferAttribute(p.index.array, 1));
        geo.computeBoundingSphere();
        models.set(key, { geo, scale: g.scale, size: e.size });
        onChange();
      } catch (err) { console.warn("map3d objects", key, err); models.set(key, null); }
    })());
  }
  const ready = (async () => {
    try { index = await (await fetch(new URL("objects/objects.json", base))).json(); } catch { /* no models: a only */ }
    for (const k of Object.keys(index.props || {})) load(k);   // the props are few and small: all at once
    await Promise.all(loading.values());
  })();

  const mats = new Map();
  const mat = (hex, opts = {}) => {
    const k = hex + JSON.stringify(opts);
    if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: hex, ...opts }));
    return mats.get(k);
  };
  const basic = (hex, opts = {}) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, ...opts });

  // ---- sprites: a label pill, a count badge, a monster's icon (always facing the camera, drawn over the ground)
  function textSprite(text, { bg = "#11151bee", fg = "#ffffff", border = null, h = 0.42, bold = true } = {}) {
    const c = document.createElement("canvas"), g = c.getContext("2d"), px = 64;
    const font = `${bold ? 700 : 500} ${px * 0.62}px "Segoe UI", system-ui, sans-serif`;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width + px * 0.7);
    c.width = w; c.height = px;
    g.font = font;
    g.fillStyle = bg;
    const r = px / 2;
    g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, px, r); g.arcTo(w, px, 0, px, r); g.arcTo(0, px, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
    if (border) { g.lineWidth = 5; g.strokeStyle = border; g.stroke(); }
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, px / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set((h * w) / px, h, 1);
    s.renderOrder = 8;
    return s;
  }
  function iconSprite(name, size, ring) {
    const file = index.monsters?.[name]?.icon;
    const key = (file || "?") + ring;
    if (!icons.has(key)) {
      // the icon on a disc in the kind's colour, drawn once into a canvas when the picture arrives
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const tex = new THREE.CanvasTexture(c);
      const g = c.getContext("2d");
      const disc = () => { g.fillStyle = "#11151b"; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.lineWidth = 7; g.strokeStyle = ring; g.stroke(); };
      disc();
      if (file) {
        const im = new Image();
        im.onload = () => { disc(); g.save(); g.beginPath(); g.arc(64, 64, 56, 0, 7); g.clip(); g.drawImage(im, 14, 10, 100, 100); g.restore(); tex.needsUpdate = true; };
        im.src = new URL("objects/" + file, base).href;
      } else {
        g.fillStyle = ring; g.font = "700 70px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("⚔", 64, 68);
      }
      icons.set(key, tex);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: icons.get(key), depthTest: false, transparent: true }));
    s.scale.set(size, size, 1);
    s.renderOrder = 7;
    return s;
  }
  function groundRing(r, color, fill = 0.16, width = 0.09) {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 48), basic(color, { opacity: fill, depthWrite: false, side: THREE.DoubleSide }));
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - width, r, 64), basic(color, { opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    for (const m of [disc, edge]) { m.rotation.x = -Math.PI / 2; m.position.y = 0.16; m.renderOrder = 2; g.add(m); }   // (over a kerb's mesh)
    return g;
  }
  // a spawn's area on uneven ground: a tile per cell inside the radius at that cell's own height (the cells the spawn
  // covers), and its edge as a ribbon following the ground; relative to the marker at (m.x, my, m.z)
  function spawnArea(m, my, r, col, standAt) {
    const g = new THREE.Group(), P = [], E = [];
    g.userData.area = true;
    const R = Math.max(0, m.fields?.radius || 0);
    for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) for (let dz = -Math.ceil(R); dz <= Math.ceil(R); dz++) {
      if (dx * dx + dz * dz > R * R + 0.01) continue;
      const y = standAt(m.x + dx, m.z + dz);
      if (y == null || Math.abs(y - my) > 3) continue;
      const h = y - my + 0.17, a = 0.47;
      P.push(dx - a, h, dz - a, dx + a, h, dz - a, dx + a, h, dz + a, dx - a, h, dz - a, dx + a, h, dz + a, dx - a, h, dz + a);
    }
    const N = 72, w = 0.09;
    const at = (k, rr) => { const a = (k / N) * Math.PI * 2, x = rr * Math.cos(a), z = rr * Math.sin(a); const y = standAt(Math.round(m.x + x), Math.round(m.z + z)); return [x, (y == null ? my : y) - my + 0.2, z]; };
    for (let k = 0; k < N; k++) {
      const a0 = at(k, r - w), a1 = at(k + 1, r - w), b0 = at(k, r), b1 = at(k + 1, r);
      E.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    }
    for (const [arr, op] of [[P, 0.2], [E, 0.95]]) {
      if (!arr.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const mesh = new THREE.Mesh(geo, basic(col, { opacity: op, depthWrite: false, side: THREE.DoubleSide }));
      mesh.renderOrder = 2;
      g.add(mesh);
    }
    return g;
  }
  function model(key, { y = 0, rot = 0 } = {}) {
    load(key);
    const m = models.get(key);
    if (!m) return null;
    const mesh = new THREE.Mesh(m.geo, modelMat);
    mesh.scale.setScalar(m.scale[0]);
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.y = y;
    holder.rotation.y = rot;
    return holder;
  }
  const kindWord = (kind) => t("kind." + kind);
  const colorOf = (m) => (m.kind === "portal" && PORTAL_RGB[m.fields?.color]) || KIND_RGB[m.kind] || "#cccccc";
  const arrow = (col, up) => { const c = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), mat(col, { emissive: col, emissiveIntensity: 0.25 })); if (!up) c.rotation.x = Math.PI; return c; };

  // ---- a · the markers
  function token(m, y, standAt) {
    const g = new THREE.Group(), col = colorOf(m), k = m.kind;
    if (k === "rope" || k === "rope2") {
      g.add(groundRing(0.46, col, 0.22));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.25, 10), mat("#8a5a32"));
      post.position.y = 0.62;
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.075, 8, 20), mat(col, { emissive: col, emissiveIntensity: 0.2 }));
      coil.rotation.x = Math.PI / 2; coil.position.y = 1.08;
      const coil2 = coil.clone(); coil2.position.y = 0.92;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), mat("#8a5a32"));
      cap.position.y = 1.28;
      g.add(post, coil, coil2, cap);
      if (k === "rope2") {   // two ways: an arrow up and one down beside the post
        const u = arrow(col, true), d = arrow(col, false);
        u.position.set(0.38, 1.15, 0); d.position.set(-0.38, 0.75, 0);
        g.add(u, d);
      }
    } else if (k === "hole") {
      g.add(groundRing(0.5, col, 0.0, 0.12));
      const pit = new THREE.Mesh(new THREE.CircleGeometry(0.38, 32), basic("#050607", { opacity: 1, side: THREE.DoubleSide }));
      pit.rotation.x = -Math.PI / 2; pit.position.y = 0.17;
      const a = arrow(col, false); a.scale.setScalar(1.4); a.position.y = 0.9;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.1), mat(col));
      shaft.position.y = 1.25;
      g.add(pit, a, shaft);
    } else if (k === "portal") {
      g.add(groundRing(0.55, col, 0.2));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 10, 40), mat(col, { emissive: col, emissiveIntensity: 0.35 }));
      ring.position.y = 0.75;
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.47, 32), basic(col, { opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      glow.position.y = 0.75;
      g.add(ring, glow);
    } else if (k === "elevator") {   // a platform with an arrow up and one down
      g.add(groundRing(0.5, col, 0.2));
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.8), mat("#5b6270"));
      plate.position.y = 0.22;
      const u = arrow(col, true), d = arrow(col, false);
      u.position.y = 1.15; d.position.y = 0.7;
      g.add(plate, u, d);
    } else if (k === "lever") {
      g.add(groundRing(0.42, col, 0.2));
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.32), mat("#5b6270"));
      base.position.y = 0.08;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8), mat("#c9ced8"));
      stick.position.set(0.18, 0.5, 0); stick.rotation.z = -0.45;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), mat(col, { emissive: col, emissiveIntensity: 0.25 }));
      knob.position.set(0.36, 0.88, 0);
      g.add(base, stick, knob);
    } else if (k === "door") {   // a door frame
      g.add(groundRing(0.45, col, 0.18));
      for (const sx of [-0.38, 0.38]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.14), mat("#6b4a2e")); p.position.set(sx, 0.7, 0); g.add(p); }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.12, 0.14), mat("#6b4a2e")); lintel.position.y = 1.4;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.3, 0.06), mat(col)); leaf.position.y = 0.66;
      g.add(lintel, leaf);
    } else if (k === "spawn" || k === "boss") {
      const r = k === "boss" ? 1 : Math.max(0.6, (m.fields?.radius || 0) + 0.5);
      g.add(k === "spawn" && standAt ? spawnArea(m, y, r, col, standAt) : groundRing(r, col, 0.14, 0.1));
      const ic = iconSprite(m.fields?.monster, k === "boss" ? 1.15 : 0.95, col);
      ic.position.y = k === "boss" ? 1.6 : 1.25;
      g.add(ic);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, ic.position.y - 0.4, 6), mat(col));
      stem.position.y = (ic.position.y - 0.4) / 2;
      g.add(stem);
      if (k === "spawn" && (m.fields?.count || 1) > 1) {
        const b = textSprite("×" + m.fields.count, { bg: col, h: 0.4 });
        b.position.set(0.42, ic.position.y + 0.38, 0);
        g.add(b);
      }
      if (k === "boss") { const cr = textSprite("👑", { bg: "#00000000", h: 0.5 }); cr.position.y = 2.3; g.add(cr); }
    } else if (k === "npc") {
      g.add(groundRing(0.42, col, 0.22));
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), mat(col));
      body.position.y = 0.45;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), mat("#f0d2b0"));
      head.position.y = 0.98;
      const bub = textSprite("💬", { bg: "#00000000", h: 0.45 });
      bub.position.set(0.3, 1.45, 0);
      g.add(body, head, bub);
    } else if (k === "note") {   // a sheet on a stick
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), mat("#9aa3b2")); stick.position.y = 0.45;
      const sheet = textSprite("✎", { bg: "#d6dae2", fg: "#11151b", h: 0.45 }); sheet.position.y = 1.1;
      g.add(stick, sheet);
    } else {   // a point: a pin
      g.add(groundRing(0.3, col, 0.25));
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), mat(col));
      stick.position.y = 0.5;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), mat(col, { emissive: col, emissiveIntensity: 0.2 }));
      head.position.y = 1.1;
      g.add(stick, head);
    }
    return g;
  }

  // ---- c · the game's models
  function spawnSpots(m, standAt) {
    const n = Math.max(1, Math.min(12, m.fields?.count || 1)), r = m.fields?.radius || 0;
    const out = [];
    for (let i = 0; i < n; i++) {
      const rr = n === 1 ? 0 : Math.max(0.9, r * 0.75) * Math.sqrt((i + 0.5) / n);
      const a = i * 2.39996 + (m.id || 0) * 0.7;
      const x = m.x + rr * Math.cos(a), z = m.z + rr * Math.sin(a);
      out.push({ dx: x - m.x, dz: z - m.z, y: standAt(Math.round(x), Math.round(z)), rot: Math.PI + Math.sin(i * 3.1 + 1) * 0.6 });
    }
    return out;
  }
  function gameModel(m, y, standAt) {
    const g = new THREE.Group(), k = m.kind;
    if (PROP[k]) {
      let [name, lift] = PROP[k];
      if (k === "portal" && m.fields?.color === 4) name = "portal_red";
      const mo = model(name, { y: lift });
      if (mo) g.add(mo);
      return { g, top: name.startsWith("portal") ? 2.5 : name === "lever" ? 1.3 : name === "rope" ? 0.4 : 0.2, ok: !!mo };
    }
    if (k === "spawn" || k === "boss" || k === "npc") {
      const key = k === "npc" ? "npc" : m.fields?.monster;
      const spots = k === "spawn" ? spawnSpots(m, standAt) : [{ dx: 0, dz: 0, y, rot: Math.PI }];
      let top = 0, ok = false;
      for (const s of spots) {
        const mo = model(key, { rot: s.rot });
        if (!mo) continue;
        mo.position.set(s.dx, (s.y ?? y) - y, s.dz);
        g.add(mo);
        ok = true;
        top = Math.max(top, models.get(key).size[1]);
      }
      return { g, top, ok };
    }
    return { g, top: 1, ok: false };
  }

  // the object of a marker in a style -> THREE.Group at the marker's feet. collapse: draw the token (zoomed out);
  // grow: the token's scale (far away a token keeps its size on the screen)
  function build(style, m, { y, standAt, collapse, grow = 1 }) {
    // (a spawn's area stays the cells it covers; the rest of the token grows about the marker's feet)
    const tok = () => {
      const g = token(m, y, standAt);
      if (grow === 1) return g;
      const out = new THREE.Group(), body = new THREE.Group();
      for (const c of [...g.children]) (c.userData.area ? out : body).add(c);
      body.scale.setScalar(grow);
      out.add(body);
      return out;
    };
    if (style === "a" || collapse) return tok();
    const { g, top, ok } = gameModel(m, y, standAt);
    if (!ok) return tok();   // no model for this kind or species (yet): the token
    const col = colorOf(m), k = m.kind;
    const r = k === "spawn" ? Math.max(0.6, (m.fields?.radius || 0) + 0.5) : k === "boss" ? 1.1 : k === "portal" ? 0.8 : 0.55;
    g.add(k === "spawn" ? spawnArea(m, y, r, col, standAt) : groundRing(r, col, 0.18));
    let text = kindWord(k);
    if (k === "spawn") text = `${m.fields?.monster || "?"} ×${m.fields?.count || 1}`;
    else if (k === "boss") text = "👑 " + (m.fields?.monster || kindWord(k));
    else if (k === "npc") text = m.fields?.name || kindWord(k);
    else if (m.fields?.label) text = m.fields.label;
    const b = textSprite(text, { bg: "#11151bdd", border: col, h: 0.36 });
    b.position.y = top + 0.55;
    g.add(b);
    return g;
  }
  return { ready, build, colorOf, hasModels: () => Object.keys(index.monsters || {}).length > 0 };
}
