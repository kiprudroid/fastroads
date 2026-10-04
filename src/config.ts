/**
 * config.ts — ALL tunable constants live here.
 *
 * Nothing else in the codebase should contain a magic number that describes
 * the world, the car, the camera or performance budgets. If you need to tune
 * the game, tune it here.
 *
 * Units: meters, seconds, radians (unless a name says otherwise).
 */

import type { QualityLevel } from './types.ts';

// ---------------------------------------------------------------------------
// Road centerline (the master spline)
// ---------------------------------------------------------------------------
export const ROAD = {
  /** Half-width of the asphalt carriageway (8 m total). */
  HALF_WIDTH: 4.0,
  /** Flat verge beyond the road edge before hills start. */
  SHOULDER: 1.5,
  /** Distance over which terrain blends from road-flat to hills. */
  BLEND_DISTANCE: 55,
  /** Centerline sample spacing (arc length, meters). */
  SAMPLE_SPACING: 2,

  /** Bounded heading amplitude (radians from initial -Z direction). */
  HEADING_AMP: 1.0, // ~57 deg
  /** Wavelengths (meters) of the two heading noise octaves. */
  HEADING_WAVE_LONG: 1400,
  HEADING_WAVE_SHORT: 500,
  /** Relative weights of the two heading octaves (must roughly sum to 1). */
  HEADING_W_LONG: 0.65,
  HEADING_W_SHORT: 0.35,

  /** Elevation amplitudes (meters). */
  GRADE_WAVE_LONG: 18,
  GRADE_WAVE_SHORT: 4,
  /** Wavelengths (meters) of the elevation fbm octaves. */
  GRADE_WAVE_LEN_LONG: 700,
  GRADE_WAVE_LEN_SHORT: 250,
  /** fbm octaves for the elevation profile. */
  GRADE_OCTAVES: 3,
  /** Hard cap on absolute road grade (slope) — enforced by clamping. */
  MAX_GRADE: 0.07, // 7%

  /** Keep at least this much road behind the car before trimming. */
  TRIM_BEHIND: 400,
  /** Generate this much road beyond the view radius. */
  LOOKAHEAD_MARGIN: 300,
  /** Local-search window (samples) around the previous s for the car. */
  HINT_WINDOW: 10,
} as const;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
export const TERRAIN = {
  /** World-aligned terrain tile edge length (m). */
  TILE_SIZE: 64,
  /** Segments per tile edge (per-quality preset overrides this). */
  TILE_SEGMENTS: 16,
  /** Circle radius (m) within which tiles exist around the car. */
  VIEW_RADIUS: 640,
  /** Fog hides tile edges before they pop in. */
  FOG_NEAR_FACTOR: 0.3, // x VIEW_RADIUS
  FOG_FAR_FACTOR: 0.92, // x VIEW_RADIUS
  /** Max tiles built per frame, nearest-first. */
  TILES_PER_FRAME_BUDGET: 2,
  /** Evict tiles beyond VIEW_RADIUS + this many tiles. */
  EVICT_SLACK_TILES: 1,
  /** First-frame synchronous build radius (m). */
  INITIAL_BUILD_RADIUS: 200,

  // heightAt composition
  HILL_WAVE_LONG: 320,
  HILL_WAVE_LONG_AMP: 45,
  HILL_OCTAVES_LONG: 4,
  HILL_WAVE_SHORT: 90,
  HILL_WAVE_SHORT_AMP: 4,
  HILL_OCTAVES_SHORT: 2,
  /** Drop ground slightly under the carriageway so the ribbon never fights it. */
  ROAD_EMBED: 0.15,
  /** Finite-difference epsilon for normalAt. */
  NORMAL_EPS: 1.0,
  /**
   * Neighbor samples may reuse a previous nearest-road search (hint) when the
   * result is within this tolerance (m) of the hinted distance. Must exceed
   * the tile vertex spacing (TILE_SIZE / TILE_SEGMENTS).
   */
  HINT_TOLERANCE: 6,
} as const;

// ---------------------------------------------------------------------------
// Road mesh
// ---------------------------------------------------------------------------
export const ROAD_MESH = {
  /** Arc length of one pooled ribbon segment (m). */
  SEGMENT_LENGTH: 64,
  /** Segments kept behind / ahead of the viewer (+ slack segments). */
  BEHIND: 64,
  SLACK_SEGMENTS: 2,
  /** Lift above terrain height to avoid z-fighting. */
  LIFT: 0.02,
  /** Lane-marking texture size. */
  TEXTURE_WIDTH: 128,
  TEXTURE_HEIGHT: 256,
  /** UV v = s / TEXTURE_REPEAT_LENGTH (meters per texture tile). */
  TEXTURE_REPEAT_LENGTH: 8,
  ANISOTROPY: 4,
  /** Canvas colors. */
  ASPHALT: '#3a3d42',
  MARKING: '#e8e6dc',
  /** Lane geometry (m, lateral offsets from centerline). */
  EDGE_LINE_LATERAL: 3.55,
  EDGE_LINE_WIDTH: 0.16,
  CENTER_LINE_WIDTH: 0.14,
  /**
   * Center-dash pattern. One texture tile = 8 m; a 3 m line + 1 m gap gives
   * a 4 m cycle (2 per tile) so the pattern tiles seamlessly across repeats.
   */
  DASH_LINE_M: 3,
  DASH_GAP_M: 1,
} as const;

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------
export const SCENERY = {
  /** Jittered-grid cell size for candidate placement (m). */
  CELL: 10,
  /** Trees/rocks must be at least this far from the centerline. */
  MIN_ROAD_DIST: 10,
  /** Reject placements on slopes above this (0..1-ish). */
  MAX_SLOPE: 0.5,
  /** Max instances per tile. */
  MAX_PER_TILE: 40,
  /** Low-frequency "forest density" noise scale (1/m). */
  DENSITY_SCALE: 1 / 180,
  /** Density threshold above which trees appear (creates clearings). */
  DENSITY_THRESHOLD: 0.25,
  /** Probability a candidate becomes a rock instead of a tree. */
  ROCK_CHANCE: 0.12,
} as const;

// ---------------------------------------------------------------------------
// Sky, fog, light
// ---------------------------------------------------------------------------
export const SKY = {
  ZENITH: 0x7fb0e0,
  HORIZON: 0xf2d9c0, // fog color is the horizon color
  SUN: 0xfff1d6,
  SUN_DIR: [0.5, 0.35, -0.8] as const,
  /** Dome radius = camera.far * DOME_FAR_FACTOR. */
  DOME_FAR_FACTOR: 0.9,
  /** Sky gradient sharpness (how quickly zenith hue takes over). */
  GRADIENT_POWER: 0.65,
  /** Sun glow angular size. */
  SUN_GLOW_SIZE: 0.12,
  HEMI_SKY: 0xcfe3f5,
  HEMI_GROUND: 0x6b7a55,
  HEMI_INTENSITY: 1.15,
  SUN_INTENSITY: 1.7,
} as const;

// ---------------------------------------------------------------------------
// Car (arcade physics)
// ---------------------------------------------------------------------------
export const CAR = {
  MAX_SPEED: 45, // m/s (~160 km/h)
  CRUISE_DEFAULT: 25, // m/s
  ACCEL: 7, // m/s^2
  BRAKE: 14, // m/s^2
  /** Quadratic drag coefficient: a -= DRAG * v^2 (terminal ~MAX_SPEED). */
  DRAG: 0.00325,
  /** Constant rolling resistance deceleration (m/s^2). */
  ROLL: 0.4,
  /** Off-road drag multiplier. */
  OFFROAD_DRAG_MULT: 3,
  WHEELBASE: 2.6,
  /** Steering input ramps toward +/-1 at this rate, returns at this rate. */
  STEER_RAMP_IN: 3.0,
  STEER_RAMP_OUT: 4.0,
  /** Max steering angle: 0.5 rad at rest -> ~0.07 rad at MAX_SPEED. */
  MAX_STEER_LOW: 0.5,
  MAX_STEER_HIGH: 0.07,
  /** Lateral-acceleration cap (anti-slide understeer). */
  MAX_LAT_ACCEL: 12,
  /** Soft wall: beyond this lateral offset we nudge back. */
  SOFT_WALL_DIST: 35,
  SOFT_WALL_BLEND: 4.5, // 1/s lerp rate toward wall + road heading
  /** Cruise-control P controller gain (throttle per m/s of speed error). */
  CRUISE_KP: 0.12,
  /** Brake gain while cruising (per m/s over target). */
  CRUISE_BRAKE_KP: 0.25,
  /** Low-poly body dimensions (m). */
  BODY_LENGTH: 4.2,
  BODY_WIDTH: 1.8,
  BODY_HEIGHT: 0.55,
  CABIN_LENGTH: 2.0,
  CABIN_WIDTH: 1.5,
  CABIN_HEIGHT: 0.42,
  CABIN_OFFSET_Z: -0.25,
  WHEEL_RADIUS: 0.34,
  WHEEL_WIDTH: 0.22,
  /** Ground-following sample half-extents (wheel positions). */
  TRACK_WIDTH: 1.6,
  WHEELBASE_VIS: 2.6,
  /** Cosmetic body pitch/roll gains. */
  BODY_PITCH_GAIN: 0.02,
  BODY_ROLL_GAIN: 0.012,
  /** Suspended smoothing rate for pitch/roll. */
  ORIENTATION_SMOOTH: 8,
} as const;

// ---------------------------------------------------------------------------
// Chase camera
// ---------------------------------------------------------------------------
export const CAMERA = {
  FOV_BASE: 58,
  FOV_SPEED_SPAN: 8, // +8 at MAX_SPEED
  FOV_SMOOTH: 3,
  /** Offset behind (m) and above (m) the car. */
  BACK: 7.5,
  UP: 3.2,
  /** Look-at point ahead of the car. */
  LOOK_AHEAD: 12,
  LOOK_UP: 1.0,
  /** Position / heading low-pass rates (1/s). */
  POS_SMOOTH: 4,
  HEADING_SMOOTH: 2.5,
  /** Never let the camera sink below terrain + this. */
  MIN_GROUND_CLEARANCE: 1.5,
  /** Camera far plane = VIEW_RADIUS * this. */
  FAR_FACTOR: 1.3,
} as const;

// ---------------------------------------------------------------------------
// Loop / timing
// ---------------------------------------------------------------------------
export const LOOP = {
  /** Fixed physics timestep (s). */
  FIXED_DT: 1 / 60,
  /** Max accumulated frame time (s) — clamp after tab switches. */
  MAX_FRAME_DT: 0.1,
  /** Max fixed steps per rendered frame. */
  MAX_STEPS: 5,
} as const;

// ---------------------------------------------------------------------------
// HUD / UI
// ---------------------------------------------------------------------------
export const HUD = {
  /** HUD refresh rate (Hz). */
  UPDATE_HZ: 10,
  /** Key-hint line fades out after this many seconds of driving. */
  HINT_FADE_SECONDS: 8,
} as const;

// ---------------------------------------------------------------------------
// Quality presets
// ---------------------------------------------------------------------------
export interface QualityPreset {
  readonly viewRadius: number;
  readonly tileSegments: number;
  readonly antialias: boolean;
  /** Multiplier on scenery instance counts. */
  readonly sceneryDensity: number;
  /** Multiplier on max pixel ratio. */
  readonly pixelRatioCap: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    viewRadius: 400,
    tileSegments: 12,
    antialias: false,
    sceneryDensity: 0.5,
    pixelRatioCap: 1.0,
  },
  medium: {
    viewRadius: TERRAIN.VIEW_RADIUS,
    tileSegments: TERRAIN.TILE_SEGMENTS,
    antialias: false,
    sceneryDensity: 1.0,
    pixelRatioCap: 1.5,
  },
  high: {
    viewRadius: 900,
    tileSegments: 32,
    antialias: true,
    sceneryDensity: 1.4,
    pixelRatioCap: 1.5,
  },
};

// ---------------------------------------------------------------------------
// Pixel ratio / adaptive resolution
// ---------------------------------------------------------------------------
export const PIXEL_RATIO = {
  MIN: 0.6,
  /** MAX = min(devicePixelRatio, this) * preset.pixelRatioCap. */
  MAX_DEVICE: 1.5,
  /** Lower the ratio when the moving-average frame time exceeds this (ms). */
  SLOW_MS: 22,
  SLOW_SECONDS: 2,
  /** Raise it when below this (ms)... */
  FAST_MS: 14,
  FAST_SECONDS: 5,
  STEP: 0.1,
  /** Moving-average window (frames). */
  AVG_WINDOW: 30,
} as const;

/** Default quality when no `?quality=` param is given. */
export const DEFAULT_QUALITY: QualityLevel = 'medium';

// ---------------------------------------------------------------------------
// Debug / dev-only tools (never enabled by default)
// ---------------------------------------------------------------------------
export const AUTOPILOT = {
  /** Aim point ahead of the car (m): base + seconds-of-travel. */
  LOOKAHEAD_BASE: 12,
  LOOKAHEAD_PER_MS: 0.6,
  /** Steer gain: steering input per radian of heading error. */
  HEADING_GAIN: 2.4,
  /** Yaw-rate damping: subtracted (radians of error per rad/s of turning). */
  DAMPING: 0.15,
  /** Longitudinal P gains toward CRUISE_DEFAULT. */
  SPEED_KP: 0.25,
  BRAKE_KP: 0.35,
  SPEED_TOLERANCE: 1.0,
} as const;

export const DEBUG = {
  /** `?debugRoad=1`: generate and plot this much road (m). */
  ROAD_PLOT_LENGTH: 5000,
  /** Top-down plot canvas size (CSS px). */
  ROAD_PLOT_SIZE: 340,
  /** Redraw throttle for the plot (ms). */
  ROAD_PLOT_INTERVAL_MS: 250,
} as const;
