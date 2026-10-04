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
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { CAMERA, DEBUG, QUALITY_PRESETS, ROAD, SKY, TERRAIN } from '../config.ts';
import type { QualityLevel } from '../types.ts';
import { Input } from './Input.ts';
import { Loop } from './Loop.ts';
import { Quality, resolveQualityLevel } from './Quality.ts';
import { Sky } from '../world/Sky.ts';
import { RoadGenerator } from '../world/RoadGenerator.ts';
import { HeightField } from '../world/HeightField.ts';
import { Terrain } from '../world/Terrain.ts';
import { RoadMesh } from '../world/RoadMesh.ts';
import { DebugStats } from '../debug/DebugStats.ts';
import { FreeFlyCamera } from '../debug/FreeFlyCamera.ts';
import { RoadPlot } from '../debug/RoadPlot.ts';
import { Autopilot } from '../debug/Autopilot.ts';
import type { NearestResult } from '../types.ts';

export interface GameOptions {
  seed: number;
  qualityLevel?: QualityLevel;
  autopilot?: boolean;
  debugRoad?: boolean;
}

const CAMERA_NEAR = 0.1;

export class Game {
  readonly seed: number;
  readonly input: Input;
  readonly road: RoadGenerator;

  private readonly root: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly sky: Sky;
  private readonly loop: Loop;
  private readonly quality: Quality;
  private readonly debugStats: DebugStats;
  private readonly freeCam: FreeFlyCamera;
  private readonly roadPlot: RoadPlot | null;
  private readonly terrain: Terrain;
  private readonly roadMesh: RoadMesh;
  private readonly autopilot: Autopilot | null;
  /** Arc length the viewer (car, later) is at — drives world streaming. */
  private viewerS = 0;
  private readonly viewerNearest: NearestResult = {
    s: 0,
    lateral: 0,
    dist: 0,
    roadY: 0,
  };

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

    this.debugStats = new DebugStats(root);
    this.freeCam = new FreeFlyCamera(this.camera, this.renderer.domElement, this.input);

    // --- world (road is the master structure; everything derives from it) ---
    this.road = new RoadGenerator(opts.seed);
    this.roadPlot = opts.debugRoad === true ? new RoadPlot(root, this.road) : null;
    this.road.ensureAhead(
      TERRAIN.VIEW_RADIUS + ROAD.LOOKAHEAD_MARGIN,
    );
    const heightField = new HeightField(opts.seed, this.road);
    this.terrain = new Terrain(this.scene, heightField, level);
    this.roadMesh = new RoadMesh(
      this.scene,
      this.road,
      opts.seed,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.autopilot = opts.autopilot === true ? new Autopilot(this.road) : null;
    if (this.autopilot !== null) this.freeCam.enabled = false;

    // Synchronous first build so the player never starts in a void.
    this.terrain.buildInitial(this.camera.position.x, this.camera.position.z);

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

    if (!this.loop.paused) {
      // --- camera source: autopilot (dev) or free-fly ---
      if (this.autopilot !== null) {
        this.autopilot.updateCamera(this.camera, dt);
      } else if (this.freeCam.enabled) {
        this.freeCam.update(dt);
      }

      // --- viewer's position on the road drives all streaming ---
      const cam = this.camera.position;
      this.road.nearest(cam.x, cam.z, this.viewerNearest, this.viewerS);
      if (Number.isFinite(this.viewerNearest.dist)) {
        this.viewerS = this.viewerNearest.s;
      }

      this.road.ensureAhead(
        Math.max(
          this.viewerS + TERRAIN.VIEW_RADIUS + ROAD.LOOKAHEAD_MARGIN,
          this.roadPlot !== null ? DEBUG.ROAD_PLOT_LENGTH : 0,
        ),
      );

      this.terrain.update(cam.x, cam.z);
      this.roadMesh.update(this.viewerS);

      // Trim AFTER eviction: keep samples for every active tile (they can sit
      // up to VIEW_RADIUS + TILE_SIZE behind the viewer), plus TRIM_BEHIND.
      this.road.trim(
        this.viewerS -
          Math.max(
            0,
            TERRAIN.VIEW_RADIUS + TERRAIN.TILE_SIZE - ROAD.TRIM_BEHIND,
          ),
      );
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
        activeTiles: this.terrain.tileCount,
        roadSamples: this.road.sampleCount,
        pixelRatio: this.quality.pixelRatio,
      },
      now,
    );

    if (this.roadPlot !== null) this.roadPlot.update(now);

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
    this.roadMesh.dispose();
    this.terrain.dispose();
    this.freeCam.dispose();
    this.debugStats.dispose();
    this.roadPlot?.dispose();
    this.input.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
