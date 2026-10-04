/**
 * math.ts — small allocation-free math helpers used across the game.
 */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Standard smoothstep with clamped edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent smoothing factor.
 * NEVER use a raw lerp factor with variable dt — use this instead.
 */
export function expSmooth(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (d > maxDelta) return current + maxDelta;
  if (d < -maxDelta) return current - maxDelta;
  return target;
}

/** Shortest signed angular difference a->b in radians, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Cheap deterministic value noise in [-1, 1] from integer-quantized world
 * coordinates. Integer math only (no Math.sin) so the result is bit-identical
 * across JS engines — important for cross-browser determinism of vertex
 * colors. Quantized to 1/16 m so it is stable under float wiggle.
 */
export function hashNoise2D(x: number, z: number): number {
  const qx = Math.round(x * 16) | 0;
  const qz = Math.round(z * 16) | 0;
  let h = (Math.imul(qx, 374761393) + Math.imul(qz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 2147483648) - 1;
}
