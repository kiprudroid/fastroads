/**
 * TempRoadStrip.ts — PHASE 3 ONLY (deleted in phase 4, replaced by RoadMesh).
 *
 * A crude solid-asphalt ribbon along the centerline so road flattening and
 * alignment can be verified visually before the real textured RoadMesh lands.
 * Rebuilt (in place, same buffers) whenever the viewer advances 100 m.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshLambertMaterial,
  type Scene,
} from 'three';
import { ROAD } from '../config.ts';
import type { RoadGenerator } from './RoadGenerator.ts';
import type { RoadSample } from '../types.ts';

const STEP = 4; // m along the centerline between strip cross-sections
const BEHIND = 100; // m kept behind the viewer
const AHEAD = 1300; // m generated ahead
const REBUILD_TRIGGER = 100; // rebuild once the range start falls this far behind
const MAX_CROSS = Math.ceil((BEHIND + AHEAD) / STEP) + 2;

export class TempRoadStrip {
  private readonly geometry = new BufferGeometry();
  private readonly mesh: Mesh;
  private readonly material: MeshLambertMaterial;
  private readonly position: BufferAttribute;
  private readonly scratch: RoadSample = {
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
  private rangeStart = -Infinity;
  private rangeEnd = -Infinity;

  constructor(
    private readonly scene: Scene,
    private readonly road: RoadGenerator,
  ) {
    // Vertices: 2 per cross-section, indexed as quads.
    this.position = new BufferAttribute(
      new Float32Array(MAX_CROSS * 2 * 3),
      3,
    );
    this.geometry.setAttribute('position', this.position);

    const index = new Uint16Array((MAX_CROSS - 1) * 6);
    let w = 0;
    for (let i = 0; i < MAX_CROSS - 1; i++) {
      const a = i * 2;
      index[w++] = a;
      index[w++] = a + 1;
      index[w++] = a + 3;
      index[w++] = a;
      index[w++] = a + 3;
      index[w++] = a + 2;
    }
    this.geometry.setIndex(new BufferAttribute(index, 1));

    this.material = new MeshLambertMaterial({
      color: 0x3a3d42,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  update(viewerS: number): void {
    if (viewerS - this.rangeStart < REBUILD_TRIGGER && this.rangeEnd > -Infinity) {
      return;
    }
    this.rebuild(viewerS);
  }

  private rebuild(viewerS: number): void {
    const startS = Math.max(0, viewerS - BEHIND);
    const endS = viewerS + AHEAD;
    this.road.ensureAhead(endS);

    const arr = this.position.array as Float32Array;
    const half = ROAD.HALF_WIDTH;
    let i = 0;
    let cross = 0;
    for (let s = startS; s <= endS && cross < MAX_CROSS; s += STEP, cross++) {
      this.road.sampleAt(s, this.scratch);
      const y = this.scratch.y + 0.02;
      const nx = this.scratch.nx;
      const nz = this.scratch.nz;
      arr[i++] = this.scratch.x - nx * half;
      arr[i++] = y;
      arr[i++] = this.scratch.z - nz * half;
      arr[i++] = this.scratch.x + nx * half;
      arr[i++] = y;
      arr[i++] = this.scratch.z + nz * half;
    }
    // Remaining cross-sections collapse onto the last one (draw range cuts them).
    this.position.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, (cross - 1) * 6));
    this.geometry.boundingSphere = null; // frustumCulled = false anyway

    this.rangeStart = startS;
    this.rangeEnd = endS;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
