// The 3D edit view: the map's chunks drawn in the game's camera, a placement check from the server's grid, and the
// same markers as the 2D page (the page's own edit model: a place here is a marker there, the link is the same).
// open(api) mounts it into api.host; app.js gives the api (markers, commit through place / setDest, select, ...).
// Data: map3d/meta.json, map3d/b/<a>_<b>.glb (the B look), map3d/c/<a>_<b>.bin (the C look and the check), written by
// the staff tools (map3d_export.py). Game axes: x east, y up, z north; the scene's world group mirrors z (three.js is
// right-handed), so everything inside it is in game coordinates.
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.170.0/three.module.min.js";
import { parseGlb } from "./glb.js";
import * as CD from "./cdata.js";
import { translator3 } from "./words3d.js";
import { createObjects, unpack } from "./objects3d.js";

const BASE = new URL("./", import.meta.url);
// the game's camera (the staff tools' gamecam.py, measured on the real client): FOV 25° vertical, pitched 57° down, the
// eye 30.8 cells from the feet (26.1 up, 16.3 back), so the feet sit a little under the picture's centre
const FOV = 24.99, PITCH = 56.976, EYE_UP = 26.117, EYE_BACK = 16.344;
const EYE_D = Math.hypot(EYE_UP, EYE_BACK), EYE_PITCH = (Math.atan2(EYE_UP, EYE_BACK) * 180) / Math.PI;
const STAND = 0.8;
const KIND_RGB = {
  grass: "#6aa84f", dirt: "#8c6a43", sand: "#dccb86", rock: "#8a8378", paved: "#b9b4a2", wood: "#9a6b3c", snow: "#eef2f6",
  lava: "#f07020", other: "#a49c88", slopeN: "#a58a62", slopeE: "#a58a62", slopeS: "#a58a62", slopeW: "#a58a62",
  water: "#3d7fd0", wall: "#8e96a6", hidden: "#c7ccd6", roof: "#a0473a", object: "#9a9488", none: "#888888",
};
const LEVEL_RGB = { ok: "#30c46c", warn: "#f5a524", bad: "#e5484d" };
const RISE = { slopeN: [0, 1], slopeE: [1, 0], slopeS: [0, -1], slopeW: [-1, 0] };

THREE.ColorManagement.enabled = false;   // the colours as written: the data's sRGB bytes, drawn without conversion

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
};
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);

export async function open(api) {
  const t3 = translator3(api.lang);
  const q = api.params || new URLSearchParams();
  const root = h("div", { id: "view3d", class: "v3d-root" });
  api.host.append(root);
  let meta;
  try { meta = await (await fetch(new URL("meta.json", BASE))).json(); }
  catch { root.append(h("div", { class: "v3d-msg" }, t3("noData"))); return { refresh() {}, show() {}, hide() { root.hidden = true; }, goTo() {} }; }
  // the Simplified ground (the game's own ground meshes, map3d/b): local data only for now, never in the public files
  const hasB = !!meta.b;
  const chunkSet = new Set(meta.chunks.map(([a, b]) => a + "_" + b));

  // ---- state
  const S = {
    objects: q.get("objects") === "a" ? "a" : "c", clean: q.get("clean") === "1", help: q.get("help") === "1",
    x: 0, z: 0, y: 0, yaw: 0, pitch: PITCH, zoom: 1, free: false,
    look: hasB && q.get("look") !== "c" ? "b" : "c", check: q.get("check") !== "0", walls: q.get("walls") === "1", tops: q.get("tops") === "1",
    floor: q.get("floor") || "all", cut: q.get("cut") != null && q.get("cut") !== "" ? +q.get("cut") : null,
    tool: null, pending: null, hover: null, clip: [], asset: null,
  };
  const OBJ = createObjects(THREE, { base: BASE, t: api.t, onChange: () => paintMarkersSoon() });
  if (S.clean) root.classList.add("clean");
  const start = (q.get("at") || "").split(",").map(Number);
  if (start.length >= 2 && start.every(Number.isFinite)) { S.x = start[0]; S.z = start[1]; }
  else if (api.start) { S.x = api.start.x; S.z = api.start.z; }
  if (!inData(S.x, S.z) && meta.areas) { const a = Object.values(meta.areas)[0]; [S.x, S.z] = a.centre; }
  if (q.get("yaw")) S.yaw = ((+q.get("yaw") % 360) + 360) % 360;
  if (q.get("zoom")) S.zoom = Math.min(4, Math.max(0.3, +q.get("zoom") || 1));
  if (q.get("pitch")) { S.pitch = Math.min(89, Math.max(15, +q.get("pitch"))); S.free = true; }

  function inData(x, z) { const [a, b] = CD.chunkOf(Math.round(x), Math.round(z)); return chunkSet.has(a + "_" + b); }

  // ---- three
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
  catch { root.append(h("div", { class: "v3d-msg" }, t3("noWebgl"))); return { refresh() {}, show() {}, hide() { root.hidden = true; }, goTo() {} }; }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.className = "v3d-canvas";
  root.append(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0d11");
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 900);
  // (three.js lights since r155: the old intensities times pi) the renderer's light: ambient 0.58, sun 0.47
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a929c, 0.62 * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5 * Math.PI);
  sun.position.set(0.35, 0.9, 0.5);   // (the renderer's sun, z mirrored)
  scene.add(sun);
  const world = new THREE.Group();
  world.scale.z = -1;
  scene.add(world);
  const layersB = new THREE.Group(), layersC = new THREE.Group(), wallsG = new THREE.Group(), marksG = new THREE.Group(), xray = new THREE.Group();
  const topsG = new THREE.Group();   // the heights and the walkable tops ("Altura e piso", ?tops=1)
  world.add(layersB, layersC, wallsG, topsG, marksG, xray);
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });
  const waterMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.78, depthWrite: false, clippingPlanes: [cutPlane] });
  const waterC = new THREE.MeshLambertMaterial({ color: "#3d7fd0", flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false, clippingPlanes: [cutPlane] });
  const wallMat = new THREE.MeshBasicMaterial({ color: "#d8dde8", transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });
  const darkMat = new THREE.MeshBasicMaterial({ color: "#ff5ca8", transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });
  // the props (lamps, crates, trunks as simple shapes) stay; the tall props' tops ("crowns": a tree's crown) are hidden
  // while the placement check is on (a crown hides the spot under it; the game hides the crowns near its character)
  const propsMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });
  const crownsMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });
  const fadeProps = (on) => { crownsMat.visible = !on; };

  // ---- chunks
  const chunks = new Map();   // key -> {a, b, c (decoded), bMesh, cMesh, wMesh, loading}
  const cellAt = (x, z) => { const [a, b] = CD.chunkOf(x, z); return chunks.get(CD.chunkKey(a, b))?.c?.cells.get(CD.cellKey(x, z)); };

  function wantChunks() {
    const [a0, b0] = CD.chunkOf(Math.round(S.x), Math.round(S.z));
    const r = Math.min(4, Math.ceil(1.2 * S.zoom + (S.free ? 1 : 0.6)));
    return meta.chunks.filter(([a, b]) => Math.abs(a - a0) <= r && Math.abs(b - b0) <= r);
  }
  let loadingN = 0;
  function stream() {
    const want = wantChunks(), keys = new Set(want.map(([a, b]) => CD.chunkKey(a, b)));
    for (const [a, b] of want) {
      const key = CD.chunkKey(a, b);
      if (chunks.has(key)) continue;
      const ch = { a, b, c: null, bMesh: null, cMesh: null, wMesh: null };
      chunks.set(key, ch);
      loadingN++;
      paintStatus();
      ch.ready = Promise.all([
        fetch(new URL(`c/${key}.bin${meta.gz ? ".gz" : ""}`, BASE)).then((r) => (r.ok ? r.arrayBuffer() : null)).then(unpack),
        hasB ? fetch(new URL(`b/${key}.glb`, BASE)).then((r) => (r.ok ? r.arrayBuffer() : null)) : null,
      ]).then(([cb, gb]) => {
        if (!chunks.has(key)) return;
        if (cb) { ch.c = CD.decodeChunk(cb); ch.cMesh = buildC(ch.c); ch.wMesh = buildWalls(ch.c); ch.tMesh = buildTops(ch.c); layersC.add(ch.cMesh); wallsG.add(ch.wMesh); topsG.add(ch.tMesh); }
        if (gb) { ch.bMesh = buildB(parseGlb(gb)); layersB.add(ch.bMesh); }
      }).catch((e) => console.warn("map3d", key, e)).finally(() => { surfaceMemo.clear(); loadingN--; paintStatus(); paintFloors(); paintMarkers(); draw(); });
    }
    // far chunks go (memory)
    const [a0, b0] = CD.chunkOf(Math.round(S.x), Math.round(S.z));
    for (const [key, ch] of chunks) {
      if (keys.has(key) || Math.max(Math.abs(ch.a - a0), Math.abs(ch.b - b0)) <= 5) continue;
      for (const m of [ch.bMesh, ch.cMesh, ch.wMesh, ch.tMesh]) if (m) { m.parent?.remove(m); m.traverse((o) => o.geometry?.dispose()); }
      chunks.delete(key);
    }
  }

  function buildB(g) {
    const grp = new THREE.Group();
    grp.position.set(...g.translation);
    grp.scale.set(...g.scale);
    for (const p of g.prims) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(p.position.array, p.position.stride), 3, 0, false));
      geo.setAttribute("color", new THREE.BufferAttribute(p.color.array, 4, true));
      geo.setIndex(new THREE.BufferAttribute(p.index.array, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, { water: waterMat, props: propsMat, crowns: crownsMat }[p.material] || groundMat);
      mesh.userData.water = p.material === "water";
      mesh.userData.props = p.material === "props" || p.material === "crowns";
      grp.add(mesh);
    }
    return grp;
  }

  // the C look: a box per solid cube (faces next to another box left out), slopes as wedges, the water as a sheet
  function buildC(c) {
    const P = [], C = [], WP = [];
    const solid = new Map();
    for (const cell of c.cells.values()) for (const cube of cell.cubes)
      if (cube.kind !== CD.K.water && cube.kind !== CD.K.hidden) solid.set(`${cell.x},${cube.y},${cell.z}`, CD.KINDS[cube.kind]);
    const quad = (a, b, cc, d, col) => { P.push(...a, ...b, ...cc, ...a, ...cc, ...d); for (let i = 0; i < 6; i++) C.push(...col); };
    for (const cell of c.cells.values()) {
      const { x, z } = cell, x0 = x - 0.5, x1 = x + 0.5, z0 = z - 0.5, z1 = z + 0.5;
      for (const cube of cell.cubes) {
        const kind = CD.KINDS[cube.kind], y = cube.y, y0 = y - 1;
        if (kind === "water") {
          if (!cell.cubes.some((o) => o.y === y + 1 && o.kind === CD.K.water)) { const w = y - 0.2; WP.push(x0, w, z0, x1, w, z0, x1, w, z1, x0, w, z0, x1, w, z1, x0, w, z1); }
          continue;
        }
        if (kind === "hidden") continue;   // (the walls layer)
        const top = rgb(KIND_RGB[kind] || KIND_RGB.other), side = top.map((v) => v * 0.8);
        const r = RISE[kind];
        if (r && !solid.has(`${x},${y + 1},${z}`)) {   // a wedge rising along r
          const hh = (cx, cz) => y0 + Math.min(1, Math.max(0, (cx - x) * r[0] + (cz - z) * r[1] + 0.5));
          const cs = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
          const tp = cs.map(([cx, cz]) => [cx, hh(cx, cz), cz]);
          quad(tp[0], tp[1], tp[2], tp[3], top);
          for (let i = 0; i < 4; i++) {
            const [ax, az] = cs[i], [bx, bz] = cs[(i + 1) % 4], ha = hh(ax, az), hb = hh(bx, bz);
            if (Math.max(ha, hb) - y0 > 0.01) quad([ax, y0, az], [bx, y0, bz], [bx, hb, bz], [ax, ha, az], side);
          }
          continue;
        }
        if (!solid.has(`${x},${y + 1},${z}`) || RISE[solid.get(`${x},${y + 1},${z}`)]) quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], top);
        const sides = [[0, -1, [x0, z0], [x1, z0]], [1, 0, [x1, z0], [x1, z1]], [0, 1, [x1, z1], [x0, z1]], [-1, 0, [x0, z1], [x0, z0]]];
        for (const [dx, dz, a, b] of sides) {
          const nb = solid.get(`${x + dx},${y},${z + dz}`);
          if (nb && !RISE[nb]) continue;
          quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y, b[1]], [a[0], y, a[1]], side);
        }
      }
    }
    const grp = new THREE.Group();
    if (P.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      geo.computeBoundingSphere();
      grp.add(new THREE.Mesh(geo, groundMat));
    }
    if (WP.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(WP, 3));
      const m = new THREE.Mesh(geo, waterC);
      m.userData.water = true;
      grp.add(m);
    }
    return grp;
  }

  // the invisible walls: the hidden blocks (light grey) and the walls' insides the server refuses (pink, body high)
  function buildWalls(c) {
    const G = [], D = [];
    const box = (arr, x, y0, y1, z) => {
      const x0 = x - 0.5, x1 = x + 0.5, z0 = z - 0.5, z1 = z + 0.5;
      const q4 = (a, b, cc, d) => arr.push(...a, ...b, ...cc, ...a, ...cc, ...d);
      q4([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
      q4([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
      q4([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
      q4([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]);
      q4([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]);
    };
    for (const cell of c.cells.values()) {
      for (const cube of cell.cubes) {
        if (cube.kind === CD.K.hidden) box(G, cell.x, cube.y - 1, cube.y, cell.z);
        if (cube.flags & CD.CUBE.dark) box(D, cell.x, cube.y + 0.02, cube.y + 2, cell.z);
      }
      for (const l of cell.layers) if ((l.bad & CD.BAD.dark) && !cell.cubes.some((cb) => cb.y === l.f && (cb.flags & CD.CUBE.dark))) box(D, cell.x, l.f + 0.02, l.f + 2, cell.z);
    }
    const grp = new THREE.Group();
    for (const [arr, mat] of [[G, wallMat], [D, darkMat]]) if (arr.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      grp.add(new THREE.Mesh(geo, mat));
    }
    return grp;
  }

  // The heights and the walkable tops ("Altura e piso"). Each standing layer's top: green where a player can stand
  // (lighter the higher it is), amber on an edge or a slope, red and hatched where nobody can (a prop's or a wall's
  // top, a roof, water, an invisible wall); a red strip on each side the server's walk can't step over (a wall, a drop).
  const hatch = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(229,72,77,0.34)"; g.fillRect(0, 0, 32, 32);
    g.strokeStyle = "rgba(229,72,77,0.75)"; g.lineWidth = 3;
    for (let k = -32; k <= 64; k += 12) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 32, 32); g.stroke(); }
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.magFilter = THREE.NearestFilter;
    return tx;
  })();
  const topsMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [cutPlane], polygonOffset: true, polygonOffsetFactor: -2 });
  const badMat = new THREE.MeshBasicMaterial({ map: hatch, transparent: true, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [cutPlane], polygonOffset: true, polygonOffsetFactor: -2 });
  const edgeMat = new THREE.MeshBasicMaterial({ color: "#ff4d55", transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });
  function buildTops(c) {
    const P = [], C = [], B = [], BU = [], E = [];
    const near = Object.values(meta.areas || {}).find((a) => Math.hypot(a.centre[0] - c.a * 16, a.centre[1] - c.b * 16) < 80);
    const y0 = (near ? near.feet_y : 0) - STAND;
    const q4 = (arr, x0, x1, z0, z1, y) => arr.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
    for (const cell of c.cells.values()) for (const l of cell.layers) {
      const x = cell.x, z = cell.z, h2 = l.f + 0.24;   // (over a paving mesh a little above the cube top)
      if (l.bad) { q4(B, x - 0.5, x + 0.5, z - 0.5, z + 0.5, h2); BU.push(x, z, x + 1, z, x + 1, z + 1, x, z, x + 1, z + 1, x, z + 1); continue; }
      const k = Math.min(1.35, Math.max(0.65, 1 + 0.07 * (l.f - y0)));
      const col = l.warn ? [0.96, 0.65, 0.14] : [0.19 * k, 0.77 * k, 0.42 * k];
      q4(P, x - 0.47, x + 0.47, z - 0.47, z + 0.47, h2);
      for (let i = 0; i < 6; i++) C.push(...col);
      // the sides the walk can't step over: a red strip along that edge
      for (const [bit, x0, x1, z0, z1] of [[1, x - 0.5, x + 0.5, z + 0.42, z + 0.5], [2, x + 0.42, x + 0.5, z - 0.5, z + 0.5],
        [4, x - 0.5, x + 0.5, z - 0.5, z - 0.42], [8, x - 0.5, x - 0.42, z - 0.5, z + 0.5]])
        if (!(l.exits & bit)) q4(E, x0, x1, z0, z1, h2 + 0.01);
    }
    const grp = new THREE.Group();
    const mk = (arr, mat2, cols, uvs) => {
      if (!arr.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      if (cols) geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      if (uvs) geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      const m = new THREE.Mesh(geo, mat2); m.renderOrder = 1; grp.add(m);
    };
    mk(P, topsMat, C); mk(B, badMat, null, BU); mk(E, edgeMat);
    return grp;
  }

  // ---- camera
  function fwd() {
    const yaw = (S.yaw * Math.PI) / 180, p = (S.pitch * Math.PI) / 180;
    return [Math.sin(yaw) * Math.cos(p), -Math.sin(p), Math.cos(yaw) * Math.cos(p)];
  }
  function placeCamera() {
    const yaw = (S.yaw * Math.PI) / 180, pe = ((S.pitch + (EYE_PITCH - PITCH)) * Math.PI) / 180, d = EYE_D * S.zoom;
    const feetY = S.y + STAND;
    const eye = [S.x - Math.sin(yaw) * d * Math.cos(pe), feetY + d * Math.sin(pe), S.z - Math.cos(yaw) * d * Math.cos(pe)];
    const f = fwd();
    camera.position.set(eye[0], eye[1], -eye[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(eye[0] + f[0], eye[1] + f[1], -(eye[2] + f[2]));
    camera.far = 120 + 200 * S.zoom;
    camera.updateProjectionMatrix();
  }
  // the ground height under the view's centre (the feet): the top layer of the target cell, else the area's
  function groundY() {
    const c = cellAt(Math.round(S.x), Math.round(S.z));
    const l = c && (S.floor !== "all" ? CD.layerFor(c, S.floor) : CD.layerFor(c, "s"));
    if (l) return l.f;
    for (const a of Object.values(meta.areas || {})) {
      const [cx, cz] = a.centre;
      if (Math.abs(cx - S.x) < 60 && Math.abs(cz - S.z) < 60) return a.feet_y - STAND;
    }
    return S.y;
  }

  // ---- the floor cut
  function cutY() {
    if (S.cut != null) return S.cut;
    if (S.floor === "all" || S.floor === "s") return 1000;
    return +S.floor + (meta.headroom || 2) - 0.02;
  }

  // ---- markers
  const KIND_SHAPE = { rope: "post", rope2: "post", portal: "portal", hole: "hole", spawn: "spawn", elevator: "portal" };
  let problems = { problems: [], passed: {} };
  let pins = [];   // [{n, x, y, z, level}] the problems' numbered pins (HTML, projected each frame)
  function standOf(x, z, floor) {
    const c = cellAt(x, z);
    const l = c && CD.layerFor(c, floor);
    return l ? l.f : c ? CD.topOf(c) : null;
  }
  // the drawn ground's height at a cell (the Simplified meshes smooth the cubes: a swamp's ground
  // sits up to a cube over its cube tops), so a spawn's area and its monsters sit on what is drawn; else the cube top
  const downRay = new THREE.Raycaster();
  const surfaceMemo = new Map();   // "x,z,floor" -> height (a chunk's mesh only changes when it loads: cleared then)
  function surfaceOf(x, z, floor) {
    const f = standOf(x, z, floor);
    if (f == null || S.look !== "b") return f;
    const key = x + "," + z + "," + floor;
    if (surfaceMemo.has(key)) return surfaceMemo.get(key);
    world.updateMatrixWorld(true);   // (a chunk added since the last frame has no world matrix yet: the ray would miss it)
    const [a, b] = CD.chunkOf(x, z), ch = chunks.get(CD.chunkKey(a, b));
    if (!ch?.bMesh) return f;   // (not memoized: its mesh is still on the way)
    downRay.set(new THREE.Vector3(x, f + 1.6, -z), new THREE.Vector3(0, -1, 0));
    downRay.far = 3;
    const hit = downRay.intersectObjects(ch.bMesh.children.filter((o) => !o.userData.props && !o.userData.water), false)[0];
    const y = hit ? hit.point.y : f;
    surfaceMemo.set(key, y);
    return y;
  }
  const matCache = new Map();
  const mat = (hex, opts = {}) => {
    const key = hex + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color: hex, ...opts }));
    return matCache.get(key);
  };
  function shape(kind, color, sel, radius) {
    const g = new THREE.Group();
    const s = KIND_SHAPE[kind] || "pin";
    if (s === "post") {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.7, 12), mat(color));
      post.position.y = 0.85;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.84), mat(color));
      base.position.y = 0.03;
      g.add(post, base);
    } else if (s === "portal") {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 20), mat(color));
      disc.position.y = 0.03;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), mat(color, { emissive: color, emissiveIntensity: 0.25 }));
      gem.scale.y = 1.4;
      gem.position.y = 1.15;
      g.add(disc, gem);
    } else if (s === "hole") {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 20), mat("#19d3d3"));
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 16), mat("#111111"));
      rim.position.y = 0.04; pit.position.y = 0.05;
      g.add(rim, pit);
    } else if (s === "spawn") {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 4), mat(color));
      cone.rotation.x = Math.PI;
      cone.position.y = 0.95;
      g.add(cone);
      if (radius > 0) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius + 0.4, radius + 0.5, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        g.add(ring);
      }
    } else {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8), mat(color));
      stick.position.y = 0.55;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), mat(color));
      head.position.y = 1.2;
      g.add(stick, head);
    }
    if (sel) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32), new THREE.MeshBasicMaterial({ color: "#ffe066", side: THREE.DoubleSide, depthTest: false, transparent: true }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.renderOrder = 5;
      g.add(ring);
    }
    return g;
  }
  function ghost(color) {   // a landing: a standing figure's outline where the player arrives
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.9, 4, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    body.position.y = 0.75;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.45, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(body, ring);
    return g;
  }
  function disposeGroup(g) {
    for (const o of [...g.children]) { g.remove(o); o.traverse((n) => { n.geometry?.dispose(); if (n.material && !matCache.has(n.material)) n.material.dispose?.(); }); }
  }
  function paintMarkers() {
    disposeGroup(marksG);
    disposeGroup(xray);
    const list = api.markers();
    const sel = api.selected();
    problems = CD.problemsOf(list, cellAt);
    const bad = new Map();
    for (const p of problems.problems) bad.set(p.id + ":" + p.end, p);
    pins = [];
    let n = 0;
    for (const p of problems.problems) {
      const y = p.end === "at" ? standOf(p.x, p.z, p.floor) : standOf(p.x, p.z, p.floor);
      if (y != null) pins.push({ n: ++n, x: p.x, y: y + 2.3, z: p.z, level: p.level, id: p.id });
      p.n = n;
    }
    for (const m of list) {
      if (m.cells || m.points) { const g = areaOrRoute(m); if (g) marksG.add(g); continue; }
      if (!("x" in m)) continue;
      const y = standOf(m.x, m.z, m.floor);
      if (y == null) continue;
      const color = api.colorOf(m);
      const ys = OBJ ? surfaceOf(m.x, m.z, m.floor) : y;
      const g = OBJ ? OBJ.build(S.objects, m, { y: ys, standAt: (x, z) => surfaceOf(x, z, m.floor), collapse: S.zoom > 2.2, grow: Math.max(1, S.zoom / 1.3) })
        : shape(m.kind, m.kind === "rope" || m.kind === "rope2" ? "#ff7a1a" : m.kind === "spawn" ? "#e5322d" : color, m.id === sel, m.fields?.radius || 0);
      g.position.set(m.x, OBJ ? ys : y, m.z);
      g.userData.id = m.id;
      marksG.add(g);
      const pb = bad.get(m.id + ":at");
      if (S.check && pb && pb.level === "bad") {   // seen through what hides it, in red
        const xr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.7, 12), new THREE.MeshBasicMaterial({ color: LEVEL_RGB.bad, transparent: true, opacity: 0.6, depthTest: false }));
        xr.position.set(m.x, y + 0.85, m.z);
        xr.renderOrder = 4;
        xray.add(xr);
      }
      if (m.dest) {
        const dy = standOf(m.dest.x, m.dest.z, m.dest.floor);
        const db = bad.get(m.id + ":dest");
        const lc = S.check ? (db ? LEVEL_RGB[db.level] : LEVEL_RGB.ok) : "#9fdc8a";
        if (dy != null) {
          const gh = ghost(lc);
          gh.position.set(m.dest.x, dy, m.dest.z);
          marksG.add(gh);
          if (S.check && db && db.level === "bad") {
            const xr = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 12), new THREE.MeshBasicMaterial({ color: LEVEL_RGB.bad, transparent: true, opacity: 0.55, depthTest: false }));
            xr.position.set(m.dest.x, dy + 0.75, m.dest.z);
            xr.renderOrder = 4;
            xray.add(xr);
          }
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(m.x, y + 1.4, m.z), new THREE.Vector3(m.dest.x, dy + 0.2, m.dest.z)]);
          const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: lc, dashSize: 0.5, gapSize: 0.3, depthTest: false, transparent: true }));
          line.computeLineDistances();
          line.renderOrder = 3;
          marksG.add(line);
        }
      }
    }
    paintProblems();
    draw();
  }

  // an area (its cells as tiles on their ground, in its colour) or a route (a line a little over the ground)
  function areaOrRoute(m) {
    const col = api.colorOf(m), g = new THREE.Group();
    if (m.cells) {
      const P = [];
      for (const [x, z] of m.cells) {
        const y = standOf(x, z, m.floor);
        if (y == null) continue;
        const h2 = y + 0.2;
        P.push(x - 0.5, h2, z - 0.5, x + 0.5, h2, z - 0.5, x + 0.5, h2, z + 0.5, x - 0.5, h2, z - 0.5, x + 0.5, h2, z + 0.5, x - 0.5, h2, z + 0.5);
      }
      if (!P.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      mesh.renderOrder = 2;
      g.add(mesh);
    } else {
      const pts = m.points.map(([x, z]) => { const y = standOf(x, z, m.floor); return y == null ? null : new THREE.Vector3(x, y + 0.35, z); }).filter(Boolean);
      if (pts.length < 2) return null;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true }));
      line.renderOrder = 3;
      g.add(line);
      for (const v of [pts[0], pts[pts.length - 1]]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: col }));
        dot.position.copy(v);
        g.add(dot);
      }
    }
    return g;
  }
  let paintQueued = false;
  function paintMarkersSoon() { if (!paintQueued) { paintQueued = true; requestAnimationFrame(() => { paintQueued = false; paintMarkers(); }); } }

  // ---- UI
  const pill = (attr, items, now, on) => h("div", { class: "v3d-seg" }, items.map(([v, word, help]) =>
    h("button", { type: "button", [attr]: v, class: String(now) === String(v) ? "on" : "", title: help || word, onclick: () => on(v) }, word)));
  const togg = (attr, word, help, on, act) => h("button", { type: "button", class: "v3d-tgl" + (on ? " on" : ""), [attr]: "1", "aria-pressed": String(on), title: help, onclick: act }, (on ? "✓ " : "") + word);
  const lookBox = h("div", { class: "v3d-card v3d-look" });
  function paintLook() {
    lookBox.replaceChildren(...[h("span", { class: "v3d-k" }, t3("look")),
      // (the Simplified ground only where its local data is: the public map shows the server's blocks)
      hasB ? pill("data-look", [["b", t3("lookB"), t3("lookBHelp")], ["c", t3("lookC"), t3("lookCHelp")]], S.look, (v) => { S.look = v; applyLook(); }) : null,
      togg("data-check", t3("lookCheck") + " (C)", t3("lookCheckHelp"), S.check, () => toggle("check")),
      togg("data-walls", t3("lookWalls") + " (I)", t3("lookWallsHelp"), S.walls, () => toggle("walls")),
      togg("data-tops", t3("lookTops") + " (H)", t3("lookTopsHelp"), S.tops, () => toggle("tops")),
      h("span", { class: "v3d-k sep" }, t3("objectsWord")),
      pill("data-objects", [["a", t3("objA"), t3("objAHelp")], ["c", t3("objC"), t3("objCHelp")]], S.objects, setObjects)].filter(Boolean));
  }
  function toggle(name) { S[name] = !S[name]; applyLook(); if (name === "check") paintMarkers(); }
  function setObjects(v) { S.objects = v; paintLook(); paintMarkers(); }
  function asPlayer() { S.free = false; S.pitch = PITCH; S.zoom = 1; S.yaw = Math.round(S.yaw / 90) * 90 % 360; update(); }
  function freeView() { S.free = !S.free; if (S.free) { S.pitch = 42; S.zoom = Math.max(S.zoom, 1.4); } else S.pitch = PITCH; update(); }
  const camBox = h("div", { class: "v3d-card v3d-cam" },
    h("button", { type: "button", title: t3("rotL"), onclick: () => turn(-90) }, "⟲ 90°"),
    h("button", { type: "button", title: t3("rotR"), onclick: () => turn(90) }, "⟳ 90°"),
    h("button", { type: "button", title: t3("zoomIn"), onclick: () => zoomBy(0.8) }, "+"),
    h("button", { type: "button", title: t3("zoomOut"), onclick: () => zoomBy(1.25) }, "−"),
    h("button", { type: "button", "data-cam": "player", title: t3("asPlayer") + " (P)", onclick: () => asPlayer() }, "👁 " + t3("asPlayer")),
    h("button", { type: "button", "data-cam": "free", title: t3("freeHelp") + " (F)", onclick: () => freeView() }, "⤢ " + t3("freeView")),
    h("button", { type: "button", "data-help": "1", class: "v3d-q", title: t3("helpTitle") + " (?)", onclick: () => toggleHelp() }, "?"));
  const hint = h("div", { class: "v3d-hint", hidden: true });
  const floorBox = h("div", { class: "v3d-card v3d-floors" });
  const probBox = h("div", { class: "v3d-card v3d-problems" });
  const mini = h("canvas", { class: "v3d-mini", width: 240, height: 150 });
  const miniBox = h("div", { class: "v3d-card v3d-minibox" }, mini, h("div", { class: "v3d-sub" }, t3("minimap")));
  const placeBox = h("div", { class: "v3d-card v3d-place" });
  const tipBox = h("div", { class: "v3d-tip", hidden: true });
  const status = h("div", { class: "v3d-status", hidden: true });
  const pinLayer = h("div", { class: "v3d-pins" });
  const helpBox = h("div", { class: "v3d-help", hidden: true, role: "dialog", "aria-label": t3("helpTitle") });
  const topRow = h("div", { class: "v3d-top" }, lookBox, camBox);
  root.append(pinLayer, topRow, hint, floorBox, probBox, miniBox, placeBox, tipBox, status, helpBox);
  // (a narrow view wraps the top cards onto two rows: the floor card and the hint go under them)
  function placeCards() {
    const below = topRow.offsetTop + topRow.offsetHeight + 8;
    floorBox.style.top = below + "px";
    hint.style.top = below + "px";
    helpBox.style.top = below + "px";
  }

  function paintStatus() { status.hidden = loadingN === 0; status.textContent = t3("loading"); root.dataset.ready = loadingN === 0 && chunks.size ? "1" : "0"; }

  const TOOLS = [["rope", "p.rope", "#ff7a1a", "⚓"], ["portal", "p.portal", "#8e4ec6", "◎"], ["landing", "p.landing", "#30c46c", "⬇"], ["spawn", "p.spawn", "#e5322d", "⚔"]];
  function paintPlace() {
    placeBox.replaceChildren(h("div", { class: "v3d-k" }, t3("place")),
      h("div", { class: "v3d-tools" }, TOOLS.map(([k, w, c, g], i) => h("button", { type: "button", "data-place": k, class: S.tool === k ? "on" : "", title: t3(w) + " (" + (i + 1) + ")", onclick: () => setTool(S.tool === k ? null : k) },
        h("span", { class: "g", style: `color:${c}` }, g), h("span", {}, t3(w)), h("kbd", {}, String(i + 1))))),
      h("div", { class: "v3d-key" }, ...[["ok", "keyOk"], ["warn", "keyWarn"], ["bad", "keyBad"]].map(([l, w]) => h("span", {}, h("i", { style: `background:${LEVEL_RGB[l]}` }), t3(w)))));
  }
  function setTool(k) {
    S.tool = k; S.pending = null;
    if (k === "landing") {
      const m = api.markers().find((x) => x.id === api.selected());
      if (!m || !["rope", "rope2", "portal", "hole", "elevator"].includes(m.kind)) { showHint(t3("hint.landingNone")); S.tool = null; paintPlace(); return; }
      S.pending = m.id;
    }
    showHint(k ? t3("hint." + k) : "");
    paintPlace();
  }
  function showHint(text) { hint.hidden = !text; hint.textContent = text; }

  function floorWord(f) { return f === "s" ? api.t("surface") : api.t("floor", f); }
  // the floors the view's ground holds (a standing layer within a chunk of the centre), top first
  const level = (f) => (f === "s" ? 0.5 : +f);
  let cutRange = [-16, 16];
  function floorOptions() {
    const seen = new Map();
    const [a0, b0] = CD.chunkOf(Math.round(S.x), Math.round(S.z));
    let lo = Infinity, hi = -Infinity;
    for (const ch of chunks.values()) {
      if (!ch.c || Math.abs(ch.a - a0) > 1 || Math.abs(ch.b - b0) > 1) continue;
      for (const cell of ch.c.cells.values()) {
        for (const l of cell.layers) if (!l.bad) seen.set(l.floor, (seen.get(l.floor) || 0) + 1);
        for (const c of cell.cubes) { lo = Math.min(lo, c.y - 1); hi = Math.max(hi, c.y + 1); }
      }
    }
    if (lo < hi) cutRange = [lo, hi];
    if (S.floor !== "all" && !seen.has(S.floor)) seen.set(S.floor, 0);
    return ["all", ...[...seen.keys()].sort((p, r) => level(r) - level(p))];
  }
  // Floor: a slider from the top ("all", nothing cut) down to the deepest floor here, its stops listed beside it
  // (a click on one goes there). Cut ("profundidade"): the height the blocks are sliced at inside the floor, like a
  // section, to look into the walls and rooms at that level; its top end is "no cut".
  function paintFloors() {
    const opts = floorOptions(), n = opts.length;
    const i = Math.max(0, opts.indexOf(S.floor));
    const here = (() => { const c = cellAt(Math.round(S.x), Math.round(S.z)); return c && c.layers.length ? CD.layerFor(c, "s").floor : null; })();
    const fs = h("input", { type: "range", class: "v3d-vslider", min: 0, max: n - 1, step: 1, value: String(n - 1 - i),
      "aria-label": t3("floorWord"), title: t3("floorCutHelp") + " ([ ] PageUp PageDown)" });
    fs.addEventListener("input", () => setFloor(opts[n - 1 - +fs.value]));
    const stops = h("div", { class: "v3d-stops" }, opts.map((f) => h("button", { type: "button", "data-floor": f, class: f === S.floor ? "on" : "", onclick: () => setFloor(f) },
      f === "all" ? t3("floorAll") : floorWord(f), f === here ? h("span", { class: "dot", title: t3("floorHere") }, "●") : null)));
    const [lo, hi] = cutRange, cut = Math.min(cutY(), hi);
    const cs = h("input", { type: "range", class: "v3d-hslider", min: String(lo), max: String(hi), step: "0.5", value: String(cut),
      "aria-label": t3("cutWord"), title: t3("cutHelp") + " (, .)" });
    cs.addEventListener("input", () => setCut(+cs.value));
    floorBox.replaceChildren(h("div", { class: "v3d-k", title: t3("floorCutHelp") }, t3("floorWord")),
      h("div", { class: "v3d-floorpick" }, fs, stops),
      h("div", { class: "v3d-k", title: t3("cutHelp") }, t3("cutWord")), cs,
      h("div", { class: "v3d-sub" }, cut >= hi ? t3("cutNone") : t3("cutAt", fmt(cut))));
  }
  function setFloor(f) { S.floor = f; S.cut = null; cutPlane.constant = cutY(); paintFloors(); update(); }
  function stepFloor(dir) {   // -1 up, +1 down
    const opts = floorOptions(), i = Math.max(0, opts.indexOf(S.floor));
    const j = Math.min(opts.length - 1, Math.max(0, i + dir));
    if (j !== i) setFloor(opts[j]);
  }
  function setCut(v) {
    const [lo, hi] = cutRange;
    S.cut = v >= hi ? null : Math.max(lo, v);
    cutPlane.constant = cutY();
    paintFloors();
    draw();
  }
  function stepCut(d) { setCut(Math.min(cutY(), cutRange[1]) + d); }

  // the keyboard: one key each (nothing while typing in a field); "?" lists them
  const KEYS = [["PageUp  ]", "kFloorUp"], ["PageDown  [", "kFloorDown"], ["0", "kFloorAll"], [",  .", "kCut"],
    ["Q  E", "kRotate"], ["+  −", "kZoom"], ["P", "kPlayer"], ["F", "kFree"], ["C", "kCheck"], ["H", "kTops"], ["I", "kWalls"],
    ["M", "kObjects"], ["1  2  3  4", "kPlace"], ["Ctrl+C  Ctrl+V", "kCopy"], ["kAltClick", "kBlock"], ["Esc", "kEsc"], ["?", "kHelp"]];
  function toggleHelp(on = !S.help) {
    S.help = on;
    helpBox.hidden = !on;
    if (on) helpBox.replaceChildren(h("div", { class: "hd" }, h("b", {}, t3("helpTitle")), h("button", { type: "button", onclick: () => toggleHelp(false), "aria-label": api.t("close") }, "×")),
      h("table", {}, KEYS.map(([k, w]) => h("tr", {}, h("td", {}, ...(k.startsWith("k") ? t3(k) : k).split("  ").map((x) => h("kbd", {}, x))), h("td", {}, t3(w))))));
  }

  function paintProblems() {
    const P = problems.problems, pass = problems.passed || {};
    const rows = P.map((p) => {
      const m = api.markers().find((x) => x.id === p.id);
      const own = m && api.labelOf(m);
      const name = own && own !== "?" ? own : api.t("kind." + p.kind);
      const where = `(${p.x}, ${p.stand != null ? fmt(p.stand) : "?"}, ${p.z})`;
      return h("div", { class: "v3d-prob " + p.level },
        h("span", { class: "n" }, String(p.n)),
        h("div", { class: "b" }, h("div", { class: "t" }, p.end === "dest" ? t3("endDest", name) : t3("endAt", name)),
          h("div", { class: "s" }, where + " · " + p.reasons.map((r) => CD.reasonText(r, t3)).join("; "))),
        h("button", { type: "button", class: "go", onclick: () => { api.select(p.id); goTo(p.x, p.z); } }, t3("goTo")));
    });
    const ok = [];
    if (pass.spots) ok.push(h("div", { class: "v3d-pass" }, h("i"), t3("passedSpots", pass.spots)));
    if (pass.landings) ok.push(h("div", { class: "v3d-pass" }, h("i"), t3("passedLandings", pass.landings)));
    if (pass.unloaded) ok.push(h("div", { class: "v3d-pass off" }, h("i"), t3("unloaded", pass.unloaded)));
    if (!P.length && !ok.length) ok.push(h("div", { class: "v3d-sub" }, t3("nothingChecked")));
    probBox.replaceChildren(h("div", { class: "v3d-k" }, P.length ? t3("problems", P.length) : t3("problems0")), ...rows, ...ok);
  }

  // the corner map: the 2D page's own tiles (zoom 0, one pixel a cell), 2 pixels a cell, the view's ground drawn on it
  const tileImg = new Map();
  function tile(floor, i, j) {
    const url = `tiles/${api.tileVersion}/${floor}/0/${i}_${j}.png`;
    if (!tileImg.has(url)) {
      const im = new Image();
      im.onload = () => paintMini();
      im.onerror = () => { im.bad = true; };
      im.src = url;
      tileImg.set(url, im);
    }
    return tileImg.get(url);
  }
  const PX = 2;
  function paintMini() {
    const g = mini.getContext("2d"), W = mini.width, H = mini.height;
    g.fillStyle = "#0b0d11"; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    const floor = S.floor === "all" ? "s" : S.floor;
    const cx = Math.round(S.x), cz = Math.round(S.z);
    const left = cx - W / PX / 2, top = -cz - H / PX / 2;   // (pixel rows grow with -z)
    for (let i = Math.floor(left / 256); i <= Math.floor((left + W / PX) / 256); i++)
      for (let j = Math.floor(top / 256); j <= Math.floor((top + H / PX) / 256); j++) {
        const im = tile(floor, i, j);
        if (im.complete && !im.bad && im.naturalWidth) g.drawImage(im, (i * 256 - left) * PX, (j * 256 - top) * PX, 256 * PX, 256 * PX);
      }
    // the view's ground: the screen's corners on the feet's height
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => groundAt(u, v)).filter(Boolean);
    if (pts.length === 4) {
      g.strokeStyle = "#ffffff"; g.lineWidth = 1.5; g.beginPath();
      pts.forEach(([x, z], k) => { const px = (x - left) * PX, py = (-z - top) * PX; k ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.closePath(); g.stroke();
    }
    g.fillStyle = "#ffe066"; g.beginPath(); g.arc(W / 2, H / 2, 3, 0, 7); g.fill();
  }
  function groundAt(u, v) {   // screen NDC -> game (x, z) on the plane of the feet
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(u, v), camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(S.y));
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, p)) return null;
    if (p.distanceTo(camera.position) > 400) return null;
    return [p.x, -p.z];
  }
  mini.addEventListener("click", (e) => {
    const r = mini.getBoundingClientRect();
    const x = Math.round(S.x) + ((e.clientX - r.left) * (mini.width / r.width) - mini.width / 2) / PX;
    const z = Math.round(S.z) - ((e.clientY - r.top) * (mini.height / r.height) - mini.height / 2) / PX;
    goTo(Math.round(x), Math.round(z));
  });

  // ---- picking
  const ray = new THREE.Raycaster();
  function pick(clientX, clientY) {
    resize();
    placeCamera();
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    const targets = [S.look === "b" ? layersB : layersC];
    let hits = ray.intersectObjects(targets, true);
    const cy = cutY();
    // (the props are shapes, not the ground a player stands on: the pick goes through them; what blocks is in the
    // grid's verdict)
    hits = hits.filter((hh) => hh.point.y <= cy + 0.001 && !hh.object.userData.props);
    const hit = hits[0];
    if (!hit) return null;
    const p = hit.point.clone().addScaledVector(ray.ray.direction, 0.02);
    const local = world.worldToLocal(p.clone());
    const n = hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0);
    const water = !!hit.object.userData.water;
    const up = water || Math.abs(n.y) > 0.6;
    const x = Math.round(local.x), z = Math.round(local.z);
    const cell = cellAt(x, z);
    const y = water ? hit.point.y : up ? local.y + 0.02 : local.y;
    return { x, z, y, cell, ...CD.pickAt(cell, y, up), sx: clientX - r.left, sy: clientY - r.top };
  }
  const hoverMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: LEVEL_RGB.ok, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }));
  hoverMesh.rotation.x = -Math.PI / 2;
  hoverMesh.renderOrder = 6;
  hoverMesh.visible = false;
  const hoverEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: "#ffffff", depthTest: false, transparent: true }));
  hoverEdge.rotation.x = -Math.PI / 2;
  hoverEdge.renderOrder = 7;
  hoverEdge.visible = false;
  world.add(hoverMesh, hoverEdge);
  function showHover(pk) {
    S.hover = pk;
    if (!pk) { hoverMesh.visible = hoverEdge.visible = false; tipBox.hidden = true; draw(); return; }
    const y = (pk.layer ? pk.layer.f : pk.cube ? pk.cube.y : pk.y) + 0.04;
    for (const m of [hoverMesh, hoverEdge]) { m.position.set(pk.x, y, pk.z); m.visible = S.check || !!S.tool; }
    hoverMesh.material.color.set(LEVEL_RGB[pk.level]);
    const stand = pk.layer ? pk.layer.stand : null;
    const floor = pk.layer ? pk.layer.floor : null;
    tipBox.replaceChildren(
      h("div", { class: "t " + pk.level }, h("b", {}, t3(pk.level === "ok" ? "levelOk" : pk.level === "warn" ? "levelWarn" : "levelBad")),
        ` (${pk.x}, ${stand != null ? fmt(stand) : "?"}, ${pk.z})` + (floor ? " · " + floorWord(floor) : "")),
      ...(pk.layer ? [h("div", { class: "hgt" }, t3("hHeight", fmt(pk.layer.stand), (pk.layer.f - S.y > 0 ? "+" : "") + (pk.layer.f - S.y)),
        h("span", { class: "on " + (pk.layer.bad ? "no" : "yes") }, t3(pk.layer.bad ? "hNoWalk" : "hWalk")))] : []),
      ...pk.reasons.map((r) => h("div", { class: "r" }, CD.reasonText(r, t3))),
      ...(S.tool && pk.layer ? [h("div", { class: "a" }, t3("clickPlace", t3(S.tool === "landing" || S.pending != null ? "p.landing" : "p." + S.tool)))] : []));
    tipBox.hidden = !(S.check || S.tool);
    tipBox.style.left = Math.min(pk.sx + 18, root.clientWidth - 300) + "px";
    tipBox.style.top = Math.max(pk.sy - 20, 60) + "px";
    if (pk.layer) api.showCell?.(pk.x, pk.z, pk.layer.floor);
    draw();
  }

  // a click: place with the armed tool, else select the marker under it
  function click(pk, e) {
    if (S.tool && pk && pk.layer) {
      const floor = pk.layer.floor;
      if (S.pending != null) {   // a landing for the rope or portal just placed (or selected)
        api.setDest(S.pending, pk.x, pk.z, floor);
        const back = S.tool === "landing" ? null : S.tool;
        S.pending = null;
        S.tool = back;
        showHint(back ? t3("hint." + back) : "");
        paintPlace();
        return;
      }
      if (S.tool === "rope" || S.tool === "portal") {
        const id = api.place(S.tool, pk.x, pk.z, floor);
        if (id != null) { S.pending = id; showHint(t3(S.tool === "rope" ? "hint.ropeDest" : "hint.portalDest")); }
        return;
      }
      if (S.tool === "spawn") { api.place("spawn", pk.x, pk.z, floor); return; }
    }
    // select: the nearest marker to the clicked cell (within 1.5 cells); else the map's block under the cursor (the
    // whole thing, or one block with Alt); else nothing
    if (pk) {
      let best = null, bd = 1.6;
      for (const m of api.markers()) {
        if (!("x" in m)) continue;
        const d = Math.hypot(m.x - pk.x, m.z - pk.z);
        if (d < bd) { bd = d; best = m; }
      }
      if (best) { selectAsset(null); api.select(best.id); return; }
      api.select(null);
      const kind = pk.cube ? CD.KINDS[pk.cube.kind] : null;
      const blocky = kind && (GROUPS[kind] || e?.altKey || !pk.layer || pk.level === "bad");
      selectAsset(blocky ? assetAt(pk, !!e?.altKey) : null);
    }
  }

  // ---- input: drag pans, right-drag (or Shift) turns and tilts (free view), the wheel zooms, a click picks
  let drag = null;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, sx: S.x, sz: S.z, yaw: S.yaw, pitch: S.pitch, rot: e.button === 2 || e.shiftKey, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      if (drag.rot) {
        S.free = true;
        S.yaw = (drag.yaw - dx * 0.3 + 360) % 360;
        S.pitch = Math.min(89, Math.max(15, drag.pitch + dy * 0.25));
      } else {
        const k = (EYE_D * S.zoom * 2 * Math.tan((FOV * Math.PI) / 360)) / canvas.clientHeight / Math.sin((S.pitch * Math.PI) / 180);
        const yaw = (S.yaw * Math.PI) / 180;
        const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
        S.x = drag.sx - dx * k * rx + dy * k * fx * Math.sin((S.pitch * Math.PI) / 180);
        S.z = drag.sz - dx * k * rz + dy * k * fz * Math.sin((S.pitch * Math.PI) / 180);
      }
      update(false);
      return;
    }
    const pk = pick(e.clientX, e.clientY);
    showHover(pk);
  });
  canvas.addEventListener("pointerup", (e) => {
    const d = drag;
    drag = null;
    if (d && d.moved) { update(); return; }
    click(pick(e.clientX, e.clientY), e);
  });
  canvas.addEventListener("pointerleave", () => { if (!drag) showHover(null); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  const onKey = (e) => {
    if (root.hidden || e.target.closest?.("input, textarea, select")) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    const act = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (mod && !e.altKey && (k === "c" || k === "C")) return act(copySel);
    if (mod && !e.altKey && (k === "v" || k === "V")) return act(pasteHere);
    if (mod || e.altKey) return;   // (Ctrl+Z and the page's other keys go on to the page)
    if (k === "Escape") {
      if (S.help) return act(() => toggleHelp(false));
      if (S.tool || S.pending != null) return act(() => setTool(null));
      if (S.asset) return act(() => selectAsset(null));
      return;
    }
    const keys = { PageUp: () => stepFloor(-1), "]": () => stepFloor(-1), PageDown: () => stepFloor(1), "[": () => stepFloor(1),
      0: () => setFloor("all"), ".": () => stepCut(0.5), ",": () => stepCut(-0.5), q: () => turn(-90), e: () => turn(90),
      "+": () => zoomBy(0.8), "=": () => zoomBy(0.8), "-": () => zoomBy(1.25), p: asPlayer, f: freeView,
      c: () => toggle("check"), h: () => toggle("tops"), i: () => toggle("walls"), m: () => setObjects(S.objects === "a" ? "c" : "a"),
      1: () => setTool(S.tool === "rope" ? null : "rope"), 2: () => setTool(S.tool === "portal" ? null : "portal"),
      3: () => setTool(S.tool === "landing" ? null : "landing"), 4: () => setTool(S.tool === "spawn" ? null : "spawn"), "?": () => toggleHelp() };
    const fn = keys[k.length === 1 ? k.toLowerCase() : k];
    if (fn) act(fn);
  };
  // Ctrl+C: the selected markers (one, or several: the page's Shift+click) into this view's clipboard; Ctrl+V: a copy
  // of them at the cell under the cursor, on that cell's floor (one undo step, the copies selected)
  function copySel() {
    if (S.asset) { showHint(t3("assetNoCopy")); return; }
    const ids = new Set(api.selectedIds ? api.selectedIds() : [api.selected()].filter((x) => x != null));
    S.clip = api.markers().filter((m) => ids.has(m.id)).map((m) => structuredClone(m));
    showHint(S.clip.length ? t3("copied3", S.clip.length) : t3("nothingCopied"));
  }
  function pasteHere() {
    const pk = S.hover;
    if (!S.clip.length || !pk?.layer) { showHint(S.clip.length ? t3("pasteWhere") : t3("nothingCopied")); return; }
    const n = api.paste ? api.paste(S.clip, pk.x, pk.z, pk.layer.floor) : 0;
    showHint(n ? t3("pasted", n) : t3("nothingCopied"));
  }
  // a click on the map's own blocks (no tool armed, no marker there): the whole thing (a wall, an object, a roof: the
  // blocks of that kind joined to it) or, with Alt, the one block; shown with its size and heights (look only: the map's
  // blocks are not edited from here)
  const assetG = new THREE.Group();
  world.add(assetG);
  const GROUPS = { wall: "solid", object: "solid", roof: "roof", hidden: "hidden" };
  function selectAsset(sel) {
    disposeGroup(assetG);
    S.asset = sel;
    if (!sel) { showHint(""); draw(); return; }
    const P = [];
    for (const [x, y, z] of sel.cubes) {
      const x0 = x - 0.52, x1 = x + 0.52, z0 = z - 0.52, z1 = z + 0.52, y0 = y - 1.02, y1 = y + 0.02;
      const q4 = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d);
      q4([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]); q4([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
      q4([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]); q4([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]);
      q4([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.38, depthTest: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 9;
    assetG.add(mesh);
    const ys = sel.cubes.map((c) => c[1]);
    showHint(t3("assetInfo", sel.cubes.length, Math.min(...ys), Math.max(...ys), t3("kind3." + sel.kind)) + " · " + t3("assetHint"));
    draw();
  }
  // the blocks joined by a face or an edge (a roof's slopes step up diagonally)
  const NEAR18 = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
    if ((dx || dy || dz) && Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2) NEAR18.push([dx, dy, dz]);
  function assetAt(pk, single) {
    const c = pk.cube;
    if (!c || !pk.cell) return null;
    const kind = CD.KINDS[c.kind], group = GROUPS[kind];
    const start = [pk.x, c.y, pk.z];
    if (single || !group) return { kind, cubes: [start] };
    const seen = new Set([start.join()]), out = [start], todo = [start];
    while (todo.length && out.length < 1500) {
      const [x, y, z] = todo.pop();
      for (const [dx, dy, dz] of NEAR18) {
        const n = [x + dx, y + dy, z + dz], key = n.join();
        if (seen.has(key)) continue;
        seen.add(key);
        const cell = cellAt(n[0], n[2]), cube = cell?.cubes.find((q) => q.y === n[1]);
        if (cube && GROUPS[CD.KINDS[cube.kind]] === group) { out.push(n); todo.push(n); }
      }
    }
    return { kind, cubes: out };
  }
  document.addEventListener("keydown", onKey, true);

  function turn(d) { S.yaw = (Math.round((S.yaw + d) / 90) * 90 + 360) % 360; update(); }
  function zoomBy(k) { S.zoom = Math.min(4, Math.max(0.3, S.zoom * k)); update(); }
  function goTo(x, z) { S.x = x; S.z = z; update(); }

  function applyLook() {
    layersB.visible = S.look === "b";
    layersC.visible = S.look === "c";
    wallsG.visible = S.walls;
    topsG.visible = S.tops;
    xray.visible = S.check;
    fadeProps(S.check);
    paintLook();
    if (S.hover) showHover(S.hover);
    draw();
  }

  // ---- frame
  let raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(frame); }
  function resize() {
    const w = root.clientWidth || 800, hh = root.clientHeight || 600;
    if (w === resize.w && hh === resize.h) return;
    resize.w = w; resize.h = hh;
    renderer.setSize(w, hh, false);   // (the drawing buffer; the canvas fills the view by CSS)
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
  }
  function frame() {
    raf = 0;
    resize();
    placeCards();
    placeCamera();
    renderer.render(scene, camera);
    // the problems' numbered pins over the canvas
    pinLayer.replaceChildren();
    if (S.check) for (const p of pins) {
      const v = new THREE.Vector3(p.x, p.y, -p.z).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      pinLayer.append(h("div", { class: "v3d-pin " + p.level, style: `left:${((v.x + 1) / 2) * root.clientWidth}px;top:${((1 - v.y) / 2) * root.clientHeight}px` }, String(p.n)));
    }
    paintMini();
  }
  let lastY = null;
  function update(full = true) {
    S.y = groundY();
    stream();
    if (full) { paintFloors(); }
    if (lastY !== S.y) { lastY = S.y; }
    api.viewMoved?.(Math.round(S.x), Math.round(S.z));
    draw();
  }
  new ResizeObserver(() => { resize(); draw(); }).observe(root);   // (picking needs the camera of the size shown now)

  paintLook(); paintPlace(); paintProblems();
  if (S.help) toggleHelp(true);
  cutPlane.constant = cutY();
  applyLook();
  update();
  if (q.get("tool")) setTool(q.get("tool"));
  // a hover asked by the address (screenshots): the cell's top layer, as if the cursor were on it
  const hv = (q.get("hover") || "").split(",").map(Number);
  OBJ.ready.then(() => paintMarkers());
  const ready = (async () => {
    await OBJ.ready;
    for (let i = 0; i < 100 && (loadingN || !chunks.size); i++) await new Promise((r) => setTimeout(r, 50));
    S.y = groundY();
    paintMarkers(); paintFloors();
    if (hv.length === 2 && hv.every(Number.isFinite)) {
      placeCamera();
      const c = cellAt(hv[0], hv[1]);
      const l = c && (c.layers.find((x) => x.floor === (S.floor === "all" ? "s" : S.floor)) || c.layers[0]);
      if (c) {
        const y = l ? l.f : CD.topOf(c);
        const v = new THREE.Vector3(hv[0], y, -hv[1]).project(camera);
        const sx = ((v.x + 1) / 2) * root.clientWidth, sy = ((1 - v.y) / 2) * root.clientHeight;
        showHover({ x: hv[0], z: hv[1], y, cell: c, ...(l ? { layer: l, cube: null, ...CD.verdict(l) } : CD.pickAt(c, y, true)), sx, sy });
      }
    }
    draw();
    await new Promise((r) => requestAnimationFrame(() => r()));
    root.dataset.ready = "1";
  })();
  // read-only hooks for the page's browser tests: the state, a cell's top on the screen (client pixels), the problems
  const screenOf = (x, z, floor = "s") => {
    resize();
    placeCamera();
    const c = cellAt(x, z), l = c && CD.layerFor(c, floor);
    if (!l) return null;
    const v = new THREE.Vector3(x, l.f, -z).project(camera), r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, floor: l.floor, stand: l.stand };
  };
  window.__v3d = { ready, state: () => ({ ...S, hover: null, asset: S.asset ? { kind: S.asset.kind, n: S.asset.cubes.length } : null, chunks: chunks.size, problems: problems.problems.map((p) => ({ ...p })) }), pick, screenOf };

  return {
    refresh() { paintMarkers(); },
    show() { root.hidden = false; update(); },
    hide() { root.hidden = true; showHover(null); },
    goTo(x, z) { goTo(x, z); },
    where() { return { x: Math.round(S.x), z: Math.round(S.z), floor: S.floor === "all" ? "s" : S.floor }; },
  };
}
