/**
 * main.ts — bootstrap: parse seed (+ flags) from the URL, create the Game.
 *
 * URL contract:
 *   #seed=NNNN      world seed (written if missing -> shareable/reproducible)
 *   ?quality=low|medium|high
 *   ?autopilot=1    car drives itself (phase 5+)
 *   ?debugRoad=1    dev-only top-down road plot (phase 2+)
 */

import './ui/hud.css';
import { Game } from './core/Game.ts';
import { parseSeed, randomSeed } from './utils/rng.ts';

function resolveSeed(): number {
  const match = /(?:^|[#&])seed=([^&]*)/.exec(window.location.hash);
  if (match) {
    const seed = parseSeed(match[1]);
    if (seed !== null) return seed;
  }
  const seed = randomSeed();
  // Write it back without adding a history entry (no scroll jump, no back
  // button pollution).
  const base =
    window.location.pathname + window.location.search + '#seed=' + seed;
  window.history.replaceState(null, '', base);
  return seed;
}

const seed = resolveSeed();

// Surface fatal errors visibly (also how we debug headless runs).
window.addEventListener('error', (e) => {
  const pre = document.createElement('pre');
  pre.style.cssText =
    'position:fixed;inset:0;margin:0;padding:16px;background:#1b1e22;color:#ffb4a8;font:12px/1.5 monospace;white-space:pre-wrap;z-index:99;';
  pre.textContent = `fastroads failed to start:\n\n${e.message}\n${e.filename ?? ''}:${e.lineno ?? ''}`;
  document.body.appendChild(pre);
});

const root = document.getElementById('app');
if (!root) throw new Error('#app root missing');

const game = new Game(root, { seed });
game.start();

// Expose for debugging in the browser console.
declare global {
  interface Window {
    __fastroads?: Game;
  }
}
window.__fastroads = game;
