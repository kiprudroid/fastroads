/**
 * types.ts — tiny shared type aliases (kept separate so config.ts and
 * feature modules can both import them without cycles).
 */

export type QualityLevel = 'low' | 'medium' | 'high';

/** Out-parameter for RoadGenerator.nearest — reused, never allocated. */
export interface NearestResult {
  /** Arc length of the closest point on the centerline. */
  s: number;
  /** Signed lateral offset: positive = right of the road direction. */
  lateral: number;
  /** Absolute distance from the centerline in the XZ plane. */
  dist: number;
  /** Interpolated road elevation at `s`. */
  roadY: number;
}

/** Out-parameter for RoadGenerator.sampleAt — reused, never allocated. */
export interface RoadSample {
  s: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Unit tangent in XZ (direction of travel). */
  tx: number;
  tz: number;
  /** Unit normal in XZ, pointing right of travel. */
  nx: number;
  nz: number;
  curvature: number;
}

/** Immutable reference to one road sample (internal storage). */
export interface RoadPoint {
  s: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  curvature: number;
}
