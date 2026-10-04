/**
 * Car.ts — state + arcade physics (kinematic bicycle model, no physics engine).
 *
 * - Speed: a = throttle*ACCEL - brake*BRAKE - DRAG*v^2 - ROLL, clamped to
 *   [0, MAX_SPEED] (no reverse). Off-road multiplies drag.
 * - Cruise control (C): P controller holds CRUISE_DEFAULT; pedal input
 *   overrides and updates the target.
 * - Steering ramps in at 3.0/s and out at 4.0/s; max steer angle shrinks with
 *   speed (0.5 rad standing -> ~0.07 rad at MAX_SPEED). Heading rate =
 *   v/WHEELBASE * tan(delta), clamped by the lateral-accel cap so the car
 *   understeers instead of sliding.
 * - Road following: nearest centerline point each step (hinted). Beyond the
 *   soft wall the car is blended back to ±35 m and its heading toward the
 *   road tangent — never a hard stop.
 * - Ground following: heightAt at the 4 wheel contacts; y = average, pitch/roll
 *   from the differences plus cosmetic accel/lean, all smoothed with
 *   1 - exp(-k*dt).
 */

import { CAR, ROAD } from '../config.ts';
import type { NearestResult, RoadSample } from '../types.ts';
import { angleDelta, approach, clamp, expSmooth } from '../utils/math.ts';
import type { HeightField } from '../world/HeightField.ts';
import type { RoadGenerator } from '../world/RoadGenerator.ts';

export interface CarControls {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  left: boolean;
  right: boolean;
}

export class Car {
  // pose + motion
  x = 0;
  z = 0;
  heading = 0; // radians, 0 = facing -Z; positive = turned right
  speed = 0;
  /** Ramped steering command, -1 (left) .. +1 (right). */
  steer = 0;
  /** Actual steering angle this step (rad, + = right) — for the model. */
  steerAngle = 0;

  // road-relative state
  s = 0;
  lateral = 0;
  hintS = 0;
  offRoad = false;

  // visual state (smoothed)
  y = 0;
  pitch = 0;
  roll = 0;
  /** Longitudinal accel this step (m/s^2) — cosmetic body pitch. */
  accel = 0;
  /** Lateral accel this step (m/s^2) — cosmetic body roll. */
  latAccel = 0;

  cruise = false;
  cruiseTarget: number = CAR.CRUISE_DEFAULT;

  private readonly near: NearestResult = { s: 0, lateral: 0, dist: 0, roadY: 0 };
  private readonly roadSample: RoadSample = {
    s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
  };

  constructor(
    private readonly road: RoadGenerator,
    private readonly hf: HeightField,
  ) {
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    this.updateRoadState();
    this.y = this.groundAt(this.x, this.z);
  }

  toggleCruise(): void {
    this.cruise = !this.cruise;
    if (this.cruise && this.speed > 1) {
      // Engaging holds where you are unless you were below default cruise.
      this.cruiseTarget = Math.max(CAR.CRUISE_DEFAULT, this.speed);
    } else if (this.cruise) {
      this.cruiseTarget = CAR.CRUISE_DEFAULT;
    }
  }

  update(dt: number, c: CarControls): void {
    // --- steering input ramp ---
    const dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);
    this.steer =
      dir !== 0
        ? approach(this.steer, dir, CAR.STEER_RAMP_IN * dt)
        : approach(this.steer, 0, CAR.STEER_RAMP_OUT * dt);

    // --- where are we on the road? ---
    this.updateRoadState();

    // --- longitudinal (cruise control first) ---
    let throttle = clamp(c.throttle, 0, 1);
    let brake = clamp(c.brake, 0, 1);
    if (this.cruise) {
      if (throttle > 0) {
        this.cruiseTarget = Math.max(this.cruiseTarget, this.speed);
      } else if (brake > 0) {
        this.cruiseTarget = Math.min(this.cruiseTarget, this.speed);
      } else {
        // P controller + feedforward: the feedforward alone balances drag and
        // rolling resistance at the target, so there is no steady-state sag.
        const err = this.cruiseTarget - this.speed;
        const effDrag = CAR.DRAG * (this.offRoad ? CAR.OFFROAD_DRAG_MULT : 1);
        if (err >= 0) {
          const ff = (effDrag * this.speed * this.speed + CAR.ROLL) / CAR.ACCEL;
          throttle = clamp(err * CAR.CRUISE_KP + ff, 0, 1);
          brake = 0;
        } else {
          throttle = 0;
          brake = clamp(-err * CAR.CRUISE_BRAKE_KP, 0, 1);
        }
      }
    }

    let drag = CAR.DRAG;
    if (this.offRoad) drag *= CAR.OFFROAD_DRAG_MULT;

    let a = throttle * CAR.ACCEL - brake * CAR.BRAKE - drag * this.speed * this.speed;
    if (this.speed > 0.01) {
      a -= CAR.ROLL;
    } else if (a < 0) {
      a = 0; // never roll backwards
    }
    this.accel = a;
    this.speed = clamp(this.speed + a * dt, 0, CAR.MAX_SPEED);

    // --- steering angle -> heading rate (anti-slide lateral cap) ---
    const t = clamp(this.speed / CAR.MAX_SPEED, 0, 1);
    const falloff = (1 - t) * (1 - t); // smooth shrink with speed
    const maxSteer =
      CAR.MAX_STEER_HIGH + (CAR.MAX_STEER_LOW - CAR.MAX_STEER_HIGH) * falloff;
    const delta = this.steer * maxSteer;
    this.steerAngle = delta;

    let yawRate = (this.speed / CAR.WHEELBASE) * Math.tan(delta);
    const maxLat = CAR.MAX_LAT_ACCEL / Math.max(this.speed, 1);
    yawRate = clamp(yawRate, -maxLat, maxLat);
    this.latAccel = yawRate * this.speed;
    this.heading += yawRate * dt;

    // --- integrate position ---
    const fwdX = Math.sin(this.heading);
    const fwdZ = -Math.cos(this.heading);
    this.x += fwdX * this.speed * dt;
    this.z += fwdZ * this.speed * dt;

    // --- soft invisible wall ---
    if (Number.isFinite(this.near.dist)) {
      this.updateRoadState();
      const absLat = Math.abs(this.lateral);
      if (absLat > CAR.SOFT_WALL_DIST) {
        this.softWall(dt);
      }
    }

    // --- ground following (4 wheel contacts) ---
    this.followGround(dt, a);
  }

  private updateRoadState(): void {
    this.road.nearest(this.x, this.z, this.near, this.hintS);
    if (!Number.isFinite(this.near.dist)) return;
    this.s = this.near.s;
    this.lateral = this.near.lateral;
    this.hintS = this.near.s;
    this.offRoad = Math.abs(this.lateral) > ROAD.HALF_WIDTH + 0.5;
  }

  /**
   * Pull the car back toward ±SOFT_WALL_DIST along the road normal and blend
   * its heading toward the road tangent — soft, never a hard bounce.
   */
  private softWall(dt: number): void {
    const k = expSmooth(CAR.SOFT_WALL_BLEND, dt);
    const sign = this.lateral >= 0 ? 1 : -1;

    this.road.sampleAt(this.near.s, this.roadSample);
    // Right of travel for the sampled tangent: (-tz, tx).
    const rightX = -this.roadSample.tz;
    const rightZ = this.roadSample.tx;

    // Closest centerline point, then the point at exactly SOFT_WALL_DIST.
    const centerX = this.x - rightX * this.lateral;
    const centerZ = this.z - rightZ * this.lateral;
    const targetX = centerX + rightX * CAR.SOFT_WALL_DIST * sign;
    const targetZ = centerZ + rightZ * CAR.SOFT_WALL_DIST * sign;

    this.x += (targetX - this.x) * k;
    this.z += (targetZ - this.z) * k;

    const tangentHeading = Math.atan2(this.roadSample.tx, -this.roadSample.tz);
    this.heading += angleDelta(this.heading, tangentHeading) * k;
  }

  private followGround(dt: number, accel: number): void {
    const rightX = Math.cos(this.heading);
    const rightZ = Math.sin(this.heading);
    const fwdX = Math.sin(this.heading);
    const fwdZ = -Math.cos(this.heading);
    const halfTrack = CAR.TRACK_WIDTH / 2;
    const halfBase = CAR.WHEELBASE_VIS / 2;

    const fl = this.groundAt(
      this.x + rightX * -halfTrack + fwdX * halfBase,
      this.z + rightZ * -halfTrack + fwdZ * halfBase,
    );
    const fr = this.groundAt(
      this.x + rightX * halfTrack + fwdX * halfBase,
      this.z + rightZ * halfTrack + fwdZ * halfBase,
    );
    const rl = this.groundAt(
      this.x + rightX * -halfTrack + fwdX * -halfBase,
      this.z + rightZ * -halfTrack + fwdZ * -halfBase,
    );
    const rr = this.groundAt(
      this.x + rightX * halfTrack + fwdX * -halfBase,
      this.z + rightZ * halfTrack + fwdZ * -halfBase,
    );

    const yTarget = (fl + fr + rl + rr) / 4;
    const pitchTarget =
      Math.atan2((fl + fr) / 2 - (rl + rr) / 2, CAR.WHEELBASE_VIS) +
      accel * CAR.BODY_PITCH_GAIN;
    const rollTarget =
      Math.atan2((fr + rr) / 2 - (fl + rl) / 2, CAR.TRACK_WIDTH) +
      this.latAccel * CAR.BODY_ROLL_GAIN;

    const k = expSmooth(CAR.ORIENTATION_SMOOTH, dt);
    this.y += (yTarget - this.y) * k;
    this.pitch += (pitchTarget - this.pitch) * k;
    this.roll += (rollTarget - this.roll) * k;
  }

  private groundAt(x: number, z: number): number {
    return this.hf.heightAt(x, z);
  }
}
