/**
 * rng.ts — seeded pseudo-random number generation.
 *
 * We use mulberry32: a tiny, fast, well-distributed 32-bit PRNG.
 * No alea dependency (per project spec). All world generation flows from
 * a single numeric seed so that (seed, position) fully determines the world.
 */

/** Create a mulberry32 generator. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string into a 32-bit unsigned seed (FNV-1a). */
export function hashStringToSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Derive a stable sub-seed from a root seed plus a few integers.
 * Used for per-tile / per-chunk deterministic streams, e.g. scenery
 * generation: rngFor(seed, ix, iz).
 */
export function rngFor(seed: number, a: number, b = 0): () => number {
  // xorshift-style mixing; cheap and stable.
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a + 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ (b + 0x165667b1), 0x27d4eb2f);
  h ^= h >>> 15;
  return mulberry32(h >>> 0);
}

/** Parse an integer seed from a string; returns null when invalid. */
export function parseSeed(str: string): number | null {
  const n = Number.parseInt(str, 10);
  if (!Number.isFinite(n)) return null;
  // Accept negatives by folding into uint32 range.
  return n >>> 0;
}

/** A fresh random seed for "R = new world". */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
