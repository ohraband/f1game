// Braking guide. Given the player's speed and position, find where braking has to
// start for the most demanding corner ahead:  need = (v^2 - safe^2) / (2 * decel).
const LOOKAHEAD = 450; // track units
const MARGIN = 16;     // extra braking distance for reaction time

export function brakeGuide(track, hud, laps) {
  if (!hud || hud.finished || !track.safe) return null;
  const n = track.path.length, step = track.step;
  const dist = (((hud.progress * track.length * laps) % track.length) + track.length) % track.length;
  const i0 = Math.floor(dist / step);
  const off = dist - i0 * step;
  const v = hud.speed;

  let best = null;
  for (let k = 1; k <= Math.ceil(LOOKAHEAD / step); k++) {
    const j = (i0 + k) % n;
    const safe = track.safe[j];
    if (v <= safe) continue;
    const need = (v * v - safe * safe) / (2 * track.brake * 0.75) + MARGIN;
    const start = k * step - off - need; // distance ahead at which braking should begin
    if (!best || start < best.start) best = { k, j, safe, start };
  }
  if (!best) return null; // nothing ahead you can't take at this speed: flat out

  const urgent = best.start <= 0;
  const mi = (i0 + (urgent ? 0 : Math.round(best.start / step))) % n;
  const zone = [];
  for (let i = mi; i !== (best.j + 1) % n && zone.length < 80; i = (i + 1) % n) zone.push(track.path[i]);
  const [x, y] = track.path[mi], [x2, y2] = track.path[(mi + 1) % n];
  return { urgent, target: best.safe, marker: { x, y, angle: Math.atan2(y2 - y, x2 - x) }, zone };
}
