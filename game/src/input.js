// Keyboard + mouse input. createInput returns the current state plus a
// one-shot action bitmask consumed each frame via takeActions().

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;

/** Codes whose default browser behaviour (scrolling, focus) we suppress. */
const PREVENT_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export function createInput(canvas) {
  const keys = new Set();
  const actions = { pending: 0 };
  const mouse = { x: 0, y: 0, down: false };

  function toCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onKeyDown(e) {
    if (PREVENT_CODES.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Enter' || e.code === 'Space') actions.pending |= ACTION_CONFIRM;
    else if (e.code === 'Escape' || e.code === 'KeyP') actions.pending |= ACTION_PAUSE;
    else if (e.code === 'KeyF' || e.code === 'KeyE') actions.pending |= ACTION_INTERACT;
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onMouseMove(e) {
    const p = toCanvasCoords(e);
    mouse.x = p.x;
    mouse.y = p.y;
  }

  function onMouseDown(e) {
    const p = toCanvasCoords(e);
    mouse.x = p.x;
    mouse.y = p.y;
    mouse.down = true;
    actions.pending |= ACTION_CONFIRM;
  }

  function onMouseUp() {
    mouse.down = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);

  return {
    down(code) {
      return keys.has(code);
    },
    axis() {
      let x = 0;
      let y = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
      if (x !== 0 && y !== 0) {
        const inv = Math.SQRT1_2;
        x *= inv;
        y *= inv;
      }
      return { x, y };
    },
    sprint() {
      return keys.has('ShiftLeft') || keys.has('ShiftRight');
    },
    mouse,
    takeActions() {
      const a = actions.pending;
      actions.pending = 0;
      return a;
    },
  };
}
