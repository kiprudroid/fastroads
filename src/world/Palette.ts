/**
 * Palette.ts — color definitions.
 *
 * Phase 1: base constants (sky/light/fog + terrain ramp). Phase 3 adds
 * `colorFor(heightAboveRoad, slope, noise) -> vertex color`.
 *
 * All hex values are sRGB; THREE.Color converts them into the linear working
 * color space (ColorManagement is on by default in modern three).
 */

import { Color } from 'three';
import { SKY } from '../config.ts';

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
} as const;
