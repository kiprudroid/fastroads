# AGENTS.md — fastroads

Calm, endless, goal-free driving game in the browser. From-scratch take on the
idea behind slowroads.io. No score, no traffic, no collisions, no finish line —
the product is the feeling of serenity.

## Commands

```bash
bun install          # install deps
bun run dev          # dev server (vite via `bunx --bun vite`), http://localhost:5173
bun run build        # production build -> dist/
bun run preview      # serve dist/
bun run typecheck    # tsc --noEmit  (STRICT, must pass)
bun test             # pure-logic tests (road, height field, determinism)
```

Every phase must pass `bun run typecheck`, `bun test`, `bun run build`.

## Stack

- **Bun** package manager + test runner; **Vite** (vanilla TS, no framework).
- **Three.js** (`three` + `@types/three`), `WebGL2` via `THREE.WebGLRenderer`.
  `mergeGeometries` comes from `three/examples/jsm/utils/BufferGeometryUtils.js`.
- **simplex-noise v4**: `createNoise2D(random)` / `createNoise3D(random)` with a
  *seeded random function* — we pass `mulberry32(seed)` from `src/utils/rng.ts`.
  Never add an alea dependency; PRNG is ours.
- TypeScript `strict: true`, no `any` unless commented why.

## Hard constraints

- Browser only. No backend, no accounts, **no network calls at runtime**.
- **No external assets** (no model/texture/font/audio files). All geometry,
  textures and colors are generated in code.
- **Infinite deterministic world**: same seed => same road + scenery. Seed lives
  in the URL hash (`#seed=12345`); if missing, pick random and write it.
- **Performance is the top priority** (low-end laptop, integrated Intel GPU,
  target 60 fps at default quality): no shadows by default, no post-processing,
  no MSAA by default, flat-shaded low-poly, few draw calls, **zero per-frame
  allocations in hot paths**, capped/adaptive pixel ratio.
- Visual style: soft, low-poly, atmospheric, pastel. Fog + light make it
  serene, not geometric detail.

## Architecture

Coordinates: Three.js convention (+Y up), car starts at origin facing -Z.
Units: meters, seconds; HUD converts m/s -> km/h (`x 3.6`).

**The key idea:** the road centerline is the master data structure. Terrain
flattening, road mesh, scenery exclusion, car height and camera all derive from
it plus a deterministic world height function. Everything is a pure function of
(seed, position), so tiles can be built, evicted and rebuilt with no seams.

### Frame flow (`src/core/Game.ts`)

1. `Loop` (`src/core/Loop.ts`) runs fixed physics steps (1/60 s, accumulator,
   max 5 steps/frame, frame dt clamped to 0.1 s, pauses on `document.hidden`).
2. Physics: `Input` -> `Car.update(dt)`.
3. Render frame: `RoadGenerator.ensureAhead(car.s + horizon)` -> `Terrain.update`
   (create/evict with per-frame budget, nearest-first) -> `RoadMesh.update(car.s)`
   -> `ChaseCamera.update(dt)` -> sky follows camera -> HUD at ~10 Hz -> render.
4. `Quality` samples frame time and adapts the pixel ratio.

### Modules

| Path | Role |
|---|---|
| `src/config.ts` | **ALL tunable constants** + `QUALITY_PRESETS`. No magic numbers elsewhere. |
| `src/types.ts` | Shared type aliases (`NearestResult`, `RoadSample`, `QualityLevel`). |
| `src/core/` | `Game`, `Loop`, `Input`, `Quality`. |
| `src/world/` | `RoadGenerator`, `HeightField`, `Terrain`, `RoadMesh`, `Scenery`, `Sky`, `Palette`. |
| `src/vehicle/` | `Car` (arcade bicycle model), `CarModel` (primitive-built low-poly car). |
| `src/camera/ChaseCamera.ts` | Exponential-smoothed chase camera. |
| `src/ui/` | `Hud` (DOM), `StartOverlay`, `hud.css`. |
| `src/debug/` | `DebugStats` (backtick), `Autopilot`. |
| `src/utils/` | `rng.ts` (mulberry32, seed helpers), `math.ts`, `pool.ts`. |

### Road (`RoadGenerator`)

- Centerline samples every `ROAD.SAMPLE_SPACING` (2 m) of arc length `s`.
- **Bounded heading noise**, not integrated curvature:
  `theta(s) = HEADING_AMP * (0.65*n(s/1400) + 0.35*n(s/500))` relative to -Z.
  Bounded heading (~±60°) means the road can never turn back on itself, which
  keeps "nearest road point" unambiguous within `BLEND_DISTANCE`.
- Position integrated with midpoint rule; samples stored in an array, extended
  by `ensureAhead(s)`, trimmed by `trim(s)` (keep ≥ 400 m behind, index offset
  so indices stay stable).
- Elevation `roadY(s) = A1*fbm1D(s/700) + A2*fbm1D(s/250)`; grade ≤ 7%.
- `nearest(x, z, out)` uses a spatial hash (cell = `BLEND_DISTANCE`) + segment
  projection; the car passes `hintS` for a cheap ±10-sample local search.
- **Tuning rule (enforced by a test):** over the first 50 km, min turn radius ≥
  150 m and max grade ≤ 7%. Tune `HEADING_AMP` / wavelengths until it passes.

### Terrain (`HeightField` + `Terrain`)

- `heightAt(x, z)` is **pure** (this is what guarantees seam-free tiles):
  hills = fbm2D(x/320, z/320, 4 oct)*45 + fbm2D(x/90, z/90, 2 oct)*4, blended
  with `roadY` by `smoothstep` over `BLEND_DISTANCE` from the road edge.
- `normalAt` = central finite differences of `heightAt` (ε = 1 m) — never
  `computeVertexNormals()` per tile, or tile borders show seams.
- Tiles: world-aligned `TILE_SIZE` squares, positions stored **local to tile
  origin** (mesh.position = tile origin) to avoid float jitter. Shared index
  buffer across all tiles. Vertex colors from `Palette`.
- Tile manager: build missing tiles nearest-first, ≤ `TILES_PER_FRAME_BUDGET`
  per frame; evict beyond `VIEW_RADIUS + 1 tile` back into a pool (reuse typed
  arrays, never allocate a `BufferGeometry` per tile per frame).
- Synchronous build within ~200 m before the first frame (behind start overlay).
- Road must be generated to `car.s + VIEW_RADIUS + 300` before tiles there can
  build; trim behind only after those tiles are evicted.

### Road mesh

- 64 m ribbon segments from centerline samples (±`ROAD_HALF_WIDTH` along the
  sample normal, y = roadY + 0.02), pooled, shared material, seamless joins.
- Procedural CanvasTexture lane markings (128×256, `v = s / 8`), mipmaps on,
  anisotropy 4, `RepeatWrapping`. Road material uses `polygonOffset`.

### Car

- Arcade kinematic bicycle model: `a = throttle*ACCEL - brake*BRAKE - DRAG*v^2
  - ROLL`, clamped to `[0, MAX_SPEED]`; cruise control (C) with a P controller.
- Steering ramps in/out; `maxSteer(v)` shrinks with speed; heading rate =
  `v/WHEELBASE * tan(delta)`, clamped by lateral-accel cap (~12 m/s²).
- Off-road (`|lateral| > halfWidth + 0.5`): drag ×3. Beyond 35 m: soft
  invisible wall (project back along road normal + blend heading to tangent).
- Ground following: sample `heightAt` at 4 wheel points; y = average; pitch/roll
  from differences, smoothed with `1 - exp(-k*dt)`.

## Conventions

- **Never a raw `lerp(a, b, k)` for dt-dependent smoothing** — use
  `expSmooth(k, dt)` from `src/utils/math.ts`.
- **Zero allocations in hot paths**: scratch objects and out-parameters
  (`nearest`, `sampleAt`, `normalAt`); pooled geometries / instanced meshes;
  `dispose()` anything permanently removed.
- Every tunable goes in `src/config.ts`.
- Seed handling: `src/utils/rng.ts` (`mulberry32`, `rngFor(seed, ...)` for
  per-tile streams, `parseSeed`, `randomSeed`).
- Tests in `tests/*.test.ts` use `bun test` and only cover pure logic (no DOM,
  no WebGL): road generation, height field, determinism.
- URL flags: `#seed=NNN` seed, `?quality=low|medium|high`,
  `?autopilot=1`, `?debugRoad=1` (dev-only top-down road plot).

## Out of scope (MVP — design allows adding later)

Audio (start overlay doubles as audio-unlock gesture), day/night, weather,
multiple biomes, car selection, gamepad/touch, water, shadows,
post-processing, Web Worker tile building, far LOD.

## Current phase status

See git log — one commit per phase (`phase N: ...`).
