/**
 * main.ts — bootstrap.
 *
 * Phase 0: minimal entry point. Later phases replace this with:
 *   parse seed from URL hash -> create Game -> show start overlay.
 */

const app = document.getElementById('app');
if (!app) throw new Error('#app root missing');

const el = document.createElement('div');
el.className = 'boot';
el.textContent = 'fastroads — scaffold ok';
app.appendChild(el);
