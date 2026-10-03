/* 3D kit: materials, canvas textures, low-poly model builders and a GPU particle field.
   World units are metres. Sim (x, y) maps to three (x, ?, z = y); north is -z. */
(function (L) {
  'use strict';
  const T = globalThis.THREE;
  if (!T) return;

  const PAL = {
    grass: 0x7d8c58, gravel: 0xa7a091, concrete: 0xc9c5ba, asphalt: 0x4b4e51, steel: 0x76838b, steelDark: 0x4d575d,
    sphere: 0xeeebe3, ochre: 0xc79a2c, ochreLight: 0xd9bd6a, fwRed: 0xb3392f, air: 0x8fb4c6, black: 0x222426,
    glass: 0x6f93a8, roof: 0x5b6065, wall: 0xd8cfbd, wallAlt: 0xb9b3a4, yellow: 0xe8c22b, orange: 0xe3742b,
    skin: [0xf0c9a5, 0xd9a47c, 0xb57b52, 0x8d5a3b, 0x6b4430], earth: 0x6b5139, earthDark: 0x4a3828,
  };

  const matCache = {};
  function mat(color, opts) {
    const key = color + JSON.stringify(opts || {});
    if (matCache[key]) return matCache[key];
    const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.78, metalness: 0.05, flatShading: true }, opts || {}));
    matCache[key] = m;
    return m;
  }
  function basic(color, opts) { return new T.MeshBasicMaterial(Object.assign({ color }, opts || {})); }

  function mesh(geo, m, cast, receive) {
    const o = new T.Mesh(geo, m);
    o.castShadow = cast !== false; o.receiveShadow = receive !== false;
    return o;
  }
  function box(w, h, d, m, x, y, z) { const o = mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x || 0, y || 0, z || 0); return o; }
  function cyl(rt, rb, h, m, seg, x, y, z) { const o = mesh(new T.CylinderGeometry(rt, rb, h, seg || 12), m); o.position.set(x || 0, y || 0, z || 0); return o; }
  function sph(r, m, x, y, z, ws, hs) { const o = mesh(new T.SphereGeometry(r, ws || 14, hs || 10), m); o.position.set(x || 0, y || 0, z || 0); return o; }

  // Pipe segment between two points (THREE.Vector3).
  const UP = new T.Vector3(0, 1, 0);
  function tube(a, b, r, m, seg) {
    const d = new T.Vector3().subVectors(b, a);
    const len = d.length();
    const o = mesh(new T.CylinderGeometry(r, r, len, seg || 8), m);
    o.position.copy(a).addScaledVector(d, 0.5);
    o.quaternion.setFromUnitVectors(UP, d.normalize());
    return o;
  }
  // Pipe along a polyline of [x, y, z] with elbow balls.
  function pipeline(pts, r, m, group) {
    const g = group || new T.Group();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = new T.Vector3(...pts[i]), b = new T.Vector3(...pts[i + 1]);
      g.add(tube(a, b, r, m));
      if (i > 0) g.add(sph(r * 1.25, m, ...pts[i], 8, 6));
    }
    return g;
  }

  // ---------------------------------------------------------------- Canvas helpers
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const FONT = '"Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, monospace';

  // Text label sprite. lines: [{t, c, s, f}] ; returns sprite with .redraw(lines)
  function labelSprite(lines, opts) {
    opts = opts || {};
    const c = canvas(opts.w || 512, opts.h || 160);
    const tex = new T.CanvasTexture(c);
    tex.anisotropy = 4;
    const sm = new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: opts.depthTest !== false });
    const s = new T.Sprite(sm);
    s.renderOrder = 10;
    const scale = opts.scale || 10;
    s.scale.set(scale, scale * c.height / c.width, 1);
    s.redraw = function (ls) {
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const pad = 14;
      let y = pad;
      const rows = ls.map((l) => ({ t: l.t, c: l.c || '#f4f2ea', s: l.s || 44, f: l.f || FONT }));
      let wmax = 0;
      for (const r of rows) { g.font = '600 ' + r.s + 'px ' + r.f; wmax = Math.max(wmax, g.measureText(r.t).width); }
      const hTot = rows.reduce((a, r) => a + r.s * 1.08, 0) + pad;
      const bw = Math.min(c.width, wmax + pad * 2), bx = (c.width - bw) / 2;
      if (opts.bg !== false) {
        g.fillStyle = opts.bg || 'rgba(28,32,34,0.78)';
        roundRect(g, bx, 0, bw, hTot, 12); g.fill();
        if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = 6; roundRect(g, bx + 3, 3, bw - 6, hTot - 6, 10); g.stroke(); }
      }
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const r of rows) { g.font = '600 ' + r.s + 'px ' + r.f; g.fillStyle = r.c; g.fillText(r.t, c.width / 2, y); y += r.s * 1.08; }
      tex.needsUpdate = true;
      s.userData.h = hTot / c.height;
    };
    s.redraw(lines);
    return s;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // Round status icon sprite (glyph in a coloured disc).
  const iconCache = {};
  function iconTexture(glyph, bg, fg) {
    const key = glyph + bg + fg;
    if (iconCache[key]) return iconCache[key];
    const c = canvas(128, 128), g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(66, 68, 54, 0, Math.PI * 2); g.fill();
    g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.fill();
    g.lineWidth = 7; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
    g.fillStyle = fg || '#fff'; g.font = '700 66px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(glyph, 64, 70);
    const t = new T.CanvasTexture(c);
    iconCache[key] = t;
    return t;
  }
  function iconSprite(glyph, bg, fg, size) {
    const s = new T.Sprite(new T.SpriteMaterial({ map: iconTexture(glyph, bg, fg), transparent: true, depthWrite: false, depthTest: false }));
    s.scale.set(size || 4, size || 4, 1);
    s.renderOrder = 20;
    return s;
  }

  // ---------------------------------------------------------------- People
  const SUITS = {
    operator: { suit: 0xe0702a, hat: 0xf4f4f0, vest: null, label: 'Field operator' },
    driver: { suit: 0x2f4466, hat: 0xf4f4f0, vest: 0xd8e02c, label: 'Tanker driver' },
    contractor: { suit: 0x6d6f6a, hat: 0x3f8f4a, vest: 0xe9b520, label: 'Contractor' },
    fitter: { suit: 0x35577a, hat: 0x3f8f4a, vest: 0xe9b520, label: 'Maintenance fitter' },
    instrument: { suit: 0x2c5c8f, hat: 0xe8c22b, vest: null, label: 'Instrument technician' },
    guard: { suit: 0x26292c, hat: 0x26292c, vest: 0xd8e02c, label: 'Gate security' },
    lab: { suit: 0xf2f2ee, hat: 0xf4f4f0, vest: null, label: 'Lab technician' },
    fire: { suit: 0x2a2f3a, hat: 0xe8c22b, vest: 0xd8d03a, label: 'Firefighter' },
    shunter: { suit: 0x3a3d40, hat: 0xf4f4f0, vest: 0xe36c2b, label: 'Rail shunter' },
    deliver: { suit: 0x5b3f6b, hat: 0xf4f4f0, vest: 0xd8e02c, label: 'Delivery driver' },
  };
  const PSCALE = 2.0; // characters are drawn larger than life so they read at site scale

  function person(role, seed) {
    const s = SUITS[role] || SUITS.contractor;
    const g = new T.Group();
    const body = new T.Group();
    g.add(body);
    const suit = mat(s.suit), skin = mat(PAL.skin[(seed || 0) % PAL.skin.length]), hat = mat(s.hat, { roughness: 0.4 }), boot = mat(0x2a2522);
    const leg = (x) => {
      const p = new T.Group(); p.position.set(x, 0.92, 0);
      const l = box(0.2, 0.84, 0.22, suit, 0, -0.42, 0); p.add(l);
      p.add(box(0.22, 0.12, 0.32, boot, 0, -0.86, 0.05));
      body.add(p); return p;
    };
    const arm = (x) => {
      const p = new T.Group(); p.position.set(x, 1.5, 0);
      p.add(box(0.16, 0.66, 0.18, suit, 0, -0.32, 0));
      p.add(box(0.14, 0.14, 0.14, skin, 0, -0.7, 0));
      body.add(p); return p;
    };
    const legL = leg(-0.13), legR = leg(0.13);
    body.add(box(0.5, 0.66, 0.3, suit, 0, 1.24, 0));
    if (s.vest) body.add(box(0.53, 0.42, 0.33, mat(s.vest, { emissive: s.vest, emissiveIntensity: 0.08 }), 0, 1.3, 0));
    if (role === 'fire') { body.add(box(0.54, 0.06, 0.34, mat(0xe8e04a, { emissive: 0xe8e04a, emissiveIntensity: 0.3 }), 0, 1.06, 0)); body.add(box(0.36, 0.5, 0.18, mat(0x9aa0a6), 0, 1.3, -0.24)); }
    const armL = arm(-0.33), armR = arm(0.33);
    const head = new T.Group(); head.position.set(0, 1.62, 0); body.add(head);
    head.add(sph(0.2, skin, 0, 0.12, 0, 10, 8));
    head.add(box(0.05, 0.05, 0.02, mat(0x1d1d1d), -0.07, 0.15, 0.19));
    head.add(box(0.05, 0.05, 0.02, mat(0x1d1d1d), 0.07, 0.15, 0.19));
    const hatG = new T.Group(); hatG.position.y = 0.24; head.add(hatG);
    if (role === 'guard') { hatG.add(cyl(0.2, 0.21, 0.12, hat, 12, 0, 0.02, 0)); hatG.add(box(0.3, 0.03, 0.18, hat, 0, -0.04, 0.16)); }
    else {
      const dome = mesh(new T.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat); hatG.add(dome);
      hatG.add(cyl(0.29, 0.29, 0.03, hat, 14, 0, 0.0, 0.02));
    }
    if (role === 'lab') body.add(box(0.56, 0.5, 0.34, mat(0xffffff), 0, 0.9, 0));
    // Tool in right hand (shown for some activities)
    const tool = new T.Group(); tool.position.set(0, -0.72, 0.08); armR.add(tool);
    tool.add(box(0.1, 0.16, 0.06, mat(0xe8c22b), 0, 0, 0.06));
    tool.visible = false;
    g.scale.setScalar(PSCALE);
    // Big invisible hit volume for easy picking
    const hit = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 2.2, 8), new T.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.1; g.add(hit);
    g.userData.rig = { body, legL, legR, armL, armR, head, tool, hit, phase: Math.random() * 6 };
    g.userData.role = role;
    return g;
  }
  // Animate a person rig. mode: 'walk' | 'idle' | 'work' | 'crouch' | 'gauge' | 'wave' | 'lie' | 'weld' | 'valve'
  function animatePerson(p, mode, dt, speed) {
    const r = p.userData.rig;
    r.phase += dt * (mode === 'walk' ? 7 * (speed || 1) : 3);
    const s = Math.sin(r.phase);
    const set = (o, x) => { o.rotation.x += (x - o.rotation.x) * Math.min(1, dt * 12); };
    r.body.rotation.z = 0; r.body.position.y = 0;
    r.tool.visible = mode === 'gauge' || mode === 'work' || mode === 'valve';
    switch (mode) {
      case 'walk': set(r.legL, s * 0.65); set(r.legR, -s * 0.65); set(r.armL, -s * 0.5); set(r.armR, s * 0.5); r.body.position.y = Math.abs(Math.cos(r.phase)) * 0.05; break;
      case 'work': set(r.legL, 0); set(r.legR, 0); set(r.armL, -1.0 + s * 0.25); set(r.armR, -1.3 + Math.sin(r.phase * 2.2) * 0.5); break;
      case 'valve': set(r.legL, 0.1); set(r.legR, -0.1); r.armL.rotation.x = -1.4 + Math.sin(r.phase * 1.5) * 0.3; r.armR.rotation.x = -1.4 - Math.sin(r.phase * 1.5) * 0.3; break;
      case 'crouch': set(r.legL, -1.1); set(r.legR, -1.1); r.body.position.y = -0.35; set(r.armL, -0.9 + s * 0.2); set(r.armR, -0.9 - s * 0.2); break;
      case 'weld': set(r.legL, -1.2); set(r.legR, -1.0); r.body.position.y = -0.38; set(r.armL, -1.1); set(r.armR, -1.25 + Math.sin(r.phase * 5) * 0.05); break;
      case 'gauge': set(r.legL, 0); set(r.legR, 0); set(r.armL, -0.2); set(r.armR, -2.2 + s * 0.1); r.head.rotation.x = -0.35; return;
      case 'wave': set(r.legL, 0); set(r.legR, 0); set(r.armL, 0); r.armR.rotation.x = -2.6; r.armR.rotation.z = Math.sin(r.phase * 3) * 0.4; break;
      case 'lie': r.body.rotation.z = Math.PI / 2; r.body.position.y = 0.25; set(r.legL, 0); set(r.legR, 0); set(r.armL, 0); set(r.armR, 0); break;
      case 'hose': set(r.legL, 0.35); set(r.legR, -0.35); set(r.armL, -1.25); set(r.armR, -1.15); break;
      default: set(r.legL, 0); set(r.legR, 0); set(r.armL, s * 0.04); set(r.armR, -s * 0.04);
    }
    r.head.rotation.x *= 0.9;
    if (mode !== 'wave') r.armR.rotation.z *= 0.8;
  }

  // ---------------------------------------------------------------- Vehicles
  const HAULIER_COLOURS = [0x2f6f8f, 0x8f2f3a, 0x2f7f4f, 0x6a4c8c, 0xb5652b, 0x3b4a6b, 0x7a7a2a];
  function wheel(x, y, z, r) { const w = cyl(r || 0.55, r || 0.55, 0.4, mat(0x1b1c1e), 12, x, y, z); w.rotation.x = Math.PI / 2; return w; }
  // Road tanker, local +x is forward. Returns group with .tank (for x-ray fill) and .smoke anchor.
  function truck(colour, rigid) {
    const g = new T.Group();
    const paint = mat(colour, { roughness: 0.5 }), white = mat(0xf1efe8, { roughness: 0.35, metalness: 0.1 }), dark = mat(0x2a2c2f);
    const len = rigid ? 7.8 : 12.5, tx = rigid ? -1.2 : -2.2;
    const cabX = rigid ? 3.7 : 6.2;
    // chassis
    g.add(box(rigid ? 10 : 16.5, 0.35, 1.6, dark, rigid ? 0.4 : 0.6, 0.85, 0));
    // cab
    g.add(box(2.1, 2.3, 2.45, paint, cabX, 2.1, 0));
    g.add(box(0.06, 0.9, 2.1, mat(0x8fb3c7, { roughness: 0.1, metalness: 0.3 }), cabX + 1.06, 2.65, 0));
    g.add(box(2.15, 0.25, 2.5, mat(0x1e2022), cabX, 3.3, 0));
    // tank
    const tank = new T.Group(); tank.position.set(tx, 2.55, 0); g.add(tank);
    const shell = cyl(1.25, 1.25, len, white, 18); shell.rotation.z = Math.PI / 2; tank.add(shell);
    for (const e of [-1, 1]) { const cap = sph(1.25, white, e * len / 2, 0, 0, 14, 10); cap.scale.set(0.35, 1, 1); tank.add(cap); }
    const stripe = cyl(1.27, 1.27, len * 0.98, paint, 18); stripe.rotation.z = Math.PI / 2; stripe.scale.set(1, 1, 1); stripe.position.y = 0; tank.add(stripe);
    stripe.geometry = new T.CylinderGeometry(1.27, 1.27, len * 0.98, 18, 1, true, Math.PI * 0.42, Math.PI * 0.16);
    // orange plates
    const plate = mat(0xf28c00, { emissive: 0x5a2a00, emissiveIntensity: 0.2 });
    g.add(box(0.05, 0.42, 0.55, plate, cabX + 1.1, 1.2, 0));
    g.add(box(0.05, 0.42, 0.55, plate, tx - len / 2 - 0.5, 2.0, 0));
    // valve cabinet
    g.add(box(1.2, 0.7, 0.4, mat(0x8a9196), tx, 1.25, 1.05));
    // wheels
    const axles = rigid ? [3.4, -2.2, -3.5] : [6.5, 4.8, -4.6, -6.0, -7.4];
    for (const ax of axles) for (const z of [-0.95, 0.95]) g.add(wheel(ax, 0.55, z));
    // exhaust stack anchor
    const smoke = new T.Object3D(); smoke.position.set(cabX - 1.0, 3.7, -1.0); g.add(smoke);
    const stackM = cyl(0.08, 0.08, 1.6, mat(0x9a9fa3, { metalness: 0.6, roughness: 0.3 }), 8, cabX - 1.0, 3.0, -1.0); g.add(stackM);
    g.userData.tank = tank; g.userData.smoke = smoke; g.userData.len = len; g.userData.tankX = tx;
    // Fill indicator (x-ray): a ochre bar inside the tank
    const fill = box(len * 0.98, 1, 1.6, mat(0xd8a12c, { transparent: true, opacity: 0.9, emissive: 0x4a3000, emissiveIntensity: 0.4 }), 0, 0, 0);
    fill.castShadow = false; fill.visible = false; tank.add(fill);
    g.userData.fill = fill;
    return g;
  }
  function vanModel(colour) {
    const g = new T.Group();
    g.add(box(5.2, 2.2, 2.1, mat(colour || 0xe9e6dc), 0, 1.6, 0));
    g.add(box(1.4, 1.4, 2.0, mat(0x8fb3c7, { roughness: 0.1 }), 2.1, 2.0, 0));
    for (const x of [-1.6, 1.6]) for (const z of [-0.95, 0.95]) g.add(wheel(x, 0.45, z, 0.45));
    return g;
  }
  function fireEngine() {
    const g = new T.Group();
    const red = mat(0xc22a22, { roughness: 0.45 });
    g.add(box(8.5, 2.6, 2.5, red, 0, 1.9, 0));
    g.add(box(2.2, 1.4, 2.5, red, 4.6, 1.6, 0));
    g.add(box(0.06, 0.8, 2.1, mat(0x8fb3c7), 5.7, 2.0, 0));
    g.add(box(7.5, 0.18, 2.5, mat(0xd7d2c5, { metalness: 0.6 }), -0.5, 3.3, 0));
    const lb = box(0.8, 0.2, 2.2, mat(0x2050ff, { emissive: 0x2050ff, emissiveIntensity: 1.2 }), 4.2, 2.5, 0); g.add(lb);
    for (const x of [-2.6, 3.6]) for (const z of [-1.1, 1.1]) g.add(wheel(x, 0.6, z, 0.6));
    g.userData.beacon = lb;
    return g;
  }
  function excavator() {
    const g = new T.Group();
    const y = mat(0xe3b129, { roughness: 0.6 });
    g.add(box(3.2, 0.7, 2.4, mat(0x2a2a2a), 0, 0.35, 0));
    const upper = new T.Group(); upper.position.y = 0.8; g.add(upper);
    upper.add(box(2.6, 1.6, 2.2, y, -0.2, 0.8, 0));
    upper.add(box(1.0, 1.2, 1.0, mat(0x8fb3c7), 0.6, 1.9, -0.5));
    const boom = new T.Group(); boom.position.set(1.0, 1.2, 0.4); upper.add(boom);
    boom.add(box(3.4, 0.35, 0.35, y, 1.7, 0, 0));
    const stick = new T.Group(); stick.position.set(3.4, 0, 0); boom.add(stick);
    stick.add(box(0.3, 2.4, 0.3, y, 0, -1.2, 0));
    stick.add(box(0.9, 0.6, 0.7, mat(0x3a3a3a), 0.2, -2.5, 0));
    g.userData.boom = boom; g.userData.stick = stick; g.userData.upper = upper;
    return g;
  }
  function railCar() {
    const g = new T.Group();
    const white = mat(0xe9e6de, { roughness: 0.4 }), dark = mat(0x2e3033), steel = mat(PAL.steelDark);
    const L2 = 17.5;
    const tank = new T.Group(); tank.position.y = 2.7; g.add(tank);
    const shell = cyl(1.5, 1.5, L2 - 2, white, 20); shell.rotation.z = Math.PI / 2; tank.add(shell);
    for (const e of [-1, 1]) { const c = sph(1.5, white, e * (L2 - 2) / 2, 0, 0, 16, 10); c.scale.set(0.5, 1, 1); tank.add(c); }
    const band = cyl(1.52, 1.52, L2 - 2, mat(0xe0702a), 20); band.rotation.z = Math.PI / 2; band.geometry = new T.CylinderGeometry(1.52, 1.52, L2 - 2, 20, 1, true, Math.PI * 0.46, Math.PI * 0.08); tank.add(band);
    tank.add(cyl(0.45, 0.45, 0.5, steel, 10, 0, 1.6, 0));
    tank.add(box(3, 0.08, 1.2, steel, 0, 1.85, 0));
    g.add(box(L2, 0.4, 2.2, dark, 0, 1.15, 0));
    for (const bx of [-6.2, 6.2]) {
      g.add(box(2.6, 0.5, 2.0, dark, bx, 0.75, 0));
      for (const dx of [-0.9, 0.9]) for (const z of [-0.72, 0.72]) g.add(wheel(bx + dx, 0.45, z, 0.45));
    }
    const fill = box(L2 - 2.2, 1, 2.2, mat(0xd8a12c, { transparent: true, opacity: 0.9, emissive: 0x4a3000, emissiveIntensity: 0.4 }), 0, 0, 0);
    fill.visible = false; fill.castShadow = false; tank.add(fill);
    g.userData.tank = tank; g.userData.fill = fill; g.userData.len = L2;
    return g;
  }
  function loco() {
    const g = new T.Group();
    const body = mat(0x2f5f8a, { roughness: 0.5 });
    g.add(box(12, 0.5, 2.6, mat(0x2a2a2a), 0, 1.2, 0));
    g.add(box(8.5, 2.4, 2.3, body, -1.2, 2.6, 0));
    g.add(box(2.6, 3.0, 2.6, body, 4.4, 2.9, 0));
    g.add(box(0.06, 0.9, 2.2, mat(0x8fb3c7), 5.72, 3.4, 0));
    g.add(box(8.5, 0.2, 2.31, mat(0xe8c22b), -1.2, 2.0, 0));
    for (const x of [-4, -2.6, 2.6, 4]) for (const z of [-0.72, 0.72]) g.add(wheel(x, 0.5, z, 0.5));
    return g;
  }

  // ---------------------------------------------------------------- Plant equipment
  function sphereTank(r, centreY) {
    const g = new T.Group();
    const white = mat(PAL.sphere, { roughness: 0.32, metalness: 0.08, flatShading: false });
    const shell = mesh(new T.SphereGeometry(r, 36, 24), white);
    shell.position.y = centreY; g.add(shell);
    const steel = mat(PAL.steel);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI * 2;
      const x = Math.cos(a) * r * 0.97, z = Math.sin(a) * r * 0.97;
      g.add(cyl(0.32, 0.36, centreY, steel, 8, x, centreY / 2, z));
      const a2 = (i + 1.5) / n * Math.PI * 2;
      const x2 = Math.cos(a2) * r * 0.97, z2 = Math.sin(a2) * r * 0.97;
      g.add(tube(new T.Vector3(x, 0.4, z), new T.Vector3(x2, centreY * 0.8, z2), 0.07, steel));
      g.add(tube(new T.Vector3(x2, 0.4, z2), new T.Vector3(x, centreY * 0.8, z), 0.07, steel));
      g.add(box(1.1, 0.4, 1.1, mat(PAL.concrete), x, 0.2, z));
    }
    // Stair tower and top platform
    const sx = r + 1.6;
    g.add(box(1.4, centreY + r, 1.4, mat(0x8b969c, { transparent: true, opacity: 0.55 }), sx, (centreY + r) / 2, 0));
    for (let y = 2; y < centreY + r; y += 2.2) g.add(box(1.5, 0.1, 1.5, steel, sx, y, 0));
    g.add(tube(new T.Vector3(sx - 0.7, centreY + r, 0), new T.Vector3(1.2, centreY + r + 0.1, 0), 0.25, steel));
    g.add(cyl(1.8, 1.8, 0.15, steel, 16, 0, centreY + r + 0.08, 0));
    const rail = mesh(new T.TorusGeometry(1.8, 0.05, 6, 24), mat(0xe8c22b)); rail.rotation.x = Math.PI / 2; rail.position.y = centreY + r + 1.0; g.add(rail);
    // PSV and vent stack
    g.add(cyl(0.18, 0.18, 3.2, steel, 8, 0.9, centreY + r + 1.6, 0.6));
    const psvTip = new T.Object3D(); psvTip.position.set(0.9, centreY + r + 3.3, 0.6); g.add(psvTip);
    // Deluge ring
    const ring = mesh(new T.TorusGeometry(r * 0.55, 0.09, 6, 30), mat(PAL.fwRed)); ring.rotation.x = Math.PI / 2; ring.position.y = centreY + r * 0.85; g.add(ring);
    // Bottom nozzle and outlet
    g.add(cyl(0.3, 0.3, centreY - r + 0.4 > 0 ? 1.2 : 1.2, mat(PAL.ochre), 8, 0, Math.max(0.6, centreY - r - 0.3), 0));
    // Liquid (x-ray) inside: clipped sphere
    const plane = new T.Plane(new T.Vector3(0, -1, 0), centreY);
    const liqMat = new T.MeshStandardMaterial({ color: 0xd8a12c, emissive: 0x5a3a00, emissiveIntensity: 0.35, roughness: 0.3, clippingPlanes: [plane], side: T.DoubleSide, transparent: true, opacity: 0.92 });
    const liquid = new T.Mesh(new T.SphereGeometry(r * 0.985, 32, 20), liqMat);
    liquid.position.y = centreY; liquid.visible = false; g.add(liquid);
    g.userData = { shell, liquid, plane, psvTip, r, centreY, ring };
    return g;
  }
  function bullet(len, r) {
    const g = new T.Group();
    const white = mat(PAL.sphere, { roughness: 0.4, flatShading: false });
    const body = cyl(r, r, len, white, 24); body.rotation.z = Math.PI / 2; body.position.y = r + 1.4; g.add(body);
    for (const e of [-1, 1]) { const c = sph(r, white, e * len / 2, r + 1.4, 0, 18, 12); c.scale.set(0.5, 1, 1); g.add(c); }
    for (const x of [-len / 3, len / 3]) g.add(box(1.2, 1.6, r * 2, mat(PAL.concrete), x, 0.8, 0));
    // Scaffold (out of service for inspection)
    const sc = mat(0xb7a27a);
    for (let x = -len / 2 - 1; x <= len / 2 + 1; x += 3) for (const z of [-r - 0.9, r + 0.9]) g.add(cyl(0.05, 0.05, r * 2 + 2.6, sc, 6, x, (r * 2 + 2.6) / 2, z));
    for (const y of [1.6, 3.4, 5.2]) for (const z of [-r - 0.9, r + 0.9]) g.add(tube(new T.Vector3(-len / 2 - 1, y, z), new T.Vector3(len / 2 + 1, y, z), 0.05, sc));
    // Open manway
    const mw = cyl(0.45, 0.45, 0.4, mat(0x2a2a2a), 12, len / 2 + r * 0.4, r + 1.4, 0); mw.rotation.z = Math.PI / 2; g.add(mw);
    return g;
  }
  function pump() {
    const g = new T.Group();
    g.add(box(3.4, 0.35, 1.3, mat(0x55606a), 0, 0.18, 0));
    const motor = cyl(0.45, 0.45, 1.5, mat(0x3c6e8f, { roughness: 0.5 }), 14, -0.7, 0.85, 0); motor.rotation.z = Math.PI / 2; g.add(motor);
    const fan = new T.Group(); fan.position.set(-1.5, 0.85, 0); g.add(fan);
    const fanBlade = box(0.05, 0.75, 0.12, mat(0xdedede), 0, 0, 0); fan.add(fanBlade); fan.add(box(0.05, 0.12, 0.75, mat(0xdedede), 0, 0, 0));
    g.add(box(0.5, 0.45, 0.45, mat(0xe8c22b), 0.25, 0.85, 0));
    const casing = cyl(0.55, 0.55, 0.5, mat(0x7c8a92), 14, 0.95, 0.85, 0); casing.rotation.x = Math.PI / 2; g.add(casing);
    g.add(cyl(0.17, 0.17, 1.2, mat(PAL.ochre), 8, 0.95, 1.6, 0));
    const lamp = sph(0.16, new T.MeshStandardMaterial({ color: 0x666666, emissive: 0x000000 }), -0.7, 1.45, 0.5, 8, 6);
    g.add(lamp);
    g.userData = { fan, lamp };
    return g;
  }
  function loadingArm(colour) {
    // Pivoting arm: riser, inner boom (yaw), outer drop (pitch).
    const g = new T.Group();
    const m = mat(colour);
    g.add(cyl(0.16, 0.16, 5, m, 8, 0, 2.5, 0));
    const yaw = new T.Group(); yaw.position.y = 5; g.add(yaw);
    yaw.add(sph(0.28, mat(0x555555), 0, 0, 0, 8, 6));
    yaw.add(tube(new T.Vector3(0, 0, 0), new T.Vector3(0, 0, 3.4), 0.13, m));
    const elbow = new T.Group(); elbow.position.set(0, 0, 3.4); yaw.add(elbow);
    elbow.add(sph(0.22, mat(0x555555), 0, 0, 0, 8, 6));
    const drop = new T.Group(); elbow.add(drop);
    drop.add(tube(new T.Vector3(0, 0, 0), new T.Vector3(0, -3.1, 0), 0.12, m));
    drop.add(cyl(0.22, 0.22, 0.4, mat(0x333333), 8, 0, -3.25, 0));
    // counterweight
    yaw.add(box(0.5, 0.5, 0.5, mat(0x3a3a3a), 0, 0, -0.7));
    g.userData = { yaw, elbow, drop };
    return g;
  }
  function building(w, h, d, wall, opts) {
    opts = opts || {};
    const g = new T.Group();
    g.add(box(w, h, d, mat(wall || PAL.wall), 0, h / 2, 0));
    g.add(box(w + 0.3, 0.35, d + 0.3, mat(PAL.roof), 0, h + 0.17, 0));
    const winM = mat(0x5f8aa3, { roughness: 0.15, metalness: 0.4, emissive: 0xffd58a, emissiveIntensity: 0 });
    const nWin = Math.max(1, Math.floor(w / 3));
    for (let i = 0; i < nWin; i++) {
      const x = -w / 2 + (i + 0.5) * w / nWin;
      if (opts.windows !== false) { g.add(box(w / nWin * 0.6, h * 0.35, 0.08, winM, x, h * 0.55, d / 2 + 0.04)); g.add(box(w / nWin * 0.6, h * 0.35, 0.08, winM, x, h * 0.55, -d / 2 - 0.04)); }
    }
    if (opts.door !== false) g.add(box(1.2, 2.1, 0.1, mat(0x3c4a55), w * 0.3, 1.05, d / 2 + 0.06));
    g.userData.windows = winM;
    return g;
  }
  function detector(kind) {
    const g = new T.Group();
    g.add(cyl(0.06, 0.06, 1.8, mat(0x6a6a6a), 6, 0, 0.9, 0));
    const head = box(0.42, 0.42, 0.32, mat(kind === 'flame' ? 0xb33a2e : 0xe5c12a), 0, 1.95, 0);
    g.add(head);
    const led = sph(0.12, new T.MeshStandardMaterial({ color: 0x44ff66, emissive: 0x22aa33, emissiveIntensity: 0.8 }), 0, 2.25, 0.1, 8, 6);
    g.add(led);
    g.scale.setScalar(1.6);
    g.userData = { led };
    return g;
  }
  function lightMast(h) {
    const g = new T.Group();
    g.add(cyl(0.18, 0.28, h, mat(0x8c969c), 8, 0, h / 2, 0));
    const lampM = new T.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff1c8, emissiveIntensity: 0 });
    for (const a of [0, 2.1, 4.2]) g.add(box(0.9, 0.35, 0.6, lampM, Math.cos(a) * 0.6, h, Math.sin(a) * 0.6));
    g.userData.lamp = lampM;
    return g;
  }
  function windsock() {
    const g = new T.Group();
    g.add(cyl(0.08, 0.1, 9, mat(0xbfbfbf), 6, 0, 4.5, 0));
    const pivot = new T.Group(); pivot.position.y = 9; g.add(pivot);
    const sock = new T.Group(); pivot.add(sock);
    for (let i = 0; i < 4; i++) {
      const c = mesh(new T.CylinderGeometry(0.55 - i * 0.09, 0.5 - i * 0.09, 0.75, 10, 1, true), mat(i % 2 ? 0xffffff : 0xe8541c, { side: T.DoubleSide }));
      c.rotation.z = Math.PI / 2; c.position.x = 0.4 + i * 0.75; sock.add(c);
    }
    g.userData = { pivot, sock };
    return g;
  }
  function tree(scale) {
    const g = new T.Group();
    g.add(cyl(0.18, 0.25, 2, mat(0x6b4a2f), 6, 0, 1, 0));
    const leaf = mat([0x5c7a3a, 0x4f6d33, 0x6b8a44][Math.floor(Math.random() * 3)]);
    const c1 = mesh(new T.ConeGeometry(1.6, 3.4, 7), leaf); c1.position.y = 3.2; g.add(c1);
    const c2 = mesh(new T.ConeGeometry(1.2, 2.6, 7), leaf); c2.position.y = 4.6; g.add(c2);
    g.scale.setScalar(scale || 1);
    return g;
  }

  // Merge every plain mesh under a group into one mesh per material (fewer draw calls for static scenery).
  function mergeGroup(group) {
    group.updateMatrixWorld(true);
    const buckets = new Map();
    const victims = [];
    group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSprite) return;
      const m = o.material;
      if (!buckets.has(m)) buckets.set(m, []);
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(o.matrixWorld);
      buckets.get(m).push({ g, cast: o.castShadow });
      victims.push(o);
    });
    for (const o of victims) o.parent.remove(o);
    for (let i = group.children.length - 1; i >= 0; i--) { const c = group.children[i]; if (c.isGroup && !c.children.length) group.remove(c); }
    const inv = new T.Matrix4().copy(group.matrixWorld).invert();
    for (const [m, list] of buckets) {
      let n = 0;
      for (const it of list) n += it.g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      let k = 0;
      for (const it of list) { pos.set(it.g.attributes.position.array, k * 3); nor.set(it.g.attributes.normal.array, k * 3); k += it.g.attributes.position.count; it.g.dispose(); }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.applyMatrix4(inv);
      geo.computeBoundingSphere();
      const mm = new T.Mesh(geo, m);
      mm.castShadow = list.some((x) => x.cast); mm.receiveShadow = true;
      group.add(mm);
    }
    return group;
  }

  // ---------------------------------------------------------------- Particles
  // One Points object with a ring buffer. Each particle: position, velocity, life, size, colour (rgba), growth.
  function particleField(max, additive) {
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max);
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 4));
    geo.setAttribute('size', new T.BufferAttribute(size, 1));
    const matP = new T.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: 'attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(0.25, 0.05, r)); }',
      transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
    });
    const pts = new T.Points(geo, matP);
    pts.frustumCulled = false;
    pts.renderOrder = additive ? 6 : 5;
    const P = { n: max, i: 0, vel: new Float32Array(max * 3), life: new Float32Array(max), max: new Float32Array(max), grow: new Float32Array(max), a0: new Float32Array(max), drag: new Float32Array(max), grav: new Float32Array(max) };
    function emit(x, y, z, vx, vy, vz, life, sz, r, g, b, a, grow, drag, grav) {
      const k = P.i; P.i = (P.i + 1) % max;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      P.vel[k * 3] = vx; P.vel[k * 3 + 1] = vy; P.vel[k * 3 + 2] = vz;
      P.life[k] = life; P.max[k] = life; size[k] = sz; P.grow[k] = grow || 0; P.a0[k] = a; P.drag[k] = drag || 0; P.grav[k] = grav || 0;
      col[k * 4] = r; col[k * 4 + 1] = g; col[k * 4 + 2] = b; col[k * 4 + 3] = a;
    }
    function update(dt) {
      for (let k = 0; k < max; k++) {
        if (P.life[k] <= 0) { if (col[k * 4 + 3] !== 0) col[k * 4 + 3] = 0; continue; }
        P.life[k] -= dt;
        const f = Math.max(0, P.life[k] / P.max[k]);
        const dr = 1 - P.drag[k] * dt;
        P.vel[k * 3] *= dr; P.vel[k * 3 + 1] = P.vel[k * 3 + 1] * dr - P.grav[k] * dt; P.vel[k * 3 + 2] *= dr;
        pos[k * 3] += P.vel[k * 3] * dt; pos[k * 3 + 1] += P.vel[k * 3 + 1] * dt; pos[k * 3 + 2] += P.vel[k * 3 + 2] * dt;
        if (pos[k * 3 + 1] < 0.05 && P.grav[k] > 0) { P.life[k] = 0; }
        size[k] += P.grow[k] * dt;
        col[k * 4 + 3] = P.a0[k] * Math.min(1, f * 2.2) * Math.min(1, (1 - f) * 8 + 0.2);
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.size.needsUpdate = true;
    }
    return { points: pts, emit, update, material: matP };
  }

  L.kit = { mergeGroup, T, PAL, mat, basic, mesh, box, cyl, sph, tube, pipeline, canvas, labelSprite, iconSprite, iconTexture, person, animatePerson, SUITS, PSCALE, truck, vanModel, fireEngine, excavator, railCar, loco, sphereTank, bullet, pump, loadingArm, building, detector, lightMast, windsock, tree, particleField, HAULIER_COLOURS, roundRect, FONT, MONO };
})(globalThis.LPG = globalThis.LPG || {});
