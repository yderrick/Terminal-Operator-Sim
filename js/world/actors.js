/* Live world: syncs trucks, rail cars, people, equipment animation, effects, sky and lighting from the simulation. */
(function (L) {
  'use strict';
  const K = L.kit;
  if (!K) return;
  const T = K.T, D = L.data, U = L.util;

  // ---------------------------------------------------------------- Paths for road tankers
  function along(pts, f) {
    let total = 0;
    const seg = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); total += l; }
    let d = U.clamp(f, 0, 1) * total;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const t = seg[i] ? Math.min(1, d / seg[i]) : 1;
        const a = pts[i], b = pts[i + 1];
        return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) };
      }
      d -= seg[i];
    }
    const n = pts.length;
    return { x: pts[n - 1][0], z: pts[n - 1][1], ang: Math.atan2(-(pts[n - 1][1] - pts[n - 2][1]), pts[n - 1][0] - pts[n - 2][0]) };
  }
  const ease = (f) => f * f * (3 - 2 * f);
  const slotY = (i) => 58 + 9 * (i % 6);
  function truckPath(S, tr) {
    const age = S.t - tr.stateT;
    const prog = (d) => ease(U.clamp(age / d, 0, 1));
    const bay = (id) => S.bays.find((b) => b.id === id) || S.bays[0];
    const sy = slotY(tr.parkSlot || 0);
    const N = Math.PI / 2, Sx = -Math.PI / 2, E = 0, Wst = Math.PI;
    switch (tr.state) {
      case 'QUEUE': { const q = S.trucks.filter((x) => x.state === 'QUEUE'); const i = q.indexOf(tr); return { x: 278 + 17 * Math.max(0, i), z: 162, ang: Wst }; }
      case 'TO_WB_IN': return along([[278, 162], [240, 162], [240, 141]], prog(90));
      case 'WB_IN_Q': return { x: 240, z: 153, ang: N };
      case 'WB_IN': return { x: 240, z: 140, ang: N };
      case 'TO_PARK': return along([[240, 140], [240, 128], [268, 112], [268, sy], [279, sy]], prog(60));
      case 'PARKED': case 'DECANT_WAIT': return { x: 279, z: sy, ang: E };
      case 'TO_BAY': { const b = bay(tr.bay); return along([[279, sy], [268, sy], [268, 104], [b.x, 104], [b.x, 78]], prog(90)); }
      case 'AT_BAY': return { x: bay(tr.bay).x, z: 78, ang: N };
      case 'TO_WB_OUT': { const b = bay(tr.lastBay || 1); return along([[b.x, 78], [b.x, 52], [182, 52], [182, 104], [204, 104], [204, 140]], prog(90)); }
      case 'WB_OUT_Q': return { x: 204, z: 122, ang: Sx };
      case 'WB_OUT': return { x: 204, z: 140, ang: Sx };
      case 'WEIGHED': return along([[204, 140], [204, 162], [218, 162]], prog(30));
      case 'EXITING': return along([[218, 162], [262, 162], [330, 162]], prog(60));
      case 'REJECTED': return along([[278, 162], [330, 162]], prog(60));
      default: return null;
    }
  }

  // Where a driver stands for each pre-load check (relative to the bay lane centre).
  const CHECK_SPOT = { pos: [2.0, -7.5, 'idle'], chocks: [1.8, 3.5, 'crouch'], ground: [-3.6, 4, 'crouch'], ppe: [3, -4, 'idle'], liquid: [2.4, 0.5, 'work'], vapour: [2.4, 2.5, 'work'], leak: [2.2, 1.5, 'crouch'], internal: [2.2, 2.2, 'valve'] };

  function create(world) {
    const { scene, site } = world;
    const A = { actors: new Map(), frame: 0, icons: new Map(), lights: [], tagT: 0 };
    const fx = K.particleField(7000, false), fxA = K.particleField(3000, true);
    scene.add(fx.points); scene.add(fxA.points);
    A.fx = fx; A.fxA = fxA;
    for (let i = 0; i < 3; i++) { const l = new T.PointLight(0xff8a3a, 0, 60, 2); scene.add(l); A.lights.push(l); }
    const weldLight = new T.PointLight(0x9fc6ff, 0, 18, 2); scene.add(weldLight);
    // Selection ring
    const ring = new T.Mesh(new T.RingGeometry(1.7, 2.2, 32), new T.MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 4; scene.add(ring);
    const hoverRing = new T.Mesh(new T.RingGeometry(1.7, 2.0, 32), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide }));
    hoverRing.rotation.x = -Math.PI / 2; hoverRing.visible = false; scene.add(hoverRing);
    A.ring = ring; A.hoverRing = hoverRing;
    // Rain
    const RAIN = 1800;
    const rainGeo = new T.BufferGeometry(); const rainPos = new Float32Array(RAIN * 6);
    rainGeo.setAttribute('position', new T.BufferAttribute(rainPos, 3));
    const rain = new T.LineSegments(rainGeo, new T.LineBasicMaterial({ color: 0xaab8c4, transparent: true, opacity: 0.45 }));
    rain.frustumCulled = false; rain.visible = false; scene.add(rain);
    for (let i = 0; i < RAIN; i++) { rainPos[i * 6 + 1] = Math.random() * 60; }
    // Lightning bolt
    const boltGeo = new T.BufferGeometry(); boltGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(30), 3));
    const bolt = new T.Line(boltGeo, new T.LineBasicMaterial({ color: 0xe8f0ff })); bolt.visible = false; scene.add(bolt);
    A.flash = 0;

    // ---------------------------------------------------------------- Actor registry
    function get(key, make) {
      let a = A.actors.get(key);
      if (!a) {
        const obj = make();
        obj.userData.actorKey = key;
        scene.add(obj);
        a = { key, obj, seen: 0, pos: new T.Vector3(), init: false, heading: 0, data: {} };
        A.actors.set(key, a);
      }
      a.seen = A.frame;
      return a;
    }
    function sweep() {
      for (const [k, a] of A.actors) if (a.seen !== A.frame) { scene.remove(a.obj); A.actors.delete(k); if (world.sel && world.sel.key === k) world.sel = null; }
    }

    // ---------------------------------------------------------------- People list from the sim
    function people(S) {
      const out = [];
      const add = (o) => out.push(o);
      // Field operators (positions are simulation truth)
      for (const c of S.crew) {
        const k = c.task ? c.task.kind : null;
        let mode = 'idle';
        if (c.injured) mode = 'lie';
        else if (c.state === 'walk' || c.state === 'retreat') mode = 'walk';
        else if (c.state === 'work') mode = { gauge: 'gauge', gastest: 'gauge', isolate: 'valve', repair: 'work', rail: 'work', odor: 'work', investigate: 'gauge', rounds: c.roundsMoving ? 'walk' : 'gauge', isolation: 'work' }[k] || 'idle';
        add({ key: 'crew:' + c.id, role: 'operator', seed: c.idx * 2 + 1, x: c.x, z: c.y, exact: true, mode, pick: { kind: 'crew', id: c.id }, badge: c.call.replace('Field ', 'F') });
      }
      // Drivers at the bays
      for (const b of S.bays) {
        const tr = b.truckId && S.trucks.find((t) => t.id === b.truckId);
        if (!tr || tr.state !== 'AT_BAY') continue;
        if (tr.engineOn && !tr.driverEvacuated) continue; // in the cab
        let spot = [4.6, 9, 'idle'];
        if (b.state === 'PREP') {
          const key = (L.rack.CHECKS[b.checkIdx] || {}).key;
          spot = b.hold ? [3.4, -2, 'idle'] : CHECK_SPOT[key] || spot;
        } else if (b.state === 'COMPLETE') spot = [2.4, 1.5, 'work'];
        let x = b.x + spot[0], z = 78 + spot[1], mode = spot[2];
        if (tr.driverEvacuated || S.muster.active) { x = D.POINTS.muster.x + 3 + (tr.id % 5) * 1.6; z = D.POINTS.muster.y - 3; mode = 'idle'; }
        add({ key: 'drv:' + tr.id, role: 'driver', seed: tr.id, x, z, mode, pick: { kind: 'driver', id: tr.id } });
      }
      // Gate guard
      const q = S.trucks.filter((t) => t.state === 'QUEUE');
      add({ key: 'guard', role: 'guard', seed: 3, x: q.length ? 272 : 257, z: q.length ? 158.5 : 151.5, mode: q.length ? 'gauge' : 'idle', pick: { kind: 'guard', id: 'guard' } });
      // Contractors and technicians on permits
      for (const pm of S.permits) {
        if (!['pending', 'active', 'workdone', 'suspended'].includes(pm.status)) continue;
        const base = { pick: { kind: 'permit', id: pm.no } };
        const role = pm.type === 'inhibit' || pm.type === 'override' ? 'instrument' : (pm.type === 'cold' || pm.type === 'electrical') ? 'fitter' : 'contractor';
        if (pm.status === 'pending') { add(Object.assign({ key: 'pm:' + pm.no + ':a', role, seed: pm.no.length, x: 156 + (S.permits.indexOf(pm) % 4) * 1.6, z: 158.5, mode: 'idle', waiting: true }, base)); continue; }
        const lx = pm.loc.x, lz = pm.loc.y;
        if (pm.status === 'suspended') { add(Object.assign({ key: 'pm:' + pm.no + ':a', role, seed: 1, x: lx + 8, z: lz + 6, mode: 'idle' }, base)); add(Object.assign({ key: 'pm:' + pm.no + ':b', role, seed: 2, x: lx + 9.5, z: lz + 6.5, mode: 'idle' }, base)); continue; }
        const done = pm.status === 'workdone';
        switch (pm.type) {
          case 'hot': add(Object.assign({ key: 'pm:' + pm.no + ':a', role, seed: 1, x: lx, z: lz, mode: done ? 'idle' : 'weld', weld: !done }, base)); add(Object.assign({ key: 'pm:' + pm.no + ':b', role, seed: 2, x: lx + 3, z: lz + 2.5, mode: 'idle' }, base)); break;
          case 'confined': add(Object.assign({ key: 'pm:' + pm.no + ':a', role, seed: 1, x: lx + 15, z: lz + 1, mode: 'crouch' }, base)); add(Object.assign({ key: 'pm:' + pm.no + ':b', role, seed: 2, x: lx + 16.5, z: lz + 3.5, mode: 'idle' }, base)); break;
          case 'height': { const t = S.tanks[pm.facts.height ? 'V102' : 'V102']; const ty = (t.r + 2.4) + t.r + 0.25; add(Object.assign({ key: 'pm:' + pm.no + ':a', role, seed: 1, x: t.x + 0.6, z: t.y - 0.5, y: ty, mode: done ? 'idle' : 'work' }, base)); add(Object.assign({ key: 'pm:' + pm.no + ':b', role, seed: 2, x: t.x + t.r + 3.2, z: t.y + 1.5, mode: 'idle' }, base)); break; }
          case 'excavation': add(Object.assign({ key: 'pm:' + pm.no + ':a', role, seed: 1, x: lx - 5, z: lz + 3, mode: 'wave' }, base)); break;
          case 'vehicle': add(Object.assign({ key: 'pm:' + pm.no + ':a', role, seed: 1, x: lx + 3, z: lz + 2, mode: 'idle' }, base)); break;
          default: add(Object.assign({ key: 'pm:' + pm.no + ':a', role, seed: 1, x: lx + 1.2, z: lz + 1.2, mode: done ? 'idle' : 'work' }, base)); if (pm.type !== 'inhibit') add(Object.assign({ key: 'pm:' + pm.no + ':b', role, seed: 2, x: lx - 1.5, z: lz + 2.2, mode: done ? 'idle' : 'valve' }, base));
        }
      }
      // Lab technician
      if (S.rail.cars.some((c) => c.sample && c.sample.status === 'lab')) add({ key: 'lab', role: 'lab', seed: 4, x: 134, z: 156, mode: 'gauge', pick: { kind: 'lab', id: 'lab' } });
      // Instrument technicians repairing radars
      for (const id of S.tankOrder) {
        const t = S.tanks[id];
        if (t.radar.repairT) add({ key: 'rad:' + id, role: 'instrument', seed: 5, x: t.x - 0.6, z: t.y + 0.4, y: t.r + 2.4 + t.r + 0.25, mode: 'work', pick: { kind: 'radar', id } });
      }
      // Odorant delivery driver
      if (S.odorDelivery.arrived && !S.odorDelivery.done) add({ key: 'odd', role: 'deliver', seed: 6, x: 180, z: 56, mode: S.odorDelivery.inProgress ? 'work' : 'idle', pick: { kind: 'odor', id: 'odd' } });
      // Firefighters
      const fb = S.fireBrigade;
      if (fb.onScene) {
        const tgt = fbTarget(S);
        for (let i = 0; i < 4; i++) add({ key: 'ff:' + i, role: 'fire', seed: i, x: tgt.ex + (i - 1.5) * 2.4, z: tgt.ez + (tgt.ez < tgt.z ? 4 : -4) + (i % 2) * 1.5, mode: 'hose', face: tgt, pick: { kind: 'fire', id: 'ff' } });
      }
      return out;
    }
    function fbTarget(S) {
      const t = S.fireBrigade.target;
      if (t && S.tanks[t]) { const k = S.tanks[t]; return { x: k.x, z: k.y, y: k.r + 2.4, ex: k.x + 4, ez: 74, label: k.tag }; }
      if (t === 'LR') return { x: 213, z: 78, y: 4, ex: 213, ez: 108, label: 'rack' };
      if (t === 'RL') return { x: 66, z: 140, y: 3, ex: 66, ez: 112, label: 'rail' };
      const f = S.fires.find((x) => !x.out) || S.fires[0];
      if (f) return { x: f.x, z: f.y, y: 3, ex: f.x + 2, ez: f.y > 100 ? f.y - 22 : f.y + 26, label: 'fire' };
      return { x: 150, z: 100, y: 2, ex: 150, ez: 104, label: 'standby' };
    }
    A.fbTarget = fbTarget;

    // ---------------------------------------------------------------- Per-frame sync
    A.update = function (S, dt, rate, flags, cam) {
      A.frame++;
      const t = performance.now() / 1000;
      const walkV = Math.min(45, 1.4 * Math.max(rate, 0.5));
      // ---------------- Trucks
      for (const tr of S.trucks) {
        if (tr.state === 'INBOUND' || tr.state === 'GONE') continue;
        const p = truckPath(S, tr);
        if (!p) continue;
        const a = get('trk:' + tr.id, () => { const g = K.truck(K.HAULIER_COLOURS[D.PEOPLE.hauliers.indexOf(tr.haulier) % K.HAULIER_COLOURS.length], tr.rigid); g.userData.pick = { kind: 'truck', id: tr.id }; return g; });
        if (!a.init) { a.pos.set(p.x, 0, p.z); a.heading = p.ang; a.init = true; }
        a.pos.x += (p.x - a.pos.x) * Math.min(1, dt * 6); a.pos.z += (p.z - a.pos.z) * Math.min(1, dt * 6);
        let dh = p.ang - a.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        a.heading += dh * Math.min(1, dt * 5);
        a.obj.position.copy(a.pos); a.obj.rotation.y = a.heading;
        const fill = a.obj.userData.fill;
        fill.visible = !!flags.xray;
        if (flags.xray) { const fr = U.clamp(tr.content / (tr.capL * 0.51), 0.02, 1); fill.scale.y = 2.2 * fr; fill.position.y = -1.1 + 1.1 * fr; }
        // Exhaust
        const moving = ['TO_WB_IN', 'TO_PARK', 'TO_BAY', 'TO_WB_OUT', 'EXITING', 'REJECTED'].includes(tr.state) || tr.engineOn;
        if (moving && Math.random() < dt * (tr.engineOn ? 14 : 6)) {
          const w = a.obj.userData.smoke.getWorldPosition(new T.Vector3());
          fx.emit(w.x, w.y, w.z, (Math.random() - 0.5) * 0.6, 1.6, (Math.random() - 0.5) * 0.6, 2.2, 0.9, 0.35, 0.35, 0.36, tr.engineOn ? 0.55 : 0.3, 1.4, 0.4, 0);
        }
        if (tr.psvLift) emitJet(a.obj.position.x - Math.cos(a.heading) * 2, 4.2, a.obj.position.z + Math.sin(a.heading) * 2, 0.8);
      }
      // ---------------- Rail cars and locomotive
      let locoWanted = null;
      for (const c of S.rail.cars) {
        const spot = D.POINTS[c.spotId === 'R1' ? 'railR1' : 'railR2'];
        let x = null;
        const vis = ['SPOTTED', 'UNLOADING'].includes(c.state) || (c.state === 'RELEASED' && S.t - c.releasedT < 300);
        if (!vis) continue;
        const a = get('car:' + c.id, () => { const g = K.railCar(); g.userData.pick = { kind: 'car', id: c.id }; return g; });
        if (!a.init) { a.data.spawn = S.t - c.arrivalT < 400 && c.state !== 'RELEASED' ? S.t : -1e9; a.init = true; }
        const arrAge = S.t - a.data.spawn;
        if (c.state === 'RELEASED') { const f = ease(U.clamp((S.t - c.releasedT) / 240, 0, 1)); x = spot.x - f * 200; locoWanted = { x: x - 18, phase: 'out' }; }
        else if (arrAge < 200) { const f = ease(U.clamp(arrAge / 200, 0, 1)); x = -160 + (spot.x + 160) * f; locoWanted = { x: x - 18 }; }
        else if (arrAge < 380) { x = spot.x; const f = ease(U.clamp((arrAge - 200) / 180, 0, 1)); locoWanted = { x: spot.x - 18 - f * 180 }; }
        else x = spot.x;
        a.obj.position.set(x, 0, L.site.TRACK_Z);
        const fl = a.obj.userData.fill; fl.visible = !!flags.xray;
        if (flags.xray) { const fr = U.clamp(c.fill, 0.02, 1); fl.scale.y = 2.8 * fr; fl.position.y = -1.4 + 1.4 * fr; }
        // Hose
        if (!a.data.hose) { a.data.hose = K.tube(new T.Vector3(0, 1.4, 1.6), new T.Vector3(0, 1.2, 4.2), 0.14, K.mat(0x222222)); a.obj.add(a.data.hose); }
        a.data.hose.visible = c.connected && x === spot.x;
        const flag = site[(c.spotId === 'R1' ? 'railR1' : 'railR2') + 'flag'];
        if (flag) flag.visible = !!c.secured;
      }
      if (locoWanted) {
        const a = get('loco', () => { const g = K.loco(); g.userData.pick = { kind: 'loco', id: 'loco' }; return g; });
        a.obj.position.set(locoWanted.x, 0, L.site.TRACK_Z);
        const sh = get('shunter', () => withPick(K.person('shunter', 1), { kind: 'shunter', id: 'shunter' }));
        placePerson(sh, locoWanted.x + 7, L.site.TRACK_Z + 3, 'walk', dt, walkV, true);
      }
      // ---------------- People
      for (const p of people(S)) {
        const a = get(p.key, () => {
          const g = K.person(p.role, p.seed || 0); g.userData.pick = p.pick;
          if (p.badge) { const b = K.labelSprite([{ t: p.badge, s: 60, c: '#fff' }], { scale: 3.2, bg: 'rgba(31,95,122,0.92)' }); b.position.y = 5.4; g.add(b); g.userData.badge = b; }
          return g;
        });
        a.data.p = p;
        a.obj.userData.pick = p.pick;
        if (p.exact) {
          const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
          if (!a.init) { a.pos.set(p.x, p.y || 0, p.z); a.init = true; }
          if (Math.hypot(dx, dz) > 0.05) a.heading = Math.atan2(dx, dz);
          a.pos.set(p.x, p.y || 0, p.z);
          a.obj.position.copy(a.pos); a.obj.rotation.y = a.heading;
          K.animatePerson(a.obj, p.mode, dt, Math.min(3, rate / 10 + 0.6));
        } else placePerson(a, p.x, p.z, p.mode, dt, walkV, false, p.y || 0, p.face);
        if (p.weld && Math.random() < dt * 40) { const w = a.obj.position; fxA.emit(w.x + 0.9, 0.8, w.z + 0.9, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.5, 0.35, 1, 0.75, 0.3, 1, -0.2, 0.5, 9.8); weldLight.position.set(w.x + 1, 1.5, w.z + 1); weldLight.intensity = 1.5 + Math.random() * 2.5; }
        if (p.role === 'fire' && p.face) emitHose(a.obj.position, p.face, dt);
      }
      if (!S.permits.some((pm) => pm.status === 'active' && pm.type === 'hot')) weldLight.intensity = 0;
      speech(S, dt);
      // Machines on permits
      for (const pm of S.permits) {
        if (pm.status !== 'active' && pm.status !== 'workdone' && pm.status !== 'suspended') continue;
        if (pm.type === 'excavation') {
          const a = get('exc:' + pm.no, () => withPick(K.excavator(), { kind: 'permit', id: pm.no }));
          a.obj.position.set(pm.loc.x, 0, pm.loc.y); a.obj.rotation.y = 0.6;
          if (pm.status === 'active') { const u = a.obj.userData; u.upper.rotation.y = Math.sin(t * 0.7) * 0.7; u.boom.rotation.z = -0.25 + Math.sin(t * 1.4) * 0.2; u.stick.rotation.z = Math.sin(t * 1.4 + 1) * 0.3; }
          const tr = get('trench:' + pm.no, () => { const m = new T.Mesh(new T.BoxGeometry(14, 0.12, 1.4), K.mat(0x3b2a1c)); return m; });
          tr.obj.position.set(pm.loc.x + 4, 0.03, pm.loc.y + 4);
        }
        if (pm.type === 'vehicle') { const a = get('van:' + pm.no, () => withPick(K.vanModel(0xe9e6dc), { kind: 'permit', id: pm.no })); a.obj.position.set(pm.loc.x, 0, pm.loc.y); a.obj.rotation.y = Math.PI / 2; }
        if (pm.type === 'confined' && pm.status === 'active') { /* entrant is inside the vessel */ }
      }
      if (S.odorDelivery.arrived && !S.odorDelivery.done) { const a = get('odvan', () => withPick(K.vanModel(0x6b4f7a), { kind: 'odor', id: 'odd' })); a.obj.position.set(188, 0, 47.5); a.obj.rotation.y = Math.PI; }
      // Fire engine
      if (S.fireBrigade.onScene) {
        const tg = fbTarget(S);
        const a = get('fengine', () => withPick(K.fireEngine(), { kind: 'fire', id: 'ff' }));
        a.obj.position.set(tg.ex - 8, 0, tg.ez + (tg.ez < tg.z ? 9 : -9)); a.obj.rotation.y = 0;
        a.obj.userData.beacon.material.emissiveIntensity = (Math.sin(t * 12) > 0 ? 2 : 0.2);
      }
      sweep();

      // ---------------- Equipment
      equipment(S, dt, t, flags);
      effects(S, dt, t, flags);
      icons(S, t, flags, cam);
      sky(S, dt, t, flags, cam);
      fx.update(dt); fxA.update(dt);
      // selection rings
      placeRing(ring, world.sel, t, true);
      placeRing(hoverRing, world.hover && (!world.sel || world.hover.key !== world.sel.key) ? world.hover : null, t, false);
    };

    const RING_SCALE = { valve: 1.4, truck: 4.6, car: 5.6, tank: 5.2, bay: 3.2, pump: 1.6, comp: 3, gd: 0.8, fd: 0.8, loco: 4.6 };
    function placeRing(r, sel, t, pulse) {
      if (!sel) { r.visible = false; return; }
      const a = sel.key && A.actors.get(sel.key);
      let x, y = 0, z, sc;
      if (a) { x = a.obj.position.x; y = a.obj.position.y || 0; z = a.obj.position.z; sc = RING_SCALE[sel.kind] || 1.1; }
      else if (sel.pos) { x = sel.pos.x; z = sel.pos.z; sc = sel.scale || RING_SCALE[sel.kind] || 2; }
      else { r.visible = false; return; }
      r.visible = true;
      r.position.set(x, y + 0.15, z);
      r.scale.setScalar(sc * (pulse ? 1 + 0.06 * Math.sin(t * 5) : 1));
    }
    // Radio calls appear as speech bubbles over the operator who made them.
    A.lastLog = A.lastLog || 0; A.bubbles = A.bubbles || {};
    function speech(S, dt) {
      for (const l of S.log) {
        if (l.id <= A.lastLog) continue;
        A.lastLog = l.id;
        if (l.cat !== 'radio') continue;
        const c = S.crew.find((q) => l.text.startsWith(q.call + ':'));
        if (!c) continue;
        let txt = l.text.slice(c.call.length + 1).trim().replace(/^“|”$/g, '');
        if (txt.length > 64) txt = txt.slice(0, 61) + '…';
        const a = A.actors.get('crew:' + c.id);
        if (!a) continue;
        const old = A.bubbles[c.id];
        if (old) a.obj.remove(old.s);
        const sp = K.labelSprite([{ t: txt, s: 30, c: '#1d2224' }], { scale: 7 / K.PSCALE * 2, w: 900, h: 70, bg: 'rgba(250,248,240,0.95)' });
        sp.position.y = 3.6; sp.renderOrder = 12;
        a.obj.add(sp);
        A.bubbles[c.id] = { s: sp, ttl: 6 };
      }
      for (const id of Object.keys(A.bubbles)) {
        const b = A.bubbles[id];
        b.ttl -= dt;
        if (b.ttl <= 0) { if (b.s.parent) b.s.parent.remove(b.s); delete A.bubbles[id]; }
      }
    }
    function withPick(g, pick) { g.userData.pick = pick; return g; }
    function placePerson(a, x, z, mode, dt, v, exactish, y, face) {
      if (!a.init) { a.pos.set(x, y || 0, z); a.init = true; }
      const dx = x - a.pos.x, dz = z - a.pos.z, d = Math.hypot(dx, dz);
      let m = mode;
      if (d > 0.3) {
        const step = Math.min(d, v * dt);
        a.pos.x += dx / d * step; a.pos.z += dz / d * step;
        a.heading = Math.atan2(dx, dz); m = 'walk';
      } else if (face) a.heading = Math.atan2(face.x - a.pos.x, face.z - a.pos.z);
      a.pos.y += ((y || 0) - a.pos.y) * Math.min(1, dt * 4);
      if (d > 60 && (y || 0) > 0) a.pos.set(x, y, z);
      a.obj.position.copy(a.pos); a.obj.rotation.y = a.heading;
      K.animatePerson(a.obj, m, dt, Math.min(3, v / 2));
    }

    // ---------------------------------------------------------------- Equipment animation
    function equipment(S, dt, t, flags) {
      for (const id of S.tankOrder) {
        const tk = S.tanks[id], g = site.spheres[id], u = g.userData;
        u.shell.material.transparent = !!flags.xray;
        u.shell.material.opacity = flags.xray ? 0.28 : 1;
        u.shell.material.depthWrite = !flags.xray;
        u.liquid.visible = !!flags.xray;
        u.plane.constant = (u.centreY - u.r) + tk.levelMeas / 1000;
      }
      for (const p of Object.values(S.pumps)) {
        const g = site.pumps[p.id];
        g.userData.fan.rotation.x += (p.running ? 30 : 0) * dt;
        const lm = g.userData.lamp.material;
        const col = p.tripped ? (Math.sin(t * 8) > 0 ? 0xff2a1a : 0x330000) : p.loto ? 0xffa21a : p.running ? 0x2aff5a : p.isolated ? 0x3a6aff : 0x222222;
        lm.emissive.setHex(col); lm.emissiveIntensity = 1.2;
      }
      for (const b of S.bays) {
        const arms = site.arms[b.id];
        const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId);
        const at = tr && tr.state === 'AT_BAY';
        const liqOn = at && (['READY', 'LOADING', 'STOPPED', 'DECANTING'].includes(b.state) || (b.state === 'PREP' && b.checks.liquid === 'ok') || (b.state === 'COMPLETE' && S.t - b.completeT < 150));
        const vapOn = at && (['READY', 'LOADING', 'STOPPED', 'DECANTING'].includes(b.state) || (b.state === 'PREP' && b.checks.vapour === 'ok') || (b.state === 'COMPLETE' && S.t - b.completeT < 110));
        aimArm(arms.liq, liqOn, b.x + 1.4, 78.8, dt);
        aimArm(arms.vap, vapOn, b.x + 1.4, 81.5, dt);
        const go = b.state === 'ARRIVING' || (b.state === 'IDLE' && !b.suspended && !b.damaged && S.trucks.some((x) => x.state === 'TO_BAY' && x.bay === b.id));
        arms.light.grn.material.emissiveIntensity = go ? 1.6 : 0;
        arms.light.red.material.emissiveIntensity = go ? 0 : 1.2;
      }
      site.comp.fly.rotation.x += (S.rail.comp.running ? 18 : 0) * dt;
      // Gate barrier opens when a truck is close and moving through
      const near = S.trucks.some((x) => ['TO_WB_IN', 'EXITING', 'REJECTED'].includes(x.state) && S.t - x.stateT < 45);
      site.barrier.rotation.z += ((near ? 1.35 : 0) - site.barrier.rotation.z) * Math.min(1, dt * 4);
      // Windsock
      const W = S.weather, b = (W.windDir + 180) * Math.PI / 180;
      site.windsock.pivot.rotation.y = Math.PI / 2 - b;
      site.windsock.sock.rotation.z = -(1 - Math.min(1, W.wind / 9)) * 1.1 + Math.sin(t * 3) * 0.04;
      // Detectors
      for (const g of S.gd) {
        const led = site.detectors[g.id].userData.led.material;
        const c = g.fault ? 0x666666 : g.inhibited ? 0x3a6aff : g.lel >= 40 ? (Math.sin(t * 10) > 0 ? 0xff2a1a : 0x330000) : g.lel >= 20 ? 0xffc21a : 0x22ff55;
        led.emissive.setHex(c); led.color.setHex(c);
      }
      for (const f of S.fd) { const led = site.flames[f.id].userData.led.material; const c = f.fire && !f.inhibited ? 0xff2a1a : f.inhibited ? 0x3a6aff : 0x22ff55; led.emissive.setHex(c); led.color.setHex(c); }
      // Valve positions
      for (const id of S.tankOrder) {
        const tk = S.tanks[id], v = site.valves[id];
        const setV = (g, open) => { const m = g.userData.body; const c = open ? 0x2aa84a : 0xc2281f; if (m.color.getHex() !== c) { m.color.setHex(c); m.emissive.setHex(open ? 0x0f5a22 : 0x5a0f0f); } };
        setV(v.in, L.plant.inletOpen(S, tk)); setV(v.out, L.plant.outletOpen(S, tk));
      }
      // Labels
      for (const s of site.labels) s.visible = !!flags.labels;
      A.tagT -= dt;
      if (A.tagT <= 0) {
        A.tagT = 0.6;
        for (const id of S.tankOrder) {
          const tk = S.tanks[id], tag = site.spheres[id].userData.tag;
          const alm = tk.fillMeas > 0.85 || tk.P > tk.pah || tk.psvLift;
          tag.redraw([{ t: tk.tag + (tk.radar.flagged ? ' · LT SUSPECT' : ''), s: 50, c: alm ? '#ffb4a8' : '#f4f2ea' }, { t: (tk.fillMeas * 100).toFixed(1) + '%  ·  ' + tk.P.toFixed(2) + ' barg  ·  ' + tk.Ts.toFixed(1) + ' °C', s: 34, c: alm ? '#ffb4a8' : '#cfd6d8', f: K.MONO }]);
          tag.visible = !!flags.labels || alm;
        }
      }
    }
    function aimArm(arm, on, tx, tz, dt) {
      const u = arm.userData;
      const bx = arm.position.x, bz = arm.position.z;
      const want = on ? Math.atan2(tx - bx, tz - bz) : (bz < 78 ? Math.PI : 0) + 0.0;
      let d = want - u.yaw.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      u.yaw.rotation.y += d * Math.min(1, dt * 3);
      const dist = Math.hypot(tx - bx, tz - bz);
      const reach = on ? U.clamp(dist / 3.4, 0.6, 1) : 0.75;
      u.yaw.scale.z += (reach - u.yaw.scale.z) * Math.min(1, dt * 3);
      u.drop.rotation.x += ((on ? 0 : 0.4) - u.drop.rotation.x) * Math.min(1, dt * 3);
    }

    // ---------------------------------------------------------------- Effects
    function emitJet(x, y, z, strength) {
      for (let i = 0; i < 3 * strength; i++) fx.emit(x, y, z, (Math.random() - 0.5) * 1.5, 9 + Math.random() * 5, (Math.random() - 0.5) * 1.5, 1.6, 1.2, 0.95, 0.96, 0.98, 0.5, 3.5, 0.9, -0.5);
    }
    const tmp = new T.Vector3();
    function emitHose(from, to, dt) {
      if (Math.random() > dt * 30) return;
      const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz) || 1;
      const time = Math.max(0.8, d / 22);
      fx.emit(from.x + dx / d * 1.5, 2.6, from.z + dz / d * 1.5, dx / time, ((to.y || 4) + 4.9 * time * time - 2.6) / time, dz / time, time + 0.3, 0.55, 0.75, 0.86, 0.98, 0.65, 0.4, 0, 9.8);
    }
    function effects(S, dt, t, flags) {
      const W = S.weather;
      const to = (W.windDir + 180) * Math.PI / 180;
      const wx = Math.sin(to), wz = -Math.cos(to);
      // Gas clouds
      for (const lk of S.leaks) {
        if (lk.rate < 0.003) continue;
        const visible = lk.seen || lk.rate > 0.12 || S.gd.some((g) => !g.inhibited && !g.fault && g.lel >= 10 && U.dist(g.x, g.y, lk.x, lk.y) < 35);
        if (!visible) continue;
        const n = Math.min(40, lk.rate * 140 + 2) * dt * 3;
        const u = Math.max(0.8, W.wind) * 1.6;
        for (let i = 0; i < n; i++) fx.emit(lk.x + (Math.random() - 0.5), 1.2 + Math.random(), lk.y + (Math.random() - 0.5), wx * u + (Math.random() - 0.5) * 1.5, 0.15, wz * u + (Math.random() - 0.5) * 1.5, 4 + 14 * Math.sqrt(lk.rate), 1.6, 0.93, 0.92, 0.8, 0.2, 1.8 + 3 * Math.sqrt(lk.rate), 0.05, 0);
      }
      // Fires
      let li = 0;
      for (const f of S.fires) {
        const sz = f.out ? 0.2 : 0.4 + Math.sqrt(Math.max(f.size, 0.02)) * 2.2;
        const n = 22 * sz * dt * 4;
        for (let i = 0; i < n; i++) {
          const hot = Math.random();
          // Jet flame: hot yellow core near the source, orange-red tongues further out.
          const v = 5 + Math.random() * 9 * sz;
          fxA.emit(f.x + (Math.random() - 0.5) * sz * 0.6, 1 + Math.random() * 0.6, f.y + (Math.random() - 0.5) * sz * 0.6, wx * 2.5 + (Math.random() - 0.5) * 2.5, v, wz * 2.5 + (Math.random() - 0.5) * 2.5, 0.35 + Math.random() * 0.5, 1.1 + sz * 1.3, 1, 0.22 + hot * 0.5, 0.02 + hot * 0.06, 0.26, -1.2, 0.5, 0);
        }
        for (let i = 0; i < n * 0.35; i++) fx.emit(f.x + (Math.random() - 0.5) * sz, 4 + sz * 4, f.y, wx * 4, 3 + Math.random() * 2, wz * 4, 6, 3 + sz * 1.5, 0.12, 0.11, 0.11, 0.55, 2.6, 0.1, -0.2);
        if (li < A.lights.length) { const l = A.lights[li++]; l.position.set(f.x, 4, f.y); l.intensity = (2.5 + Math.random()) * Math.min(1, sz); }
      }
      for (; li < A.lights.length; li++) A.lights[li].intensity = 0;
      // PSV lift on spheres
      for (const id of S.tankOrder) {
        const tk = S.tanks[id];
        if (tk.psvLift) { site.spheres[id].userData.psvTip.getWorldPosition(tmp); emitJet(tmp.x, tmp.y, tmp.z, 2); }
        const del = L.plant.tankDelugeEff(S, id);
        if (del > 0) {
          const g = site.spheres[id], u = g.userData;
          for (let i = 0; i < 26 * dt * 10; i++) { const a = Math.random() * Math.PI * 2; const r = u.r * 0.6; fx.emit(g.position.x + Math.cos(a) * r, u.centreY + u.r * 0.85, g.position.z + Math.sin(a) * r, Math.cos(a) * 4, 1, Math.sin(a) * 4, 1.6, 0.45, 0.72, 0.85, 0.98, 0.55 * del, 0.2, 0, 9.8); }
        }
      }
      if (L.plant.delugeEff(S, 'DV301') > 0) for (let i = 0; i < 70 * dt * 6; i++) fx.emit(184 + Math.random() * 58, 8.3, 60 + Math.random() * 36, 0, -2, 0, 1.2, 0.4, 0.72, 0.85, 0.98, 0.5, 0, 0, 9.8);
      if (L.plant.delugeEff(S, 'DV201') > 0) for (let i = 0; i < 40 * dt * 6; i++) fx.emit(44 + Math.random() * 70, 5, 68 + Math.random() * 14, 0, -2, 0, 0.8, 0.4, 0.72, 0.85, 0.98, 0.5, 0, 0, 9.8);
      if (L.plant.delugeEff(S, 'DV401') > 0) for (let i = 0; i < 40 * dt * 6; i++) fx.emit(30 + Math.random() * 70, 6, 132 + Math.random() * 12, 0, -2, 0, 1, 0.4, 0.72, 0.85, 0.98, 0.5, 0, 0, 9.8);
      // Flow tracers along the pipework that is actually moving product
      const H = S.headers;
      if (H.propane.flow > 0.5) tracer(FLOW.propane.concat([[S.tanks[H.propane.source].x, 0.8, S.tanks[H.propane.source].y + 9]]), dt, 0.95, 0.75, 0.25);
      if (H.butane.flow > 0.5) tracer(FLOW.butane, dt, 0.95, 0.85, 0.45);
      for (const b of S.bays) if (b.flowing) tracer([[b.x + 4.2, 6.2, 70.5], [b.x + 4.2, 5.2, 74]], dt, 1, 0.8, 0.3, 4);
      if (S.rail.comp.running && ((S.rail.flowKgS || 0) > 0.01 || (S.rail.vapKgS || 0) < -0.01)) { const car = S.rail.cars.find((c) => c.id === S.rail.comp.lineup); if (car) tracer(car.spotId === 'R1' ? FLOW.railR1 : FLOW.railR2, dt, 1, 0.82, 0.35); }
      // Diesel fire pump exhaust
      if (S.fw.diesel.running && Math.random() < dt * 10) fx.emit(site.fwExhaust.position.x, site.fwExhaust.position.y + 1, site.fwExhaust.position.z, 0.2, 2, 0.2, 3, 1.2, 0.2, 0.2, 0.22, 0.5, 1.6, 0.3, 0);
    }

    // Pipe routes for flow tracers (same coordinates as the site pipework)
    const FLOW = {
      propane: [[50, 1.6, 75], [50, 6.2, 75], [50, 6.2, 86], [178, 6.2, 86], [178, 6.2, 70.5], [242, 6.2, 70.5]],
      butane: [[96, 1.6, 75], [96, 6.9, 75], [96, 6.9, 89], [176, 6.9, 89], [176, 6.9, 67.5], [242, 6.9, 67.5]],
      railR1: [[46, 0.6, 133], [46, 0.6, 128], [66, 0.6, 128], [66, 0.6, 126]],
      railR2: [[86, 0.6, 133], [86, 0.6, 128], [66, 0.6, 128], [66, 0.6, 126]],
    };
    function tracer(path, dt, r, g, b, rate) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], c = path[i + 1];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        if (len < 0.5) continue;
        const v = 14;
        if (Math.random() < dt * (rate || 1) * Math.max(1, len / 12)) {
          fxA.emit(a[0], a[1], a[2], (c[0] - a[0]) / len * v, (c[1] - a[1]) / len * v, (c[2] - a[2]) / len * v, len / v, 0.55, r, g, b, 0.9, 0, 0, 0);
        }
      }
    }

    // ---------------------------------------------------------------- Status icons
    function icons(S, t, flags, cam) {
      const want = [];
      const add = (key, glyph, bg, x, y, z, tip) => want.push({ key, glyph, bg, x, y, z, tip });
      const P1 = '#d8261f', P2 = '#e37a00', BLUE = '#2f7fbf', AMB = '#d9a400';
      const q = S.trucks.filter((x) => x.state === 'QUEUE');
      if (q.length) add('gate', '?', BLUE, 278, 8, 162, q.length + ' truck(s) waiting at the gate');
      for (const b of S.bays) {
        if (b.hold) add('bay' + b.id, '!', P2, b.x, 9, 78, b.tag + ': ' + b.hold.msg);
        else if (b.state === 'READY') add('bay' + b.id, '?', BLUE, b.x, 9, 78, b.tag + ' ready: set preset');
        else if (b.state === 'STOPPED') add('bay' + b.id, '!', P2, b.x, 9, 78, b.tag + ' stopped: ' + b.stopReason);
        const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId);
        if (tr && tr.engineOn) add('eng' + b.id, '!', P1, b.x, 11, 70, 'Engine running at ' + b.tag);
      }
      for (const tr of S.trucks) if (tr.state === 'WEIGHED') add('rel' + tr.id, '?', BLUE, 218, 7, 162, tr.plate + ': release or decant');
      for (const p of Object.values(S.pumps)) {
        if (p.loto) add('pl' + p.id, 'L', AMB, p.x, 5, p.y, p.tag + ' locked out');
        else if (p.tripped) add('pl' + p.id, '!', P1, p.x, 5, p.y, p.tag + ' tripped');
      }
      for (const g of S.gd) if (!g.inhibited && !g.fault && g.lel >= 20) add('gd' + g.id, 'G', g.lel >= 40 ? P1 : P2, g.x, 6, g.y, g.tag + ' ' + Math.round(g.lel) + '% LEL');
      for (const f of S.fires) if (!f.out) add('fire' + f.id, 'F', P1, f.x, 14, f.y, 'Fire: ' + f.label);
      for (const c of S.crew) if (c.injured) add('inj' + c.id, '+', P1, c.x, 4, c.y, c.name + ' injured');
      for (const c of S.rail.cars) {
        const pt = D.POINTS[c.spotId === 'R1' ? 'railR1' : 'railR2'];
        const need = (c.state === 'SPOTTED' && !c.secured && !c.busy) || (c.phase === 'liquid-done' && S.rail.comp.mode === 'LIQUID' && S.rail.comp.lineup === c.id) || (c.sample && c.sample.status === 'done' && !c.sample.pass && !c.rejected && c.received < 500);
        if (need && ['SPOTTED', 'UNLOADING'].includes(c.state)) add('car' + c.id, '?', BLUE, pt.x, 9, L.site.TRACK_Z, 'Rail car at ' + c.spotId + ' needs you');
      }
      for (const pm of S.permits) {
        if (pm.status === 'pending') add('pm' + pm.no, '?', BLUE, 156 + (S.permits.indexOf(pm) % 4) * 1.6, 7, 158.5, 'Permit ' + pm.no + ' waiting for you');
        if (pm.status === 'workdone') add('pm' + pm.no, '✓', '#2e8b57', pm.loc.x, 7, pm.loc.y, pm.no + ' work complete: close the permit');
      }
      for (const id of S.tankOrder) { const tk = S.tanks[id]; if (tk.psvLift || tk.lshhTrip || tk.fillMeas > 0.9) add('tk' + id, '!', P1, tk.x, tk.r * 2 + 9, tk.y, tk.tag + ' alarm'); }
      if (S.rail.comp.tripped) add('comp', '!', P2, 66, 8, 124, 'C-301 tripped');
      // Crew asking for approval: a purple question mark over the place the decision is about.
      for (const ap of S.approvals || []) if (ap.loc) add('ap' + ap.id, '?', '#7a4fc0', ap.loc.x, 13, ap.loc.z, 'Crew ask: ' + ap.title + ' (click to answer)');
      const seen = new Set();
      for (const w of want) {
        seen.add(w.key);
        let s = A.icons.get(w.key);
        if (!s || s.userData.glyph !== w.glyph + w.bg) {
          if (s) scene.remove(s);
          s = K.iconSprite(w.glyph, w.bg, '#fff', 3.6);
          s.userData.glyph = w.glyph + w.bg;
          s.userData.pick = { kind: 'icon', id: w.key };
          scene.add(s); A.icons.set(w.key, s);
        }
        s.userData.tip = w.tip;
        const camD = cam ? cam.position.distanceTo(new T.Vector3(w.x, w.y, w.z)) : 100;
        const k = U.clamp(camD / 80, 0.6, 2.2);
        const pulse = 1 + 0.1 * Math.sin(t * 5);
        s.scale.setScalar(3.4 * k * pulse);
        s.position.set(w.x, w.y + Math.sin(t * 2.4) * 0.4 + 1.5 * k, w.z);
      }
      for (const [k, s] of A.icons) if (!seen.has(k)) { scene.remove(s); A.icons.delete(k); }
    }

    // ---------------------------------------------------------------- Sky, sun, weather
    const skyDay = new T.Color(0xb8cbd6), skyDawn = new T.Color(0xe9c6a4), skyStorm = new T.Color(0x5f686e), skyNight = new T.Color(0x1d2733);
    const sunWarm = new T.Color(0xffc98e), sunWhite = new T.Color(0xfff4e2);
    const tmpC = new T.Color();
    function sky(S, dt, t, flags, cam) {
      const W = S.weather;
      const h = U.hourOf(S);
      const th = Math.PI * (h - 6.0) / 13.4;
      const elev = Math.max(-0.2, Math.sin(th)) * 0.95;
      const day = U.clamp(elev * 2.2 + 0.15, 0, 1);
      const storm = U.clamp(W.rain * 1.2 + (W.lightningKm < 12 ? 0.3 : 0), 0, 1);
      const dir = new T.Vector3(Math.cos(th), Math.max(0.12, elev + 0.05), Math.sin(th) * 0.7).normalize();
      world.sun.position.copy(dir.multiplyScalar(320)).add(new T.Vector3(145, 0, 86));
      world.sun.target.position.set(145, 0, 86);
      tmpC.copy(sunWarm).lerp(sunWhite, U.clamp(elev * 2, 0, 1));
      world.sun.color.copy(tmpC);
      world.sun.intensity = (0.18 + 0.72 * day) * (1 - 0.6 * storm) * (1 - 0.3 * W.cloud);
      world.hemi.intensity = 0.3 + 0.28 * day * (1 - 0.3 * storm);
      tmpC.copy(skyDawn).lerp(skyDay, U.clamp(elev * 1.8, 0, 1)).lerp(skyNight, U.clamp(0.3 - elev * 2, 0, 1)).lerp(skyStorm, storm * 0.85);
      if (A.flash > 0) { tmpC.lerp(new T.Color(0xeef4ff), A.flash); world.hemi.intensity += A.flash * 2.2; A.flash = Math.max(0, A.flash - dt * 5); }
      world.scene.background.copy(tmpC);
      world.scene.fog.color.copy(tmpC);
      world.scene.fog.near = 260 - storm * 120; world.scene.fog.far = 900 - storm * 450;
      const lampsOn = day < 0.35 || storm > 0.4;
      for (const m of site.lamps) m.emissiveIntensity = lampsOn ? 1.6 : 0;
      for (const m of site.windows) m.emissiveIntensity = lampsOn ? 0.7 : 0.05;
      world.flood.intensity = lampsOn ? 0.55 : 0;
      // Rain around the camera target
      rain.visible = W.rain > 0.05;
      if (rain.visible) {
        const c = world.camCtl.target;
        const n = Math.floor(RAIN * U.clamp(W.rain, 0.2, 1));
        const ws = W.wind * 0.3;
        for (let i = 0; i < RAIN; i++) {
          const o = i * 6;
          if (i >= n) { rainPos[o + 1] = -100; rainPos[o + 4] = -100; continue; }
          let y = rainPos[o + 1] - dt * 38;
          if (y < 0 || rainPos[o] === 0) { y = 30 + Math.random() * 40; rainPos[o] = c.x + (Math.random() - 0.5) * 220; rainPos[o + 2] = c.z + (Math.random() - 0.5) * 220; }
          rainPos[o + 1] = y; rainPos[o + 3] = rainPos[o] + ws; rainPos[o + 4] = y + 1.6; rainPos[o + 5] = rainPos[o + 2];
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
      // Lightning: flash and bolt on fresh strikes
      const last = W.strikes[W.strikes.length - 1];
      if (last && last !== A.lastStrike) {
        A.lastStrike = last;
        if (last.km < 25) {
          A.flash = U.clamp(1.2 - last.km / 25, 0.15, 1);
          const ang = Math.random() * Math.PI * 2, dist = 200 + last.km * 20;
          const bx = 145 + Math.cos(ang) * dist, bz = 86 + Math.sin(ang) * dist;
          const arr = bolt.geometry.attributes.position.array;
          for (let i = 0; i < 10; i++) { arr[i * 3] = bx + (Math.random() - 0.5) * 18; arr[i * 3 + 1] = 160 - i * 17.8; arr[i * 3 + 2] = bz + (Math.random() - 0.5) * 18; }
          bolt.geometry.attributes.position.needsUpdate = true;
          bolt.visible = true; A.boltT = 0.18;
          if (world.onThunder) world.onThunder(last.km);
        }
      }
      if (A.boltT > 0) { A.boltT -= dt; if (A.boltT <= 0) bolt.visible = false; }
    }

    return A;
  }

  L.actors = { create, truckPath };
})(globalThis.LPG = globalThis.LPG || {});
