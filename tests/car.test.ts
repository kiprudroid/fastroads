/**
 * car.test.ts — pure-logic tests for the arcade car physics and the
 * autopilot driver. The headline test is the spec's acceptance criterion:
 * the car stays on the road under autopilot for 10+ minutes of simulated
 * driving. No DOM, no WebGL.
 */

import { describe, expect, test } from 'bun:test';
import { RoadGenerator } from '../src/world/RoadGenerator.ts';
import { HeightField } from '../src/world/HeightField.ts';
import { Car, type CarControls } from '../src/vehicle/Car.ts';
import { Autopilot } from '../src/debug/Autopilot.ts';
import { CAR, ROAD } from '../src/config.ts';
import { angleDelta } from '../src/utils/math.ts';
import type { RoadSample } from '../src/types.ts';

const DT = 1 / 60;

function makeCar(seed: number): {
  car: Car;
  autopilot: Autopilot;
  road: RoadGenerator;
} {
  const road = new RoadGenerator(seed);
  road.ensureAhead(3000);
  const hf = new HeightField(seed, road);
  const car = new Car(road, hf);
  const autopilot = new Autopilot(road);
  return { car, autopilot, road };
}

const IDLE: CarControls = { throttle: 0, brake: 0, left: false, right: false };

const aim: RoadSample = {
  s: 0, x: 0, y: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0, curvature: 0,
};

/**
 * Minimal center-follower for manual-driving tests (the autopilot owns the
 * speed controller, so tests that need full throttle steer themselves).
 * Keeps the car on the road while the test only worries about speed.
 */
function steerToCenter(car: Car, road: RoadGenerator, c: CarControls): void {
  road.sampleAt(car.s + 12 + car.speed * 0.6, aim);
  const desired = Math.atan2(aim.tx, -aim.tz);
  const err = angleDelta(car.heading, desired) - car.lateral * 0.03;
  c.right = err > 0.01;
  c.left = err < -0.01;
}

/** Keep the road generated a few km ahead of the car (like Game does). */
function keepRoadAhead(car: Car, road: RoadGenerator): void {
  road.ensureAhead(car.s + 4000);
}

describe('Car physics', () => {
  test('accelerates and clamps at MAX_SPEED', () => {
    const { car, road } = makeCar(1);
    const full: CarControls = { ...IDLE, throttle: 1 };
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 120 === 0) keepRoadAhead(car, road);
      steerToCenter(car, road, full);
      car.update(DT, full);
    }
    expect(car.offRoad).toBe(false);
    expect(car.speed).toBeGreaterThan(CAR.MAX_SPEED - 1);
    expect(car.speed).toBeLessThanOrEqual(CAR.MAX_SPEED);
  });

  test('never reverses and brakes to a stop', () => {
    const { car } = makeCar(2);
    const full: CarControls = { ...IDLE, throttle: 1 };
    for (let i = 0; i < 60 * 5; i++) car.update(DT, full);
    const brake: CarControls = { ...IDLE, brake: 1 };
    for (let i = 0; i < 60 * 20; i++) car.update(DT, brake);
    expect(car.speed).toBe(0);
    expect(car.z).not.toBeGreaterThan(0.0001); // still moved forward (-z), never back
  });

  test('cruise control holds the target speed', () => {
    const { car, road } = makeCar(3);
    car.toggleCruise();
    expect(car.cruise).toBe(true);
    const c: CarControls = { ...IDLE };
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 120 === 0) keepRoadAhead(car, road);
      steerToCenter(car, road, c);
      car.update(DT, c);
    }
    expect(car.offRoad).toBe(false);
    expect(car.speed).toBeGreaterThan(CAR.CRUISE_DEFAULT - 1);
    expect(car.speed).toBeLessThan(CAR.CRUISE_DEFAULT + 1);
  });

  test('steering input ramps (no instant lock)', () => {
    const { car } = makeCar(4);
    const turn: CarControls = { ...IDLE, right: true };
    car.update(DT, turn);
    expect(Math.abs(car.steer)).toBeLessThanOrEqual(CAR.STEER_RAMP_IN * DT + 1e-9);
    expect(car.steer).toBeGreaterThan(0);
    // Returns toward 0 when released.
    for (let i = 0; i < 60; i++) car.update(DT, IDLE);
    expect(Math.abs(car.steer)).toBeLessThan(0.01);
  });

  test('soft wall contains a car that never steers', () => {
    const { car, road } = makeCar(5);
    const full: CarControls = { ...IDLE, throttle: 1 };
    let maxLateral = 0;
    for (let i = 0; i < 60 * 120; i++) {
      if (i % 120 === 0) keepRoadAhead(car, road);
      car.update(DT, full); // no steering at all — road wanders away
      if (Math.abs(car.lateral) > maxLateral) maxLateral = Math.abs(car.lateral);
    }
    // Contained by the soft wall, never launched into the world.
    expect(maxLateral).toBeLessThan(CAR.SOFT_WALL_DIST + 2);
    expect(car.s).toBeGreaterThan(1000); // still progressed along the road
  });

  test('off-road costs top speed', () => {
    // Full throttle straight off the road (no steering) until drag settles…
    const { car: off, road: roadOff } = makeCar(6);
    const fullOff: CarControls = { ...IDLE, throttle: 1 };
    for (let i = 0; i < 60 * 120; i++) {
      if (i % 120 === 0) keepRoadAhead(off, roadOff);
      off.update(DT, fullOff);
    }
    // …versus full throttle WITH steering, staying on the asphalt.
    const { car: on, road: roadOn } = makeCar(6);
    const fullOn: CarControls = { ...IDLE, throttle: 1 };
    for (let i = 0; i < 60 * 60; i++) {
      if (i % 120 === 0) keepRoadAhead(on, roadOn);
      steerToCenter(on, roadOn, fullOn);
      on.update(DT, fullOn);
    }
    expect(on.offRoad).toBe(false);
    expect(off.offRoad).toBe(true);
    expect(off.speed).toBeLessThan(on.speed * 0.7);
  });

  test('deterministic: identical inputs give identical states', () => {
    const a = makeCar(7);
    const b = makeCar(7);
    const input: CarControls = { throttle: 1, brake: 0, left: false, right: true };
    for (let i = 0; i < 600; i++) {
      a.car.update(DT, input);
      b.car.update(DT, input);
    }
    expect(a.car.x).toBe(b.car.x);
    expect(a.car.z).toBe(b.car.z);
    expect(a.car.speed).toBe(b.car.speed);
    expect(a.car.s).toBe(b.car.s);
    expect(a.car.y).toBe(b.car.y);
  });

  test('car sits at road elevation minus embed at the start', () => {
    const { car } = makeCar(8);
    expect(car.y).toBeGreaterThan(-3);
    expect(car.y).toBeLessThan(3);
    expect(Math.abs(car.lateral)).toBeLessThan(ROAD.HALF_WIDTH);
  });
});

describe('Autopilot', () => {
  test('stays on the road for 10+ minutes of simulated driving', () => {
    const { car, autopilot, road } = makeCar(42);
    const minutes = 10;
    const steps = Math.ceil((minutes * 60) / DT);
    let maxLateral = 0;
    let minSpeed = Infinity;

    for (let i = 0; i < steps; i++) {
      if (i % 300 === 0) keepRoadAhead(car, road); // stream like Game does
      autopilot.drive(car, DT);
      if (i > 600 && i % 30 === 0) { // skip the launch from standstill
        const abs = Math.abs(car.lateral);
        if (abs > maxLateral) maxLateral = abs;
        if (car.speed < minSpeed) minSpeed = car.speed;
      }
    }

    const expectedDistance = CAR.CRUISE_DEFAULT * minutes * 60;
    expect(car.s).toBeGreaterThan(expectedDistance * 0.9);
    expect(maxLateral).toBeLessThan(5); // tracks the centerline closely
    expect(minSpeed).toBeGreaterThan(CAR.CRUISE_DEFAULT - 3); // no stalling
    expect(car.offRoad).toBe(false);
  }, 60_000);

  test('road coverage follows the autopilot (ensureAhead pattern)', () => {
    const { car, autopilot, road } = makeCar(99);
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 300 === 0) keepRoadAhead(car, road);
      autopilot.drive(car, DT);
    }
    expect(car.hintS).toBeGreaterThan(500);
    expect(car.s).toBeGreaterThan(500);
  });
});
