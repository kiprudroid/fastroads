/**
 * RoadGenerator.ts — lazy infinite centerline (the "master spline").
 *
 * The road is the master data structure: terrain flattening, road mesh,
 * scenery exclusion, car height and camera all derive from it.
 *
 * Design decisions (see AGENTS.md):
 *  - Heading is a BOUNDED noise function of arc length (not an integrated
 *    curvature): theta(s) = HEADING_AMP * (w1 * n1(s/L1) + w2 * n2(s/L2))
 *    relative to -Z. Because |theta| < ~60 deg always, the road can never turn
 *    back on itself, which keeps "nearest road point" unambiguous within
 *    BLEND_DISTANCE.
 *  - Position is integrated from heading with the midpoint rule, so samples
 *    are generated strictly sequentially and stored in an array; `ensureAhead`
 *    extends, `trim` drops samples behind while keeping a base index offset so
 *    global sample indices stay stable.
 *  - Elevation tracks a closed-form fbm profile (A1*fbm(s/700) + A2*fbm(s/250))
 *    through a 7% slope limiter, so the grade constraint holds by construction
 *    (a pure closed-form profile can exceed 7% where the octaves align).
 *  - `nearest` uses a spatial hash keyed by integer cell coords (cell size =
 *    BLEND_DISTANCE), a 3x3 cell query, then projects onto the closest
 *    segment. With `hintS` it first does a cheap local scan (±HINT_WINDOW
 *    samples) around the car's previous s.
 *
 * Everything here is deterministic: same seed => identical samples, whatever
 * the order of ensureAhead/trim calls (extension always continues forward
 * from the tail; trim never touches the tail).
 */

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { ROAD } from '../config.ts';
import type { NearestResult, RoadPoint, RoadSample } from '../types.ts';
import { mulberry32 } from '../utils/rng.ts';
import { clamp, lerp } from '../utils/math.ts';
import { makeFbm1D } from '../utils/fbm.ts';

/** Hash cell key packing (cell coords stay well within these bounds). */
const CELL_OFFSET = 1 << 20;
const CELL_SPAN = 1 << 21;

export class RoadGenerator {
  readonly spacing = ROAD.SAMPLE_SPACING;

  private readonly points: RoadPoint[] = [];
  /** Global index of points[0] (advanced by trim; keeps indices stable). */
  private baseIndex = 0;
  /** cell key -> global sample indices (stale entries removed on trim). */
  private readonly hash = new Map<number, number[]>();

  // Noise fields (created once from the seed; never re-seeded).
  private readonly noiseHeadingLong: NoiseFunction2D;
  private readonly noiseHeadingShort: NoiseFunction2D;
  private readonly fbmElevLong: (x: number) => number;
  private readonly fbmElevShort: (x: number) => number;

  // Search scratch (instance fields — zero allocation in nearest()).
  private bestD2 = Infinity;
  private bestG0 = -1;
  private bestG1 = -1;
  private bestT = 0;

  constructor(seed: number) {
    this.noiseHeadingLong = createNoise2D(mulberry32(seed ^ 0x1f2e3d4c));
    this.noiseHeadingShort = createNoise2D(mulberry32(seed ^ 0x5a6b7c8d));
    const fbmElevNoiseLong = createNoise2D(mulberry32(seed ^ 0x9e0f1a2b));
    const fbmElevNoiseShort = createNoise2D(mulberry32(seed ^ 0x3c4d5e6f));

    this.fbmElevLong = makeFbm1D(fbmElevNoiseLong, {
      octaves: ROAD.GRADE_OCTAVES,
    });
    this.fbmElevShort = makeFbm1D(fbmElevNoiseShort, {
      octaves: ROAD.GRADE_OCTAVES,
    });

    this.seedFirstSample();
  }

  // -------------------------------------------------------------------------
  // Derived profile functions (pure in s)
  // -------------------------------------------------------------------------

  /** Bounded heading in radians, relative to -Z. */
  private headingAt(s: number): number {
    const a = this.noiseHeadingLong(s / ROAD.HEADING_WAVE_LONG, 0);
    const b = this.noiseHeadingShort(s / ROAD.HEADING_WAVE_SHORT, 0);
    return (
      ROAD.HEADING_AMP *
      (ROAD.HEADING_W_LONG * a + ROAD.HEADING_W_SHORT * b)
    );
  }

  /** Closed-form elevation target (m) — tracked through the grade limiter. */
  private elevationTarget(s: number): number {
    return (
      ROAD.GRADE_WAVE_LONG * this.fbmElevLong(s / ROAD.GRADE_WAVE_LEN_LONG) +
      ROAD.GRADE_WAVE_SHORT * this.fbmElevShort(s / ROAD.GRADE_WAVE_LEN_SHORT)
    );
  }

  // -------------------------------------------------------------------------
  // Extension / trimming
  // -------------------------------------------------------------------------

  private seedFirstSample(): void {
    const theta = this.headingAt(0);
    const tx = Math.sin(theta);
    const tz = -Math.cos(theta);
    const point: RoadPoint = {
      s: 0,
      x: 0,
      y: this.elevationTarget(0),
      z: 0,
      heading: theta,
      tx,
      tz,
      nx: -tz,
      nz: tx,
      // Central difference is valid everywhere: headingAt is pure.
      curvature: (this.headingAt(this.spacing) - this.headingAt(-this.spacing)) /
        (2 * this.spacing),
    };
    this.points.push(point);
    this.indexIntoHash(0, point.x, point.z);
  }

  private extend(): void {
    const ds = this.spacing;
    const n = this.points.length;
    const gi = this.baseIndex + n; // global index of the new sample
    const s = gi * ds;
    const prev = this.points[n - 1];

    // Midpoint-rule integration of position from heading.
    const thetaMid = this.headingAt(s - ds * 0.5);
    const x = prev.x + Math.sin(thetaMid) * ds;
    const z = prev.z - Math.cos(thetaMid) * ds;

    // Elevation: track the closed-form profile, limited to MAX_GRADE.
    const maxDy = ROAD.MAX_GRADE * ds;
    const y = prev.y + clamp(this.elevationTarget(s) - prev.y, -maxDy, maxDy);

    const theta = this.headingAt(s);
    const tx = Math.sin(theta);
    const tz = -Math.cos(theta);
    const point: RoadPoint = {
      s,
      x,
      y,
      z,
      heading: theta,
      tx,
      tz,
      nx: -tz,
      nz: tx,
      curvature: (this.headingAt(s + ds) - this.headingAt(s - ds)) / (2 * ds),
    };
    this.points.push(point);
    this.indexIntoHash(gi, x, z);
  }

  /** Generate centerline samples until `s` is covered. */
  ensureAhead(s: number): void {
    // Allow one sample of slack beyond the request.
    let guard = 0;
    while (this.lastS < s && guard < 1_000_000) {
      this.extend();
      guard++;
    }
  }

  /**
   * Drop samples behind the car, keeping at least ROAD.TRIM_BEHIND meters
   * behind `s`. Never touches the tail (extension continues from it, which is
   * what keeps elevation deterministic regardless of trim timing).
   */
  trim(s: number): void {
    const cutoffGi = Math.floor((s - ROAD.TRIM_BEHIND) / this.spacing);
    let remove = cutoffGi - this.baseIndex;
    if (remove <= 0) return;
    // Always keep at least one sample so the tail (and hash) stay valid.
    if (remove >= this.points.length) remove = this.points.length - 1;
    for (let k = 0; k < remove; k++) {
      this.removeFromHash(this.baseIndex + k);
    }
    this.points.splice(0, remove);
    this.baseIndex += remove;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** Number of samples currently held (after trims). */
  get sampleCount(): number {
    return this.points.length;
  }

  get firstS(): number {
    return this.baseIndex * this.spacing;
  }

  get lastS(): number {
    return (this.baseIndex + this.points.length - 1) * this.spacing;
  }

  // -------------------------------------------------------------------------
  // Interpolated sample (no allocation — writes into `out`)
  // -------------------------------------------------------------------------

  sampleAt(s: number, out: RoadSample): void {
    if (this.points.length === 0) return; // never happens (seeded in ctor)
    const clamped = clamp(s, this.firstS, this.lastS);
    const f = clamped / this.spacing;
    const gi = Math.floor(f);
    const t = f - gi;

    const i0 = clamp(gi - this.baseIndex, 0, this.points.length - 1);
    const i1 = Math.min(i0 + 1, this.points.length - 1);
    const p0 = this.points[i0];
    const p1 = this.points[i1];

    const heading = lerp(p0.heading, p1.heading, t);
    const tx = Math.sin(heading);
    const tz = -Math.cos(heading);

    out.s = clamped;
    out.x = lerp(p0.x, p1.x, t);
    out.y = lerp(p0.y, p1.y, t);
    out.z = lerp(p0.z, p1.z, t);
    out.heading = heading;
    out.tx = tx;
    out.tz = tz;
    out.nx = -tz;
    out.nz = tx;
    out.curvature = lerp(p0.curvature, p1.curvature, t);
  }

  // -------------------------------------------------------------------------
  // Nearest road point (spatial hash + segment projection, no allocation)
  // -------------------------------------------------------------------------

  /**
   * Closest point on the centerline to (x, z).
   *
   * `lateral` is signed: positive = right of the direction of travel.
   * When `hintS` is given (the car's previous s), a cheap local scan around it
   * is tried first and accepted if it lands within BLEND_DISTANCE.
   * If no sample exists at all, `out.dist` is Infinity.
   */
  nearest(x: number, z: number, out: NearestResult, hintS?: number): void {
    this.resetBest();

    if (this.points.length === 1) {
      this.fillFromSingle(x, z, out);
      return;
    }
    if (this.points.length < 2) {
      out.s = 0;
      out.lateral = 0;
      out.dist = Infinity;
      out.roadY = 0;
      return;
    }

    if (hintS !== undefined) {
      this.searchHint(x, z, hintS);
      if (this.bestD2 <= ROAD.BLEND_DISTANCE * ROAD.BLEND_DISTANCE) {
        this.fillFromBest(x, z, out);
        return;
      }
      this.resetBest();
    }

    this.searchHash(x, z);
    this.fillFromBest(x, z, out);
  }

  private resetBest(): void {
    this.bestD2 = Infinity;
    this.bestG0 = -1;
    this.bestG1 = -1;
    this.bestT = 0;
  }

  /** Project (x, z) onto segment [g0, g1]; keep it if it improves the best. */
  private consider(g0: number, g1: number, x: number, z: number): void {
    if (g0 < this.baseIndex) return;
    const lastGi = this.baseIndex + this.points.length - 1;
    if (g1 > lastGi) return;

    const p0 = this.points[g0 - this.baseIndex];
    const p1 = this.points[g1 - this.baseIndex];
    const ex = p1.x - p0.x;
    const ez = p1.z - p0.z;
    const len2 = ex * ex + ez * ez;
    if (len2 === 0) return;

    let t = ((x - p0.x) * ex + (z - p0.z) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = p0.x + ex * t;
    const pz = p0.z + ez * t;
    const dx = x - px;
    const dz = z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < this.bestD2) {
      this.bestD2 = d2;
      this.bestG0 = g0;
      this.bestG1 = g1;
      this.bestT = t;
    }
  }

  private searchHash(x: number, z: number): void {
    const cell = ROAD.BLEND_DISTANCE;
    const ix = Math.floor(x / cell);
    const iz = Math.floor(z / cell);
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const bucket = this.hash.get(cellKey(ix + cx, iz + cz));
        if (bucket === undefined) continue;
        for (let b = 0; b < bucket.length; b++) {
          const gi = bucket[b];
          this.consider(gi, gi + 1, x, z);
          this.consider(gi - 1, gi, x, z);
        }
      }
    }
  }

  private searchHint(x: number, z: number, hintS: number): void {
    const hintGi = Math.round(hintS / this.spacing);
    const lo = Math.max(this.baseIndex, hintGi - ROAD.HINT_WINDOW);
    const hi = Math.min(
      this.baseIndex + this.points.length - 2,
      hintGi + ROAD.HINT_WINDOW,
    );
    for (let gi = lo; gi <= hi; gi++) {
      this.consider(gi, gi + 1, x, z);
      this.consider(gi - 1, gi, x, z);
    }
  }

  private fillFromBest(x: number, z: number, out: NearestResult): void {
    if (this.bestG0 < 0) {
      // No sample in range at all.
      out.s = 0;
      out.lateral = 0;
      out.dist = Infinity;
      out.roadY = 0;
      return;
    }

    const g0 = this.bestG0;
    const g1 = this.bestG1;
    const t = this.bestT;
    const p0 = this.points[g0 - this.baseIndex];
    const p1 = this.points[g1 - this.baseIndex];

    const ex = p1.x - p0.x;
    const ez = p1.z - p0.z;
    const len = Math.sqrt(ex * ex + ez * ez);
    const px = p0.x + ex * t;
    const pz = p0.z + ez * t;
    const dx = x - px;
    const dz = z - pz;

    out.s = (g0 + t) * this.spacing;
    out.dist = Math.sqrt(dx * dx + dz * dz);
    // Right of travel = tangent rotated -90° about +Y: (-tz, tx) ~ (-ez, ex).
    out.lateral = len > 0 ? (dx * -ez + dz * ex) / len : 0;
    out.roadY = lerp(p0.y, p1.y, t);
  }

  private fillFromSingle(x: number, z: number, out: NearestResult): void {
    const p = this.points[0];
    const dx = x - p.x;
    const dz = z - p.z;
    out.s = p.s;
    out.dist = Math.sqrt(dx * dx + dz * dz);
    out.lateral = dx * p.nx + dz * p.nz;
    out.roadY = p.y;
  }

  // -------------------------------------------------------------------------
  // Spatial hash
  // -------------------------------------------------------------------------

  private indexIntoHash(gi: number, x: number, z: number): void {
    const key = cellKey(
      Math.floor(x / ROAD.BLEND_DISTANCE),
      Math.floor(z / ROAD.BLEND_DISTANCE),
    );
    const bucket = this.hash.get(key);
    if (bucket === undefined) this.hash.set(key, [gi]);
    else bucket.push(gi);
  }

  private removeFromHash(gi: number): void {
    const p = this.points[gi - this.baseIndex];
    if (p === undefined) return;
    const key = cellKey(
      Math.floor(p.x / ROAD.BLEND_DISTANCE),
      Math.floor(p.z / ROAD.BLEND_DISTANCE),
    );
    const bucket = this.hash.get(key);
    if (bucket === undefined) return;
    const idx = bucket.indexOf(gi);
    if (idx >= 0) bucket.splice(idx, 1);
    if (bucket.length === 0) this.hash.delete(key);
  }
}

function cellKey(ix: number, iz: number): number {
  return (ix + CELL_OFFSET) * CELL_SPAN + (iz + CELL_OFFSET);
}
