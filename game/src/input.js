// Input: keyboard state, mouse look deltas, pointer lock, and the fire button.
// One object, no allocations per frame: look deltas are consumed with takeLook().
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    locked: false,
  };
  let lookX = 0;
  let lookY = 0;
  // Codes pressed since the last frame, consumed by takePressed(). A quick
  // tap between two frames still counts — at a low frame rate a tap can
  // otherwise start and end before any frame sees the key held down.
  const pressed = new Set();

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (!state.locked) return;
    lookX += event.movementX;
    lookY += event.movementY;
  }
  function onMouseDown(event) {
    if (event.button === 0 && state.locked) state.firing = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
  }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) state.firing = false;
    onLockChange(state.locked);
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    // Codes pressed since the last call (empties the set).
    takePressed() {
      const out = new Set(pressed);
      pressed.clear();
      return out;
    },
    // Test hook: drive firing without a pointer lock (used by the debug hook).
    setFiring(value) {
      state.firing = value;
    },
  };
}
