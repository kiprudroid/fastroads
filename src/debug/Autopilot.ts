/**
 * Autopilot.ts — drives the car along the road with no input (`?autopilot=1`).
 *
 * Purely a driver: aims at a point on the centerline ahead of the car, turns
 * with a proportional heading controller (the Car's own steering ramp smooths
 * it), and holds CRUISE_DEFAULT longitudinally. No scenery collisions exist,
 * so staying on the road is the whole job.
 */

import { AUTOPILOT, CAR } from '../config.ts';
import type { RoadGenerator } from '../world/RoadGenerator.ts';
import type { RoadSample } from '../types.ts';
import type { Car, CarControls } from '../vehicle/Car.ts';
import { angleDelta, clamp } from '../utils/math.ts';

export class Autopilot {
  private readonly target: RoadSample = {
    s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
  };
  private readonly controls: CarControls = {
    throttle: 0,
    brake: 0,
    left: false,
    right: false,
  };

  constructor(private readonly road: RoadGenerator) {}

  /** One physics step: compute controls and drive the car. */
  drive(car: Car, dt: number): void {
    // Aim point: centerline ahead, looked at seconds-of-travel ahead.
    const look =
      AUTOPILOT.LOOKAHEAD_BASE + car.speed * AUTOPILOT.LOOKAHEAD_PER_MS;
    this.road.sampleAt(car.s + look, this.target);

    const dx = this.target.x - car.x;
    const dz = this.target.z - car.z;
    const desired = Math.atan2(dx, -dz);
    const yawRate = car.latAccel / Math.max(car.speed, 1);
    const err =
      angleDelta(car.heading, desired) - yawRate * AUTOPILOT.DAMPING;
    const steer = clamp(err * AUTOPILOT.HEADING_GAIN, -1, 1);

    const speedErr = CAR.CRUISE_DEFAULT - car.speed;
    if (speedErr >= 0) {
      // Feedforward balances drag/rolling resistance at the target so the
      // P term only has to close transients (no steady-state sag).
      const effDrag = CAR.DRAG * (car.offRoad ? CAR.OFFROAD_DRAG_MULT : 1);
      const ff = (effDrag * car.speed * car.speed + CAR.ROLL) / CAR.ACCEL;
      this.controls.throttle = clamp(
        speedErr * AUTOPILOT.SPEED_KP + ff,
        0,
        1,
      );
      this.controls.brake = 0;
    } else if (speedErr < -AUTOPILOT.SPEED_TOLERANCE) {
      this.controls.throttle = 0;
      this.controls.brake = clamp(
        -speedErr * AUTOPILOT.BRAKE_KP,
        0,
        1,
      );
    } else {
      // Within tolerance: coast.
      this.controls.throttle = 0;
      this.controls.brake = 0;
    }
    this.controls.left = steer < -0.02;
    this.controls.right = steer > 0.02;

    car.update(dt, this.controls);
  }
}
