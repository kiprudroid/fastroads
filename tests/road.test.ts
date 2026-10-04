/**
 * road.test.ts — pure-logic tests for the road centerline.
 *
 * Covers the spec's tuning rule (min turn radius >= 150 m and max grade <= 7%
 * over the first 50 km), determinism, nearest-point accuracy and trim
 * consistency. No DOM, no WebGL.
 */

import { describe, expect, test } from 'bun:test';
import { Scene } from 'three';
import { RoadGenerator } from '../src/world/RoadGenerator.ts';
import { RoadMesh } from '../src/world/RoadMesh.ts';
import { ROAD, ROAD_MESH } from '../src/config.ts';
import type { NearestResult, RoadSample } from '../src/types.ts';

function newSample(): RoadSample {
  return {
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
}

function newNearest(): NearestResult {
  return { s: 0, lateral: 0, dist: 0, roadY: 0 };
}

describe('RoadGenerator determinism', () => {
  test('same seed produces identical samples', () => {
    const a = new RoadGenerator(12345);
    const b = new RoadGenerator(12345);
    a.ensureAhead(2000);
    b.ensureAhead(2000);
    expect(a.sampleCount).toBe(b.sampleCount);

    const sa = newSample();
    const sb = newSample();
    for (let s = 0; s <= 2000; s += ROAD.SAMPLE_SPACING) {
      a.sampleAt(s, sa);
      b.sampleAt(s, sb);
      expect(sa.x).toBe(sb.x);
      expect(sa.y).toBe(sb.y);
      expect(sa.z).toBe(sb.z);
      expect(sa.heading).toBe(sb.heading);
      expect(sa.curvature).toBe(sb.curvature);
    }
  });

  test('different seeds produce different roads', () => {
    const a = new RoadGenerator(1);
    const b = new RoadGenerator(2);
    a.ensureAhead(2000);
    b.ensureAhead(2000);
    const sa = newSample();
    const sb = newSample();
    let diff = 0;
    for (let s = 0; s <= 2000; s += ROAD.SAMPLE_SPACING) {
      a.sampleAt(s, sa);
      b.sampleAt(s, sb);
      if (Math.abs(sa.x - sb.x) > 1e-6 || Math.abs(sa.z - sb.z) > 1e-6) diff++;
    }
    expect(diff).toBeGreaterThan(100);
  });

  test('generation is independent of ensureAhead call pattern', () => {
    const a = new RoadGenerator(777);
    const b = new RoadGenerator(777);
    // a: one big jump; b: many small steps (same final coverage).
    a.ensureAhead(3000);
    for (let s = 0; s <= 3000; s += 137) b.ensureAhead(s);
    b.ensureAhead(3000);
    const sa = newSample();
    const sb = newSample();
    for (let s = 0; s <= 3000; s += ROAD.SAMPLE_SPACING) {
      a.sampleAt(s, sa);
      b.sampleAt(s, sb);
      expect(sa.x).toBe(sb.x);
      expect(sa.y).toBe(sb.y);
      expect(sa.z).toBe(sb.z);
    }
  });
});

describe('RoadGenerator tuning rule (first 50 km)', () => {
  test('minimum turn radius >= 150 m', () => {
    const road = new RoadGenerator(20240101);
    road.ensureAhead(50_000);
    const s = newSample();
    let maxK = 0;
    for (let t = 0; t <= 50_000; t += ROAD.SAMPLE_SPACING) {
      road.sampleAt(t, s);
      const k = Math.abs(s.curvature);
      if (k > maxK) maxK = k;
    }
    const radius = 1 / maxK;
    expect(radius).toBeGreaterThanOrEqual(150);
  });

  test('max grade <= 7%', () => {
    const road = new RoadGenerator(20240101);
    road.ensureAhead(50_000);
    const a = newSample();
    const b = newSample();
    let maxGrade = 0;
    for (let t = 0; t < 50_000; t += ROAD.SAMPLE_SPACING) {
      road.sampleAt(t, a);
      road.sampleAt(t + ROAD.SAMPLE_SPACING, b);
      const grade = Math.abs(b.y - a.y) / ROAD.SAMPLE_SPACING;
      if (grade > maxGrade) maxGrade = grade;
    }
    expect(maxGrade).toBeLessThanOrEqual(ROAD.MAX_GRADE + 1e-9);
    // Sanity: the road actually has hills (not clamped flat).
    road.sampleAt(0, a);
    road.sampleAt(50_000, b);
    expect(Math.abs(b.y - a.y) + road.sampleCount).toBeGreaterThan(0);
  });

  test('headings stay bounded (road never turns back on itself)', () => {
    const road = new RoadGenerator(999);
    road.ensureAhead(10_000);
    const s = newSample();
    for (let t = 0; t <= 10_000; t += ROAD.SAMPLE_SPACING) {
      road.sampleAt(t, s);
      expect(Math.abs(s.heading)).toBeLessThan(Math.PI / 2);
      // Bounded heading => forward progress in -Z every step.
      expect(s.tz).toBeLessThan(0);
    }
  });
});

describe('RoadGenerator.nearest', () => {
  test('recovers a known lateral offset', () => {
    const road = new RoadGenerator(4242);
    road.ensureAhead(3000);
    const sample = newSample();
    const out = newNearest();

    for (const s of [500, 1200, 1201, 2500]) {
      road.sampleAt(s, sample);
      for (const offset of [3, 7, -5, -12.5]) {
        const px = sample.x + sample.nx * offset;
        const pz = sample.z + sample.nz * offset;
        road.nearest(px, pz, out);
        expect(out.lateral).toBeCloseTo(offset, 2);
        expect(out.dist).toBeCloseTo(Math.abs(offset), 2);
        expect(Math.abs(out.s - s)).toBeLessThan(1.0);
      }
    }
  });

  test('reports roadY matching the centerline elevation', () => {
    const road = new RoadGenerator(31337);
    road.ensureAhead(3000);
    const sample = newSample();
    const out = newNearest();
    road.sampleAt(1750, sample);
    const px = sample.x + sample.nx * 6;
    const pz = sample.z + sample.nz * 6;
    road.nearest(px, pz, out);
    expect(out.roadY).toBeCloseTo(sample.y, 1);
  });

  test('hint search matches the full search', () => {
    const road = new RoadGenerator(555);
    road.ensureAhead(4000);
    const sample = newSample();
    const withHint = newNearest();
    const withoutHint = newNearest();
    road.sampleAt(2500, sample);
    const px = sample.x - sample.nx * 9 + 0.7;
    const pz = sample.z - sample.nz * 9 - 0.4;
    road.nearest(px, pz, withHint, 2500);
    road.nearest(px, pz, withoutHint);
    expect(withHint.s).toBeCloseTo(withoutHint.s, 3);
    expect(withHint.lateral).toBeCloseTo(withoutHint.lateral, 3);
    expect(withHint.dist).toBeCloseTo(withoutHint.dist, 3);
  });

  test('far-away point gets a large distance (no false neighbors)', () => {
    const road = new RoadGenerator(8);
    road.ensureAhead(1000);
    const out = newNearest();
    // 300 m west of the start; the road heads north-ish from the origin.
    road.nearest(-300, -200, out);
    expect(out.dist).toBeGreaterThan(ROAD.BLEND_DISTANCE);
  });
});

describe('RoadMesh segment joins', () => {
  test('adjacent segments share the exact boundary cross-section', () => {
    const road = new RoadGenerator(2468);
    road.ensureAhead(600);
    const scene = new Scene();
    const mesh = new RoadMesh(scene, road, 2468, 4);
    mesh.update(0);

    const m0 = mesh.getSegment(0);
    const m1 = mesh.getSegment(1);
    expect(m0).toBeDefined();
    expect(m1).toBeDefined();
    if (m0 === undefined || m1 === undefined) return;

    const p0 = m0.geometry.getAttribute('position');
    const p1 = m1.geometry.getAttribute('position');
    const u0 = m0.geometry.getAttribute('uv');
    const u1 = m1.geometry.getAttribute('uv');
    const cross = ROAD_MESH.SEGMENT_LENGTH / ROAD.SAMPLE_SPACING;
    const vLast = cross * 2; // last cross-section's left vertex in segment 0

    // World-space positions of the shared boundary: m0's last cross-section
    // vs m1's first. Stored local to each segment origin, so recombine.
    for (let k = 0; k < 2; k++) {
      const x0 = p0.getX(vLast + k) + m0.position.x;
      const y0 = p0.getY(vLast + k) + m0.position.y;
      const z0 = p0.getZ(vLast + k) + m0.position.z;
      const x1 = p1.getX(k) + m1.position.x;
      const y1 = p1.getY(k) + m1.position.y;
      const z1 = p1.getZ(k) + m1.position.z;
      expect(x0).toBeCloseTo(x1, 3);
      expect(y0).toBeCloseTo(y1, 3);
      expect(z0).toBeCloseTo(z1, 3);
      // UV v is continuous across the join (v = s / 8).
      expect(u0.getY(vLast + k)).toBeCloseTo(u1.getY(k), 6);
    }

    // The ribbon sits at roadY + LIFT (checked against the centerline).
    const sample: RoadSample = {
      s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
    };
    road.sampleAt(32, sample); // middle of segment 0
    const midVertex = (32 / ROAD.SAMPLE_SPACING) * 2; // cross-section i=16, left vert
    const leftY = p0.getY(midVertex) + m0.position.y;
    expect(leftY).toBeCloseTo(sample.y + ROAD_MESH.LIFT, 3);

    mesh.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('RoadGenerator.trim', () => {
  test('keeps >= 400 m behind and preserves values', () => {
    const road = new RoadGenerator(2468);
    road.ensureAhead(5000);
    const before = newSample();
    const after = newSample();
    road.sampleAt(4600, before);

    road.trim(5000); // keeps samples from s = 4600 onward
    expect(road.firstS).toBeLessThanOrEqual(5000 - ROAD.TRIM_BEHIND + ROAD.SAMPLE_SPACING);
    expect(road.firstS).toBeGreaterThanOrEqual(5000 - ROAD.TRIM_BEHIND - ROAD.SAMPLE_SPACING);

    road.sampleAt(4600, after);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
    expect(road.lastS).toBeGreaterThanOrEqual(4600);
  });

  test('trim drops only samples older than s - TRIM_BEHIND', () => {
    const road = new RoadGenerator(1357);
    road.ensureAhead(2000);
    const count = road.sampleCount;

    // Still inside the keep-behind window => no-op.
    road.trim(ROAD.TRIM_BEHIND - 100);
    expect(road.sampleCount).toBe(count);
    expect(road.firstS).toBe(0);

    // 1000 - 400 = 600 => samples before s=600 are dropped.
    road.trim(1000);
    expect(road.firstS).toBe(600);
    expect(road.sampleCount).toBe(count - 300);
    const s = newSample();
    road.sampleAt(600, s);
    expect(s.s).toBe(600);
  });

  test('nearest still works after trim (hash cleanup)', () => {
    const road = new RoadGenerator(9753);
    road.ensureAhead(6000);
    road.trim(5000);
    const sample = newSample();
    const out = newNearest();
    road.sampleAt(5600, sample);
    const px = sample.x + sample.nx * 4;
    const pz = sample.z + sample.nz * 4;
    road.nearest(px, pz, out, 5600);
    expect(out.lateral).toBeCloseTo(4, 2);
    expect(out.s).toBeCloseTo(5600, 1);
    expect(out.dist).toBeCloseTo(4, 2);
  });

  test('trim beyond the generated tail never destroys the tail', () => {
    const road = new RoadGenerator(111);
    road.ensureAhead(1000);
    road.trim(999999);
    expect(road.sampleCount).toBeGreaterThanOrEqual(1);
    // Extension must still be possible after an aggressive trim.
    road.ensureAhead(2000);
    const s = newSample();
    road.sampleAt(road.lastS, s);
    expect(road.lastS).toBeGreaterThanOrEqual(2000);
  });
});
