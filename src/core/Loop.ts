/**
 * Loop.ts — requestAnimationFrame loop with a fixed-step accumulator.
 *
 *  - Physics runs at a fixed 1/60 s (max LOOP.MAX_STEPS steps per frame).
 *  - Frame dt is clamped to LOOP.MAX_FRAME_DT (0.1 s) so a stall never causes
 *    a physics explosion or a camera jump.
 *  - Pauses while the tab is hidden or the window is blurred; on resume the
 *    last timestamp is reset so there is no dt spike.
 */

import { LOOP } from '../config.ts';

export type StepFn = (dt: number) => void;
export type FrameFn = (dt: number) => void;

export class Loop {
  private readonly stepFn: StepFn;
  private readonly frameFn: FrameFn;

  private rafId = 0;
  private last = 0;
  private accumulator = 0;
  private started = false;
  private userPaused = false;
  private systemPaused = false;
  /** Diagnostics: number of physics steps executed last frame. */
  lastSteps = 0;

  constructor(step: StepFn, frame: FrameFn) {
    this.stepFn = step;
    this.frameFn = frame;
  }

  get paused(): boolean {
    return this.userPaused || this.systemPaused;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    this.last = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    cancelAnimationFrame(this.rafId);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('focus', this.onFocus);
  }

  /** Player-initiated pause (P / Esc). */
  setUserPaused(paused: boolean): void {
    if (this.userPaused === paused) return;
    this.userPaused = paused;
    this.resetClock();
  }

  /** True only for the player's own pause — the UI shows the overlay for this. */
  get userPausedState(): boolean {
    return this.userPaused;
  }

  private resetClock(): void {
    this.last = performance.now();
    this.accumulator = 0;
  }

  private readonly onVisibility = (): void => {
    this.systemPaused = document.hidden;
    if (!document.hidden) this.resetClock();
  };

  private readonly onBlur = (): void => {
    this.systemPaused = true;
  };

  private readonly onFocus = (): void => {
    this.systemPaused = false;
    this.resetClock();
  };

  private readonly tick = (timestamp: number): void => {
    if (!this.started) return;
    this.rafId = requestAnimationFrame(this.tick);

    let dt = (timestamp - this.last) / 1000;
    this.last = timestamp;
    if (!(dt >= 0)) dt = 0; // also catches NaN
    if (dt > LOOP.MAX_FRAME_DT) dt = LOOP.MAX_FRAME_DT;

    this.lastSteps = 0;
    if (!this.paused) {
      this.accumulator += dt;
      while (
        this.accumulator >= LOOP.FIXED_DT &&
        this.lastSteps < LOOP.MAX_STEPS
      ) {
        this.stepFn(LOOP.FIXED_DT);
        this.accumulator -= LOOP.FIXED_DT;
        this.lastSteps++;
      }
      // Dropped frames: discard the backlog instead of spiraling.
      if (this.lastSteps === LOOP.MAX_STEPS) this.accumulator = 0;
    } else {
      this.accumulator = 0;
    }

    this.frameFn(dt);
  };
}
