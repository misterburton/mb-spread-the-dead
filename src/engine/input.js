// Unified pointer input: desktop pointerlock + touch sticks.
// Export: createInput(canvas, touchRoot) -> { move, look, interact, sprint, usingTouch, update() }

export function createInput(canvas, touchRoot) {
  const pointers = new Map(); // pointerId -> { type, role, ox, oy, x, y }

  // public state (read each frame, consumed by update())
  const state = {
    move: { x: 0, y: 0 },
    look: { dx: 0, dy: 0 },
    interact: false, // edge-triggered
    sprint: false,
    usingTouch: false,
    update,
  };

  const keys = new Set();
  let locked = false;
  let pendingInteract = false;

  // --- touch move stick state ---
  const STICK_DEAD = 8;
  const STICK_RADIUS = 60;
  let stickId = null;
  let stickOrigin = { x: 0, y: 0 };
  let stickKnob = { x: 0, y: 0 };
  let lookTouchId = null;
  let lookLast = { x: 0, y: 0 };

  // --- DOM: stick visuals (created lazily, shown only for active stick) ---
  let originEl = null;
  let knobEl = null;
  function ensureStickEls() {
    if (originEl || !touchRoot) return;
    originEl = document.createElement('div');
    knobEl = document.createElement('div');
    for (const el of [originEl, knobEl]) {
      el.style.position = 'fixed';
      el.style.borderRadius = '50%';
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
      el.style.zIndex = '10';
      touchRoot.appendChild(el);
    }
    originEl.style.width = originEl.style.height = '120px';
    originEl.style.background = 'rgba(255,255,255,0.08)';
    originEl.style.border = '2px solid rgba(255,255,255,0.2)';
    knobEl.style.width = knobEl.style.height = '56px';
    knobEl.style.background = 'rgba(255,255,255,0.25)';
    knobEl.style.border = '2px solid rgba(255,255,255,0.4)';
  }
  function showStick() {
    if (!originEl) return;
    originEl.style.display = knobEl.style.display = 'block';
    positionStick();
  }
  function hideStick() {
    if (!originEl) return;
    originEl.style.display = knobEl.style.display = 'none';
  }
  function positionStick() {
    originEl.style.left = stickOrigin.x - 60 + 'px';
    originEl.style.top = stickOrigin.y - 60 + 'px';
    knobEl.style.left = stickKnob.x - 28 + 'px';
    knobEl.style.top = stickKnob.y - 28 + 'px';
  }

  // --- context (interact) button: 72px circle bottom-right, lazy ---
  let ctxBtn = null;
  function ensureContextButton() {
    if (ctxBtn || !touchRoot) return;
    ctxBtn = document.createElement('div');
    ctxBtn.style.cssText =
      'position:fixed;right:24px;bottom:24px;width:72px;height:72px;' +
      'border-radius:50%;background:rgba(255,255,255,0.15);' +
      'border:2px solid rgba(255,255,255,0.3);z-index:11;touch-action:none;';
    ctxBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pendingInteract = true;
    });
    touchRoot.appendChild(ctxBtn);
  }

  // --- desktop: pointerlock ---
  canvas.addEventListener('click', () => {
    if (!state.usingTouch && !locked) {
      canvas.requestPointerLock && canvas.requestPointerLock();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (locked) {
      state.look.dx += e.movementX;
      state.look.dy += e.movementY;
    }
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!state.usingTouch && e.button === 0) pendingInteract = true;
  });

  // --- keyboard fallback ---
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyE') pendingInteract = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // --- pointer events (touch sticks; also tracks mouse harmlessly) ---
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { type: e.pointerType, x: e.clientX, y: e.clientY });
    if (e.pointerType !== 'touch') return;
    if (!state.usingTouch) {
      state.usingTouch = true; // permanent once set
      ensureStickEls();
      ensureContextButton();
    }
    const half = window.innerWidth / 2;
    if (e.clientX < half && stickId === null) {
      stickId = e.pointerId;
      stickOrigin = { x: e.clientX, y: e.clientY };
      stickKnob = { x: e.clientX, y: e.clientY };
      showStick();
    } else if (e.clientX >= half && lookTouchId === null) {
      lookTouchId = e.pointerId;
      lookLast = { x: e.clientX, y: e.clientY };
    }
  });

  window.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (e.pointerId === stickId) {
      let dx = e.clientX - stickOrigin.x;
      let dy = e.clientY - stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      stickKnob = { x: stickOrigin.x + dx, y: stickOrigin.y + dy };
      if (len < STICK_DEAD) {
        state.move.x = 0;
        state.move.y = 0;
      } else {
        state.move.x = dx / STICK_RADIUS;
        state.move.y = dy / STICK_RADIUS;
      }
      positionStick();
    } else if (e.pointerId === lookTouchId) {
      state.look.dx += e.clientX - lookLast.x;
      state.look.dy += e.clientY - lookLast.y;
      lookLast = { x: e.clientX, y: e.clientY };
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (e.pointerId === stickId) {
      stickId = null;
      state.move.x = 0;
      state.move.y = 0;
      hideStick();
    }
    if (e.pointerId === lookTouchId) lookTouchId = null;
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  // --- frame update: keyboard move + sprint, edge consumption ---
  function update() {
    if (!state.usingTouch) {
      state.move.x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      state.move.y = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
    }
    state.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    // interact edge: true for exactly one frame
    state.interact = pendingInteract;
    pendingInteract = false;
    // look deltas consumed by reader before update() each frame
    state.look.dx = 0;
    state.look.dy = 0;
  }

  return state;
}
