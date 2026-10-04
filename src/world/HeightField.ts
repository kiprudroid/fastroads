/**
 * HeightField.ts — the deterministic world height function.
 *
 * `heightAt(x, z)` is a PURE function of world coordinates — this is what
 * guarantees seamless terrain tiles: any tile can be built, evicted and
 * rebuilt with identical results.
 *
 * Composition (see AGENTS.md for the chosen variant):
 *
 *   hills(x,z) = fbm2D(x/320, z/320, 4 oct) * 45
 *              + fbm2D(x/90,  z/90,  2 oct) * 4
 *
 *   {s, dist, roadY} = road.nearest(x, z)
 *   w  = smoothstep(HALF + SHOULDER, HALF + SHOULDER + BLEND, dist)
 *   h  = mix(roadY,  roadY + (hills(x,z) - hills(roadPoint)),  w)
 *
 * Chosen variant: **hills relative to the road** (the spec's first formula),
 * not `hills + roadYTrend`. Reasons:
 *  - h == roadY exactly under the carriageway (w = 0), so the road elevation
 *    test is trivially true and the road never floats or sinks;
 *  - terrain stays within ±(hills range) of the road's elevation forever —
 *    no long-distance drift, unlike a low-frequency roadY trend;
 *  - everything entering the mix is continuous in (x, z), so tile borders
 *    match exactly.
 *
 * Under the carriageway the ground is dropped by ROAD_EMBED (0.15 m) so the
 * road ribbon (which sits at roadY + 0.02) never fights the terrain. Unlike a
 * hard `dist < HALF_WIDTH` cut, the embed fades out over the shoulder with a
 * smoothstep — a hard cut would leave a visible 15 cm step along both road
 * edges (spec intent preserved, geometry made continuous).
 *
 * `normalAt` = central finite differences of `heightAt` (ε = 1 m), so normals
 * match perfectly across tile borders (never `computeVertexNormals()`).
 */

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { ROAD, TERRAIN } from '../config.ts';
import type { NearestResult, RoadSample } from '../types.ts';
import { makeFbm2D, type Fbm2D } from '../utils/fbm.ts';
import { mulberry32 } from '../utils/rng.ts';
import { smoothstep } from '../utils/math.ts';

/** Minimal vector shape so tests and three.js objects both fit. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Result of `evaluate` — enough to color a terrain vertex. */
export interface GroundEval {
  /** Final ground height (includes the road embed). */
  height: number;
  /** height - roadY: negative under the road, positive on hills. */
  roadRel: number;
  /** Distance from the centerline. */
  roadDist: number;
  /** Nearest centerline arc length — reused as a hint by neighbors. */
  roadS: number;
}

export class HeightField {
  private readonly fbmHills: Fbm2D;
  private readonly fbmDetail: Fbm2D;
  private readonly noiseHills: NoiseFunction2D;
  private readonly noiseDetail: NoiseFunction2D;

  // Reusable out-objects (zero allocation in hot paths).
  private readonly near: NearestResult = { s: 0, lateral: 0, dist: 0, roadY: 0 };
  private readonly roadSample: RoadSample = {
    s: 0,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    tx: 0,
    tz: 0,
    nx: 0,
    nz: 0,
    curvature: 0,
  };

  constructor(
    seed: number,
    private readonly road: {
      nearest(
        x: number,
        z: number,
        out: NearestResult,
        hintS?: number,
        hintMaxDist?: number,
      ): void;
      sampleAt(s: number, out: RoadSample): void;
    },
  ) {
    this.noiseHills = createNoise2D(mulberry32(seed ^ 0x2b7f9a1d));
    this.noiseDetail = createNoise2D(mulberry32(seed ^ 0x64c8e3f7));
    this.fbmHills = makeFbm2D(this.noiseHills, {
      octaves: TERRAIN.HILL_OCTAVES_LONG,
    });
    this.fbmDetail = makeFbm2D(this.noiseDetail, {
      octaves: TERRAIN.HILL_OCTAVES_SHORT,
    });
  }

  /** Rolling hills + fine detail (no road involvement). */
  hills(x: number, z: number): number {
    return (
      this.fbmHills(x / TERRAIN.HILL_WAVE_LONG, z / TERRAIN.HILL_WAVE_LONG) *
        TERRAIN.HILL_WAVE_LONG_AMP +
      this.fbmDetail(x / TERRAIN.HILL_WAVE_SHORT, z / TERRAIN.HILL_WAVE_SHORT) *
        TERRAIN.HILL_WAVE_SHORT_AMP
    );
  }

  /** Pure ground height at (x, z). `hint` reuses a nearby evaluation. */
  heightAt(x: number, z: number, hint?: GroundEval): number {
    this.evaluate(x, z, this.evalScratch, hint);
    return this.evalScratch.height;
  }

  private readonly evalScratch: GroundEval = {
    height: 0,
    roadRel: 0,
    roadDist: 0,
    roadS: 0,
  };
  /** Memo for hills() at the nearest centerline point (invalidated by s). */
  private memoRoadS = NaN;
  private memoHillsRoad = 0;

  /**
   * Full ground evaluation (height + coloring inputs).
   *
   * With `hint` (an evaluation of a point ≤ a few meters away), the nearest
   * road search is first attempted around the hint's arc length — this is
   * what keeps tile building cheap: the true nearest point moves at most by
   * the query distance, so a ±HINT_WINDOW sample scan almost always wins,
   * validated by |dist - hintDist| <= HINT_TOLERANCE.
   */
  evaluate(x: number, z: number, out: GroundEval, hint?: GroundEval): void {
    const near = this.near;
    // Hinting only wins near the road: there the spatial hash scans dense
    // buckets, while far from it the queried cells are empty and a plain hash
    // is cheaper than the local scan. Accepted hints always find the true
    // nearest point (a ≤4 m displacement moves it ≤4 m, far inside the
    // ±HINT_WINDOW sample scan), so hinted and unhinted paths produce
    // bit-identical results — tile borders stay seamless.
    if (
      hint !== undefined &&
      hint.roadDist < ROAD.BLEND_DISTANCE + TERRAIN.HINT_TOLERANCE
    ) {
      this.road.nearest(
        x,
        z,
        near,
        hint.roadS,
        hint.roadDist + TERRAIN.HINT_TOLERANCE,
      );
      if (Math.abs(near.dist - hint.roadDist) > TERRAIN.HINT_TOLERANCE) {
        // Stale/failed hint (e.g. after a teleport): full spatial-hash search.
        this.road.nearest(x, z, near);
      }
    } else {
      this.road.nearest(x, z, near);
    }

    // No road coverage at all (beyond generated range): pure hills.
    if (near.dist === Infinity) {
      const h = this.hills(x, z);
      out.height = h;
      out.roadRel = h;
      out.roadDist = Infinity;
      out.roadS = 0;
      return;
    }

    const edge0 = ROAD.HALF_WIDTH + ROAD.SHOULDER;
    const edge1 = edge0 + ROAD.BLEND_DISTANCE;
    const w = smoothstep(edge0, edge1, near.dist);

    const hillsHere = this.hills(x, z);
    let roadY = near.roadY;
    if (w > 0) {
      // Blend partner: hills evaluated at the nearest centerline point.
      // Memoized by exact s — sample values never change for a given s, and
      // clamped projections mean many vertices share the same s.
      if (near.s !== this.memoRoadS) {
        this.road.sampleAt(near.s, this.roadSample);
        this.memoHillsRoad = this.hills(this.roadSample.x, this.roadSample.z);
        this.memoRoadS = near.s;
      }
      roadY = near.roadY + w * (hillsHere - this.memoHillsRoad);
    }

    // Embed (full under the carriageway, fading across the verge).
    const embed = 1 - smoothstep(ROAD.HALF_WIDTH, edge0, near.dist);
    const height = roadY - TERRAIN.ROAD_EMBED * embed;

    out.height = height;
    out.roadRel = height - near.roadY;
    out.roadDist = near.dist;
    out.roadS = near.s;
  }

  /**
   * Central finite differences of `heightAt` — identical across tile borders
   * because the underlying function is pure. Pass the center evaluation as
   * `center` so all four samples reuse its nearest-road search.
   */
  normalAt(x: number, z: number, out: Vec3Like, center?: GroundEval): void {
    const e = TERRAIN.NORMAL_EPS;
    const hL = this.heightAt(x - e, z, center);
    const hR = this.heightAt(x + e, z, center);
    const hD = this.heightAt(x, z - e, center);
    const hU = this.heightAt(x, z + e, center);

    let nx = (hL - hR) / (2 * e);
    let ny = 1;
    let nz = (hD - hU) / (2 * e);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= len;
    ny /= len;
    nz /= len;
    out.x = nx;
    out.y = ny;
    out.z = nz;
  }
}
