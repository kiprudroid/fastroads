/**
 * Palette.ts — color definitions.
 *
 * `colorFor(heightAboveRoad, slope, noise, out)` maps a terrain vertex to a
 * color: grass in low/flat areas, darker/yellower on rises, rocky gray-brown
 * on steep slopes, plus a little deterministic noise variation.
 *
 * All hex values are sRGB; THREE.Color converts them into the linear working
 * color space (ColorManagement is on by default). Vertex color attributes
 * are written with these LINEAR values, which is what the shader expects.
 */

import { Color } from 'three';
import { SKY } from '../config.ts';
import { clamp, lerp, smoothstep } from '../utils/math.ts';

/** Minimal color shape so three.js Color instances fit as out-params. */
export interface RgbLike {
  r: number;
  g: number;
  b: number;
}

export const Palette = {
  // sky / light
  zenith: new Color(SKY.ZENITH),
  horizon: new Color(SKY.HORIZON),
  sun: new Color(SKY.SUN),

  // terrain
  grassLow: new Color(0x7aa35a),
  grassMid: new Color(0x5d8a4a),
  grassDry: new Color(0x9ab06a),
  rock: new Color(0x8a8478),

  // scenery
  trunk: new Color(0x5a4632),
  foliageDark: new Color(0x4c7a44),
  foliageLight: new Color(0x6f9f57),

  // road
  asphalt: new Color(0x3a3d42),
  laneMark: new Color(0xe8e6dc),

  // car
  carBody: new Color(0xe8745a),

  /**
   * Terrain vertex color.
   *
   * @param heightAboveRoad relief relative to the nearest road point (m);
   *   negative under the carriageway, positive on hillsides.
   * @param slope 1 - normal.y (0 = flat, ~1 = vertical).
   * @param noise deterministic variation in [-1, 1].
   * @param out receives the LINEAR rgb values (no allocation).
   */
  colorFor(
    heightAboveRoad: number,
    slope: number,
    noise: number,
    out: RgbLike,
  ): void {
    const h = heightAboveRoad;

    // Base ramp: low grass -> yellower dry grass on rises.
    const tRise = smoothstep(2, 30, h);
    let r = lerp(Palette.grassLow.r, Palette.grassDry.r, tRise);
    let g = lerp(Palette.grassLow.g, Palette.grassDry.g, tRise);
    let b = lerp(Palette.grassLow.b, Palette.grassDry.b, tRise);

    // Slightly darker green mid-tones so rises read as deeper vegetation.
    const tMid = smoothstep(0, 14, h) * 0.4;
    r = lerp(r, Palette.grassMid.r, tMid);
    g = lerp(g, Palette.grassMid.g, tMid);
    b = lerp(b, Palette.grassMid.b, tMid);

    // Steep slopes turn rocky gray-brown.
    const tRock = smoothstep(0.32, 0.55, slope);
    r = lerp(r, Palette.rock.r, tRock);
    g = lerp(g, Palette.rock.g, tRock);
    b = lerp(b, Palette.rock.b, tRock);

    // A little per-vertex variation so large fields never look flat.
    const bright = 1 + noise * 0.07;
    out.r = clamp(r * bright, 0, 1);
    out.g = clamp(g * bright, 0, 1);
    out.b = clamp(b * bright, 0, 1);
  },
} as const;
