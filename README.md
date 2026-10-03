# fastroads

A calm, endless, goal-free driving game in the browser. No score, no traffic,
no crashing, no finish line — just you, a procedurally generated road, soft
rolling scenery and a warm hazy sky.

A from-scratch take on the idea behind slowroads.io.

## Run

```bash
bun install
bun run dev        # http://localhost:5173
```

Other commands:

```bash
bun run typecheck  # tsc --noEmit
bun test           # pure logic tests (road, height field, determinism)
bun run build      # production build -> dist/
bun run preview    # serve the production build
```

## Controls

| Key | Action |
|---|---|
| `W` / `↑` | accelerate |
| `S` / `↓` | brake |
| `A` `D` / `←` `→` | steer |
| `C` | cruise control |
| `H` | toggle HUD |
| `P` / `Esc` | pause |
| `F` | fullscreen |
| `R` | new random seed (rebuilds the world) |
| `` ` `` | debug stats overlay |

## Seed

The world is deterministic: the same seed always produces the same road and
scenery. The seed lives in the URL hash, e.g. `#seed=12345`. If the hash has
no seed, a random one is generated and written to the URL.

## Stack

Bun + Vite + TypeScript (strict) + Three.js + simplex-noise. No backend, no
network calls at runtime, no external assets — all geometry, textures and
colors are generated in code.

See `AGENTS.md` for architecture and conventions.
