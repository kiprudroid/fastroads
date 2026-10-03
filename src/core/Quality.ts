/**
 * Quality.ts — quality presets + adaptive pixel-ratio controller.
 *
 * Preset (low/medium/high) fixes view radius, tile segments, antialias and
 * scenery density. On top of that, adaptive resolution watches a moving
 * average of frame time:
 *   - > PIXEL_RATIO.SLOW_MS  for ~SLOW_SECONDS -> pixel ratio -0.1
 *   - < PIXEL_RATIO.FAST_MS  for ~FAST_SECONDS -> pixel ratio +0.1
 * Bounds: [PIXEL_RATIO.MIN, min(devicePixelRatio, MAX_DEVICE * preset cap)].
 */

import type { WebGLRenderer } from 'three';
import { PIXEL_RATIO, QUALITY_PRESETS, DEFAULT_QUALITY, type QualityPreset } from '../config.ts';
import type { QualityLevel } from '../types.ts';
import { clamp } from '../utils/math.ts';

const LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

function levelFromSearch(search: string): QualityLevel {
  const raw = new URLSearchParams(search).get('quality');
  if (raw !== null && (LEVELS as readonly string[]).includes(raw)) {
    return raw as QualityLevel;
  }
  return DEFAULT_QUALITY;
}

/** Resolve the quality level from `?quality=` (or the default). */
export function resolveQualityLevel(): QualityLevel {
  return levelFromSearch(window.location.search);
}

export function isQualityLevel(value: string): value is QualityLevel {
  return (LEVELS as readonly string[]).includes(value);
}

export class Quality {
  readonly level: QualityLevel;
  readonly preset: QualityPreset;

  private readonly renderer: WebGLRenderer;
  private ratio: number;

  /** Moving-average ring buffer of frame intervals (ms). */
  private readonly buf = new Float32Array(PIXEL_RATIO.AVG_WINDOW);
  private bufIndex = 0;
  private bufCount = 0;
  private bufSum = 0;

  /** How long the average has been on each side of the thresholds (ms). */
  private slowForMs = 0;
  private fastForMs = 0;

  constructor(renderer: WebGLRenderer, level?: QualityLevel) {
    this.renderer = renderer;
    this.level = level ?? levelFromSearch(window.location.search);
    this.preset = QUALITY_PRESETS[this.level];
    this.ratio = clamp(this.maxRatio(), PIXEL_RATIO.MIN, this.maxRatio());
    renderer.setPixelRatio(this.ratio);
  }

  get pixelRatio(): number {
    return this.ratio;
  }

  /** Upper bound for the current device + preset (browser zoom aware). */
  maxRatio(): number {
    return Math.min(
      window.devicePixelRatio || 1,
      PIXEL_RATIO.MAX_DEVICE * this.preset.pixelRatioCap,
    );
  }

  /** Feed one frame interval; may lower/raise the pixel ratio. */
  sampleFrame(frameMs: number): void {
    const buf = this.buf;
    this.bufSum -= buf[this.bufIndex];
    buf[this.bufIndex] = frameMs;
    this.bufSum += frameMs;
    this.bufIndex = (this.bufIndex + 1) % buf.length;
    if (this.bufCount < buf.length) this.bufCount++;
    if (this.bufCount < buf.length) return; // still warming up

    const avg = this.bufSum / this.bufCount;

    if (avg > PIXEL_RATIO.SLOW_MS) {
      this.slowForMs += frameMs;
      this.fastForMs = 0;
      if (this.slowForMs >= PIXEL_RATIO.SLOW_SECONDS * 1000) {
        this.slowForMs = 0;
        this.applyRatio(this.ratio - PIXEL_RATIO.STEP);
      }
    } else if (avg < PIXEL_RATIO.FAST_MS) {
      this.fastForMs += frameMs;
      this.slowForMs = 0;
      if (this.fastForMs >= PIXEL_RATIO.FAST_SECONDS * 1000) {
        this.fastForMs = 0;
        this.applyRatio(this.ratio + PIXEL_RATIO.STEP);
      }
    } else {
      this.slowForMs = 0;
      this.fastForMs = 0;
    }
  }

  private applyRatio(next: number): void {
    const clamped = clamp(next, PIXEL_RATIO.MIN, this.maxRatio());
    if (clamped === this.ratio) return;
    this.ratio = clamped;
    this.renderer.setPixelRatio(clamped);
    // Reset the moving average so the change is judged on fresh data.
    this.buf.fill(0);
    this.bufCount = 0;
    this.bufSum = 0;
    this.bufIndex = 0;
    this.slowForMs = 0;
    this.fastForMs = 0;
  }
}
