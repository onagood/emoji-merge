/**
 * sky.js — the time of day, as a continuous value rather than three states.
 *
 * The design gives three skies: morning, sunset and night. Switching between
 * them by swapping CSS values cannot be animated, because their gradients had
 * different numbers of colour stops and a browser will not interpolate those.
 * So every preset here is normalised to the same four stops, and the sky is
 * mixed in JavaScript at whatever point between them the game currently sits.
 *
 * The result is a sky that drifts as the score climbs, instead of cutting.
 */

/** Stop positions shared by every preset, so any two can be blended. */
const STOPS = [0, 45, 75, 100];

/**
 * Presets in order. `stops` are the four gradient colours; the originals from
 * the design had stops at different offsets and have been resampled onto the
 * shared positions above, which leaves each sky looking as it did.
 */
export const SKY_PRESETS = [
  {
    key: 'morning',
    label: 'Day',
    icon: '☀️',
    stops: ['#6fc3f0', '#9cdbf9', '#bbe8fd', '#d5f1ff'],
    sun: '#ffe36e',
    halo: [255, 227, 110, 0.4],
    stars: 0,
    cloudOpacity: 0.95,
    brightness: 1,
    saturate: 1,
  },
  {
    key: 'sunset',
    label: 'Sunset',
    icon: '🌇',
    stops: ['#5b5bd6', '#e77aa0', '#ffb36b', '#ffd68a'],
    sun: '#ff9a5c',
    halo: [255, 154, 92, 0.45],
    stars: 0.3,
    cloudOpacity: 0.8,
    brightness: 0.85,
    saturate: 0.9,
  },
  {
    key: 'night',
    label: 'Night',
    icon: '🌙',
    stops: ['#0f1a3a', '#1e325f', '#2c4677', '#3a5a8a'],
    sun: '#fff3c4',
    halo: [255, 243, 196, 0.25],
    stars: 1,
    cloudOpacity: 0.35,
    brightness: 0.55,
    saturate: 0.7,
  },
];

export const SKY_KEYS = SKY_PRESETS.map((p) => p.key);

/**
 * The presets form a loop, so a position is measured in "preset units" where
 * one full day is CYCLE. The leg from night back to morning is the dawn, and
 * it is what stops a long run from being stuck at night forever.
 */
export const CYCLE = SKY_PRESETS.length;

/** Score at which each preset is reached on the first day. */
const SCORE_AT = [0, 1200, 3000];
/** Score for one whole day. The remainder past night is the dawn. */
const SCORE_PER_DAY = 4800;

/** Positive modulo, so a negative position still lands inside the cycle. */
function wrap(value, size) {
  return ((value % size) + size) % size;
}

/**
 * Move `target` into the turn of the cycle just ahead of `current`, so the sky
 * always advances. Used in auto mode, where time only runs forwards.
 */
export function forwardFrom(current, target) {
  let next = current + wrap(target - current, CYCLE);
  // An exact match must stay put rather than jump a whole day.
  if (Math.abs(next - current) < 1e-9) next = current;
  return next;
}

/**
 * Move `target` to whichever side of the cycle is closer. Used when the player
 * picks a time of day by hand, so the change is as short as it looks.
 */
export function nearestFrom(current, target) {
  const ahead = wrap(target - current, CYCLE);
  return current + (ahead > CYCLE / 2 ? ahead - CYCLE : ahead);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  const to = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
}

/**
 * Where the sky should sit for a given score, as a position along the preset
 * list: 0 is morning, 1 is sunset, 2 is night, and anything between is a mix.
 */
export function positionForScore(score) {
  const safe = Math.max(0, score);
  const days = Math.floor(safe / SCORE_PER_DAY);
  const local = safe - days * SCORE_PER_DAY;

  let within;
  if (local <= SCORE_AT[1]) {
    within = local / SCORE_AT[1];
  } else if (local <= SCORE_AT[2]) {
    within = 1 + (local - SCORE_AT[1]) / (SCORE_AT[2] - SCORE_AT[1]);
  } else {
    // Dawn: night back round to the next morning.
    within = 2 + (local - SCORE_AT[2]) / (SCORE_PER_DAY - SCORE_AT[2]);
  }
  return days * CYCLE + within;
}

/** Position for a fixed choice from the settings screen. */
export function positionForKey(key) {
  const index = SKY_KEYS.indexOf(key);
  return index < 0 ? 0 : index;
}

/**
 * Blend the presets at `position` and return ready-to-use CSS values.
 * @param {number} position 0..2
 */
export function skyAt(position) {
  // The position runs on forever as the score climbs; fold it into the loop.
  const looped = wrap(position, CYCLE);
  const lower = Math.floor(looped);
  const upper = (lower + 1) % CYCLE;
  const t = looped - lower;

  const a = SKY_PRESETS[lower];
  const b = SKY_PRESETS[upper];

  const stops = a.stops.map((colour, i) => `${lerpColor(colour, b.stops[i], t)} ${STOPS[i]}%`);
  const halo = a.halo.map((v, i) => lerp(v, b.halo[i], t));

  return {
    background: `linear-gradient(180deg, ${stops.join(', ')})`,
    sun: lerpColor(a.sun, b.sun, t),
    halo: `rgba(${Math.round(halo[0])}, ${Math.round(halo[1])}, ${Math.round(halo[2])}, ${halo[3].toFixed(3)})`,
    stars: lerp(a.stars, b.stars, t),
    cloudOpacity: lerp(a.cloudOpacity, b.cloudOpacity, t),
    groundFilter: `brightness(${lerp(a.brightness, b.brightness, t).toFixed(3)}) saturate(${lerp(a.saturate, b.saturate, t).toFixed(3)})`,
  };
}

/**
 * Eases a value toward a target at a rate independent of frame rate.
 * @param {number} current
 * @param {number} target
 * @param {number} dtSeconds
 * @param {number} halfLife seconds to cover half the remaining distance
 */
export function ease(current, target, dtSeconds, halfLife = 0.9) {
  if (halfLife <= 0) return target;
  const k = 1 - Math.pow(0.5, dtSeconds / halfLife);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.0005 ? target : next;
}
