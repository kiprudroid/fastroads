/**
 * ChaseCamera.ts — the in-game camera.
 *
 * - Position target = car position - smoothedForward * BACK + up * UP, where
 *   smoothedForward is a low-pass of the car's heading (so the camera lags in
 *   turns — that lag is where the feel comes from).
 * - Follow uses exponential smoothing `1 - exp(-k*dt)` (never a raw lerp with
 *   variable dt).
 * - Look-at = car + smoothedForward * LOOK_AHEAD + up * LOOK_UP.
 * - Camera y never sinks below heightAt(xz) + MIN_GROUND_CLEARANCE.
 * - FOV = 58 + speedFactor * 8, itself smoothed.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA, CAR } from '../config.ts';
import { angleDelta, clamp, expSmooth } from '../utils/math.ts';
import type { HeightField } from '../world/HeightField.ts';
import type { Car } from '../vehicle/Car.ts';

export class ChaseCamera {
  /** Low-passed copy of the car heading (lags in turns). */
  private smoothedHeading = 0;
  private fov = CAMERA.FOV_BASE;
  private initialized = false;
  private readonly lookTarget = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly hf: HeightField,
  ) {}

  /** Snap to the car (used on start / after a world rebuild). */
  reset(car: Car): void {
    this.smoothedHeading = car.heading;
    this.fov = CAMERA.FOV_BASE;
    this.camera.fov = CAMERA.FOV_BASE;
    this.camera.updateProjectionMatrix();
    this.initialized = false;
    this.update(1 / 60, car); // one snapped step
    this.initialized = true;
  }

  update(dt: number, car: Car): void {
    // --- low-pass the heading (angle-aware: never lerps across the seam) ---
    const kHeading = expSmooth(CAMERA.HEADING_SMOOTH, dt);
    this.smoothedHeading +=
      angleDelta(this.smoothedHeading, car.heading) * kHeading;

    const fx = Math.sin(this.smoothedHeading);
    const fz = -Math.cos(this.smoothedHeading);

    // --- ideal position behind/above the car ---
    const targetX = car.x - fx * CAMERA.BACK;
    const targetZ = car.z - fz * CAMERA.BACK;
    const targetY = car.y + CAMERA.UP;

    if (!this.initialized) {
      this.camera.position.set(targetX, targetY, targetZ);
      this.initialized = true;
    } else {
      const kPos = expSmooth(CAMERA.POS_SMOOTH, dt);
      this.camera.position.x += (targetX - this.camera.position.x) * kPos;
      this.camera.position.y += (targetY - this.camera.position.y) * kPos;
      this.camera.position.z += (targetZ - this.camera.position.z) * kPos;
    }

    // --- never sink below the terrain ---
    const minY =
      this.hf.heightAt(this.camera.position.x, this.camera.position.z) +
      CAMERA.MIN_GROUND_CLEARANCE;
    if (this.camera.position.y < minY) this.camera.position.y = minY;

    // --- look ahead along the smoothed forward ---
    this.lookTarget.set(
      car.x + fx * CAMERA.LOOK_AHEAD,
      car.y + CAMERA.LOOK_UP,
      car.z + fz * CAMERA.LOOK_AHEAD,
    );
    this.camera.lookAt(this.lookTarget);

    // --- speed-linked FOV, smoothed ---
    const speedFactor = clamp(car.speed / CAR.MAX_SPEED, 0, 1);
    const targetFov = CAMERA.FOV_BASE + speedFactor * CAMERA.FOV_SPEED_SPAN;
    this.fov += (targetFov - this.fov) * expSmooth(CAMERA.FOV_SMOOTH, dt);
    if (Math.abs(this.fov - this.camera.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
