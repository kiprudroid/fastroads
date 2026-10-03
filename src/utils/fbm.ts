/**
 * fbm.ts — fractal Brownian motion built on seeded simplex noise.
 *
 * Simplex-noise v4 only ships 2D+ noise, so 1D fbm evaluates the noise at a
 * constant second coordinate. All functions are created once (closures over a
 * noise instance) and never allocate when called — safe for hot paths.
 */

import type { NoiseFunction2D } from 'simplex-noise';

export type Fbm1D = (x: number) => number;
export type Fbm2D = (x: number, y: number) => number;

export interface FbmOptions {
  octaves: number;
  /** Amplitude falloff per octave (default 0.5). */
  persistence?: number;
  /** Frequency growth per octave (default 2). */
  lacunarity?: number;
  /** Second coordinate used by the 1D variant (default 0). */
  y?: number;
}

function normalization( octaves: number, persistence: number): number {
  let norm = 0;
  let amp = 1;
  for (let i = 0; i < octaves; i++) {
    norm += amp;
    amp *= persistence;
  }
  return norm > 0 ? norm : 1;
}

/** 1D fbm over simplex noise sampled at a constant second coordinate. */
export function makeFbm1D(noise: NoiseFunction2D, opts: FbmOptions): Fbm1D {
  const { octaves } = opts;
  const persistence = opts.persistence ?? 0.5;
  const lacunarity = opts.lacunarity ?? 2;
  const y = opts.y ?? 0;
  const norm = normalization(octaves, persistence);

  return (x: number): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y);
      amp *= persistence;
      freq *= lacunarity;
    }
    return sum / norm;
  };
}

/** 2D fbm over simplex noise. Output roughly in [-1, 1]. */
export function makeFbm2D(noise: NoiseFunction2D, opts: FbmOptions): Fbm2D {
  const { octaves } = opts;
  const persistence = opts.persistence ?? 0.5;
  const lacunarity = opts.lacunarity ?? 2;
  const norm = normalization(octaves, persistence);

  return (x: number, y: number): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq);
      amp *= persistence;
      freq *= lacunarity;
    }
    return sum / norm;
  };
}
