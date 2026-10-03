/**
 * FreeFlyCamera.ts — dev-only free-fly camera.
 *
 * Hold the RIGHT mouse button to look around; `WASD` moves, `Q`/`E` go
 * down/up, `Shift` boosts. Used in Phase 1 before the chase camera exists and
 * kept afterwards as a debug tool (toggled with `B`).
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { clamp } from '../utils/math.ts';
import type { Input } from '../core/Input.ts';

const BASE_SPEED = 30; // m/s
const BOOST_FACTOR = 4;
const LOOK_SENSITIVITY = 0.0022; // rad per pixel
const MAX_PITCH = Math.PI / 2 - 0.01;

export class FreeFlyCamera {
  enabled = true;

  private yaw = 0;
  private pitch = 0;
  private looking = false;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();

  private readonly onContextMenu = (e: MouseEvent): void => e.preventDefault();
  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 2) {
      this.looking = true;
      e.preventDefault();
    }
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.looking = false;
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.looking || !this.enabled) return;
    this.yaw -= e.movementX * LOOK_SENSITIVITY;
    this.pitch = clamp(
      this.pitch - e.movementY * LOOK_SENSITIVITY,
      -MAX_PITCH,
      MAX_PITCH,
    );
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
    private readonly input: Input,
  ) {
    dom.addEventListener('contextmenu', this.onContextMenu);
    dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  update(dt: number): void {
    if (!this.enabled || dt <= 0) return;

    const boost = this.input.isDown('boost') ? BOOST_FACTOR : 1;
    const speed = BASE_SPEED * boost * dt;

    // Forward follows the look direction; strafe stays horizontal.
    const cp = Math.cos(this.pitch);
    this.forward.set(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp,
    );
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.input.isDown('throttle')) {
      this.camera.position.addScaledVector(this.forward, speed);
    }
    if (this.input.isDown('brake')) {
      this.camera.position.addScaledVector(this.forward, -speed);
    }
    if (this.input.isDown('right')) {
      this.camera.position.addScaledVector(this.right, speed);
    }
    if (this.input.isDown('left')) {
      this.camera.position.addScaledVector(this.right, -speed);
    }
    if (this.input.isDown('up')) this.camera.position.y += speed;
    if (this.input.isDown('down')) this.camera.position.y -= speed;

    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  dispose(): void {
    // Window-level listeners are removed by the owner; canvas listeners die
    // with the canvas element itself.
  }
}
