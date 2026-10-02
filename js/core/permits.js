/* Permit-to-work: requests, gas tests, isolation verification, SIMOPS, decisions, hand-back. */
(function (L) {
  'use strict';
  const U = L.util, D = L.data, sim = L.sim;

  const TYPES = {
    hot: 'Hot work', cold: 'Cold work', confined: 'Confined space entry', electrical: 'Electrical isolation',
    height: 'Work at height', excavation: 'Excavation', override: 'Safety system override', vehicle: 'Vehicle entry', inhibit: 'F&G inhibit',
  };
  const CONDITIONS = {
    firewatch: 'Dedicated fire watch during work and 30 min after',
    contgas: 'Continuous gas monitoring at the work site',
    suspendLR: 'Suspend loading on the rack for the duration',
    suspendRL: 'Suspend rail unloading for the duration',
    standby: 'Standby person at the entry point with rescue kit',
    noReceipt: 'No receipts into the vessel while bypassed; level watched manually',
    weatherStop: 'Stop work on lightning or high-wind alarm',
    compensating: 'Portable detector at the location as compensating measure',
    escort: 'Vehicle escorted, engine off inside the zone',
  };
  const REJECT_REASONS = {
    simops: 'Conflicts with live operations nearby (SIMOPS)',
    gas: 'Gas test failed or not possible',
    isolation: 'Isolation inadequate or not verified',
    competency: 'Competency or documentation not valid',
    weather: 'Weather unsuitable',
    equipment: 'Equipment not in a safe state',
    rescue: 'No rescue arrangements',
    locate: 'Buried services not located',
    other: 'Other / insufficient information',
  };

  // ---------------------------------------------------------------------------------
  // Templates. Each returns a permit with declared fields and hidden facts.
  const TEMPLATES = {
    hotPiperack(S, r) {
      return {
        type: 'hot', title: 'Weld repair to pipe support shoe, pipe rack PR-2 grid C4', equip: 'PR-2',
        loc: { x: 178, y: 72, name: 'Pipe rack PR-2 (beside Bay 1)', zone: 'LR' }, durH: r.range(2, 3),
        desc: 'Corroded support shoe under the 6" propane loading header. Grind out, weld new shoe plate. Header remains in service.',
        hazards: ['Ignition source in Zone 2 hazardous area', 'Hot surfaces', 'Sparks travel up to 10 m'],
        declared: { gasTest: true, fireWatch: true, isolation: 'Not required (external)', jsa: true, competent: true },
        facts: { needsGas: true, needsCond: ['firewatch', 'contgas', 'suspendLR'], blockers: [] },
      };
    },
    hotWorkshop(S, r) {
      return {
        type: 'hot', title: 'Grinding and cutting in maintenance workshop', equip: 'WS-1',
        loc: { x: D.POINTS.workshop.x, y: D.POINTS.workshop.y, name: 'Maintenance workshop (safe area)', zone: 'UT' }, durH: r.range(2, 4),
        desc: 'Fabricate brackets for new cable tray. Workshop is outside the hazardous area classification.',
        hazards: ['Sparks', 'Noise'],
        declared: { gasTest: false, fireWatch: false, isolation: 'N/A', jsa: true, competent: true },
        facts: { needsGas: false, needsCond: [], blockers: [] },
      };
    },
    elecP202A(S, r) {
      return {
        type: 'electrical', title: 'Electrical isolation of P-202A motor for bearing change', equip: 'P202A',
        loc: { x: 96, y: 74, name: 'P-202A butane pump', zone: 'PA' }, durH: r.range(2.5, 4),
        desc: 'Drive-end bearing noisy on last vibration survey. Isolate at MCC, rack out breaker, apply personal locks, prove dead.',
        hazards: ['Stored electrical energy', 'Pressurised process fluid'],
        declared: { gasTest: false, fireWatch: false, isolation: 'Electrical: MCC breaker racked out + process: suction/discharge MOVs closed (ICC-' + r.int(3100, 3999) + ')', jsa: true, competent: true },
        facts: { needsGas: false, needsCond: [], blockers: [], pump: 'P202A' },
      };
    },
    confinedV104(S, r) {
      const flaw = r.pick([null, null, 'valveOnly', 'o2', 'noStandby']);
      return {
        type: 'confined', title: 'Entry into bullet V-104 for internal inspection', equip: 'V104',
        loc: { x: 128, y: 36, name: 'Bullet V-104 manway', zone: 'TF' }, durH: r.range(2.5, 3.5),
        desc: 'Statutory internal inspection (ultrasonic thickness and MPI of welds). Vessel steamed, purged with nitrogen, then air.',
        hazards: ['Oxygen deficiency', 'Residual hydrocarbon', 'Restricted access'],
        declared: { gasTest: true, fireWatch: false, isolation: flaw === 'valveOnly' ? 'Spades fitted on all nozzles (ICC-' + r.int(3100, 3999) + ')' : 'Spades fitted on all nozzles (ICC-' + r.int(3100, 3999) + ')', standby: flaw !== 'noStandby', rescue: flaw !== 'noStandby', jsa: true, competent: true },
        facts: { needsGas: true, needsCond: ['standby', 'contgas'], blockers: flaw === 'noStandby' ? ['rescue'] : [], confined: true, isoActual: flaw === 'valveOnly' ? 'valve' : 'blinded', o2: flaw === 'o2' ? r.range(18.4, 19.2) : r.range(20.7, 20.9), insideLel: flaw === 'valveOnly' ? r.range(6, 14) : 0, flaw },
      };
    },
    heightV102(S, r) {
      return {
        type: 'height', title: 'Inspect PSV-102 tail pipe and aviation light on top of V-102', equip: 'V102',
        loc: { x: 70, y: 32, name: 'V-102 top platform (15 m)', zone: 'TF' }, durH: r.range(1.5, 2.5),
        desc: 'Visual inspection of relief valve tail pipe rain cap and replacement of aviation warning lamp.',
        hazards: ['Fall from height', 'Dropped objects', 'Lightning exposure'],
        declared: { gasTest: false, fireWatch: false, isolation: 'N/A', harness: true, jsa: true, competent: true },
        facts: { needsGas: false, needsCond: ['weatherStop'], blockers: [], height: true },
      };
    },
    excavation(S, r) {
      const locate = r.chance(0.5);
      return {
        type: 'excavation', title: 'Excavate 1.2 m trench for cable duct beside rail spot R2', equip: 'R2',
        loc: { x: 96, y: 128, name: 'Rail spot R2 verge', zone: 'RL' }, durH: r.range(2.5, 4),
        desc: 'Mini-excavator trench for new CCTV cable. Route crosses near the buried 4" rail unloading line.',
        hazards: ['Buried pipeline strike', 'Collapse', 'Vehicle in Zone 2'],
        declared: { gasTest: true, fireWatch: false, isolation: 'N/A', lineLocate: locate, jsa: true, competent: true },
        facts: { needsGas: true, needsCond: ['contgas'], blockers: locate ? [] : ['locate'], excav: true, locate },
      };
    },
    overrideLSHH(S, r) {
      return {
        type: 'override', title: 'Bypass LSHH-102 for proof test (45 min)', equip: 'V102',
        loc: { x: 70, y: 48, name: 'LSHH-102 at V-102', zone: 'TF' }, durH: 0.75,
        desc: 'Annual proof test of the independent high-high level switch on V-102. Switch output bypassed in the SIS while the float chamber is drained and tested.',
        hazards: ['Overfill protection unavailable during the test'],
        declared: { gasTest: false, fireWatch: false, isolation: 'Float chamber isolated and drained to closed drain', jsa: true, competent: true },
        facts: { needsGas: false, needsCond: ['noReceipt'], blockers: [], override: 'V102' },
      };
    },
    vehicle(S, r) {
      return {
        type: 'vehicle', title: 'Scaffold delivery van to Bay 4 canopy', equip: 'Bay 4',
        loc: { x: 238, y: 66, name: 'Bay 4 canopy', zone: 'LR' }, durH: r.range(0.75, 1.25),
        desc: 'Diesel van (not Ex-rated) to unload scaffold tube for canopy gutter repair. Petrol-free, spark arrestor not fitted.',
        hazards: ['Non-rated vehicle (ignition source) in Zone 2'],
        declared: { gasTest: true, fireWatch: false, isolation: 'N/A', jsa: true, competent: r.chance(0.8) },
        facts: { needsGas: true, needsCond: ['escort', 'suspendLR'], blockers: [], vehicle: true },
      };
    },
    inhibitGD(S, r) {
      const gd = r.pick(['GD10', 'GD11', 'GD07']);
      const g = D.GAS_DET.find((x) => x.id === gd);
      return {
        type: 'inhibit', title: 'Inhibit ' + g.tag + ' for calibration (60 min)', equip: gd,
        loc: { x: g.x, y: g.y, name: g.tag + ' (' + D.ZONES[g.zone].name + ')', zone: g.zone }, durH: 1,
        desc: 'Bump test failed on monthly check. Calibrate with 50% LEL propane span gas; detector will alarm during calibration.',
        hazards: ['Detection gap'],
        declared: { gasTest: false, fireWatch: false, isolation: 'N/A', jsa: true, competent: true },
        facts: { needsGas: false, needsCond: ['compensating'], blockers: [], inhibit: gd },
      };
    },
    coldGauge(S, r) {
      const lotoPump = Object.values(S.pumps).find((p) => p.loto);
      const target = lotoPump && r.chance(0.6) ? lotoPump : S.pumps[r.pick(['P201A', 'P202B'])];
      return {
        type: 'cold', title: 'Replace discharge pressure gauge on ' + target.tag, equip: target.id,
        loc: { x: target.x, y: target.y + 3, name: target.tag + ' discharge', zone: 'PA' }, durH: r.range(0.75, 1.5),
        desc: 'Gauge glass cracked. Close gauge root valve, vent, replace gauge, leak test.',
        hazards: ['Trapped pressure', 'Small LPG release on venting'],
        declared: { gasTest: true, fireWatch: false, isolation: 'Gauge root valve closed', jsa: true, competent: true },
        facts: { needsGas: true, needsCond: ['contgas'], blockers: [], pumpCheck: target.id },
      };
    },
  };

  function makePermit(S, key, at, opts) {
    const r = S.rng;
    const base = TEMPLATES[key](S, r);
    const pm = Object.assign(base, {
      no: 'PTW-' + new Date(S.date).getFullYear() + '-' + String(4100 + (S.permitSeq = (S.permitSeq || 0) + 1) * 7 + r.int(0, 6)).padStart(4, '0'),
      key, contractor: r.pick(D.PEOPLE.contractors), performer: r.pick(D.PEOPLE.first) + ' ' + r.pick(D.PEOPLE.last),
      requestT: at, status: 'pending', gasTest: null, isoVerified: null, conditions: [], decision: null, workEnd: null,
      competentExp: S.date + r.int(30, 700) * 86400000, ignition: base.type === 'hot',
    });
    pm.ignition = pm.type === 'hot';
    if (opts && opts.badCompetency) { pm.competentExp = S.date - r.int(5, 40) * 86400000; pm.facts.blockers.push('competency'); }
    if (pm.declared.competent === false) { pm.competentExp = S.date - r.int(3, 20) * 86400000; pm.facts.blockers.push('competency'); }
    return pm;
  }

  // ---------------------------------------------------------------------------------
  // Live assessment — what a competent area authority would see right now.
  function assess(S, pm) {
    const out = { blockers: [], needs: [], simops: [], notes: [] };
    const f = pm.facts;
    for (const b of f.blockers) out.blockers.push(b);
    if (pm.competentExp < S.date) out.blockers.push('competency');
    // SIMOPS
    const near = (x, y, r) => U.dist(x, y, pm.loc.x, pm.loc.y) <= r;
    for (const b of S.bays) if ((b.state === 'LOADING' || b.state === 'DECANTING' || b.state === 'READY' || b.state === 'PREP') && near(b.x, b.y, 35)) out.simops.push(b.tag + ' ' + b.state.toLowerCase());
    if (S.rail.comp.running) {
      const c = S.rail.cars.find((x) => x.id === S.rail.comp.lineup);
      if (c) { const pt = D.POINTS[c.spotId === 'R1' ? 'railR1' : 'railR2']; if (near(pt.x, pt.y, 35)) out.simops.push('Rail unloading at ' + c.spotId); }
    }
    for (const p of Object.values(S.pumps)) if (p.running && near(p.x, p.y, 20)) out.simops.push(p.tag + ' running');
    out.lel = L.plant.lelAt(S, pm.loc.x, pm.loc.y);
    if (out.lel > 0.5 && (pm.ignition || pm.type === 'vehicle' || pm.type === 'excavation')) out.blockers.push('gas');
    // Gas test
    const gt = pm.gasTest;
    if (f.needsGas) {
      if (!gt || gt.status !== 'done') out.needs.push('gasTest');
      else if (S.t - gt.t > 2 * 3600) out.needs.push('gasTestStale');
      else {
        if (gt.lel > (pm.type === 'confined' ? 1 : 0.5)) out.blockers.push('gas');
        if (pm.type === 'confined' && (gt.o2 < 19.5 || gt.o2 > 23.5)) out.blockers.push('gas');
      }
    }
    if (f.confined && f.isoActual === 'valve' && pm.isoVerified) out.blockers.push('isolation');
    if (f.confined && f.isoActual === 'valve' && !pm.isoVerified) out.hiddenIsolation = true;
    // Equipment state
    if (f.pump) {
      const p = S.pumps[f.pump];
      if (p.running) out.blockers.push('equipment');
      const other = Object.values(S.pumps).find((q) => q.product === p.product && q.id !== p.id);
      if (other && (other.loto || other.tripped)) out.notes.push('Both ' + p.product + ' pumps would be unavailable — butane loading stops.');
    }
    if (f.pumpCheck) {
      const p = S.pumps[f.pumpCheck];
      if (p.running) out.blockers.push('equipment');
    }
    if (f.override) {
      const comp = S.rail.comp;
      if (comp.running && comp.tank === f.override && comp.mode === 'LIQUID') out.blockers.push('simops');
    }
    if (f.height) {
      if (S.weather.wind > 12) out.blockers.push('weather');
      if (S.weather.hold || S.t - S.weather.lastStrike20 < 900) out.blockers.push('weather');
    }
    if (f.inhibit) {
      const g = S.gd.find((x) => x.id === f.inhibit);
      if (g && g.lel > 10) out.blockers.push('gas');
    }
    // Hot work / vehicle with active SIMOPS needs the zone suspended.
    if ((pm.ignition || pm.type === 'vehicle') && out.simops.length) out.notes.push('Live operations within 35 m: ' + out.simops.join(', '));
    out.blockers = Array.from(new Set(out.blockers));
    return out;
  }

  // ---------------------------------------------------------------------------------
  sim.register({
    name: 'permits', order: 60,
    init(S) {
      S.permits = [];
      S.simopsHold = { LR: null, RL: null };
    },
    tick(S, dt) {
      for (const pm of S.permits) {
        if (pm.status === 'scheduled' && S.t >= pm.requestT) {
          pm.status = 'pending';
          sim.log(S, 'permit', pm.no + ' requested by ' + pm.contractor + ': ' + pm.title + '.');
        }
        if (pm.status === 'pending' && S.t - pm.requestT > 5400 && !pm.latePen) {
          pm.latePen = true;
          sim.score(S, 'compliance', -1, pm.no + ' left without a decision for 90 min (crew standing idle)');
        }
        if (pm.status === 'active' && S.t >= pm.workEnd) {
          pm.status = 'workdone';
          sim.log(S, 'permit', pm.no + ': ' + pm.contractor + ' reports work complete. Permit awaiting hand-back and close-out.');
        }
        // Suspend-zone conditions: penalise live transfers while hot work is active.
        if (pm.status === 'active' && pm.conditions.includes('suspendLR')) {
          for (const b of S.bays) {
            if ((b.state === 'LOADING' || b.state === 'DECANTING') && U.dist(b.x, b.y, pm.loc.x, pm.loc.y) < 40 && !pm['simopsPen' + b.id]) {
              pm['simopsPen' + b.id] = true;
              sim.score(S, 'safety', -6, b.tag + ' transferring while ' + pm.no + ' requires the rack suspended', 'A permit condition is a commitment. If the permit says the rack is suspended, nothing on the rack moves until the permit is suspended or closed.');
            }
          }
        }
        // Weather stop condition for work at height
        if (pm.status === 'active' && pm.facts.height && (S.weather.hold || S.weather.wind > 15 || S.t - S.weather.lastStrike20 < 600)) {
          if (pm.conditions.includes('weatherStop')) {
            pm.status = 'suspended'; pm.suspendedWhy = 'weather';
            sim.log(S, 'permit', pm.no + ' suspended — weather stop condition triggered. Crew down from V-102.', 'warn');
          } else if (!pm.wxPen) {
            pm.wxPen = true;
            sim.score(S, 'safety', -10, 'Crew working on top of V-102 during a lightning/wind alarm (no weather stop condition)', 'A person on top of a 15 m sphere is the highest point on site in a thunderstorm.');
          }
        }
        // Excavation without line locate: chance of striking the buried rail line.
        if (pm.status === 'active' && pm.facts.excav && !pm.facts.locate && !pm.struck && S.rng.chance(dt / 4000)) {
          pm.struck = true;
          sim.log(S, 'safety', 'Excavator bucket struck the buried rail unloading line near R2!', 'crit');
          sim.score(S, 'safety', -15, 'Buried line struck during ' + pm.no + ' (no line locate)', 'Always locate buried services (drawings plus cable/pipe locator) and hand-dig within 0.5 m before machine excavation.');
          L.plant.addLeak(S, { x: pm.loc.x, y: pm.loc.y, zone: 'RL', src: { kind: 'field', id: 0 }, rate: 0.35, product: 'propane', label: 'Struck line near R2', fieldFix: true });
        }
      }
      // Rack hold from permits
      S.simopsHold.LR = (S.permits.find((p) => p.status === 'active' && p.conditions.includes('suspendLR')) || {}).no || null;
      S.simopsHold.RL = (S.permits.find((p) => p.status === 'active' && p.conditions.includes('suspendRL')) || {}).no || null;
      const pend = S.permits.filter((p) => p.status === 'pending' && S.t - p.requestT > 900).length;
      sim.setAlarm(S, 'PERMIT', 'PERMIT', 'PTW', pend > 0, pend + ' waiting');
    },
  });

  // ---------------------------------------------------------------------------------
  const A = sim.action;
  function get(S, no) { return S.permits.find((p) => p.no === no); }

  A('permitGasTest', (S, no) => {
    const pm = get(S, no);
    if (!pm) return { ok: false };
    if (pm.gasTest && pm.gasTest.status === 'pending') return { ok: false, msg: 'Gas test already requested.' };
    pm.gasTest = { status: 'pending' };
    return L.crewMod.dispatch(S, null, {
      kind: 'gastest', label: 'Gas test for ' + pm.no + ' at ' + pm.loc.name, x: pm.loc.x, y: pm.loc.y + 2, work: 6 * 60,
      done: (S2, c) => {
        const f = pm.facts;
        const lel = f.confined ? f.insideLel + S2.rng.range(0, 0.4) : L.plant.lelAt(S2, pm.loc.x, pm.loc.y);
        const o2 = f.confined ? f.o2 : 20.9;
        pm.gasTest = { status: 'done', t: S2.t, lel: Math.round(lel * 10) / 10, o2: Math.round(o2 * 10) / 10, h2s: 0, co: f.confined ? S2.rng.int(0, 3) : 0, by: c.name };
        sim.radio(S2, c.call, 'Gas test ' + pm.no + ': O₂ ' + pm.gasTest.o2.toFixed(1) + '%, LEL ' + pm.gasTest.lel.toFixed(1) + '%, H₂S 0 ppm, CO ' + pm.gasTest.co + ' ppm. Recorded on the permit.');
      },
      cancel: () => { pm.gasTest = null; },
    });
  });
  A('permitVerifyIso', (S, no) => {
    const pm = get(S, no);
    if (!pm) return { ok: false };
    return L.crewMod.dispatch(S, null, {
      kind: 'isolation', label: 'Verify isolation for ' + pm.no, x: pm.loc.x, y: pm.loc.y + 2, work: 10 * 60,
      done: (S2, c) => {
        pm.isoVerified = true;
        const f = pm.facts;
        if (f.confined && f.isoActual === 'valve') sim.radio(S2, c.call, pm.no + ': isolation is NOT as declared. Only two nozzles are spaded — the bottom liquid connection is on a closed valve only. Not positive isolation.');
        else if (f.pump) { const p = S2.pumps[f.pump]; sim.radio(S2, c.call, pm.no + ': ' + p.tag + (p.running ? ' is RUNNING — cannot isolate a running duty pump.' : ' breaker racked out, locks applied, MOVs closed, proved dead at local stop. Isolation confirmed.')); }
        else sim.radio(S2, c.call, pm.no + ': isolation checked on site and matches the certificate.');
      },
    });
  });
  A('permitDecide', (S, no, decision, payload) => {
    const pm = get(S, no);
    if (!pm || pm.status !== 'pending') return { ok: false, msg: 'Permit is not awaiting a decision.' };
    const as = assess(S, pm);
    pm.decision = { t: S.t, decision, payload, assess: as };
    const f = pm.facts;
    const why = (k) => REJECT_REASONS[k] || k;
    if (decision === 'reject') {
      pm.status = 'rejected';
      const reason = payload && payload.reason;
      if (as.blockers.length || as.hiddenIsolation) {
        S.stats.nearMisses++;
        const hit = as.blockers.includes(reason) || (as.hiddenIsolation && reason === 'isolation');
        sim.score(S, 'safety', +3, 'Correctly refused ' + pm.no + (hit ? '' : ' (recorded reason differs: ' + why(as.blockers[0] || 'isolation') + ')'), lessonFor(pm, as));
      } else if (as.needs.includes('gasTest') && reason === 'gas') {
        sim.log(S, 'permit', pm.no + ' refused pending gas test — contractor will re-submit.');
        reissue(S, pm, 45 * 60);
      } else if (as.simops.length && (pm.ignition || pm.type === 'vehicle') && reason === 'simops') {
        sim.score(S, 'compliance', +1, pm.no + ' deferred because of live operations nearby');
        reissue(S, pm, 90 * 60);
      } else {
        sim.score(S, 'compliance', -2, 'Refused ' + pm.no + ' with no valid safety reason (maintenance backlog grows)');
      }
      sim.log(S, 'permit', pm.no + ' REFUSED — ' + why(reason) + '.');
      return { ok: true, msg: pm.no + ' refused.' };
    }
    // Approve
    const conds = (payload && payload.conditions) || [];
    pm.conditions = conds;
    pm.status = 'active';
    pm.startT = S.t;
    pm.workEnd = S.t + pm.durH * 3600;
    let problems = 0;
    for (const b of as.blockers) {
      problems++;
      const pts = b === 'gas' || b === 'isolation' || b === 'simops' || b === 'equipment' ? -12 : -7;
      sim.score(S, 'safety', pts, 'Issued ' + pm.no + ' despite: ' + why(b), lessonFor(pm, as, b));
    }
    if (as.hiddenIsolation) { problems++; sim.score(S, 'safety', -12, 'Issued confined space entry ' + pm.no + ' without verifying the isolation (valve only, not spaded)', 'For vessel entry only positive isolation (spades/blinds or removed spool) is acceptable, and the area authority verifies it on site. A passing valve can flood a vessel with LPG while people are inside.'); }
    if (as.needs.includes('gasTest')) { problems++; sim.score(S, 'compliance', -5, 'Issued ' + pm.no + ' without the required gas test', 'The gas test is done immediately before work starts and recorded on the permit. Without it you are guessing.'); }
    if (as.needs.includes('gasTestStale')) { problems++; sim.score(S, 'compliance', -3, 'Issued ' + pm.no + ' on a gas test more than 2 hours old'); }
    for (const c of f.needsCond) {
      if (c === 'suspendLR' && !as.simops.some((s) => /Bay/.test(s)) && pm.type === 'hot' && !conds.includes(c)) {
        // Suspension needed only if the rack is (or will be) live; accept fire watch + gas monitoring if rack idle.
        sim.log(S, 'permit', pm.no + ': rack idle at issue — make sure no bay is authorised while the hot work is live.');
        pm.watchRack = true;
        continue;
      }
      if (!conds.includes(c)) { problems++; sim.score(S, 'safety', -4, pm.no + ' issued without condition: ' + CONDITIONS[c], 'Conditions on a permit are the controls that make the job safe. If the risk assessment needs them, they are not optional.'); }
    }
    if ((pm.ignition || pm.type === 'vehicle') && as.simops.length && !conds.includes('suspendLR') && !conds.includes('suspendRL')) {
      problems++;
      sim.score(S, 'safety', -8, pm.no + ' issued with live operations within 35 m and no suspension', 'Simultaneous operations: an ignition source next to a live LPG transfer is exactly the combination that turns a small leak into a fire.');
    }
    if (!problems) { sim.score(S, 'compliance', +2, pm.no + ' issued correctly'); }
    // Effects
    if (f.pump) { const p = S.pumps[f.pump]; if (p.running) { p.running = false; } p.loto = true; p.isolated = true; sim.log(S, 'ops', p.tag + ' locked out under ' + pm.no + '.'); }
    if (f.override) { S.tanks[f.override].lshhBypass = true; sim.log(S, 'safety', 'LSHH-' + f.override.slice(1) + ' BYPASSED under ' + pm.no + '.', 'warn'); }
    if (f.inhibit) { const g = S.gd.find((x) => x.id === f.inhibit); g.inhibited = true; g.inhibitBy = pm.no; }
    if (conds.includes('suspendLR')) sim.log(S, 'permit', 'Loading rack suspended for ' + pm.no + '. Bays cannot be authorised until the permit is closed or suspended.');
    sim.log(S, 'permit', pm.no + ' ISSUED' + (conds.length ? ' with conditions: ' + conds.map((c) => CONDITIONS[c]).join('; ') : '') + '. Work until ' + U.clock(S, pm.workEnd) + '.');
    return { ok: true, msg: pm.no + ' issued.' };
  });
  A('permitClose', (S, no) => {
    const pm = get(S, no);
    if (!pm || !['active', 'workdone', 'suspended'].includes(pm.status)) return { ok: false, msg: 'Permit is not open.' };
    const early = pm.status !== 'workdone';
    pm.status = 'closed'; pm.closedT = S.t;
    const f = pm.facts;
    if (f.pump) {
      const p = S.pumps[f.pump];
      p.loto = false; p.isolated = false;
      if (!early) { p.wear = 0.02; p.wearRate = 0; p.vib = 1.5; p.seal = 'ok'; p.sealWear = 0; p.sealRate = 0; p.tripped = false; }
      sim.log(S, 'ops', p.tag + ' locks removed, returned to service' + (early ? ' (work incomplete).' : ' after maintenance.'));
    }
    if (f.override) { S.tanks[f.override].lshhBypass = false; sim.log(S, 'safety', 'LSHH-' + f.override.slice(1) + ' bypass REMOVED. Overfill protection restored.'); }
    if (f.inhibit) { const g = S.gd.find((x) => x.id === f.inhibit); g.inhibited = false; if (!early) g.fault = false; }
    if (f.handoverPump) { const p = S.pumps[f.handoverPump]; p.loto = false; p.isolated = false; if (!early) { p.seal = 'ok'; p.sealWear = 0; p.sealRate = 0; p.wear = 0.02; } }
    if (f.handoverGD) { const g = S.gd.find((x) => x.id === f.handoverGD); g.inhibited = false; g.fault = false; }
    if (early && f.override) sim.log(S, 'permit', pm.no + ' closed before the work was complete.');
    if (!early) sim.score(S, 'compliance', +1, pm.no + ' handed back and closed');
    sim.log(S, 'permit', pm.no + ' CLOSED. Work site inspected and handed back.');
    return { ok: true };
  });
  A('permitSuspend', (S, no) => {
    const pm = get(S, no);
    if (!pm || pm.status !== 'active') return { ok: false };
    pm.status = 'suspended'; pm.suspendedWhy = 'operator';
    sim.log(S, 'permit', pm.no + ' suspended by the area authority.');
    return { ok: true };
  });
  A('permitResume', (S, no) => {
    const pm = get(S, no);
    if (!pm || pm.status !== 'suspended') return { ok: false };
    const as = assess(S, pm);
    if (pm.facts.needsGas && (!pm.gasTest || pm.gasTest.status !== 'done' || pm.gasTest.t < (pm.suspendedT || pm.startT))) {
      sim.score(S, 'compliance', -2, pm.no + ' resumed without a fresh gas test');
    }
    if (as.blockers.includes('gas') || as.lel > 1) sim.score(S, 'safety', -8, pm.no + ' resumed with gas present');
    pm.status = 'active';
    sim.log(S, 'permit', pm.no + ' resumed.');
    return { ok: true };
  });

  function reissue(S, pm, delay) {
    const pm2 = makePermit(S, pm.key, S.t + delay);
    pm2.status = 'scheduled';
    pm2.facts = pm.facts; // same job, same hidden facts
    pm2.title = pm.title; pm2.loc = pm.loc; pm2.declared = pm.declared; pm2.contractor = pm.contractor; pm2.performer = pm.performer;
    pm2.resubmitOf = pm.no;
    S.permits.push(pm2);
  }

  function lessonFor(pm, as, b) {
    const key = b || as.blockers[0] || (as.hiddenIsolation ? 'isolation' : '');
    switch (key) {
      case 'gas': return 'Hot work, vehicles and entry require a clean gas test at the work site: 0% LEL for hot work, <1% LEL and 19.5–23.5% O₂ for entry.';
      case 'isolation': return 'Isolation must match the certificate and be verified on site. For vessel entry, only positive isolation (spades/blinds) is acceptable.';
      case 'competency': return 'Check the performing authority\'s competency card. An expired card means nobody has confirmed they can do this job safely.';
      case 'weather': return 'Work at height stops for lightning within 20 km and wind above 12 m/s on exposed platforms.';
      case 'equipment': return 'Equipment must be stopped and isolated before work on it — swap the duty to the standby pump first.';
      case 'rescue': return 'No confined space entry without a standby person and a rescue plan. Most confined-space deaths are would-be rescuers.';
      case 'locate': return 'Buried services must be located (drawings plus locator scan) before any mechanical excavation.';
      case 'simops': return 'Do not bypass overfill protection on a vessel that is receiving product.';
      default: return '';
    }
  }

  L.permits = { TYPES, CONDITIONS, REJECT_REASONS, TEMPLATES, makePermit, assess };
})(globalThis.LPG = globalThis.LPG || {});
