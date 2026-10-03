/**
 * Sky.ts — gradient sky dome + sun, fog setup, lights.
 *
 * The dome is a large BackSide sphere with a custom ShaderMaterial:
 * a vertical gradient (horizon -> zenith) plus a soft sun glow toward the
 * sun direction. No textures. It follows the camera every frame so it is
 * effectively infinitely far away.
 *
 * Fog is linear THREE.Fog whose color equals the horizon color, so distant
 * terrain dissolves into the sky seamlessly. Fog near/far derive from
 * VIEW_RADIUS so tile edges are always fully hidden before they pop in.
 */

import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  SphereGeometry,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { SKY, TERRAIN } from '../config.ts';

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uGradientPower;
uniform float uGlowSize;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);

  // Vertical gradient: horizon -> zenith (nothing below the horizon line).
  float up = clamp(dir.y, 0.0, 1.0);
  float t = pow(up, uGradientPower);
  vec3 col = mix(uHorizon, uZenith, t);

  // Soft warm glow around the sun direction.
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  float glow = pow(sd, 1.0 / max(uGlowSize, 0.001));
  col += uSunColor * glow * 0.22;
  // Tight core so the sun reads as a bright spot.
  col += uSunColor * pow(sd, 600.0) * 0.6;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: Mesh;
  private readonly scene: Scene;
  private readonly sun: DirectionalLight;
  private readonly hemi: HemisphereLight;
  private readonly material: ShaderMaterial;
  private readonly geometry: SphereGeometry;
  private readonly sunDir: Vector3;

  constructor(scene: Scene, farPlane: number) {
    this.scene = scene;
    this.sunDir = new Vector3(...SKY.SUN_DIR).normalize();

    // --- fog (shared with every fogged material) ---
    scene.fog = new Fog(
      new Color(SKY.HORIZON),
      TERRAIN.VIEW_RADIUS * TERRAIN.FOG_NEAR_FACTOR,
      TERRAIN.VIEW_RADIUS * TERRAIN.FOG_FAR_FACTOR,
    );

    // --- lights (no shadows by default; soft and flat) ---
    this.sun = new DirectionalLight(SKY.SUN, SKY.SUN_INTENSITY);
    this.sun.position.copy(this.sunDir).multiplyScalar(1000);
    scene.add(this.sun);

    this.hemi = new HemisphereLight(SKY.HEMI_SKY, SKY.HEMI_GROUND, SKY.HEMI_INTENSITY);
    scene.add(this.hemi);

    // --- dome ---
    this.material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Color(SKY.ZENITH) },
        uHorizon: { value: new Color(SKY.HORIZON) },
        uSunColor: { value: new Color(SKY.SUN) },
        uSunDir: { value: this.sunDir.clone() },
        uGradientPower: { value: SKY.GRADIENT_POWER },
        uGlowSize: { value: SKY.SUN_GLOW_SIZE },
      },
    });
    this.geometry = new SphereGeometry(farPlane * SKY.DOME_FAR_FACTOR, 32, 16);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1; // draw first; depth test still hides it behind terrain
    scene.add(this.mesh);
  }

  /** Update fog range when quality (view radius) changes. */
  setViewRadius(viewRadius: number): void {
    const fog = this.scene.fog;
    if (fog instanceof Fog) {
      fog.near = viewRadius * TERRAIN.FOG_NEAR_FACTOR;
      fog.far = viewRadius * TERRAIN.FOG_FAR_FACTOR;
    }
  }

  /** The dome follows the camera so it never moves relative to the viewer. */
  update(cameraPosition: Vector3): void {
    this.mesh.position.copy(cameraPosition);
  }

  dispose(): void {
    this.scene.remove(this.mesh, this.sun, this.hemi);
    this.geometry.dispose();
    this.material.dispose();
  }
}
