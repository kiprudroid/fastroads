/**
 * Autopilot.ts — drives along the road with no input.
 *
 * Phase 3: moves the debug camera along the centerline (`?autopilot=1`) so
 * terrain streaming can be verified without a car. Phase 5 adds `drive()`
 * mode, which computes throttle/steering for the real Car instead.
 */

import { Vector3 } from 'three';
import { CAMERA, CAR, ROAD } from '../config.ts';
import type { RoadGenerator } from '../world/RoadGenerator.ts';
import type { RoadSample } from '../types.ts';

export class Autopilot {
  /** Simulated arc length along the road (camera mode). */
  s = 0;
  /** Cruise speed (m/s). */
  speed = CAR.CRUISE_DEFAULT;

  private readonly camPt: RoadSample = {
    s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
  };
  private readonly lookPt: RoadSample = {
    s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
  };

  private readonly lookTarget = new Vector3();

  constructor(private readonly road: RoadGenerator) {}

  /** Phase 3: follow the centerline with a chase-camera-like offset. */
  updateCamera(
    camera: {
      position: { set(x: number, y: number, z: number): void };
      lookAt(v: Vector3): void;
    },
    dt: number,
  ): void {
    this.s += this.speed * dt;
    this.road.ensureAhead(this.s + CAMERA.LOOK_AHEAD + 50);

    // Camera sits CAMERA.BACK behind the virtual car point...
    this.road.sampleAt(this.s - CAMERA.BACK, this.camPt);
    // ...and looks CAMERA.LOOK_AHEAD ahead.
    this.road.sampleAt(this.s + CAMERA.LOOK_AHEAD, this.lookPt);

    camera.position.set(
      this.camPt.x,
      this.camPt.y + CAMERA.UP,
      this.camPt.z,
    );
    this.lookTarget.set(
      this.lookPt.x,
      this.lookPt.y + CAMERA.LOOK_UP,
      this.lookPt.z,
    );
    camera.lookAt(this.lookTarget);
  }

  /** Phase 5 will use this: keep the s used for road coverage ahead. */
  get roadHorizon(): number {
    return this.s + ROAD.LOOKAHEAD_MARGIN;
  }
}
