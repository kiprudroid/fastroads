/**
 * heightfield.test.ts — pure-logic tests for the world height function and
 * terrain tile streaming. No DOM, no WebGL (three.js scene/geometry objects
 * work headless).
 */

import { describe, expect, test } from 'bun:test';
import { Scene } from 'three';
import { RoadGenerator } from '../src/world/RoadGenerator.ts';
import { HeightField } from '../src/world/HeightField.ts';
import { Terrain } from '../src/world/Terrain.ts';
import { ROAD, TERRAIN } from '../src/config.ts';
import type { NearestResult, RoadSample } from '../src/types.ts';

function makeWorld(seed: number): { road: RoadGenerator; hf: HeightField } {
  const road = new RoadGenerator(seed);
  road.ensureAhead(3000);
  const hf = new HeightField(seed, road);
  return { road, hf };
}

function roadPoint(road: RoadGenerator, s: number): RoadSample {
  const out: RoadSample = {
    s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
  };
  road.sampleAt(s, out);
  return out;
}

describe('HeightField', () => {
  test('heightAt is deterministic for the same seed', () => {
    const a = makeWorld(987654);
    const b = makeWorld(987654);
    for (const [x, z] of [
      [0, 0],
      [123.4, -567.8],
      [-900, 2200],
      [4000, -8000],
      [0.1, 0.2],
    ]) {
      expect(a.hf.heightAt(x, z)).toBe(b.hf.heightAt(x, z));
    }
  });

  test('heightAt differs between seeds', () => {
    const a = makeWorld(1);
    const b = makeWorld(2);
    let differs = 0;
    for (let x = -400; x <= 400; x += 100) {
      if (a.hf.heightAt(x, -600) !== b.hf.heightAt(x, -600)) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  test('centerline equals road elevation minus the embed', () => {
    const { road, hf } = makeWorld(2024);
    for (let s = 50; s < 2800; s += 137) {
      const p = roadPoint(road, s);
      const h = hf.heightAt(p.x, p.z);
      expect(h).toBeCloseTo(p.y - TERRAIN.ROAD_EMBED, 4);
    }
  });

  test('under the carriageway the ground never reaches the road surface', () => {
    const { road, hf } = makeWorld(55);
    for (let s = 50; s < 2000; s += 211) {
      const p = roadPoint(road, s);
      for (const lateral of [0, ROAD.HALF_WIDTH - 0.5, -(ROAD.HALF_WIDTH - 0.5)]) {
        const x = p.x + p.nx * lateral;
        const z = p.z + p.nz * lateral;
        const h = hf.heightAt(x, z);
        expect(h).toBeLessThan(p.y + 0.02); // below the ribbon
        expect(h).toBeGreaterThan(p.y - ROAD.HALF_WIDTH); // sanity
      }
    }
  });

  test('blend reaches full hills beyond the blend distance', () => {
    const { road, hf } = makeWorld(77);
    const p = roadPoint(road, 1200);
    const far = ROAD.HALF_WIDTH + ROAD.SHOULDER + ROAD.BLEND_DISTANCE + 5;
    const x = p.x + p.nx * far;
    const z = p.z + p.nz * far;
    const out: NearestResult = { s: 0, lateral: 0, dist: 0, roadY: 0 };
    road.nearest(x, z, out);
    expect(out.dist).toBeGreaterThanOrEqual(far - 1); // sanity: really offset
    // At full blend: h = roadY + hills(p) - hills(road), which is the raw
    // hills relief relative to the road — check it matches the formula.
    const sample: RoadSample = {
      s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
    };
    road.sampleAt(out.s, sample);
    const expected = out.roadY + hf.hills(x, z) - hf.hills(sample.x, sample.z);
    expect(hf.heightAt(x, z)).toBeCloseTo(expected, 6);
  });

  test('normalAt returns unit normals', () => {
    const { hf } = makeWorld(31);
    const n = { x: 0, y: 0, z: 0 };
    for (const [x, z] of [
      [0, 0],
      [200, -700],
      [-350, -1500],
    ]) {
      hf.normalAt(x, z, n);
      const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
      expect(len).toBeCloseTo(1, 6);
      expect(n.y).toBeGreaterThan(0); // ground never faces down
    }
  });
});

describe('Terrain tiles', () => {
  test('adjacent tile edges match exactly (height, normal, color)', () => {
    const { road, hf } = makeWorld(4242);
    const scene = new Scene();
    const terrain = new Terrain(scene, hf, 'medium');

    // Find a road point and pick the tile containing it.
    const p = roadPoint(road, 800);
    const ix = Math.floor(p.x / TERRAIN.TILE_SIZE);
    const iz = Math.floor(p.z / TERRAIN.TILE_SIZE);

    // Build the 2x2 block around that point (forcing each individually).
    terrain.buildInitial((ix + 0.5) * TERRAIN.TILE_SIZE, (iz + 0.5) * TERRAIN.TILE_SIZE);
    terrain.buildInitial((ix + 1.5) * TERRAIN.TILE_SIZE, (iz + 0.5) * TERRAIN.TILE_SIZE);
    terrain.buildInitial((ix + 0.5) * TERRAIN.TILE_SIZE, (iz + 1.5) * TERRAIN.TILE_SIZE);
    terrain.buildInitial((ix + 1.5) * TERRAIN.TILE_SIZE, (iz + 1.5) * TERRAIN.TILE_SIZE);

    const a = terrain.getTile(ix, iz);
    const b = terrain.getTile(ix + 1, iz);
    const c = terrain.getTile(ix, iz + 1);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    if (a === undefined || b === undefined || c === undefined) return;

    const seg = 16;
    const side = seg + 1;
    const pa = a.geometry.getAttribute('position');
    const pb = b.geometry.getAttribute('position');
    const pc = c.geometry.getAttribute('position');
    const na = a.geometry.getAttribute('normal');
    const nb = b.geometry.getAttribute('normal');
    const ca = a.geometry.getAttribute('color');
    const cb = b.geometry.getAttribute('color');

    // Shared edge in X: tile A column `seg` vs tile B column 0.
    for (let r = 0; r < side; r++) {
      const ia = (r * side + seg) * 3;
      const ib = (r * side + 0) * 3;
      expect(pa.getY(ia / 3)).toBeCloseTo(pb.getY(ib / 3), 6);
      expect(na.getX(ia / 3)).toBeCloseTo(nb.getX(ib / 3), 6);
      expect(na.getY(ia / 3)).toBeCloseTo(nb.getY(ib / 3), 6);
      expect(na.getZ(ia / 3)).toBeCloseTo(nb.getZ(ib / 3), 6);
      expect(ca.getX(ia / 3)).toBeCloseTo(cb.getX(ib / 3), 6);
      expect(ca.getY(ia / 3)).toBeCloseTo(cb.getY(ib / 3), 6);
      expect(ca.getZ(ia / 3)).toBeCloseTo(cb.getZ(ib / 3), 6);
    }

    // Shared edge in Z: tile A row `seg` vs tile C row 0.
    const nc = c.geometry.getAttribute('normal');
    const cc = c.geometry.getAttribute('color');
    for (let col = 0; col < side; col++) {
      const ia = ((seg * side + col)) * 3;
      const ic = (0 * side + col) * 3;
      expect(pa.getY(ia / 3)).toBeCloseTo(pc.getY(ic / 3), 6);
      expect(na.getY(ia / 3)).toBeCloseTo(nc.getY(ic / 3), 6);
      expect(ca.getY(ia / 3)).toBeCloseTo(cc.getY(ic / 3), 6);
    }

    // Positions are stored LOCAL: |x|, |z| within the tile.
    for (let v = 0; v < pa.count; v++) {
      const x = pa.getX(v);
      const z = pa.getZ(v);
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(TERRAIN.TILE_SIZE + 1e-6);
      expect(z).toBeGreaterThanOrEqual(-1e-6);
      expect(z).toBeLessThanOrEqual(TERRAIN.TILE_SIZE + 1e-6);
    }

    terrain.dispose();
  });

  test('streaming stays bounded over a 15 km drive (pool + tile counts)', () => {
    const { road, hf } = makeWorld(1234);
    const scene = new Scene();
    const terrain = new Terrain(scene, hf, 'low');

    // Theoretical max tiles inside the eviction circle + boundary slack.
    const r =
      Math.ceil(
        (TERRAIN.VIEW_RADIUS + TERRAIN.EVICT_SLACK_TILES * TERRAIN.TILE_SIZE) /
          TERRAIN.TILE_SIZE,
      ) + 1;
    const maxTiles = Math.PI * r * r + 2 * r * 2;

    const sample: RoadSample = {
      s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
    };

    let peakTiles = 0;
    // Simulate 15 km of driving (~10 min at cruise). One update per meter ≈
    // realistic frame pacing (25 m/s at 60 fps = 0.42 m/frame), so the
    // 2-tiles-per-frame build budget is fed the way the game feeds it.
    for (let s = 0; s <= 15_000; s += 1) {
      road.ensureAhead(s + TERRAIN.VIEW_RADIUS + ROAD.LOOKAHEAD_MARGIN);
      road.sampleAt(s, sample);
      terrain.update(sample.x, sample.z);
      road.trim(
        s - Math.max(0, TERRAIN.VIEW_RADIUS + TERRAIN.TILE_SIZE - ROAD.TRIM_BEHIND),
      );
      if (terrain.tileCount > peakTiles) peakTiles = terrain.tileCount;
    }

    expect(peakTiles).toBeLessThanOrEqual(Math.floor(maxTiles));
    expect(terrain.tileCount).toBeGreaterThan(10); // it actually streamed
    // Road samples stay bounded too (trim keeps memory flat): the kept window
    // runs from viewerS - (VIEW_RADIUS + TILE_SIZE) to viewerS + VIEW + MARGIN.
    const kept =
      (2 * TERRAIN.VIEW_RADIUS + TERRAIN.TILE_SIZE + ROAD.LOOKAHEAD_MARGIN) /
        ROAD.SAMPLE_SPACING +
      10;
    expect(road.sampleCount).toBeLessThan(kept);
    // After stopping, one more update may fill up to one budget of tiles,
    // but must never run away.
    const settled = terrain.tileCount;
    terrain.update(sample.x, sample.z);
    expect(terrain.tileCount).toBeLessThanOrEqual(
      settled + TERRAIN.TILES_PER_FRAME_BUDGET,
    );

    terrain.dispose();
  }, 30_000);

  test('tiles are recycled from the pool (no geometry churn)', () => {
    const { road, hf } = makeWorld(999);
    const scene = new Scene();
    const terrain = new Terrain(scene, hf, 'low');
    const sample: RoadSample = {
      s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
    };

    // Drive far enough that early tiles are evicted into the pool.
    for (let s = 0; s <= 4000; s += 1) {
      road.ensureAhead(s + TERRAIN.VIEW_RADIUS + ROAD.LOOKAHEAD_MARGIN);
      road.sampleAt(s, sample);
      terrain.update(sample.x, sample.z);
    }
    expect(terrain.pooledCount).toBeGreaterThan(0); // evictions happened
    // Total geometries ever created: active + pooled.
    const totalCreated = terrain.tileCount + terrain.pooledCount;

    // Return to the start: tiles must come from the pool — the total must not
    // grow (no new BufferGeometry churn) and the pool must be consumed.
    road.sampleAt(0, sample);
    for (let i = 0; i < 400; i++) terrain.update(sample.x, sample.z);
    expect(terrain.tileCount + terrain.pooledCount).toBe(totalCreated);
    expect(terrain.pooledCount).toBeLessThan(totalCreated);
    // The test scene contains only terrain meshes → exactly one per tile.
    const meshes = scene.children.filter((c) => c.type === 'Mesh');
    expect(meshes.length).toBe(terrain.tileCount);
    expect(meshes.length).toBeGreaterThan(0);

    terrain.dispose();
    expect(scene.children.length).toBe(0);
  });
});
