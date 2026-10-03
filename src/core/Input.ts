/**
 * Input.ts — keyboard state + edge-triggered toggles.
 *
 * Two access patterns:
 *  - `isDown(action)`  — held state, read by the physics step (throttle/steer).
 *  - `consume(action)` — edge trigger, returns true exactly once per press
 *    (cruise, pause, fullscreen, debug overlays...).
 *
 * Edge triggers accumulate until consumed or until `endFrame()` clears them,
 * so a key pressed between frames is never lost.
 */

export type Action =
  | 'throttle'
  | 'brake'
  | 'left'
  | 'right'
  | 'cruise'
  | 'hud'
  | 'pause'
  | 'fullscreen'
  | 'newSeed'
  | 'debugStats'
  | 'freeCam'
  | 'up'
  | 'down'
  | 'boost'
  | 'confirm';

const KEY_TO_ACTIONS: Readonly<Record<string, readonly Action[]>> = {
  KeyW: ['throttle'],
  ArrowUp: ['throttle'],
  KeyS: ['brake'],
  ArrowDown: ['brake'],
  KeyA: ['left'],
  ArrowLeft: ['left'],
  KeyD: ['right'],
  ArrowRight: ['right'],
  KeyC: ['cruise'],
  KeyH: ['hud'],
  KeyP: ['pause'],
  Escape: ['pause'],
  KeyF: ['fullscreen'],
  KeyR: ['newSeed'],
  Backquote: ['debugStats'],
  KeyB: ['freeCam'],
  KeyE: ['up'],
  KeyQ: ['down'],
  ShiftLeft: ['boost'],
  ShiftRight: ['boost'],
  Space: ['confirm'],
  Enter: ['confirm'],
};

/** Keys whose default browser behavior must be suppressed (scrolling etc.). */
const PREVENT_DEFAULT = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Backquote',
]);

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private anyPressed = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (e.metaKey || e.ctrlKey) return;
    if (!e.repeat) {
      this.pressed.add(e.code);
      this.anyPressed = true;
    }
    this.down.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  /** Keys can stick if the window loses focus mid-press. */
  private readonly onBlur = (): void => {
    this.down.clear();
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Is any key bound to `action` currently held? */
  isDown(action: Action): boolean {
    for (const code of KEY_TO_ACTIONS_KEYS) {
      const actions = KEY_TO_ACTIONS[code];
      if (actions !== undefined && actions.includes(action) && this.down.has(code)) {
        return true;
      }
    }
    return false;
  }

  /** Edge trigger: true once per press. */
  consume(action: Action): boolean {
    let hit = false;
    for (const code of KEY_TO_ACTIONS_KEYS) {
      const actions = KEY_TO_ACTIONS[code];
      if (actions !== undefined && actions.includes(action) && this.pressed.has(code)) {
        this.pressed.delete(code);
        hit = true;
      }
    }
    return hit;
  }

  /**
   * Edge trigger for "press any key" (start overlay). Consumes the whole
   * buffer so the dismissing keystroke does not also trigger an action.
   */
  consumeAnyPress(): boolean {
    if (!this.anyPressed) return false;
    this.anyPressed = false;
    this.pressed.clear();
    return true;
  }

  /** Clear unconsumed edge triggers at the end of a frame. */
  endFrame(): void {
    this.pressed.clear();
    this.anyPressed = false;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.down.clear();
    this.pressed.clear();
  }
}

/** Precomputed list of mapped key codes to avoid Object.keys allocation. */
const KEY_TO_ACTIONS_KEYS: readonly string[] = Object.keys(KEY_TO_ACTIONS);
