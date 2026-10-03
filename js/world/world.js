/* World host: renderer, lights, camera, picking and the per-frame update. */
(function (L) {
  'use strict';
  const T = globalThis.THREE;

  function webglOK() {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; }
  }

  function init(container) {
    if (!T || !L.kit || !webglOK()) return null;
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 600;
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' }); } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    // Colours in the kit are authored as display values, so render without colour-space conversion.
    renderer.outputEncoding = T.LinearEncoding;
    renderer.toneMapping = T.NoToneMapping;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    renderer.domElement.className = 'world-canvas';
    renderer.domElement.setAttribute('aria-label', '3D view of the terminal. Drag to pan, right-drag to rotate, scroll to zoom.');

    const scene = new T.Scene();
    scene.background = new T.Color(0xb8cbd6);
    scene.fog = new T.Fog(0xb8cbd6, 260, 900);
    const camera = new T.PerspectiveCamera(38, 1, 1, 2400);
    const hemi = new T.HemisphereLight(0xdfe9f2, 0x6b5f4a, 0.6); scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff4e2, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -175, right: 175, top: 140, bottom: -140, near: 10, far: 900 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.4;
    scene.add(sun); scene.add(sun.target);
    const flood = new T.AmbientLight(0xffe2b0, 0); scene.add(flood);

    const W = { renderer, scene, camera, hemi, sun, flood, sel: null, hover: null, flags: { xray: false, labels: true, underground: false }, mobile };
    W.site = L.site.build(scene);
    W.camCtl = L.camCtl.create(camera, renderer.domElement);
    W.actors = L.actors.create(W);
    if (mobile) { W.camCtl.want.dist = 150; W.camCtl.want.target.set(160, 0, 100); }

    function resize() {
      const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
      const sc = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * Math.PI / 360));
      W.actors.fx.material.uniforms.scale.value = sc; W.actors.fxA.material.uniforms.scale.value = sc;
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(container); else window.addEventListener('resize', resize);

    // ---- Picking
    const ray = new T.Raycaster();
    const ndc = new T.Vector2();
    W.pick = function (cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const list = W.site.pick.slice();
      for (const a of W.actors.actors.values()) list.push(a.obj);
      for (const s of W.actors.icons.values()) list.push(s);
      const hits = ray.intersectObjects(list, true);
      let ground = null;
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.pick) o = o.parent;
        if (!o) continue;
        if (!visibleChain(o)) continue;
        const p = o.userData.pick;
        if (p.kind === 'ground') { if (!ground) ground = { kind: 'ground', point: h.point.clone() }; continue; }
        return { kind: p.kind, id: p.id, name: p.name, key: o.userData.actorKey || null, point: h.point.clone(), obj: o, pos: o.position.clone() };
      }
      if (!ground) {
        // Fall back to the ground plane for underground views and the outer area.
        const t = -ray.ray.origin.y / ray.ray.direction.y;
        if (t > 0) ground = { kind: 'ground', point: ray.ray.origin.clone().addScaledVector(ray.ray.direction, t) };
      }
      return ground;
    };
    function visibleChain(o) { while (o) { if (o.visible === false) return false; o = o.parent; } return true; }

    W.setUnderground = function (on) {
      W.flags.underground = on;
      W.site.underground.visible = on;
      W.site.groundMat.opacity = on ? 0.14 : 1;
      W.site.groundMat.depthWrite = !on;
      W.site.grass.material.transparent = on; W.site.grass.material.opacity = on ? 0.18 : 1;
      W.camCtl.setUnderground(on);
    };
    W.project = function (v) {
      const p = v.clone().project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height, behind: p.z > 1 };
    };
    W.frame = function (S, dt, rate) {
      W.camCtl.update(dt);
      if (S) W.actors.update(S, dt, rate, W.flags, camera);
      renderer.render(scene, camera);
    };
    return W;
  }

  L.world = { init, webglOK };
})(globalThis.LPG = globalThis.LPG || {});
