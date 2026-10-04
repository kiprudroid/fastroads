/**
 * RoadMesh.ts — road ribbon segments + procedural lane-marking texture.
 *
 * Independent of terrain tiles: segments cover ROAD_MESH.SEGMENT_LENGTH (64 m)
 * of arc length each, built from centerline samples (vertices at
 * ±ROAD_HALF_WIDTH along the sample normal, y = roadY + LIFT). Every segment's
 * boundary cross-section uses the exact sample shared with its neighbor
 * (s = idx * 64 is always a sample point), so joins are seamless by
 * construction; the shared UV `v = s / TEXTURE_REPEAT_LENGTH` keeps the dash
 * pattern continuous across borders too.
 *
 * Positions are stored LOCAL to the segment's first cross-section (mesh
 * position carries the origin) — same float-precision hygiene as terrain
 * tiles. Segments are pooled and recycled; one shared material/texture and
 * one shared index buffer for all segments.
 *
 * The texture is drawn on a canvas (no assets): dark asphalt with subtle
 * noise, solid thin edge lines, dashed center line. Mipmaps + anisotropy so
 * the dashes stay readable at distance.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Sphere,
  type Scene,
  type Texture,
} from 'three';
import { ROAD, ROAD_MESH, TERRAIN } from '../config.ts';
import { mulberry32 } from '../utils/rng.ts';
import type { RoadGenerator } from './RoadGenerator.ts';
import type { RoadSample } from '../types.ts';

/** Cross-sections per segment: one per centerline sample + closing section. */
const CROSS = ROAD_MESH.SEGMENT_LENGTH / ROAD.SAMPLE_SPACING + 1;
const VERTS = CROSS * 2;
const QUADS = CROSS - 1;

interface Segment {
  idx: number;
  mesh: Mesh;
  geometry: BufferGeometry;
  position: BufferAttribute;
  uv: BufferAttribute;
  sphere: Sphere;
}

export class RoadMesh {
  private readonly segments = new Map<number, Segment>();
  private readonly pool: Segment[] = [];
  private readonly material: MeshLambertMaterial;
  private readonly texture: Texture;
  private readonly scene: Scene;
  private readonly road: RoadGenerator;
  /** Same index buffer for every segment (positions differ, topology is fixed). */
  private readonly sharedIndex: BufferAttribute;

  private readonly scratch: RoadSample = {
    s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
  };

  constructor(scene: Scene, road: RoadGenerator, seed: number, maxAnisotropy: number) {
    this.scene = scene;
    this.road = road;

    this.texture = createRoadTexture(seed, maxAnisotropy);
    this.material = new MeshLambertMaterial({
      map: this.texture,
      // Road must win against the (already lowered) ground beneath it.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const index = new Uint16Array(QUADS * 6);
    let w = 0;
    for (let q = 0; q < QUADS; q++) {
      const a = q * 2; // left
      const b = a + 1; // right
      const c = a + 2; // next left
      const d = a + 3; // next right
      // CCW seen from above (+Y normal).
      index[w++] = a;
      index[w++] = b;
      index[w++] = c;
      index[w++] = b;
      index[w++] = d;
      index[w++] = c;
    }
    this.sharedIndex = new BufferAttribute(index, 1);
  }

  get segmentCount(): number {
    return this.segments.size;
  }

  /** Test accessor. */
  getSegment(idx: number): Mesh | undefined {
    return this.segments.get(idx)?.mesh;
  }

  /** Keep segments covering [viewerS - BEHIND, viewerS + VIEW_RADIUS]. */
  update(viewerS: number): void {
    const len = ROAD_MESH.SEGMENT_LENGTH;
    const minIdx = Math.max(0, Math.floor((viewerS - ROAD_MESH.BEHIND) / len));
    const maxIdx = Math.min(
      Math.floor(this.road.lastS / len),
      Math.floor((viewerS + TERRAIN.VIEW_RADIUS) / len),
    );
    const slack = ROAD_MESH.SLACK_SEGMENTS;

    // Evict (pooled, not disposed).
    for (const [idx, seg] of this.segments) {
      if (idx < minIdx - slack || idx > maxIdx + slack) {
        this.scene.remove(seg.mesh);
        this.segments.delete(idx);
        this.pool.push(seg);
      }
    }

    if (maxIdx < minIdx) return;
    // Build the missing ones (at road speed this is <1 segment per second).
    for (let idx = minIdx; idx <= maxIdx; idx++) {
      if (this.segments.has(idx)) continue;
      const seg = this.acquire(idx);
      this.fill(seg, idx);
      this.segments.set(idx, seg);
    }
  }

  private acquire(idx: number): Segment {
    const pooled = this.pool.pop();
    if (pooled !== undefined) {
      pooled.idx = idx;
      return pooled;
    }

    const geometry = new BufferGeometry();
    const position = new BufferAttribute(new Float32Array(VERTS * 3), 3);
    const uv = new BufferAttribute(new Float32Array(VERTS * 2), 2);
    geometry.setAttribute('position', position);
    geometry.setAttribute('uv', uv);
    geometry.setIndex(this.sharedIndex);
    const sphere = new Sphere();
    geometry.boundingSphere = sphere;

    const mesh = new Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    return { idx, mesh, geometry, position, uv, sphere };
  }

  private fill(seg: Segment, idx: number): void {
    const half = ROAD.HALF_WIDTH;
    const s0 = idx * ROAD_MESH.SEGMENT_LENGTH;
    const pos = seg.position.array as Float32Array;
    const uv = seg.uv.array as Float32Array;

    // Origin = first cross-section center (local coordinates for precision).
    this.road.sampleAt(s0, this.scratch);
    const ox = this.scratch.x;
    const oy = this.scratch.y;
    const oz = this.scratch.z;

    let minY = Infinity;
    let maxY = -Infinity;
    let p = 0;
    let t = 0;
    for (let i = 0; i < CROSS; i++) {
      const s = s0 + i * ROAD.SAMPLE_SPACING;
      this.road.sampleAt(s, this.scratch);
      const y = this.scratch.y + ROAD_MESH.LIFT - oy;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const lx = this.scratch.x - this.scratch.nx * half;
      const lz = this.scratch.z - this.scratch.nz * half;
      const rx = this.scratch.x + this.scratch.nx * half;
      const rz = this.scratch.z + this.scratch.nz * half;

      pos[p++] = lx - ox;
      pos[p++] = y;
      pos[p++] = lz - oz;
      pos[p++] = rx - ox;
      pos[p++] = y;
      pos[p++] = rz - oz;

      const v = s / ROAD_MESH.TEXTURE_REPEAT_LENGTH;
      uv[t++] = 0;
      uv[t++] = v;
      uv[t++] = 1;
      uv[t++] = v;
    }

    seg.position.needsUpdate = true;
    seg.uv.needsUpdate = true;

    seg.mesh.position.set(ox, oy, oz);
    seg.mesh.updateMatrix();

    const spanZ = ROAD_MESH.SEGMENT_LENGTH / 2;
    seg.sphere.center.set(0, (minY + maxY) / 2, -spanZ);
    // Conservative: covers heading wander (±40°) plus width and height span.
    seg.sphere.radius =
      ROAD_MESH.SEGMENT_LENGTH * 0.75 + (maxY - minY) / 2 + 4;
    seg.geometry.boundingSphere = seg.sphere;

    this.scene.add(seg.mesh);
  }

  dispose(): void {
    for (const seg of this.segments.values()) this.scene.remove(seg.mesh);
    for (const seg of this.segments.values()) seg.geometry.dispose();
    for (const seg of this.pool) seg.geometry.dispose();
    this.segments.clear();
    this.pool.length = 0;
    this.material.dispose();
    this.texture.dispose();
  }
}

/**
 * Procedural lane-marking texture (128 x 256, one tile = 8 m of road):
 * asphalt + speckle noise, solid edge lines, dashed center line.
 * Speckles use a seeded PRNG so the texture is identical across runs.
 *
 * Headless fallback: bun tests have no DOM, and they only exercise geometry —
 * so a 1x1 placeholder texture stands in for the canvas one.
 */
function createRoadTexture(seed: number, maxAnisotropy: number): Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([0x3a, 0x3d, 0x42, 0xff]);
    const placeholder = new DataTexture(data, 1, 1);
    placeholder.needsUpdate = true;
    return placeholder;
  }

  const w = ROAD_MESH.TEXTURE_WIDTH;
  const h = ROAD_MESH.TEXTURE_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d context unavailable');

  const mPerPxX = (ROAD.HALF_WIDTH * 2) / w; // across
  const mPerPxY = ROAD_MESH.TEXTURE_REPEAT_LENGTH / h; // along
  const lateralToX = (lateral: number): number =>
    (lateral + ROAD.HALF_WIDTH) / (ROAD.HALF_WIDTH * 2) * w;

  // Asphalt base + subtle noise.
  ctx.fillStyle = ROAD_MESH.ASPHALT;
  ctx.fillRect(0, 0, w, h);
  const rng = mulberry32(seed ^ 0x51ed2701);
  for (let i = 0; i < 2600; i++) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    const light = rng() > 0.5;
    const a = 0.03 + rng() * 0.05;
    ctx.fillStyle = light ? `rgba(255,255,255,${a.toFixed(3)})` : `rgba(0,0,0,${a.toFixed(3)})`;
    const size = rng() > 0.85 ? 2 : 1;
    ctx.fillRect(x, y, size, size);
  }

  // Solid thin edge lines.
  const edgeW = ROAD_MESH.EDGE_LINE_WIDTH / mPerPxX;
  const edgeX = lateralToX(ROAD_MESH.EDGE_LINE_LATERAL);
  ctx.fillStyle = ROAD_MESH.MARKING;
  ctx.fillRect(edgeX - edgeW / 2, 0, edgeW, h);
  ctx.fillRect(w - edgeX - edgeW / 2, 0, edgeW, h);    // Dashed center line: 3 m line, 1 m gap (4 m cycle, 2 per 8 m tile —
    // the cycle divides the tile, so dashes tile seamlessly across repeats).
    const dashW = ROAD_MESH.CENTER_LINE_WIDTH / mPerPxX;
    const cx = lateralToX(0) - dashW / 2;
    const linePx = ROAD_MESH.DASH_LINE_M / mPerPxY;
    const cyclePx = (ROAD_MESH.DASH_LINE_M + ROAD_MESH.DASH_GAP_M) / mPerPxY;
    ctx.fillRect(cx, 0, dashW, linePx);
    ctx.fillRect(cx, cyclePx, dashW, linePx);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = Math.min(ROAD_MESH.ANISOTROPY, maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
}
