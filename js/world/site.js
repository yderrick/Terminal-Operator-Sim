/* Static 3D terminal: ground, pads, roads, plant, buildings, fence, lights and the underground services layer. */
(function (L) {
  'use strict';
  const K = L.kit;
  if (!K) return;
  const T = K.T, D = L.data, P = K.PAL;
  const { mat, box, cyl, sph, tube, pipeline } = K;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);

  const ROADS = [
    [[340, 162], [184, 162]],
    [[240, 162], [240, 128], [268, 112], [268, 52], [182, 52], [182, 104], [268, 104]],
    [[204, 104], [204, 162]],
    [[8, 92], [182, 92]],
    [[150, 92], [150, 144]],
  ];
  const TRACK_Z = 140.5;

  // ---------------------------------------------------------------- Ground texture
  function groundTexture() {
    const W = D.SITE.w, H = D.SITE.h, PX = 8;
    const c = K.canvas(W * PX, H * PX), g = c.getContext('2d');
    const px = (v) => v * PX;
    // gravel base with noise
    g.fillStyle = '#a49d8e'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 26000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(80,72,60,0.10)' : 'rgba(255,250,235,0.10)'; g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2); }
    const pad = (x, y, w, h, col, joints) => {
      g.fillStyle = col; g.fillRect(px(x), px(y), px(w), px(h));
      if (joints) { g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 2; for (let xx = x; xx <= x + w; xx += 6) { g.beginPath(); g.moveTo(px(xx), px(y)); g.lineTo(px(xx), px(y + h)); g.stroke(); } for (let yy = y; yy <= y + h; yy += 6) { g.beginPath(); g.moveTo(px(x), px(yy)); g.lineTo(px(x + w), px(yy)); g.stroke(); } }
    };
    pad(20, 22, 140, 40, '#c7c3b8', true);   // tank farm bund floor
    pad(40, 66, 76, 18, '#c3bfb3', true);    // pump area
    pad(182, 56, 62, 46, '#c9c5ba', true);   // rack
    pad(6, 94, 40, 32, '#bdb9ad', true);     // utilities
    pad(140, 116, 24, 14, '#bdb9ad', true);  // IA house
    pad(56, 116, 20, 14, '#c3bfb3', true);   // compressor
    // rail ballast
    g.fillStyle = '#857c70'; g.fillRect(0, px(TRACK_Z - 3.5), px(130), px(7));
    for (let i = 0; i < 4000; i++) { g.fillStyle = 'rgba(40,36,30,0.25)'; g.fillRect(Math.random() * px(130), px(TRACK_Z - 3.5) + Math.random() * px(7), 2, 2); }
    // unloading platforms
    pad(30, 132, 32, 4, '#c3bfb3'); pad(70, 132, 32, 4, '#c3bfb3');
    // roads
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of ROADS) {
      g.strokeStyle = '#4c4f52'; g.lineWidth = px(7.5);
      g.beginPath(); r.forEach((p, i) => (i ? g.lineTo(px(p[0]), px(p[1])) : g.moveTo(px(p[0]), px(p[1])))); g.stroke();
    }
    for (const r of ROADS) {
      g.strokeStyle = 'rgba(235,230,210,0.75)'; g.lineWidth = 3; g.setLineDash([px(3), px(3)]);
      g.beginPath(); r.forEach((p, i) => (i ? g.lineTo(px(p[0]), px(p[1])) : g.moveTo(px(p[0]), px(p[1])))); g.stroke();
    }
    g.setLineDash([]);
    // bay lanes
    for (const b of D.BAYS) {
      g.fillStyle = '#56595c'; g.fillRect(px(b.x - 4), px(54), px(8), px(50));
      g.strokeStyle = '#e8c22b'; g.lineWidth = 5; g.strokeRect(px(b.x - 4), px(60), px(8), px(36));
      g.fillStyle = '#f2efe4'; g.font = '700 ' + px(3.2) + 'px "Saira Condensed", Arial Narrow, sans-serif'; g.textAlign = 'center';
      g.fillText('BAY ' + b.id, px(b.x), px(100));
    }
    // weighbridge plates painted
    for (const p of [D.POINTS.wbIn, D.POINTS.wbOut]) { g.fillStyle = '#6d7074'; g.fillRect(px(p.x - 2.2), px(p.y - 9), px(4.4), px(18)); }
    // muster point
    g.fillStyle = '#2e8b57'; g.beginPath(); g.arc(px(D.POINTS.muster.x), px(D.POINTS.muster.y - 2), px(4), 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = '700 ' + px(1.6) + 'px Arial'; g.fillText('MUSTER', px(D.POINTS.muster.x), px(D.POINTS.muster.y - 1.4));
    // hazardous area hatching on bund edges
    g.strokeStyle = 'rgba(230,190,40,0.55)'; g.lineWidth = 4;
    g.strokeRect(px(20), px(22), px(140), px(40)); g.strokeRect(px(182), px(56), px(62), px(46));
    const t = new T.CanvasTexture(c);
    t.anisotropy = 8;
    return t;
  }

  // ---------------------------------------------------------------- Build
  function build(scene) {
    const H = { pumps: {}, arms: {}, spheres: {}, detectors: {}, flames: {}, lamps: [], windows: [], pick: [], labels: [], bays: {}, hydrants: [] };
    const root = new T.Group(); scene.add(root);
    const decor = new T.Group(); root.add(decor); // static scenery, merged at the end
    const pickable = (o, kind, id, name) => { o.userData.pick = { kind, id, name }; H.pick.push(o); return o; };
    const label = (text, x, y, z, sub, scale) => {
      const s = K.labelSprite(sub ? [{ t: text, s: 46 }, { t: sub, s: 30, c: '#c9d1d3' }] : [{ t: text, s: 46 }], { scale: scale || 9 });
      s.position.set(x, y, z); root.add(s); H.labels.push(s); return s;
    };
    // Outer grass + world
    const grass = new T.Mesh(new T.PlaneGeometry(900, 700), mat(P.grass, { roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.set(145, -0.05, 86); grass.receiveShadow = true; root.add(grass);
    H.grass = grass;
    const tex = groundTexture();
    const groundMat = new T.MeshStandardMaterial({ map: tex, roughness: 0.95, transparent: true, opacity: 1 });
    const ground = new T.Mesh(new T.PlaneGeometry(D.SITE.w, D.SITE.h), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(D.SITE.w / 2, 0, D.SITE.h / 2); ground.receiveShadow = true;
    root.add(ground); H.ground = ground; H.groundMat = groundMat;
    pickable(ground, 'ground', null, 'Ground');
    // Public road outside the gate and rail line to the west
    const pub = new T.Mesh(new T.PlaneGeometry(400, 8), mat(0x4c4f52, { roughness: 1 })); pub.rotation.x = -Math.PI / 2; pub.position.set(480, 0.01, 162); pub.receiveShadow = true; root.add(pub);
    const ext = new T.Mesh(new T.PlaneGeometry(300, 7), mat(0x857c70, { roughness: 1 })); ext.rotation.x = -Math.PI / 2; ext.position.set(-150, 0.01, TRACK_Z); root.add(ext);

    // Bund walls round the tank farm
    const bund = mat(0xb9b5aa);
    decor.add(box(140, 0.9, 0.4, bund, 90, 0.45, 22)); decor.add(box(140, 0.9, 0.4, bund, 90, 0.45, 62));
    decor.add(box(0.4, 0.9, 40, bund, 20, 0.45, 42)); decor.add(box(0.4, 0.9, 40, bund, 160, 0.45, 42));
    for (const x of [54, 86, 116]) decor.add(box(0.3, 0.5, 40, bund, x, 0.25, 42));

    // Spheres
    for (const t of D.TANKS) {
      const cy = t.r + 2.4;
      const g = K.sphereTank(t.r, cy);
      g.position.set(t.x, 0, t.y);
      root.add(g);
      pickable(g, 'tank', t.id, t.tag);
      H.spheres[t.id] = g;
      const tag = K.labelSprite([{ t: t.tag, s: 50 }, { t: '', s: 34 }], { scale: 18, w: 768 });
      tag.position.set(t.x, cy + t.r + 6.5, t.y); root.add(tag); H.labels.push(tag);
      g.userData.tag = tag;
    }
    const bu = K.bullet(D.BULLET.len, D.BULLET.r); bu.position.set(D.BULLET.x, 0, D.BULLET.y); root.add(bu); pickable(bu, 'bullet', 'V104', 'V-104');
    label('V-104', D.BULLET.x, 9, D.BULLET.y, 'out of service', 9);

    // Pumps
    for (const p of D.PUMPS) {
      const g = K.pump(); g.position.set(p.x, 0, p.y); g.rotation.y = -Math.PI / 2; root.add(g);
      pickable(g, 'pump', p.id, p.tag);
      H.pumps[p.id] = g;
      label(p.tag, p.x, 3.6, p.y + 1, null, 5);
    }
    // Pump-area shelter roof
    const steel = mat(P.steel);
    for (const x of [44, 70, 90, 114]) for (const z of [68, 82]) decor.add(cyl(0.18, 0.18, 5, steel, 6, x, 2.5, z));
    const roofM = mat(0x9aa4aa, { transparent: true, opacity: 0.4, side: T.DoubleSide });
    root.add(box(28, 0.15, 15, roofM, 57, 5.05, 75)); root.add(box(26, 0.15, 15, roofM, 102, 5.05, 75));

    // Process pipework
    const och = mat(P.ochre, { roughness: 0.5 }), ochL = mat(P.ochreLight, { roughness: 0.5 });
    const t1 = D.TANKS;
    const tb = (t) => t.y + 1.5;
    pipeline([[t1[0].x, 0.8, tb(t1[0])], [t1[0].x, 0.8, 66], [t1[1].x, 0.8, 66], [t1[1].x, 0.8, tb(t1[1])]], 0.22, och, decor);
    pipeline([[50, 0.8, 66], [50, 0.8, 72.4]], 0.18, och, decor); pipeline([[60, 0.8, 66], [60, 0.8, 72.4]], 0.18, och, decor);
    pipeline([[t1[2].x, 0.8, tb(t1[2])], [t1[2].x, 0.8, 69], [96, 0.8, 69], [96, 0.8, 72.4]], 0.2, och, decor);
    pipeline([[t1[2].x, 0.8, 69], [106, 0.8, 69], [106, 0.8, 72.4]], 0.2, och, decor);
    // discharge risers and pipe rack headers
    for (const x of [50, 60]) pipeline([[x, 1.6, 74.95], [x, 6.2, 74.95], [x, 6.2, 86]], 0.16, och, decor);
    for (const x of [96, 106]) pipeline([[x, 1.6, 74.95], [x, 6.9, 74.95], [x, 6.9, 89]], 0.16, ochL, decor);
    pipeline([[50, 6.2, 86], [178, 6.2, 86], [178, 6.2, 70.5], [242, 6.2, 70.5]], 0.24, och, decor);
    pipeline([[96, 6.9, 89], [176, 6.9, 89], [176, 6.9, 67.5], [242, 6.9, 67.5]], 0.22, ochL, decor);
    // pipe rack portal frames
    for (let x = 48; x <= 176; x += 8) { decor.add(cyl(0.15, 0.15, 7.4, steel, 6, x, 3.7, 84.4)); decor.add(cyl(0.15, 0.15, 7.4, steel, 6, x, 3.7, 90.6)); decor.add(box(0.25, 0.25, 6.4, steel, x, 5.9, 87.5)); }
    for (let z = 66; z <= 90; z += 6) { decor.add(cyl(0.15, 0.15, 7.4, steel, 6, 174.4, 3.7, z)); decor.add(cyl(0.15, 0.15, 7.4, steel, 6, 179.6, 3.7, z)); decor.add(box(5.6, 0.25, 0.25, steel, 177, 5.9, z)); }
    // fire water and air lines on the rack
    pipeline([[48, 5.2, 85], [176, 5.2, 85]], 0.14, mat(P.fwRed), decor);
    pipeline([[48, 5.2, 90], [176, 5.2, 90]], 0.08, mat(P.air), decor);

    // Loading rack canopy, gantry, arms
    for (const x of [184, 198.5, 213, 227.5, 242]) for (const z of [60, 78, 96]) decor.add(cyl(0.25, 0.25, 8.5, steel, 8, x, 4.25, z));
    const canopy = new T.Mesh(new T.BoxGeometry(60, 0.2, 38), new T.MeshStandardMaterial({ color: 0xaab4b9, transparent: true, opacity: 0.32, side: T.DoubleSide, depthWrite: false }));
    canopy.position.set(213, 8.6, 78); root.add(canopy); H.canopy = canopy;
    for (const z of [60, 78, 96]) decor.add(box(60, 0.35, 0.35, steel, 213, 8.4, z));
    for (const b of D.BAYS) {
      const bx = b.x;
      const liq = K.loadingArm(P.ochre); liq.position.set(bx + 4.2, 0, 74); root.add(liq);
      const vap = K.loadingArm(P.ochreLight); vap.position.set(bx + 4.2, 0, 83); root.add(vap);
      pipeline([[bx + 4.2, 6.2, 70.5], [bx + 4.2, 6.2, 74], [bx + 4.2, 5.2, 74]], 0.12, och, decor);
      // ESD station and traffic light
      decor.add(box(0.5, 1.4, 0.3, mat(0xd8d8d0), bx + 5.2, 0.7, 88));
      decor.add(sph(0.18, mat(0xd8261f, { emissive: 0x500000 }), bx + 5.2, 1.3, 87.8, 8, 6));
      const tl = new T.Group(); tl.position.set(bx - 4.6, 0, 101); root.add(tl);
      tl.add(cyl(0.08, 0.08, 3, mat(0x555555), 6, 0, 1.5, 0));
      tl.add(box(0.45, 0.9, 0.3, mat(0x222222), 0, 3.1, 0));
      const red = sph(0.15, new T.MeshStandardMaterial({ color: 0x441111, emissive: 0xff2200, emissiveIntensity: 0 }), 0, 3.32, 0.16, 8, 6);
      const grn = sph(0.15, new T.MeshStandardMaterial({ color: 0x114411, emissive: 0x22ff44, emissiveIntensity: 0 }), 0, 2.92, 0.16, 8, 6);
      tl.add(red); tl.add(grn);
      // Earth reel
      decor.add(cyl(0.35, 0.35, 0.25, mat(0x2c8f3a), 10, bx - 4.4, 1.2, 82));
      H.arms[b.id] = { liq, vap, light: { red, grn } };
      const lane = new T.Mesh(new T.BoxGeometry(9, 0.3, 40), new T.MeshBasicMaterial({ visible: false }));
      lane.position.set(bx, 0.2, 78); root.add(lane); pickable(lane, 'bay', b.id, b.tag);
      H.bays[b.id] = lane;
    }
    label('LOADING RACK', 213, 12.5, 58, null, 14);
    // Odorant skid
    const od = new T.Group(); od.position.set(D.POINTS.odorant.x, 0, D.POINTS.odorant.y); root.add(od);
    od.add(box(5, 0.3, 3, mat(0x55606a), 0, 0.15, 0));
    const odt = cyl(0.8, 0.8, 3, mat(0xdcdcd4), 14, 0, 1.3, 0); odt.rotation.z = Math.PI / 2; od.add(odt);
    od.add(box(0.6, 0.6, 0.6, mat(0x3c6e8f), 1.8, 0.6, 1.0));
    pickable(od, 'odorant', 'T401', 'Odorant skid T-401');
    label('T-401 odorant', D.POINTS.odorant.x, 4.5, D.POINTS.odorant.y, null, 6);

    // Rail: rails, sleepers (instanced), buffer stop, unloading posts
    const rails = mat(0x6b6f72, { metalness: 0.6, roughness: 0.4 });
    for (const dz of [-0.75, 0.75]) decor.add(box(560, 0.18, 0.12, rails, -150, 0.35, TRACK_Z + dz));
    const sleeperGeo = new T.BoxGeometry(0.3, 0.16, 2.4), sleeperMat = mat(0x5a4632);
    const nS = 470; const sl = new T.InstancedMesh(sleeperGeo, sleeperMat, nS);
    const m4 = new T.Matrix4();
    for (let i = 0; i < nS; i++) { m4.makeTranslation(-430 + i * 1.2, 0.18, TRACK_Z); sl.setMatrixAt(i, m4); }
    sl.receiveShadow = true; root.add(sl);
    decor.add(box(1, 1.4, 3, mat(0xd8261f), 130, 0.7, TRACK_Z));
    for (const sp of ['railR1', 'railR2']) {
      const pt = D.POINTS[sp];
      const g = new T.Group(); g.position.set(pt.x, 0, 134.5); root.add(g);
      g.add(box(16, 1.2, 3, mat(0xb8b4a8), 0, 0.6, 0));
      g.add(cyl(0.2, 0.2, 6, steel, 8, 0, 3, 0)); g.add(box(0.3, 0.3, 4.5, steel, 0, 6, 2.2));
      const flag = new T.Group(); flag.position.set(-9, 0, 4); g.add(flag);
      flag.add(cyl(0.05, 0.05, 2.4, mat(0x777777), 6, 0, 1.2, 0));
      flag.add(box(0.05, 0.6, 0.9, mat(0x1d4fd8, { emissive: 0x0a2a90, emissiveIntensity: 0.4 }), 0, 2.1, 0.45));
      flag.visible = false;
      H[sp + 'flag'] = flag;
      label(sp === 'railR1' ? 'R1' : 'R2', pt.x, 4, 131, null, 4);
    }
    pipeline([[46, 0.6, 133], [46, 0.6, 128], [86, 0.6, 128], [86, 0.6, 133]], 0.16, och, decor);
    pipeline([[66, 0.6, 128], [66, 0.6, 126]], 0.16, och, decor);
    // Compressor C-301
    const cp = new T.Group(); cp.position.set(D.POINTS.comp.x, 0, D.POINTS.comp.y); root.add(cp);
    for (const x of [-4, 4]) for (const z of [-3, 3]) cp.add(cyl(0.15, 0.15, 4.2, steel, 6, x, 2.1, z));
    cp.add(box(9, 0.15, 7, mat(0x9aa4aa, { transparent: true, opacity: 0.5, side: T.DoubleSide }), 0, 4.25, 0));
    cp.add(box(3.5, 1.4, 1.6, mat(0x5a7a5a), 0, 0.9, 0));
    const fly = new T.Group(); fly.position.set(-2.1, 1.1, 0); cp.add(fly);
    const wheelM = cyl(0.8, 0.8, 0.25, mat(0x333333), 16, 0, 0, 0); wheelM.rotation.z = Math.PI / 2; fly.add(wheelM);
    fly.add(box(0.3, 1.5, 0.12, mat(0xe8c22b), 0.15, 0, 0));
    cp.add(cyl(0.45, 0.45, 1.6, mat(0x8a9196), 12, 2.4, 0.9, 1.2));
    pickable(cp, 'comp', 'C301', 'Compressor C-301');
    H.comp = { fly };
    label('C-301', D.POINTS.comp.x, 6.5, D.POINTS.comp.y, 'compressor', 6);

    // Buildings
    const bld = (w, h, d, x, z, col, kind, id, name, sub) => {
      const g = K.building(w, h, d, col); g.position.set(x, 0, z); root.add(g);
      H.windows.push(g.userData.windows);
      if (kind) pickable(g, kind, id, name);
      label(name, x, h + 3, z, sub, 8);
      return g;
    };
    bld(15, 4.6, 10, 150.5, 151, P.wall, 'ccr', 'CCR', 'Control room', 'you are here');
    bld(14, 5, 9, 120, 159.5, P.wallAlt, 'workshop', 'WS', 'Workshop');
    bld(6, 3.6, 6, 134, 152, 0xe2e0d6, 'lab', 'LAB', 'Lab');
    bld(9, 4, 6, 34, 121, 0xc8b8a0, 'fwpumps', 'FWP', 'Fire pumps', 'P-501 / P-502');
    bld(10, 3.5, 6, 150, 124, P.wallAlt, 'ia', 'IA', 'Air compressors', 'K-601A/B');
    bld(6, 3, 5, 254, 154, 0xd9d2c2, 'gate', 'GATE', 'Gatehouse');
    bld(4, 2.6, 3, 246, 140, 0xd9d2c2, 'wb', 'in', 'WB-1', 'weighbridge in');
    bld(4, 2.6, 3, 198, 140, 0xd9d2c2, 'wb', 'out', 'WB-2', 'weighbridge out');
    // Fire water tank
    const fwt = new T.Group(); fwt.position.set(D.POINTS.fwTank.x, 0, D.POINTS.fwTank.y); root.add(fwt);
    fwt.add(cyl(7, 7, 11, mat(0x7a8f6a, { roughness: 0.6 }), 28, 0, 5.5, 0));
    fwt.add(mesh2(new T.ConeGeometry(7.2, 1.6, 28), mat(0x6c7d5e), 0, 11.8, 0));
    pickable(fwt, 'fwtank', 'FWT', 'Fire water tank');
    label('Fire water', D.POINTS.fwTank.x, 16, D.POINTS.fwTank.y, '3,000 m³', 8);
    H.fwExhaust = new T.Object3D(); H.fwExhaust.position.set(37, 5, 121); root.add(H.fwExhaust);
    // Substation
    decor.add(box(6, 3, 4, mat(0x7f8a6a), 126, 1.5, 100));
    // Gate barrier
    const bar = new T.Group(); bar.position.set(258.5, 1.1, 158); root.add(bar);
    bar.add(box(0.5, 1.1, 0.5, mat(0x333333), 0, -0.55, 0));
    const arm = new T.Group(); bar.add(arm);
    for (let i = 0; i < 8; i++) arm.add(box(1, 0.16, 0.16, mat(i % 2 ? 0xffffff : 0xd8261f), 0.5 + i, 0, 0));
    arm.rotation.y = 0; H.barrier = arm;
    // Signboard
    const sign = K.labelSprite([{ t: 'NO SMOKING · NO NAKED FLAMES', s: 32, c: '#fff' }, { t: 'PPE · FR CLOTHING · NO PHONES', s: 28, c: '#fff' }], { scale: 12, bg: 'rgba(200,40,30,0.92)' });
    sign.position.set(270, 4, 152); root.add(sign);

    // Detectors
    for (const d of D.GAS_DET) { const g = K.detector('gas'); g.position.set(d.x, 0, d.y); root.add(g); pickable(g, 'gd', d.id, d.tag); H.detectors[d.id] = g; }
    for (const d of D.FLAME_DET) { const g = K.detector('flame'); g.position.set(d.x, 0, d.y); g.scale.setScalar(1.3); root.add(g); pickable(g, 'fd', d.id, d.tag); H.flames[d.id] = g; }

    // Light masts, windsock, fence, trees
    for (const [x, z] of [[30, 64], [130, 64], [190, 50], [250, 108], [60, 108], [228, 150], [12, 150], [160, 30]]) { const m = K.lightMast(16); m.position.set(x, 0, z); decor.add(m); H.lamps.push(m.userData.lamp); }
    const ws = K.windsock(); ws.position.set(164, 0, 68); root.add(ws); H.windsock = ws.userData;
    pickable(ws, 'windsock', 'WS', 'Windsock');
    const fenceM = mat(0x8a9196);
    const postGeo = new T.CylinderGeometry(0.06, 0.06, 2.4, 5);
    const posts = [];
    const fenceLine = (x1, z1, x2, z2) => { const n = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 3); for (let i = 0; i <= n; i++) posts.push([x1 + (x2 - x1) * i / n, z1 + (z2 - z1) * i / n]); decor.add(tube(V3(x1, 2.3, z1), V3(x2, 2.3, z2), 0.03, fenceM)); decor.add(tube(V3(x1, 1.2, z1), V3(x2, 1.2, z2), 0.03, fenceM)); };
    fenceLine(2, 2, 288, 2); fenceLine(288, 2, 288, 154); fenceLine(288, 169, 288, 170); fenceLine(2, 170, 288, 170); fenceLine(2, 2, 2, 136); fenceLine(2, 145, 2, 170);
    const pi = new T.InstancedMesh(postGeo, fenceM, posts.length);
    posts.forEach((p, i) => { m4.makeTranslation(p[0], 1.2, p[1]); pi.setMatrixAt(i, m4); });
    root.add(pi);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, rr = 200 + Math.random() * 140;
      let x = 145 + Math.cos(a) * rr * 1.1, z = 86 + Math.sin(a) * rr * 0.75;
      if (Math.abs(z - 162) < 10 && x > 280) continue;
      if (Math.abs(z - TRACK_Z) < 8 && x < 10) continue;
      const tr = K.tree(0.9 + Math.random() * 1.1); tr.position.set(x, 0, z); decor.add(tr);
    }
    // Hydrants on the ring main
    for (const [x, z] of [[12, 40], [12, 80], [60, 20], [120, 20], [180, 20], [250, 40], [250, 80], [250, 118], [180, 118], [100, 118]]) {
      const h = new T.Group(); h.position.set(x, 0, z); decor.add(h);
      h.add(cyl(0.25, 0.3, 1.1, mat(P.fwRed), 8, 0, 0.55, 0)); h.add(sph(0.26, mat(P.fwRed), 0, 1.1, 0, 8, 6));
      H.hydrants.push(h);
    }

    // ---------------------------------------------------------------- Underground
    const UG = new T.Group(); UG.visible = false; root.add(UG); H.underground = UG;
    const red = mat(P.fwRed, { emissive: 0xb3392f, emissiveIntensity: 0.55 });
    pipeline([[12, -1.0, 20], [250, -1.0, 20], [250, -1.0, 120], [12, -1.0, 120], [12, -1.0, 20]], 0.45, red, UG);
    for (const h of H.hydrants) UG.add(tube(V3(h.position.x, -1.0, h.position.z), V3(h.position.x, 0, h.position.z), 0.18, red));
    const buried = mat(P.ochre, { emissive: 0xc79a2c, emissiveIntensity: 0.5 });
    pipeline([[46, -1.4, 133], [46, -1.4, 128], [86, -1.4, 128], [86, -1.4, 133]], 0.32, buried, UG);
    pipeline([[66, -1.4, 128], [66, -1.4, 104], [22, -1.4, 104], [22, -1.4, 58], [78, -1.4, 58]], 0.32, buried, UG);
    for (const x of [42, 74]) UG.add(tube(V3(x, -1.4, 58), V3(x, 0.4, 58), 0.2, buried));
    // cable trenches
    const trench = mat(0x9c9890, { transparent: true, opacity: 0.85 }), cable = mat(0x2a2a2a);
    const trenchRun = (pts) => { for (let i = 0; i < pts.length - 1; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[i + 1]; const len = Math.hypot(x2 - x1, z2 - z1); const b = box(x1 === x2 ? 1.2 : len, 0.8, x1 === x2 ? len : 1.2, trench, (x1 + x2) / 2, -0.55, (z1 + z2) / 2); UG.add(b); UG.add(tube(V3(x1, -0.6, z1), V3(x2, -0.6, z2), 0.12, cable)); } };
    trenchRun([[150, 146], [150, 95], [80, 95], [80, 84]]); trenchRun([[150, 95], [212, 95], [212, 100]]); trenchRun([[150, 130], [66, 130], [66, 126]]);
    // drains and interceptor
    const drainM = mat(0x3d3a36);
    pipeline([[55, -1.8, 82], [55, -1.8, 100], [130, -1.8, 100], [130, -1.8, 108]], 0.25, drainM, UG);
    pipeline([[213, -1.8, 100], [213, -1.8, 110], [130, -1.8, 110]], 0.25, drainM, UG);
    UG.add(box(4, 3, 4, mat(0x6f6a62), 130, -2, 109));
    // Foundations and piles
    const conc = mat(0x8f8b83);
    for (const t of D.TANKS) {
      const ring = new T.Mesh(new T.TorusGeometry(t.r * 0.97, 0.6, 6, 24), conc); ring.rotation.x = Math.PI / 2; ring.position.set(t.x, -0.6, t.y); UG.add(ring);
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; UG.add(cyl(0.35, 0.35, 9, conc, 8, t.x + Math.cos(a) * t.r * 0.97, -5, t.y + Math.sin(a) * t.r * 0.97)); }
    }
    for (let x = 186; x <= 240; x += 9) for (let z = 60; z <= 96; z += 12) UG.add(cyl(0.3, 0.3, 7, conc, 6, x, -3.8, z));
    // Earth block (strata), only shown underground
    const strata = [[0x7a5c40, -0.6], [0x8c6d4a, -3.5], [0x6f6253, -7.5]];
    const earth = new T.Group(); UG.add(earth);
    const floor = new T.Mesh(new T.PlaneGeometry(D.SITE.w + 40, D.SITE.h + 40), new T.MeshStandardMaterial({ color: 0x4a3828, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(D.SITE.w / 2, -9.2, D.SITE.h / 2); floor.receiveShadow = false; earth.add(floor);
    for (const [x, z, w, d] of [[D.SITE.w / 2, -20, D.SITE.w + 40, 0.5], [D.SITE.w / 2, D.SITE.h + 20, D.SITE.w + 40, 0.5], [-20, D.SITE.h / 2, 0.5, D.SITE.h + 40], [D.SITE.w + 20, D.SITE.h / 2, 0.5, D.SITE.h + 40]]) {
      const wall = new T.Mesh(new T.BoxGeometry(w, 9.2, d), new T.MeshStandardMaterial({ color: 0x6b5139, transparent: true, opacity: 0.55 }));
      wall.position.set(x, -4.6, z); earth.add(wall);
    }
    strata.forEach(([c, y], i) => {
      const hgt = i === 0 ? 1.2 : i === 1 ? 4.6 : 3.4;
      const b = new T.Mesh(new T.BoxGeometry(D.SITE.w, hgt, D.SITE.h), new T.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.1, depthWrite: false, side: T.DoubleSide }));
      b.position.set(D.SITE.w / 2, y, D.SITE.h / 2); earth.add(b);
    });
    // Labels for buried services
    const ugLabel = (t, x, y, z) => { const s = K.labelSprite([{ t, s: 34 }], { scale: 9, bg: 'rgba(70,45,25,0.85)' }); s.position.set(x, y, z); UG.add(s); };
    ugLabel('Fire water ring main (buried)', 120, 1.5, 20); ugLabel('4" rail unloading line (buried)', 22, 1.5, 80);
    ugLabel('Cable trench', 115, 1.2, 95); ugLabel('Closed drain → interceptor', 130, 1.2, 104); ugLabel('Sphere piles', 70, 1.5, 52);

    K.mergeGroup(decor);
    H.root = root;
    return H;
  }
  function mesh2(geo, m, x, y, z) { const o = K.mesh(geo, m); o.position.set(x, y, z); return o; }

  L.site = { build, ROADS, TRACK_Z };
})(globalThis.LPG = globalThis.LPG || {});
