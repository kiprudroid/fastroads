/**
 * CarModel.ts — low-poly car built from Three primitives (no assets).
 *
 * Box body (pastel), smaller cabin (dark glass), 4 cylinder wheels that spin
 * with speed and visibly steer up front, small emissive tail lights,
 * flat-shaded. ~1.8 m wide, 4.2 m long. One group, a handful of draw calls.
 *
 * The group's world transform (position, yaw = -heading, cosmetic pitch/roll)
 * is owned by Game; this class only animates the wheels and exposes dispose().
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { CAR } from '../config.ts';
import { Palette } from '../world/Palette.ts';

interface Wheel {
  /** Front wheels get steering rotation on this pivot. */
  pivot: Group;
  spin: Mesh;
  front: boolean;
}

export class CarModel {
  readonly group = new Group();

  private readonly wheels: Wheel[] = [];
  private readonly bodyMaterial: MeshLambertMaterial;
  private readonly cabinMaterial: MeshLambertMaterial;
  private readonly wheelMaterial: MeshLambertMaterial;
  private readonly lightMaterial: MeshLambertMaterial;
  private readonly geometries: Array<BoxGeometry | CylinderGeometry> = [];

  private spinAngle = 0;

  constructor() {
    this.bodyMaterial = new MeshLambertMaterial({
      color: Palette.carBody,
      flatShading: true,
    });
    this.cabinMaterial = new MeshLambertMaterial({
      color: 0x39434e,
      flatShading: true,
    });
    this.wheelMaterial = new MeshLambertMaterial({
      color: 0x24262a,
      flatShading: true,
    });
    this.lightMaterial = new MeshLambertMaterial({
      color: 0x8a1f16,
      emissive: 0xd84a34,
      flatShading: true,
    });

    const wheelY = CAR.WHEEL_RADIUS;
    const bodyY = wheelY + 0.05 + CAR.BODY_HEIGHT / 2;

    // --- body ---
    const bodyGeo = new BoxGeometry(
      CAR.BODY_WIDTH,
      CAR.BODY_HEIGHT,
      CAR.BODY_LENGTH,
    );
    this.geometries.push(bodyGeo);
    const body = new Mesh(bodyGeo, this.bodyMaterial);
    body.position.y = bodyY;
    this.group.add(body);

    // --- cabin (slightly toward the front; car faces -Z) ---
    const cabinGeo = new BoxGeometry(
      CAR.CABIN_WIDTH,
      CAR.CABIN_HEIGHT,
      CAR.CABIN_LENGTH,
    );
    this.geometries.push(cabinGeo);
    const cabin = new Mesh(cabinGeo, this.cabinMaterial);
    cabin.position.set(0, bodyY + CAR.BODY_HEIGHT / 2 + CAR.CABIN_HEIGHT / 2 - 0.04, CAR.CABIN_OFFSET_Z);
    this.group.add(cabin);

    // --- wheels ---
    const wheelGeo = new CylinderGeometry(
      CAR.WHEEL_RADIUS,
      CAR.WHEEL_RADIUS,
      CAR.WHEEL_WIDTH,
      12,
    );
    wheelGeo.rotateZ(Math.PI / 2); // axle along X
    this.geometries.push(wheelGeo);
    const halfTrack = CAR.TRACK_WIDTH / 2;
    const halfBase = CAR.WHEELBASE_VIS / 2;
    for (const front of [true, false]) {
      for (const side of [-1, 1]) {
        const pivot = new Group();
        pivot.position.set(side * halfTrack, wheelY, front ? -halfBase : halfBase);
        const wheel = new Mesh(wheelGeo, this.wheelMaterial);
        pivot.add(wheel);
        this.group.add(pivot);
        this.wheels.push({ pivot, spin: wheel, front });
      }
    }

    // --- tail lights (rear = +Z) ---
    const lightGeo = new BoxGeometry(0.28, 0.1, 0.06);
    this.geometries.push(lightGeo);
    for (const side of [-1, 1]) {
      const light = new Mesh(lightGeo, this.lightMaterial);
      light.position.set(
        side * (CAR.BODY_WIDTH / 2 - 0.22),
        bodyY + 0.05,
        CAR.BODY_LENGTH / 2 + 0.02,
      );
      this.group.add(light);
    }
  }

  /**
   * @param speed m/s (wheel spin)
   * @param steerAngle front wheel steering angle (rad, + = right)
   */
  update(dt: number, speed: number, steerAngle: number): void {
    this.spinAngle += (speed * dt) / CAR.WHEEL_RADIUS;
    for (const wheel of this.wheels) {
      wheel.spin.rotation.x = this.spinAngle;
      if (wheel.front) wheel.pivot.rotation.y = -steerAngle;
    }
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    this.bodyMaterial.dispose();
    this.cabinMaterial.dispose();
    this.wheelMaterial.dispose();
    this.lightMaterial.dispose();
    this.group.clear();
  }
}
