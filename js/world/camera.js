/* Strategy-game camera: drag to pan, right-drag / two fingers to rotate and tilt, wheel / pinch to zoom, keys WASD QE RF. */
(function (L) {
  'use strict';
  const T = globalThis.THREE;
  if (!T) return;

  function create(cam, dom) {
    const C = {
      target: new T.Vector3(150, 0, 92), dist: 210, yaw: -0.35, pitch: 0.95,
      goal: null, minDist: 14, maxDist: 420, underground: false, follow: null, moved: false,
    };
    const want = { target: C.target.clone(), dist: C.dist, yaw: C.yaw, pitch: C.pitch };
    const clampT = (v) => { v.x = Math.max(-40, Math.min(330, v.x)); v.z = Math.max(-30, Math.min(210, v.z)); };

    function apply(dt) {
      const k = Math.min(1, dt * 9);
      if (C.follow) { const p = C.follow(); if (p) { want.target.x = p.x; want.target.z = p.z; } }
      C.target.lerp(want.target, k);
      C.dist += (want.dist - C.dist) * k;
      C.yaw += (want.yaw - C.yaw) * k;
      C.pitch += (want.pitch - C.pitch) * k;
      const cp = Math.cos(C.pitch), sp = Math.sin(C.pitch);
      cam.position.set(C.target.x + Math.sin(C.yaw) * cp * C.dist, C.target.y + sp * C.dist, C.target.z + Math.cos(C.yaw) * cp * C.dist);
      cam.lookAt(C.target);
    }
    function pan(dxPx, dyPx) {
      const s = C.dist / dom.clientHeight * 1.15;
      // Screen right on the ground is (cos yaw, -sin yaw); screen up is (-sin yaw, -cos yaw).
      const sn = Math.sin(C.yaw), cs = Math.cos(C.yaw);
      want.target.x += (-dxPx * cs - dyPx * sn) * s;
      want.target.z += (dxPx * sn - dyPx * cs) * s;
      clampT(want.target);
      C.follow = null; C.moved = true;
    }
    function rotate(dx, dy) {
      want.yaw -= dx * 0.006;
      const lo = C.underground ? -0.55 : 0.32;
      want.pitch = Math.max(lo, Math.min(1.45, want.pitch + dy * 0.005));
      C.moved = true;
    }
    function zoom(f) { want.dist = Math.max(C.minDist, Math.min(C.maxDist, want.dist * f)); C.moved = true; }
    function focus(x, z, dist) { want.target.set(x, 0, z); if (dist) want.dist = dist; C.moved = true; }
    function setUnderground(on) {
      C.underground = on;
      if (on) { want.pitch = Math.min(want.pitch, 0.35); want.target.y = -1.5; C.target.y = -1.5; }
      else { want.pitch = Math.max(want.pitch, 0.6); want.target.y = 0; }
    }
    function reset() { want.target.set(150, 0, 92); want.dist = 210; want.yaw = -0.35; want.pitch = 0.95; C.follow = null; }

    // ---- Pointer input
    let drag = null;
    const touches = new Map();
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button, shift: e.shiftKey, ctrl: e.ctrlKey, t: performance.now() };
      C.dragged = false;
    });
    dom.addEventListener('pointermove', (e) => {
      const prev = touches.get(e.pointerId);
      if (prev) touches.set(e.pointerId, { x: e.clientX, y: e.clientY, px: prev.x, py: prev.y });
      if (touches.size >= 2) {
        const [a, b] = Array.from(touches.values());
        if (a.px !== undefined && b.px !== undefined) {
          const d0 = Math.hypot(a.px - b.px, a.py - b.py), d1 = Math.hypot(a.x - b.x, a.y - b.y);
          if (d0 > 0) zoom(d0 / d1);
          const ang0 = Math.atan2(a.py - b.py, a.px - b.px), ang1 = Math.atan2(a.y - b.y, a.x - b.x);
          want.yaw -= (ang1 - ang0);
          const my = ((a.y - a.py) + (b.y - b.py)) / 2;
          rotate(0, my);
        }
        C.dragged = true;
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) C.dragged = true;
      if (!C.dragged) return;
      if (drag.btn === 2 || drag.btn === 1 || drag.shift || drag.ctrl) rotate(dx, dy);
      else pan(dx, dy);
    });
    const end = (e) => { touches.delete(e.pointerId); if (touches.size === 0) drag = null; };
    dom.addEventListener('pointerup', end); dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    const keys = {};
    window.addEventListener('keydown', (e) => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return; keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
    function keyTick(dt) {
      const v = 380 * dt;
      if (keys.w || keys.arrowup) pan(0, v); if (keys.s || keys.arrowdown) pan(0, -v);
      if (keys.a || keys.arrowleft) pan(v, 0); if (keys.d || keys.arrowright) pan(-v, 0);
      if (keys.q) rotate(-v * 0.8, 0); if (keys.e) rotate(v * 0.8, 0);
      if (keys.r) rotate(0, -v * 0.6); if (keys.f) rotate(0, v * 0.6);
      if (keys['+'] || keys['=']) zoom(1 - dt * 1.5); if (keys['-']) zoom(1 + dt * 1.5);
    }
    C.update = (dt) => { keyTick(dt); apply(dt); };
    Object.assign(C, { pan, rotate, zoom, focus, reset, setUnderground, want });
    apply(1);
    return C;
  }

  L.camCtl = { create };
})(globalThis.LPG = globalThis.LPG || {});
