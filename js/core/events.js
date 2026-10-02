/* Shift scenario: handover state, routine tasks, gauging & reconciliation, latent faults, random events. */
(function (L) {
  'use strict';
  const U = L.util, P = L.phys, D = L.data, sim = L.sim;

  // ===================================================================================
  // Measured stock (what the gauging worksheet calculates)
  // ===================================================================================
  function measuredStock(S, t, levelMm, tempC) {
    const Vobs = P.sphereVol(levelMm / 1000, t.r);
    const rho15 = P.rhoL15(t.labWP !== undefined ? t.labWP : t.wP);
    const vcf = P.rhoL(t.labWP !== undefined ? t.labWP : t.wP, tempC) / rho15;
    const V15 = Vobs * vcf;
    const mLiq = V15 * rho15;
    const Vvap = t.Vtot - Vobs;
    const Pabs = t.P + 1.013;
    const rv = P.rhoV(t.wP, tempC, Pabs);
    const mVap = Vvap * rv;
    return { levelMm, tempC, Vobs, rho15, vcf, V15, mLiq, Vvap, Pabs, rv, mVap, total: mLiq + mVap };
  }

  function newGaugeSession(S) {
    const g = { status: 'open', readings: {}, signedT: null, results: null };
    for (const id of S.tankOrder) g.readings[id] = { manual: null, manualT: null, manualTemp: null, radarAt: null, flag: false, pending: false };
    return g;
  }

  // ===================================================================================
  // Routine tasks
  // ===================================================================================
  function addTask(S, id, title, detail, startT, dueT, opts) {
    S.tasks.push(Object.assign({ id, title, detail, startT, dueT, status: 'pending', doneT: null }, opts || {}));
  }
  function complete(S, id) {
    const t = S.tasks.find((x) => x.id === id);
    if (!t || t.status === 'done' || t.status === 'late') return;
    t.doneT = S.t;
    if (S.t <= t.dueT) { t.status = 'done'; sim.score(S, 'compliance', +1, 'Routine task completed: ' + t.title); }
    else { t.status = 'late'; sim.score(S, 'compliance', -1, 'Routine task completed late: ' + t.title); }
  }

  // ===================================================================================
  sim.register({
    name: 'events', order: 70,
    init(S) {
      const r = S.rng, d = S.diff;
      S.tasks = [];
      S.events = [];
      S.findings = [];
      S.gauge = { opening: newGaugeSession(S), closing: null, openingStock: null, recon: null };
      S.handover = { acked: false, items: [] };
      const hv = S.handover.items;

      // --- Night shift carry-overs
      const p201b = S.pumps.P201B;
      p201b.loto = true; p201b.isolated = true; p201b.duty = false; S.pumps.P201A.duty = true;
      const pmSeal = L.permits.makePermit(S, 'coldGauge', -6 * 3600);
      Object.assign(pmSeal, {
        type: 'cold', title: 'Replace mechanical seal on P-201B', equip: 'P201B', status: 'active', startT: -5 * 3600,
        loc: { x: 60, y: 77, name: 'P-201B propane pump', zone: 'PA' }, workEnd: r.range(4, 6.5) * 3600, conditions: ['contgas'],
        desc: 'Seal failed on night shift 2 days ago. Pump drained, purged, electrically and mechanically isolated (ICC-3077).',
        facts: { needsGas: true, needsCond: [], blockers: [], handoverPump: 'P201B' }, contractor: 'Stanmore Mechanical', ignition: false,
      });
      S.permits.push(pmSeal);
      hv.push({ k: 'eq', text: 'P-201B is locked out under ' + pmSeal.no + ' (mechanical seal replacement, Stanmore Mechanical). Fitters expect to finish around ' + U.clock(S, pmSeal.workEnd) + '. P-201A is the only propane pump until then — no standby.' });
      const gd13 = S.gd.find((g) => g.id === 'GD13');
      gd13.inhibited = true; gd13.fault = true;
      const pmGd = L.permits.makePermit(S, 'inhibitGD', -3 * 3600);
      Object.assign(pmGd, {
        title: 'GD-13 inhibited — sensor failed, awaiting replacement head', equip: 'GD13', status: 'active', startT: -3 * 3600,
        loc: { x: 46, y: 132, name: 'GD-13 (rail spot R1)', zone: 'RL' }, workEnd: r.range(2, 3.5) * 3600, conditions: ['compensating'],
        facts: { needsGas: false, needsCond: [], blockers: [], handoverGD: 'GD13' }, contractor: 'Vale Instrument Services',
      });
      S.permits.push(pmGd);
      hv.push({ k: 'fg', text: 'GD-13 at rail spot R1 is faulty and inhibited (' + pmGd.no + '). Compensating measure: portable detector clipped to the R1 hose rack. Vale Instruments bringing a new sensor head this morning (~' + U.clock(S, pmGd.workEnd) + ').' });

      // --- Latent faults
      const pumps = ['P201A', 'P202A', 'P202B'];
      const latentPool = r.shuffle(['seal', 'bearing', 'flange', 'radar']);
      const nLatent = Math.min(latentPool.length, d.latent + (r.chance(0.5) ? 1 : 0));
      for (let i = 0; i < nLatent; i++) {
        const k = latentPool[i];
        if (k === 'seal') {
          const p = S.pumps[r.pick(pumps)];
          p.sealWear = r.range(0.25, 0.4); p.sealRate = 1 / (r.range(4.5, 8) * 3600);
          S.events.push({ kind: 'latent', what: 'seal', id: p.id });
        } else if (k === 'bearing') {
          const p = S.pumps[r.pick(pumps)];
          p.wear = r.range(0.12, 0.22); p.wearRate = 0.85 / (r.range(6, 9) * 3600);
          S.events.push({ kind: 'latent', what: 'bearing', id: p.id });
        } else if (k === 'flange') {
          const tk = r.pick(S.tankOrder);
          S.events.push({ kind: 'flange', id: tk, weepT: r.range(0.5, 3) * 3600, leakT: r.range(5, 8.5) * 3600, state: 'none' });
        } else if (k === 'radar') {
          const tk = S.tanks.V102;
          const at = r.chance(0.55) ? 0 : r.range(1.5, 4) * 3600;
          S.events.push({ kind: 'radar', id: 'V102', t: at, mode: r.chance(0.7) ? 'stuck' : 'drift', done: false });
          if (at === 0) { tk.radar.fault = 'stuck'; tk.radar.stuck = tk.level + r.range(-30, -12); tk.radar.since = 0; }
        }
      }
      if (S.difficulty === 'trainee') S.fw.diesel.failLatent = false;
      // --- Random operational events
      const pool = ['groundLoss', 'engine', 'armLeak', 'iaTrip', 'powerDip', 'odorFail', 'wbDrift', 'groundLoss', 'engine', 'armLeak', 'gdFault', 'odorFail'];
      const picks = r.shuffle(pool).slice(0, d.randomEvents);
      for (const k of picks) S.events.push({ kind: 'random', what: k, t: r.range(1.2, 11) * 3600, done: false, tries: 0 });

      // --- Permit requests through the shift
      const keys = r.shuffle(['hotPiperack', 'hotWorkshop', 'elecP202A', 'confinedV104', 'heightV102', 'excavation', 'overrideLSHH', 'vehicle', 'inhibitGD', 'coldGauge']);
      for (let i = 0; i < d.permits; i++) {
        const at = 0.6 * 3600 + (i + r.range(0, 0.8)) * (9.5 * 3600 / d.permits);
        const pm = L.permits.makePermit(S, keys[i % keys.length], at, { badCompetency: r.chance(0.12) });
        pm.status = 'scheduled';
        S.permits.push(pm);
      }

      // --- Handover text
      const st = (id) => S.tanks[id];
      hv.unshift({ k: 'stock', text: 'Night shift stock at 05:45 (radar): V-101 ' + (st('V101').fillMeas * 100).toFixed(1) + '%, V-102 ' + (st('V102').fillMeas * 100).toFixed(1) + '%, V-103 ' + (st('V103').fillMeas * 100).toFixed(1) + '%. Propane header on V-101, butane on V-103.' });
      const railFirst = S.rail.cars.filter((c) => c.arrivalT < 4 * 3600).length;
      hv.push({ k: 'rail', text: railFirst + ' propane rail cars due from Saltfleet Refinery around ' + U.clock(S, S.rail.cars[0].arrivalT) + ', more after lunch. C-301 lined up to V-102. Free time 6 h per drop.' });
      hv.push({ k: 'task', text: 'Weekly P-502 diesel fire pump run test is due today (30 min run, log readings).' });
      hv.push({ k: 'task', text: 'Odorant (ethyl mercaptan) top-up delivery booked for 11:00 — needs a field operator to supervise the transfer. Tank at ' + (S.util.odor.level * 100).toFixed(0) + '%.' });
      const radarEv = S.events.find((e) => e.kind === 'radar');
      if (radarEv && (S.settings.hints || S.rng.chance(0.4))) hv.push({ k: 'hint', text: 'Night shift noticed the V-102 level trend looked "very steady" overnight. Nobody checked it locally. Worth a look during the opening gauge.' });
      hv.push({ k: 'bookings', text: S.trucks.filter((t) => t.booked).length + ' road tankers booked today. First slot ' + U.clock(S, S.trucks.find((t) => t.booked).slotT) + '.' });
      if (S.weather.storm) hv.push({ k: 'wx', text: 'Forecast: thunderstorms possible this ' + (U.hourOf(S, S.weather.storm.start) < 12 ? 'morning' : 'afternoon') + '. Lightning detector is in service.' });
      else hv.push({ k: 'wx', text: 'Forecast: dry, max around ' + Math.round(S.weather.Tmean + S.weather.amp) + ' °C, wind ' + U.compass(S.weather.windDir) + ' ' + S.weather.wind.toFixed(0) + ' m/s.' });

      // --- Routine tasks
      addTask(S, 'handover', 'Read and accept the shift handover', 'Read the night shift notes and sign the handover log.', 0, 15 * 60);
      addTask(S, 'opengauge', 'Opening gauge and stock sign-off', 'Compare radar with an independent local reading for each sphere, then sign the opening stock.', 0, 1.5 * 3600);
      addTask(S, 'rounds1', 'Field rounds — morning', 'Send a field operator on the plant walk-down (about 40 min).', 1.5 * 3600, 3.5 * 3600);
      addTask(S, 'fwtest', 'Weekly diesel fire pump test', 'Start P-502 from the Utilities page, run 30 min, stop.', 2.5 * 3600, 9 * 3600);
      addTask(S, 'odordel', 'Supervise odorant delivery', 'Send a field operator to the odorant skid when the delivery arrives.', 5 * 3600, 6.5 * 3600);
      addTask(S, 'rounds2', 'Field rounds — midday', 'Plant walk-down.', 5.5 * 3600, 7.5 * 3600);
      addTask(S, 'rounds3', 'Field rounds — afternoon', 'Plant walk-down.', 9.5 * 3600, 11.5 * 3600);
      addTask(S, 'closegauge', 'Closing gauge and stock reconciliation', 'Gauge all spheres and reconcile book stock against physical stock.', 10.75 * 3600, 12 * 3600);
      S.odorDelivery = { t: 5 * 3600 + r.range(-10, 20) * 60, arrived: false, done: false };
    },
    tick(S, dt) {
      const r = S.rng;
      // Task deadlines
      for (const t of S.tasks) {
        if (t.status === 'pending' && S.t > t.dueT + (t.id === 'closegauge' ? 0 : 600)) {
          t.status = 'missed';
          sim.score(S, 'compliance', t.id === 'fwtest' ? -6 : t.id.startsWith('rounds') ? -3 : -5, 'Routine task missed: ' + t.title,
            t.id === 'fwtest' ? 'Fire pumps that are not run weekly fail when you need them. The test exists to find the fault on a quiet day.' : '');
        }
      }
      // Odorant delivery arrival
      const od = S.odorDelivery;
      if (!od.arrived && S.t >= od.t) { od.arrived = true; sim.log(S, 'gate', 'Odorant delivery (ethyl mercaptan, UN 2363) at the gate. Needs a field operator at the skid to supervise the transfer.'); }
      // Latent: flange weep -> leak
      for (const ev of S.events) {
        if (ev.kind === 'flange') {
          const tk = S.tanks[ev.id];
          if (ev.state === 'none' && S.t >= ev.weepT) { ev.state = 'weep'; }
          if (ev.state === 'weep' && S.t >= ev.leakT) {
            ev.state = 'leak';
            ev.leak = L.plant.addLeak(S, { x: tk.x + 4, y: tk.y + tk.r + 4, zone: 'TF', src: { kind: 'manifold', id: tk.id }, rate: r.range(0.08, 0.22), product: tk.product, label: tk.tag + ' outlet flange' });
          }
          if (ev.state === 'leak' && ev.leak && !S.leaks.includes(ev.leak)) { ev.state = 'stopped'; }
        }
        if (ev.kind === 'radar' && !ev.done && S.t >= ev.t) {
          ev.done = true;
          const tk = S.tanks[ev.id];
          if (!tk.radar.fault) {
            tk.radar.fault = ev.mode; tk.radar.since = S.t;
            if (ev.mode === 'stuck') tk.radar.stuck = tk.levelMeas;
            else tk.radar.driftRate = -r.range(1.5, 3) / 60; // mm/s reading low
          }
        }
        if (ev.kind === 'random' && !ev.done && S.t >= ev.t) fireRandom(S, ev);
        if (ev.kind === 'repair' && !ev.done && S.t >= ev.t) { ev.done = true; ev.fn(S); }
      }
      // Instrument repair of a flagged radar
      for (const id of S.tankOrder) {
        const tk = S.tanks[id];
        if (tk.radar.repairT && S.t >= tk.radar.repairT) {
          tk.radar.repairT = null;
          tk.radar.fault = null; tk.radar.drift = 0; tk.radar.flagged = false; tk.radar.bias = r.range(-1, 1);
          sim.log(S, 'ops', 'Vale Instruments: LT-' + id.slice(1) + ' radar repaired and verified against a manual dip. Back in service.');
        }
      }
    },
  });

  // ===================================================================================
  function loadingBay(S) {
    const b = S.bays.filter((x) => x.state === 'LOADING');
    return b.length ? S.rng.pick(b) : null;
  }
  function fireRandom(S, ev) {
    const r = S.rng;
    const retry = () => { ev.t = S.t + 120; ev.tries++; if (ev.tries > 60) ev.done = true; };
    switch (ev.what) {
      case 'groundLoss': {
        const b = loadingBay(S); if (!b) return retry();
        b.ground = 'lost';
        sim.log(S, 'rack', b.tag + ': ground monitor lost the truck — clamp knocked off its lug.', 'warn');
        break;
      }
      case 'engine': {
        const b = loadingBay(S); if (!b) return retry();
        const tr = S.trucks.find((x) => x.id === b.truckId);
        tr.engineOn = true; b.engineT = S.t;
        sim.log(S, 'rack', b.tag + ': CCTV — ' + tr.plate + ' engine running (driver wants the cab air-con).', 'warn');
        sim.lesson(S, 'engine', 'Engines and loading arms', 'A running engine is an ignition source next to the coupling, and a driver in the cab may drive off with the arms connected. Stop the transfer first, then tell the driver to switch off over the bay PA.');
        break;
      }
      case 'armLeak': {
        const b = loadingBay(S); if (!b) return retry();
        L.plant.addLeak(S, { x: b.x + 2, y: b.y - 6, zone: 'LR', src: { kind: 'bay', id: b.id }, rate: r.range(0.05, 0.16), product: b.product, label: b.tag + ' liquid arm swivel joint', residual: 25 });
        break;
      }
      case 'iaTrip': {
        const c = S.util.ia.comps.find((x) => x.running);
        if (!c) return retry();
        c.running = false; c.tripped = true; c.tripCause = 'motor overload';
        const sb = S.util.ia.comps.find((x) => x !== c);
        if (r.chance(0.5)) sb.auto = false; // standby left in manual by maintenance
        sim.log(S, 'ops', c.tag + ' instrument air compressor tripped (motor overload).' + (!sb.auto ? ' ' + sb.tag + ' is in MANUAL.' : ''), 'warn');
        break;
      }
      case 'powerDip': {
        S.util.power.ok = false; S.util.power.dipUntil = S.t + r.range(20, 70); S.util.power.lastDip = S.t;
        for (const p of Object.values(S.pumps)) if (p.running) { p.running = false; p.autoStarted = false; p.tripped = true; p.tripCause = 'power dip (undervoltage)'; }
        if (S.rail.comp.running) { S.rail.comp.running = false; }
        sim.log(S, 'ops', 'Grid voltage dip — motors tripped on undervoltage. Control system on UPS.', 'crit');
        break;
      }
      case 'odorFail': {
        if (!S.bays.some((b) => b.product === 'propane' && (b.state === 'LOADING' || b.state === 'READY' || b.state === 'PREP'))) return retry();
        S.util.odor.failed = true; S.util.odor.pump = 'failed';
        sim.log(S, 'ops', 'Odorant injection pump P-401 lost prime — injection flow zero.', 'warn');
        break;
      }
      case 'wbDrift': {
        const which = r.chance(0.5) ? 'in' : 'out';
        S.wb[which].zero = Math.round(r.range(140, 280) / 20) * 20;
        break;
      }
      case 'gdFault': {
        const g = r.pick(S.gd.filter((x) => !x.fault && !x.inhibited));
        g.fault = true;
        S.events.push({ kind: 'repair', t: S.t + r.range(1.5, 2.5) * 3600, done: false, fn: (S2) => { g.fault = false; sim.log(S2, 'ops', g.tag + ' repaired and bump-tested by Vale Instruments.'); } });
        break;
      }
      default: break;
    }
    ev.done = true;
  }
  // Weighbridge drift alarm (shown when a truck reads off zero with empty deck)
  sim.register({
    name: 'wbmon', order: 71,
    tick(S) {
      for (const k of ['in', 'out']) sim.setAlarm(S, 'WB-' + k, 'WBFAULT', k === 'in' ? 'WB-1' : 'WB-2', S.wb[k].zero !== 0 && !S.wb[k].busy, '+' + S.wb[k].zero + ' kg');
    },
  });

  // ===================================================================================
  // Field rounds & investigations
  // ===================================================================================
  function roundsFindings(S, c) {
    const out = [];
    for (const p of Object.values(S.pumps)) {
      if (p.seal === 'weep' && !p.sealReported) { p.sealReported = true; out.push({ kind: 'seal', id: p.id, text: p.tag + ': seal weeping — drips at the gland, mercaptan smell, 4% LEL on my monitor at the seal.' }); }
      if (p.wear > 0.3 && !p.wearReported) { p.wearReported = true; out.push({ kind: 'bearing', id: p.id, text: p.tag + ': drive-end bearing is noisy and hot to touch — handheld vibration ' + (1.8 + p.wear * 10).toFixed(1) + ' mm/s.' }); }
    }
    for (const ev of S.events) {
      if (ev.kind === 'flange' && ev.state === 'weep' && !ev.reported) { ev.reported = true; out.push({ kind: 'flange', id: ev.id, ev, text: S.tanks[ev.id].tag + ' outlet flange: bubbles on a soap test at the gasket, 6% LEL at the flange face. Bolts look slack.' }); }
    }
    for (const id of S.tankOrder) {
      const tk = S.tanks[id];
      if (tk.radar.fault && !tk.radar.flagged && !tk.radar.reported && S.rng.chance(0.5)) { tk.radar.reported = true; out.push({ kind: 'radar', id, text: tk.tag + ': local magnetic gauge reads ' + Math.round(tk.level) + ' mm but the DCS shows ' + Math.round(tk.levelMeas) + ' mm.' }); }
    }
    if (S.fw.diesel.failLatent && !S.fw.diesel.reported && S.rng.chance(0.3)) { S.fw.diesel.reported = true; out.push({ kind: 'diesel', text: 'P-502 diesel fire pump: battery charger showing a fault light. Might not crank.' }); }
    return out;
  }
  sim.action('crewRounds', (S) => {
    const t = S.tasks.find((x) => x.id.startsWith('rounds') && x.status === 'pending' && S.t >= x.startT - 1800);
    return L.crewMod.dispatch(S, null, {
      kind: 'rounds', label: 'Plant walk-down (rounds)', x: 80, y: 66, work: 40 * 60,
      done: (S2, c) => {
        const f = roundsFindings(S2, c);
        if (!f.length) sim.radio(S2, c.call, 'Rounds complete. Nothing abnormal. Fire extinguishers, eyewash and deluge valves checked.');
        else {
          sim.radio(S2, c.call, 'Rounds complete — ' + f.length + ' finding' + (f.length > 1 ? 's' : '') + ':');
          for (const x of f) { sim.radio(S2, c.call, x.text); S2.findings.push(Object.assign({ t: S2.t, status: 'open' }, x)); }
          sim.score(S2, 'safety', +2 * f.length, 'Rounds found ' + f.length + ' latent defect' + (f.length > 1 ? 's' : ''), 'Walk-downs exist to find the small problem before it becomes the big one: a weep before a leak, a noisy bearing before a trip.');
          S2.stats.nearMisses += f.length;
        }
        if (t) complete(S2, t.id);
      },
    });
  });
  function investigateReport(S, c, x, y, label) {
    const lk = S.leaks.filter((l) => U.dist(l.x, l.y, x, y) < 25 && l.rate > 0.002).sort((a, b) => U.dist(a.x, a.y, x, y) - U.dist(b.x, b.y, x, y))[0];
    if (lk) {
      lk.seen = true; lk.found = true;
      let advice = '';
      switch (lk.src.kind) {
        case 'bay': advice = 'Stop that bay — it isolates at the arm valves.'; break;
        case 'pump': advice = 'Stop the pump and close its suction and discharge MOVs.'; break;
        case 'manifold': advice = 'Close the sphere outlet ROSOV to isolate.'; break;
        case 'rail': advice = 'The car valve needs closing by hand.'; break;
        case 'field': advice = 'I can isolate it locally with the manual block valve if you send me back.'; break;
        default: advice = '';
      }
      sim.radio(S, c.call, 'Found it: ' + lk.label + ', I can hear it hissing — about ' + (lk.rate < 0.1 ? 'a small' : lk.rate < 0.4 ? 'a significant' : 'a large') + ' release. ' + advice);
      return;
    }
    const f = roundsFindings(S, c);
    if (f.length) { for (const x of f) { sim.radio(S, c.call, x.text); S.findings.push(Object.assign({ t: S.t, status: 'open' }, x)); } return; }
    sim.radio(S, c.call, 'At ' + label + '. Nothing found — no smell, monitor reads zero. Could be a detector fault.');
  }
  sim.action('fixFinding', (S, idx) => {
    const f = S.findings[idx];
    if (!f || f.status !== 'open') return { ok: false };
    if (f.kind === 'flange') {
      const tk = S.tanks[f.id];
      if (L.plant.outletOpen(S, tk)) return { ok: false, msg: 'Close the ' + tk.tag + ' outlet ROSOV first (line it out of service) — the flange must be isolated before re-tightening.' };
      return L.crewMod.dispatch(S, null, { kind: 'repair', label: 'Re-tighten ' + tk.tag + ' outlet flange (isolated)', x: tk.x + 4, y: tk.y + tk.r + 4, work: 30 * 60, done: (S2) => { f.ev.state = 'fixed'; f.status = 'closed'; sim.log(S2, 'ops', tk.tag + ' outlet flange re-torqued and leak tested. Line may be returned to service.'); sim.score(S2, 'safety', +3, 'Flange weep on ' + tk.tag + ' repaired before it became a leak'); } });
    }
    if (f.kind === 'seal' || f.kind === 'bearing') {
      const p = S.pumps[f.id];
      if (p.running) return { ok: false, msg: 'Stop ' + p.tag + ' (swap to the standby) before maintenance can work on it.' };
      p.loto = true; p.isolated = true;
      f.status = 'inwork';
      const end = S.t + S.rng.range(1.5, 2.5) * 3600;
      const pm = L.permits.makePermit(S, 'coldGauge', S.t);
      Object.assign(pm, { type: 'cold', title: (f.kind === 'seal' ? 'Replace mechanical seal on ' : 'Replace bearings on ') + p.tag, equip: p.id, status: 'active', startT: S.t, workEnd: end, loc: { x: p.x, y: p.y + 3, name: p.tag, zone: 'PA' }, conditions: ['contgas'], contractor: 'Stanmore Mechanical', facts: { needsGas: true, needsCond: [], blockers: [], handoverPump: p.id }, desc: 'Raised from field rounds finding.' });
      S.permits.push(pm);
      sim.log(S, 'permit', pm.no + ' raised by maintenance planner for ' + p.tag + '. Pump locked out. Close the permit when the work is complete to return it to service.');
      sim.score(S, 'safety', +2, f.kind === 'seal' ? 'Weeping seal on ' + p.tag + ' taken out of service before failure' : 'Worn bearing on ' + p.tag + ' taken out of service before a trip');
      return { ok: true, msg: p.tag + ' handed to maintenance.' };
    }
    if (f.kind === 'radar') { f.status = 'closed'; return sim.actions.gaugeFlag(S, 'opening', f.id, true, true); }
    if (f.kind === 'diesel') {
      f.status = 'closed';
      return L.crewMod.dispatch(S, null, { kind: 'repair', label: 'Replace P-502 battery charger fuse', x: D.POINTS.fwPumps.x, y: D.POINTS.fwPumps.y, work: 20 * 60, done: (S2) => { S2.fw.diesel.failLatent = false; S2.fw.diesel.failed = false; sim.log(S2, 'ops', 'P-502 battery charger repaired, batteries on charge.'); } });
    }
    return { ok: false };
  });
  sim.action('odorRestore', (S) => {
    const od = S.util.odor;
    if (!od.failed) return { ok: false, msg: 'Odorant injection is running.' };
    return L.crewMod.dispatch(S, null, { kind: 'repair', label: 'Re-prime odorant injection pump P-401', x: D.POINTS.odorant.x, y: D.POINTS.odorant.y, work: 15 * 60, done: (S2, c) => { od.failed = false; od.pump = 'running'; sim.radio(S2, c.call, 'P-401 re-primed, stroke counter running, injection back at 25 ppm.'); } });
  });
  sim.action('odorDelivery', (S) => {
    const od = S.odorDelivery;
    if (!od.arrived) return { ok: false, msg: 'The odorant delivery has not arrived yet.' };
    if (od.done || od.inProgress) return { ok: false, msg: 'Already handled.' };
    od.inProgress = true;
    return L.crewMod.dispatch(S, null, { kind: 'odor', label: 'Supervise odorant transfer at the skid', x: D.POINTS.odorant.x, y: D.POINTS.odorant.y + 3, work: 30 * 60, done: (S2, c) => { od.done = true; S2.util.odor.level = Math.min(0.95, S2.util.odor.level + 0.45); sim.radio(S2, c.call, 'Odorant transfer complete, nitrogen blanket restored, drum returned. Tank at ' + (S2.util.odor.level * 100).toFixed(0) + '%.'); complete(S2, 'odordel'); }, cancel: () => { od.inProgress = false; } });
  });
  sim.action('handoverAck', (S) => {
    if (S.handover.acked) return { ok: true };
    S.handover.acked = true;
    sim.log(S, 'ops', 'Shift handover read and signed.');
    complete(S, 'handover');
    return { ok: true };
  });
  sim.action('crewIsolateField', (S, leakId) => {
    const lk = S.leaks.find((x) => x.id === leakId);
    if (!lk) return { ok: false };
    return L.crewMod.dispatch(S, null, { kind: 'isolate', label: 'Close manual block valve at ' + lk.label, x: lk.x - 6, y: lk.y + 6, work: 5 * 60, done: (S2, c) => { lk.fixed = true; lk.residual = Math.min(lk.residual, 15); sim.radio(S2, c.call, 'Manual valve closed at ' + lk.label + '. Hissing has stopped.'); } });
  });
  sim.action('railCloseCarValves', (S, carId) => {
    const c = S.rail.cars.find((x) => x.id === carId);
    if (!c) return { ok: false };
    const pt = D.POINTS[c.spotId === 'R1' ? 'railR1' : 'railR2'];
    return L.crewMod.dispatch(S, null, { kind: 'isolate', label: 'Close internal valves on car ' + c.number, x: pt.x - 6, y: pt.y, work: 4 * 60, done: (S2, cr) => { c.valvesOpen = false; sim.radio(S2, cr.call, 'Car ' + c.number + ' internal valves closed.'); } });
  });

  // ===================================================================================
  // Gauging actions
  // ===================================================================================
  sim.action('gaugeManual', (S, which, tankId) => {
    const g = S.gauge[which];
    if (!g || g.status !== 'open') return { ok: false, msg: 'Gauge session not open.' };
    const rd = g.readings[tankId];
    if (rd.pending) return { ok: false, msg: 'Reading already requested.' };
    const tk = S.tanks[tankId];
    rd.pending = true;
    return L.crewMod.dispatch(S, null, {
      kind: 'gauge', label: 'Read local magnetic level gauge on ' + tk.tag, x: tk.x + tk.r + 2, y: tk.y + 4, work: 8 * 60,
      done: (S2, c) => {
        rd.pending = false;
        rd.manual = Math.round(tk.level + S2.rng.gauss() * 2.5);
        rd.radarAt = Math.round(tk.levelMeas);
        rd.manualTemp = Math.round((tk.Tb + S2.rng.gauss() * 0.15) * 10) / 10;
        rd.manualT = S2.t;
        sim.radio(S2, c.call, tk.tag + ' local gauge: ' + rd.manual + ' mm, thermowell ' + rd.manualTemp.toFixed(1) + ' °C.');
      },
      cancel: () => { rd.pending = false; },
    });
  });
  sim.action('gaugeFlag', (S, which, tankId, on, silent) => {
    const tk = S.tanks[tankId];
    const g = S.gauge[which];
    if (g && g.readings[tankId]) g.readings[tankId].flag = on;
    if (on && !tk.radar.flagged) {
      tk.radar.flagged = true;
      tk.radar.flagT = S.t;
      if (tk.radar.fault) {
        tk.radar.repairT = S.t + S.rng.range(1.3, 2.2) * 3600;
        S.stats.nearMisses++;
        sim.score(S, 'safety', +4, 'Faulty radar on ' + tk.tag + ' identified (' + tk.radar.fault + ')', 'Comparing the control gauge with an independent reading every shift is how stuck gauges are found. A stuck gauge during a receipt is how vessels are overfilled.');
        sim.log(S, 'ops', 'LT-' + tankId.slice(1) + ' flagged SUSPECT. Instrument work order raised — technician due ' + U.clock(S, tk.radar.repairT) + '. Treat the radar reading as unreliable until then.');
      } else {
        sim.score(S, 'compliance', -2, 'Healthy radar on ' + tk.tag + ' flagged as faulty');
        sim.log(S, 'ops', 'LT-' + tankId.slice(1) + ' flagged suspect. Instrument technician later found it within ±2 mm of a manual dip.');
        tk.radar.flagged = false;
      }
    }
    return { ok: true };
  });
  sim.action('gaugeOpenClosing', (S) => {
    if (S.gauge.closing) return { ok: true };
    S.gauge.closing = newGaugeSession(S);
    sim.log(S, 'ops', 'Closing gauge session opened.');
    return { ok: true };
  });
  sim.action('gaugeSign', (S, which) => {
    const g = S.gauge[which];
    if (!g || g.status !== 'open') return { ok: false, msg: 'Nothing to sign.' };
    if (S.tankOrder.some((id) => g.readings[id].pending)) return { ok: false, msg: 'Wait for the field readings to come back.' };
    let manualCount = 0;
    const res = {};
    for (const id of S.tankOrder) {
      const tk = S.tanks[id], rd = g.readings[id];
      if (rd.manual !== null) manualCount++;
      const useManual = rd.flag && rd.manual !== null;
      const lvl = useManual ? rd.manual : tk.levelMeas;
      const temp = useManual ? rd.manualTemp : tk.Tb + 0.1;
      const m = measuredStock(S, tk, lvl, temp);
      const truth = tk.M;
      res[id] = { calc: m, used: useManual ? 'manual' : 'radar', truth, radarErr: tk.levelMeas - tk.level };
      if (Math.abs(tk.levelMeas - tk.level) > 12 && !rd.flag && !tk.radar.flagged) {
        sim.score(S, 'compliance', -6, (which === 'opening' ? 'Opening' : 'Closing') + ' stock signed on a faulty radar for ' + tk.tag + ' (' + U.fmt.sign(tk.levelMeas - tk.level, 0) + ' mm)', 'An independent reading that disagrees with the radar by more than ~10 mm is a fault until proven otherwise. Flag it, use the manual figure for stock, and restrict receipts.');
      }
    }
    if (manualCount === 0) sim.score(S, 'compliance', -3, (which === 'opening' ? 'Opening' : 'Closing') + ' stock signed from the radar alone, with no independent check');
    g.status = 'signed'; g.signedT = S.t; g.results = res;
    const total = S.tankOrder.reduce((s, id) => s + res[id].calc.total, 0);
    g.total = total;
    if (which === 'opening') {
      S.gauge.openingStock = { t: S.t, total, dispatchedAt: S.stats.dispatched, receivedAt: S.stats.received, ventedAt: S.stats.vented };
      complete(S, 'opengauge');
      sim.log(S, 'ops', 'Opening stock signed: ' + U.fmt.t(total) + ' total LPG in spheres.');
    } else {
      const o = S.gauge.openingStock;
      if (!o) { sim.log(S, 'ops', 'Closing stock signed: ' + U.fmt.t(total) + '. No opening figure to reconcile against.', 'warn'); }
      else {
        const disp = S.stats.dispatched - o.dispatchedAt;
        const rec = S.stats.received - o.receivedAt;
        // Book: what the documents say should be in the tanks (rail receipts per shipper declarations).
        const recDeclared = S.rail.cars.filter((c) => c.received > 500).reduce((s, c) => s + Math.min(c.received, c.declared), 0);
        const book = o.total + rec - disp;
        const diff = total - book;
        const tol = 0.0025 * (disp + rec) + 400;
        S.gauge.recon = { opening: o.total, receipts: rec, recDeclared, dispatched: disp, book, physical: total, diff, tol, pct: diff / Math.max(disp + rec, 1) };
        if (Math.abs(diff) <= tol) sim.score(S, 'compliance', +3, 'Stock reconciliation within tolerance (' + U.fmt.sign(diff / 1000, 2) + ' t)');
        else sim.score(S, 'compliance', -5, 'Unexplained stock difference ' + U.fmt.sign(diff / 1000, 2) + ' t (tolerance ±' + (tol / 1000).toFixed(2) + ' t)', 'A large gain or loss means either a measurement fault (gauge, weighbridge) or product that went somewhere it should not (leaks, relief valves). Both need investigating.');
      }
      complete(S, 'closegauge');
    }
    return { ok: true, msg: 'Stock signed.' };
  });

  L.events = { measuredStock, investigateReport, roundsFindings };
  L.tasks = { complete, addTask };
})(globalThis.LPG = globalThis.LPG || {});
