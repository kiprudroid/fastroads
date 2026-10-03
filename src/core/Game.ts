/**
 * Game.ts — owns renderer, scene, systems; update/render orchestration.
 *
 * Frame flow:
 *   1. Loop runs fixed physics steps (1/60 s, accumulator, max 5/frame,
 *      frame dt clamped to 0.1 s, auto-pause while hidden/blurred).
 *   2. Physics step: Input -> Car.update(dt).        (phase 5+)
 *   3. Render frame: world streaming -> camera -> sky follows -> HUD (~10 Hz)
 *      -> render -> quality sample -> debug stats.
 *   4. Quality adapts the pixel ratio from frame times.
 *
 * Phase 1: renderer + loop + sky + debug stats + free-fly debug camera over a
 * temporary flat ground plane.
 */

import {
  Color,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { CAMERA, QUALITY_PRESETS, SKY, TERRAIN } from '../config.ts';
import type { QualityLevel } from '../types.ts';
import { Input } from './Input.ts';
import { Loop } from './Loop.ts';
import { Quality, resolveQualityLevel } from './Quality.ts';
import { Sky } from '../world/Sky.ts';
import { Palette } from '../world/Palette.ts';
import { DebugStats } from '../debug/DebugStats.ts';
import { FreeFlyCamera } from '../debug/FreeFlyCamera.ts';

export interface GameOptions {
  seed: number;
  qualityLevel?: QualityLevel;
  autopilot?: boolean;
  debugRoad?: boolean;
}

const CAMERA_NEAR = 0.1;
const TEMP_GROUND_SIZE = 3000; // phase 3 replaces this with terrain tiles

export class Game {
  readonly seed: number;
  readonly input: Input;

  private readonly root: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly sky: Sky;
  private readonly loop: Loop;
  private readonly quality: Quality;
  private readonly debugStats: DebugStats;
  private readonly freeCam: FreeFlyCamera;
  private readonly tempGround: Mesh;

  // fps / stats sampling
  private fpsFrames = 0;
  private fpsElapsed = 0;
  private fps = 0;

  private disposed = false;

  constructor(root: HTMLElement, opts: GameOptions) {
    this.root = root;
    this.seed = opts.seed;
    this.input = new Input();

    const far = TERRAIN.VIEW_RADIUS * CAMERA.FAR_FACTOR;
    const level = opts.qualityLevel ?? resolveQualityLevel();

    // Antialias is fixed at construction; rebuilding the renderer on a
    // quality change is handled in phase 8.
    this.renderer = new WebGLRenderer({
      antialias: QUALITY_PRESETS[level].antialias,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(new Color(SKY.HORIZON), 1);
    this.renderer.domElement.style.display = 'block';
    root.appendChild(this.renderer.domElement);

    this.quality = new Quality(this.renderer, level);

    this.camera = new PerspectiveCamera(
      CAMERA.FOV_BASE,
      1,
      CAMERA_NEAR,
      far,
    );
    this.camera.position.set(0, 6, 10);

    this.sky = new Sky(this.scene, far);

    // Temporary flat ground until phase 3 (terrain tiles).
    const groundGeo = new PlaneGeometry(TEMP_GROUND_SIZE, TEMP_GROUND_SIZE, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    this.tempGround = new Mesh(groundGeo, new MeshLambertMaterial({ color: Palette.grassMid }));
    this.scene.add(this.tempGround);

    this.debugStats = new DebugStats(root);
    this.freeCam = new FreeFlyCamera(this.camera, this.renderer.domElement, this.input);

    this.loop = new Loop(this.step, this.frame);

    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  start(): void {
    // Paint one frame synchronously so the player (and any screenshot) never
    // sees an empty canvas before the first rAF fires.
    this.sky.update(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.loop.start();
  }

  // -------------------------------------------------------------------------
  // Fixed physics step (1/60 s)
  // -------------------------------------------------------------------------
  private readonly step = (_dt: number): void => {
    // phase 5+: Input -> Car.update(dt)
  };

  // -------------------------------------------------------------------------
  // Render frame
  // -------------------------------------------------------------------------
  private readonly frame = (dt: number): void => {
    this.handleActions();

    if (!this.loop.paused && this.freeCam.enabled) {
      this.freeCam.update(dt);
    }

    this.sky.update(this.camera.position);
    this.renderer.render(this.scene, this.camera);

    // --- stats (after render so info reflects this frame) ---
    const now = performance.now();
    this.fpsFrames++;
    this.fpsElapsed += dt;
    if (this.fpsElapsed >= 0.5) {
      this.fps = this.fpsFrames / this.fpsElapsed;
      this.fpsFrames = 0;
      this.fpsElapsed = 0;
    }
    this.quality.sampleFrame(dt * 1000);
    const info = this.renderer.info;
    this.debugStats.update(
      {
        fps: this.fps,
        frameMs: dt * 1000,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        activeTiles: 0, // phase 3+
        roadSamples: 0, // phase 2+
        pixelRatio: this.quality.pixelRatio,
      },
      now,
    );

    this.input.endFrame();
  };

  private handleActions(): void {
    if (this.input.consume('debugStats')) this.debugStats.toggle();

    if (this.input.consume('pause')) {
      this.loop.setUserPaused(!this.loop.paused);
    }
  }

  // -------------------------------------------------------------------------
  // Resize
  // -------------------------------------------------------------------------
  private readonly onResize = (): void => {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    window.removeEventListener('resize', this.onResize);
    this.sky.dispose();
    this.tempGround.geometry.dispose();
    (this.tempGround.material as MeshLambertMaterial).dispose();
    this.freeCam.dispose();
    this.debugStats.dispose();
    this.input.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
