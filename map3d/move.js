// Moving the 3D view with the keyboard (W A S D and the arrows). No DOM here: the page and the tests (node) share it.
// The view's heading (yaw, degrees: 0 looks north, +z; 90 looks east, +x, after one E) decides what "up the screen"
// is: W / ArrowUp always moves away from the camera, D / ArrowRight to the right of the picture, whatever Q / E did.

// the keys that move, by KeyboardEvent.key (lower case): [forward, right]
export const MOVE_KEYS = {
  w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0],
  d: [0, 1], arrowright: [0, 1], a: [0, -1], arrowleft: [0, -1],
};
export const moveKey = (key) => MOVE_KEYS[String(key).toLowerCase()] || null;

// cells a second at zoom 1 (one zoom step out moves the same distance on the screen), and Shift's factor
export const SPEED = 14;
export const FAST = 3;

// the ground direction [dx, dz] (game axes: x east, z north; length 1, or 0 when the keys cancel out) of the held keys
// (an iterable of KeyboardEvent.key) for a view turned yaw degrees
export function moveDir(yaw, held) {
  let f = 0, r = 0;
  for (const k of held) { const m = moveKey(k); if (m) { f += m[0]; r += m[1]; } }
  if (!f && !r) return [0, 0];
  const y = (yaw * Math.PI) / 180;
  // forward on the ground: (sin y, cos y); right of the picture: (cos y, -sin y) (gamecam's axes)
  let dx = f * Math.sin(y) + r * Math.cos(y), dz = f * Math.cos(y) - r * Math.sin(y);
  const n = Math.hypot(dx, dz);
  dx /= n; dz /= n;
  return [Math.abs(dx) < 1e-12 ? 0 : dx, Math.abs(dz) < 1e-12 ? 0 : dz];
}

// how far a frame of dt seconds moves at this zoom ([dx, dz] in cells)
export function moveStep(yaw, held, dt, zoom = 1, fast = false) {
  const [dx, dz] = moveDir(yaw, held);
  const d = SPEED * zoom * (fast ? FAST : 1) * Math.min(dt, 0.1);   // (a long frame: no jump across the map)
  return [dx * d, dz * d];
}
