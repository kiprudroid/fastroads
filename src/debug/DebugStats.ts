/**
 * DebugStats.ts — frame-time / draw-call overlay, toggled with backtick.
 *
 * Pure DOM (monospace, top-left), updated at ~4 Hz to keep the overlay itself
 * from costing anything while hidden.
 */

export interface DebugFrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  activeTiles: number;
  roadSamples: number;
  pixelRatio: number;
}

const UPDATE_INTERVAL_MS = 250;

export class DebugStats {
  private readonly el: HTMLDivElement;
  private visible = false;
  private lastUpdate = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-stats';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.style.display = visible ? 'block' : 'none';
  }

  update(stats: DebugFrameStats, now: number): void {
    if (!this.visible) return;
    if (now - this.lastUpdate < UPDATE_INTERVAL_MS) return;
    this.lastUpdate = now;
    this.el.textContent =
      `fps        ${stats.fps.toFixed(0)}\n` +
      `frame      ${stats.frameMs.toFixed(2)} ms\n` +
      `draw calls ${stats.drawCalls}\n` +
      `triangles  ${stats.triangles}\n` +
      `geometries ${stats.geometries}\n` +
      `textures   ${stats.textures}\n` +
      `tiles      ${stats.activeTiles}\n` +
      `road pts   ${stats.roadSamples}\n` +
      `pixelRatio ${stats.pixelRatio.toFixed(2)}`;
  }

  dispose(): void {
    this.el.remove();
  }
}
