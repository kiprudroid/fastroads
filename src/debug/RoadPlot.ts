/**
 * RoadPlot.ts — dev-only top-down plot of the road centerline (`?debugRoad=1`).
 *
 * Draws the generated samples onto a small 2D canvas overlay so the road's
 * shape (smooth winding curves, no self-intersections) can be checked at a
 * glance. Redrawn on a throttle; never enabled by default.
 */

import { DEBUG } from '../config.ts';
import type { RoadGenerator } from '../world/RoadGenerator.ts';
import type { RoadSample } from '../types.ts';

const PADDING = 14;
/** Sample stride when collecting points for the plot (m). */
const STRIDE = 6;

export class RoadPlot {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
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
  private lastDraw = 0;

  constructor(parent: HTMLElement, private readonly road: RoadGenerator) {
    const size = DEBUG.ROAD_PLOT_SIZE;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'road-plot';
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    parent.appendChild(this.canvas);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);

    const ctx = this.canvas.getContext('2d');
    if (ctx === null) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);
  }

  /** Throttled redraw. */
  update(now: number): void {
    if (now - this.lastDraw < DEBUG.ROAD_PLOT_INTERVAL_MS) return;
    this.lastDraw = now;
    this.draw();
  }

  private draw(): void {
    const size = DEBUG.ROAD_PLOT_SIZE;
    const ctx = this.ctx;
    const first = this.road.firstS;
    const last = this.road.lastS;

    // Collect bounds (pass 1).
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let s = first; s <= last; s += STRIDE) {
      this.road.sampleAt(s, this.scratch);
      const { x, z } = this.scratch;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) return;

    const spanX = Math.max(maxX - minX, 1);
    const spanZ = Math.max(maxZ - minZ, 1);
    const scale = Math.min(
      (size - 2 * PADDING) / spanX,
      (size - 2 * PADDING) / spanZ,
    );
    // world -> screen: +X right, +Z down (so the road heading -Z goes up).
    const ox = PADDING - minX * scale + ((size - 2 * PADDING) - spanX * scale) / 2;
    const oy = PADDING - minZ * scale + ((size - 2 * PADDING) - spanZ * scale) / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(16, 18, 22, 0.72)';
    ctx.fillRect(0, 0, size, size);

    // Faint grid.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    const gridM = 500; // every 500 m
    const gridPx = gridM * scale;
    if (gridPx > 6) {
      ctx.beginPath();
      const x0 = ox + Math.floor(minX / gridM) * gridM * scale;
      for (let x = x0; x < size; x += gridPx) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
      }
      const y0 = oy + Math.floor(minZ / gridM) * gridM * scale;
      for (let y = y0; y < size; y += gridPx) {
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
      }
      ctx.stroke();
    }

    // Centerline.
    ctx.strokeStyle = '#ffd9a0';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let firstPoint = true;
    for (let s = first; s <= last; s += STRIDE) {
      this.road.sampleAt(s, this.scratch);
      const px = ox + this.scratch.x * scale;
      const py = oy + this.scratch.z * scale;
      if (firstPoint) {
        ctx.moveTo(px, py);
        firstPoint = false;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // Start marker (origin) + label.
    const sx = ox;
    const sy = oy;
    ctx.fillStyle = '#7dff9b';
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(246, 241, 232, 0.85)';
    ctx.font = '10px monospace';
    ctx.fillText(
      `road ${Math.round(last)}m  grid ${gridM}m`,
      8,
      size - 8,
    );
  }

  dispose(): void {
    this.canvas.remove();
  }
}
