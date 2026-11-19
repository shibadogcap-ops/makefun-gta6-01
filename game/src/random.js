// Seeded randomness and math helpers shared across modules.

/** mulberry32: a small, fast, well-distributed PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a seeded RNG with convenience helpers. */
export function createRandom(seed) {
  const next = mulberry32(seed);
  return {
    next,
    /** Uniform float in [a, b). */
    range(a, b) {
      return a + (b - a) * next();
    },
    /** Inclusive integer in [a, b]. */
    int(a, b) {
      return a + Math.floor((b - a + 1) * next());
    },
    pick(array) {
      return array[Math.floor(next() * array.length)];
    },
    chance(p) {
      return next() < p;
    },
  };
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Squared distance between two points (avoids the sqrt). */
export function dist2(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/** Shortest-path angular interpolation from a to b by factor t in [0,1]. */
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
