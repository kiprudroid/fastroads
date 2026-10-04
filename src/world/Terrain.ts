/**
 * Terrain.ts — world-aligned terrain tiles + pool/manager.
 *
 * Tiles are TILE_SIZE squares with id (ix, iz). Each tile is one
 * BufferGeometry with (SEGMENTS+1)^2 vertices stored LOCAL to the tile origin
 * (mesh.position carries the origin — keeps floats small far from 0) and a
 * shared index buffer across all tiles (one GL element buffer).
 *
 * Per vertex: position from `HeightField.heightAt`, normal from `normalAt`
 * (finite differences — seamless across borders), color from
 * `Palette.colorFor`.
 *
 * Manager: each frame, tiles whose center is within VIEW_RADIUS of the viewer
 * exist; missing ones are built nearest-first at most TILES_PER_FRAME_BUDGET
 * per frame; tiles beyond VIEW_RADIUS + EVICT_SLACK_TILES are returned to a
 * pool (geometry typed arrays are reused — never allocate a BufferGeometry
 * per tile per frame). `buildInitial` synchronously builds everything within
 * INITIAL_BUILD_RADIUS before the first frame (behind the start overlay).
 */

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshLambertMaterial,
  Sphere,
  type Scene,
} from 'three';
import { QUALITY_PRESETS, TERRAIN } from '../config.ts';
import type { QualityLevel } from '../types.ts';
import { hashNoise2D } from '../utils/math.ts';
import type { HeightField, GroundEval, Vec3Like } from './HeightField.ts';
import { Palette } from './Palette.ts';

const TILE_KEY_OFFSET = 1 << 20;
const TILE_KEY_SPAN = 1 << 21;

interface Tile {
  ix: number;
  iz: number;
  key: number;
  mesh: Mesh;
  geometry: BufferGeometry;
  position: BufferAttribute;
  normal: BufferAttribute;
  color: BufferAttribute;
  /** Local bounding sphere (mutated per build; avoids recompute). */
  sphere: Sphere;
}

function tileKey(ix: number, iz: number): number {
  return (ix + TILE_KEY_OFFSET) * TILE_KEY_SPAN + (iz + TILE_KEY_OFFSET);
}

export class Terrain {
  private readonly scene: Scene;
  private readonly hf: HeightField;
  private readonly segments: number;
  private readonly side: number;
  private readonly step: number;

  private readonly material: MeshLambertMaterial;
  /** One index buffer shared by every tile (GL element buffer uploaded once). */
  private readonly sharedIndex: BufferAttribute;

  private readonly tiles = new Map<number, Tile>();
  private readonly pool: Tile[] = [];

  // Per-frame candidate buffers (reused — no allocation after warmup).
  private candKeys: number[] = [];
  private candIx: number[] = [];
  private candIz: number[] = [];
  private candD2: number[] = [];
  private candTake: Uint8Array = new Uint8Array(0);

  // Scratch for vertex building.
  private readonly ground: GroundEval = { height: 0, roadRel: 0, roadDist: 0, roadS: 0 };
  /** Previous-row evaluations, reused as nearest-road hints (per column). */
  private readonly rowEval: GroundEval[] = [];
  private readonly normal: Vec3Like = { x: 0, y: 1, z: 0 };
  private readonly tint: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 };

  constructor(
    scene: Scene,
    hf: HeightField,
    level: QualityLevel = 'medium',
  ) {
    this.scene = scene;
    this.hf = hf;
    this.segments = QUALITY_PRESETS[level].tileSegments;
    this.side = this.segments + 1;
    this.step = TERRAIN.TILE_SIZE / this.segments;

    this.material = new MeshLambertMaterial({ vertexColors: true, fog: true });

    // Shared index data: two CCW (up-facing) triangles per cell.
    const seg = this.segments;
    const index = new Uint16Array(seg * seg * 6);
    let w = 0;
    for (let r = 0; r < seg; r++) {
      for (let c = 0; c < seg; c++) {
        const a = r * this.side + c;
        const b = a + 1;
        const cc = a + this.side;
        const d = cc + 1;
        index[w++] = a;
        index[w++] = d;
        index[w++] = b;
        index[w++] = a;
        index[w++] = cc;
        index[w++] = d;
      }
    }
    this.sharedIndex = new BufferAttribute(index, 1);
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  /** Tiles waiting for reuse (diagnostic/test accessor). */
  get pooledCount(): number {
    return this.pool.length;
  }

  /** Test/debug accessor. */
  getTile(ix: number, iz: number): Mesh | undefined {
    return this.tiles.get(tileKey(ix, iz))?.mesh;
  }

  // -------------------------------------------------------------------------
  // Building
  // -------------------------------------------------------------------------

  /** Synchronous initial build (called before the first frame). */
  buildInitial(x: number, z: number): void {
    const r = Math.ceil(TERRAIN.INITIAL_BUILD_RADIUS / TERRAIN.TILE_SIZE);
    const cx = Math.floor(x / TERRAIN.TILE_SIZE);
    const cz = Math.floor(z / TERRAIN.TILE_SIZE);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (this.tiles.has(tileKey(ix, iz))) continue;
        if (this.centerDistance2(x, z, ix, iz) > TERRAIN.INITIAL_BUILD_RADIUS ** 2) {
          continue;
        }
        const tile = this.acquire(ix, iz);
        if (tile !== null) this.fill(tile, ix, iz);
      }
    }
  }

  /**
   * Stream tiles around (x, z): evict, then build missing tiles nearest-first
   * within the per-frame budget.
   */
  update(x: number, z: number): void {
    const view2 = TERRAIN.VIEW_RADIUS * TERRAIN.VIEW_RADIUS;
    const evictR = TERRAIN.VIEW_RADIUS + TERRAIN.EVICT_SLACK_TILES * TERRAIN.TILE_SIZE;
    const evict2 = evictR * evictR;

    // --- evict first so pooled geometry can be reused this frame ---
    for (const [key, tile] of this.tiles) {
      const d2 = this.centerDistance2(x, z, tile.ix, tile.iz);
      if (d2 > evict2) {
        this.scene.remove(tile.mesh);
        this.tiles.delete(key);
        this.pool.push(tile);
      }
    }

    // --- gather missing tiles inside the view circle ---
    const r = Math.ceil(evictR / TERRAIN.TILE_SIZE);
    const cx = Math.floor(x / TERRAIN.TILE_SIZE);
    const cz = Math.floor(z / TERRAIN.TILE_SIZE);

    let count = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        const key = tileKey(ix, iz);
        if (this.tiles.has(key)) continue;
        const d2 = this.centerDistance2(x, z, ix, iz);
        if (d2 > view2) continue;
        // Reuse arrays; capacity grows once and stays.
        this.candKeys[count] = key;
        this.candIx[count] = ix;
        this.candIz[count] = iz;
        this.candD2[count] = d2;
        count++;
      }
    }
    if (count > this.candTake.length) this.candTake = new Uint8Array(count);

    // --- build up to the budget, nearest-first (linear selection) ---
    this.candTake.fill(0, 0, count);
    let budget = TERRAIN.TILES_PER_FRAME_BUDGET;
    while (budget > 0) {
      let best = -1;
      let bestD2 = Infinity;
      for (let i = 0; i < count; i++) {
        if (this.candTake[i] !== 0) continue;
        if (this.candD2[i] < bestD2) {
          bestD2 = this.candD2[i];
          best = i;
        }
      }
      if (best < 0) break;
      this.candTake[best] = 1;
      const tile = this.acquire(this.candIx[best], this.candIz[best]);
      if (tile !== null) this.fill(tile, this.candIx[best], this.candIz[best]);
      budget--;
    }
  }

  // -------------------------------------------------------------------------
  // Tile data fill
  // -------------------------------------------------------------------------

  private fill(tile: Tile, ix: number, iz: number): void {
    const side = this.side;
    const step = this.step;
    const originX = ix * TERRAIN.TILE_SIZE;
    const originZ = iz * TERRAIN.TILE_SIZE;
    const pos = tile.position.array as Float32Array;
    const nrm = tile.normal.array as Float32Array;
    const col = tile.color.array as Float32Array;

    let minY = Infinity;
    let maxY = -Infinity;
    let i = 0;

    // Ensure the hint row buffer exists (one allocation per Terrain).
    if (this.rowEval.length < side) {
      this.rowEval.length = 0;
      for (let k = 0; k < side; k++) {
        this.rowEval.push({ height: 0, roadRel: 0, roadDist: 0, roadS: 0 });
      }
    }

    for (let r = 0; r < side; r++) {
      const lz = r * step;
      const wz = originZ + lz;
      for (let c = 0; c < side; c++) {
        const lx = c * step;
        const wx = originX + lx;

        // Hint: the same column of the row above (still holds r-1), or the
        // previous column for the very first row. Both are ≤ one vertex step
        // away, so the hint is always inside the local search window.
        const hint = r > 0 ? this.rowEval[c] : c > 0 ? this.rowEval[c - 1] : undefined;
        this.hf.evaluate(wx, wz, this.ground, hint);
        const h = this.ground.height;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;

        this.hf.normalAt(wx, wz, this.normal, this.ground);
        Palette.colorFor(
          this.ground.roadRel,
          1 - this.normal.y,
          hashNoise2D(wx, wz),
          this.tint,
        );

        // Publish this vertex's eval as the hint for its neighbors.
        const pub = this.rowEval[c];
        pub.height = this.ground.height;
        pub.roadRel = this.ground.roadRel;
        pub.roadDist = this.ground.roadDist;
        pub.roadS = this.ground.roadS;

        pos[i] = lx;
        pos[i + 1] = h;
        pos[i + 2] = lz;
        nrm[i] = this.normal.x;
        nrm[i + 1] = this.normal.y;
        nrm[i + 2] = this.normal.z;
        col[i] = this.tint.r;
        col[i + 1] = this.tint.g;
        col[i + 2] = this.tint.b;
        i += 3;
      }
    }

    tile.position.needsUpdate = true;
    tile.normal.needsUpdate = true;
    tile.color.needsUpdate = true;

    tile.mesh.position.set(originX, 0, originZ);
    tile.mesh.updateMatrix(); // matrixAutoUpdate off: only changes on rebuild

    // Manual bounding sphere (local space): avoids computeBoundingSphere()
    // allocations and keeps frustum culling exact enough.
    const halfDiag = (TERRAIN.TILE_SIZE * Math.SQRT2) / 2;
    const midY = (minY + maxY) / 2;
    const radius = halfDiag + (maxY - minY) / 2 + 1;
    tile.sphere.center.set(0, midY, 0);
    tile.sphere.radius = radius;
    tile.geometry.boundingSphere = tile.sphere;

    tile.ix = ix;
    tile.iz = iz;
    this.scene.add(tile.mesh);
    this.tiles.set(tileKey(ix, iz), tile);
  }

  /** Pop a pooled tile (reusing its geometry buffers) or create a new one. */
  private acquire(ix: number, iz: number): Tile | null {
    const pooled = this.pool.pop();
    if (pooled !== undefined) {
      pooled.ix = ix;
      pooled.iz = iz;
      return pooled;
    }
    return this.createTile(ix, iz);
  }

  private createTile(ix: number, iz: number): Tile | null {
    const vertexCount = this.side * this.side;
    const geometry = new BufferGeometry();

    const position = new BufferAttribute(new Float32Array(vertexCount * 3), 3);
    const normal = new BufferAttribute(new Float32Array(vertexCount * 3), 3);
    const color = new BufferAttribute(new Float32Array(vertexCount * 3), 3);
    geometry.setAttribute('position', position);
    geometry.setAttribute('normal', normal);
    geometry.setAttribute('color', color);
    geometry.setIndex(this.sharedIndex);

    const sphere = new Sphere();
    geometry.boundingSphere = sphere;

    const mesh = new Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix(); // position set in fill()

    return {
      ix,
      iz,
      key: tileKey(ix, iz),
      mesh,
      geometry,
      position,
      normal,
      color,
      sphere,
    };
  }

  private centerDistance2(x: number, z: number, ix: number, iz: number): number {
    const dx = x - ((ix + 0.5) * TERRAIN.TILE_SIZE);
    const dz = z - ((iz + 0.5) * TERRAIN.TILE_SIZE);
    return dx * dx + dz * dz;
  }

  dispose(): void {
    for (const tile of this.tiles.values()) this.scene.remove(tile.mesh);
    for (const tile of this.pool) tile.geometry.dispose();
    for (const tile of this.tiles.values()) tile.geometry.dispose();
    this.tiles.clear();
    this.pool.length = 0;
    this.material.dispose();
  }
}
