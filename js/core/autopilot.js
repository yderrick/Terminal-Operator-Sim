/* Autopilot: the crew's brain. A competent operator that reads documents, computes presets and follows procedures.
   Every action has a category, a title, a reason and a place on the map. A policy decides, per category, whether the
   crew just does it, asks the player for approval first, or leaves it alone. The same code drives the headless tests,
   crew autonomy in play, approval requests and the tutorial narration. */
(function (L) {
  'use strict';

  // Categories. FIELD work is done by field operators; ROUTINE by the CCR assistant; DECIDE are key decisions.
  const FIELD = new Set(['field', 'railField', 'permitPrep', 'gaugeRead', 'emergencyField']);
  const ROUTINE = new Set(['routine', 'ack', 'handover', 'header', 'bayAssign', 'bayRun', 'railComp', 'utility', 'gaugeSign', 'permitClose', 'emergency']);
  const DECIDE = new Set(['gate', 'bayHold', 'preset', 'release', 'railSpec', 'permit', 'radar']);
  const CAT_LABEL = { field: 'Field work', railField: 'Rail', permitPrep: 'Permits', gaugeRead: 'Gauging', emergencyField: 'Emergency', routine: 'Control room', ack: 'Alarms', ackCrit: 'Alarms', handover: 'Handover', header: 'Pumps & headers', bayAssign: 'Loading rack', bayRun: 'Loading rack', railComp: 'Rail', utility: 'Utilities', gaugeSign: 'Gauging', permitClose: 'Permits', emergency: 'Emergency', gate: 'Gate', bayHold: 'Loading rack', preset: 'Loading rack', release: 'Weighbridge', railSpec: 'Rail', permit: 'Permits', radar: 'Gauging' };

  // Policy from the shift settings.
  function policyFor(S) {
    const a = S.cfg.autonomy, ap = S.cfg.approvals;
    return (cat) => {
      if (a === 'watch') return 'do';
      if (a === 'off') return 'skip';
      if (cat === 'ackCrit') return 'skip';
      if (FIELD.has(cat)) return 'do';
      if (a === 'field') return 'skip';
      if (ROUTINE.has(cat)) return 'do';
      if (DECIDE.has(cat)) return ap === 'auto' ? 'do' : 'ask';
      return 'skip';
    };
  }

  // Where an action happens, for the camera and for icons.
  function locate(S, name, args) {
    const bay = (id) => S.bays.find((b) => b.id === id);
    const tr = (id) => S.trucks.find((t) => t.id === id);
    const car = (id) => S.rail.cars.find((c) => c.id === id);
    const carLoc = (c) => c ? { x: c.spotId === 'R1' ? 46 : 86, z: 140.5, kind: 'car', id: c.id, key: 'car:' + c.id } : null;
    const tk = (id) => S.tanks[id] ? { x: S.tanks[id].x, z: S.tanks[id].y, kind: 'tank', id } : null;
    switch (name) {
      case 'gateDecision': return { x: 278, z: 162, kind: 'truck', id: args[0], key: 'trk:' + args[0] };
      case 'assignBay': return { x: bay(args[1]).x, z: 90, kind: 'bay', id: args[1] };
      case 'bayChangeover': case 'bayResolve': case 'bayAuthorize': case 'bayStop': case 'bayResume': case 'bayFinish': case 'bayPA': case 'bayReground': case 'baySuspend': case 'bayRepair': { const b = bay(args[0]); return b ? { x: b.x, z: 80, kind: 'bay', id: b.id } : null; }
      case 'bayStopAll': return { x: 213, z: 80, kind: 'bay', id: 1 };
      case 'truckRelease': case 'truckDecant': return { x: 218, z: 162, kind: 'truck', id: args[0], key: 'trk:' + args[0] };
      case 'railSecure': case 'railSample': case 'railConnect': case 'railRelease': case 'railReject': case 'railCloseCarValves': return carLoc(car(args[0]));
      case 'compLineup': case 'compMode': case 'compStart': case 'compStop': case 'compReset': return { x: 66, z: 124, kind: 'comp', id: 'C301' };
      case 'gaugeManual': return tk(args[1]);
      case 'gaugeFlag': return tk(args[1]);
      case 'gaugeSign': case 'gaugeOpenClosing': return { x: 70, z: 44, kind: 'tank', id: 'V102' };
      case 'setTankValve': return tk(args[0]);
      case 'setHeaderSource': return tk(args[1]);
      case 'pumpIsolate': case 'pumpReset': case 'pumpStop': case 'pumpDuty': { const p = S.pumps[args[0]]; return p ? { x: p.x, z: p.y, kind: 'pump', id: p.id } : null; }
      case 'permitDecide': case 'permitGasTest': case 'permitVerifyIso': case 'permitClose': { const pm = S.permits.find((x) => x.no === args[0]); return pm ? (pm.status === 'pending' ? { x: 157, z: 158, kind: 'permit', id: pm.no, key: 'pm:' + pm.no + ':a' } : { x: pm.loc.x, z: pm.loc.y, kind: 'permit', id: pm.no, key: 'pm:' + pm.no + ':a' }) : null; }
      case 'odorRestore': case 'odorDelivery': return { x: 176, z: 64, kind: 'odorant', id: 'T401' };
      case 'fwPump': return { x: 34, z: 121, kind: 'fwpumps', id: 'FWP' };
      case 'iaStart': case 'iaStop': return { x: 150, z: 124, kind: 'ia', id: 'IA' };
      case 'wbZero': return { x: args[0] === 'in' ? 240 : 204, z: 140, kind: 'wb', id: args[0] };
      case 'crewRounds': return { x: 150, z: 140, kind: 'ccr', id: 'CCR' };
      case 'handoverAck': return { x: 150, z: 151, kind: 'ccr', id: 'CCR' };
      case 'callFireBrigade': case 'muster': case 'deluge': case 'esdReset': { const f = S.fires[0]; return f ? { x: f.x, z: f.y, kind: 'ground' } : { x: 150, z: 151, kind: 'ccr', id: 'CCR' }; }
      case 'crewIsolateField': { const lk = S.leaks.find((l) => l.id === args[0]); return lk ? { x: lk.x, z: lk.y, kind: 'ground' } : null; }
      default: return null;
    }
  }

  // ---------------------------------------------------------------- One decision pass
  function step(Lx, S, opts) {
    const L2 = Lx || L;
    // Accept either step(L, S, { policy, ask, narrate, style }) or the old step(L, S, style).
    const isOpts = opts && (opts.policy || opts.ask || opts.narrate || opts.style);
    opts = isOpts ? opts : { style: opts || {} };
    const style = opts.style || {};
    const policy = opts.policy || (() => 'do');
    const U = L2.util, F = U.fmt, P = L2.phys;
    const asked = opts.asked || null;
    const act = (name, ...args) => { S._ap = true; try { return L2.sim.act(S, name, ...args); } finally { S._ap = false; } };
    // go(cat, info, name, ...args): run, ask, or skip according to policy.
    function go(cat, info, name, ...args) {
      const p = policy(cat);
      if (p === 'skip') return false;
      const loc = info.loc !== undefined ? info.loc : locate(S, name, args);
      if (p === 'ask') {
        if (opts.ask) opts.ask({ cat, key: info.akey || (name + ':' + JSON.stringify(args)), title: info.title, why: info.why, name, args, loc });
        return false;
      }
      const res = act(name, ...args);
      const ok = !res || res.ok !== false;
      if (ok && info.title && opts.narrate) opts.narrate({ cat, title: info.title, why: info.why || '', key: info.key || cat, loc, important: !!info.important, name, args });
      return ok;
    }
    const touched = (names, id, mins) => names.some((n) => { const t = S.touch[n + ':' + JSON.stringify(id)]; return t !== undefined && S.t - t < (mins || 15) * 60; });
    const hold = S.weather.hold;

    // ---------------- Alarms and handover
    for (const a of S.alarms.slice()) {
      if (a.acked) continue;
      const cat = a.pri <= 2 ? 'ackCrit' : 'ack';
      if (policy(cat) === 'do') L2.sim.ackAlarm(S, a.id);
    }
    if (!S.handover.acked) go('handover', { title: 'Shift handover read and signed', why: 'Every shift starts by reading the night shift\'s notes: what is locked out, what is inhibited, what is due today. Handover failures sit behind some of the worst process accidents (Piper Alpha, 1988).', key: 'handover', important: true }, 'handoverAck');

    // ---------------- Emergencies
    const gas = style.reckless ? [] : S.gd.filter((g) => g.lel >= 20 && !g.inhibited && !g.fault);
    if (gas.length) {
      const g0 = gas[0];
      for (const z of new Set(gas.map((g) => g.zone))) {
        if (z === 'LR' && S.bays.some((b) => b.state === 'LOADING')) go('emergency', { title: 'Gas on the rack — all bays stopped', why: g0.tag + ' reads ' + Math.round(g0.lel) + '% LEL. Stopping every transfer removes the fuel and keeps drivers from starting engines near the cloud. Investigate before restarting.', key: 'gas-rack', important: true, loc: { x: g0.x, z: g0.y, kind: 'gd', id: g0.id } }, 'bayStopAll');
        if (z === 'PA') for (const p of Object.values(S.pumps)) if (!p.isolated && U.dist(p.x, p.y, g0.x, g0.y) < 15) go('emergency', { title: p.tag + ' isolated (gas at the pumps)', why: 'Gas near a pump usually means a seal leak. Stopping the pump and closing its suction and discharge valves cuts off the leak.', key: 'gas-pump', important: true }, 'pumpIsolate', p.id, true);
        if (z === 'TF') for (const id of S.tankOrder) { const t = S.tanks[id]; if (U.dist(t.x, t.y, g0.x, g0.y) < 20 && t.xvOut) go('emergency', { title: t.tag + ' outlet ROSOV closed (gas in the tank farm)', why: 'The leak is close to ' + t.tag + '. Closing its remotely operated outlet valve isolates the manifold from the 500-tonne inventory behind it.', key: 'gas-tank', important: true }, 'setTankValve', id, 'out', false); }
        if (z === 'RL') { if (S.rail.comp.running) go('emergency', { title: 'C-301 stopped (gas at the rail siding)', why: 'Stop pushing gas around while there is a leak at the siding.', key: 'gas-rail', important: true }, 'compStop'); for (const c of S.rail.cars) if (c.valvesOpen && c.state !== 'RELEASED' && !c.closeReq) { c.closeReq = true; go('emergencyField', { title: 'Field operator sent to close the car valves', why: 'The car valves are manual. A field operator approaches from upwind with a personal gas monitor.', key: 'gas-car', important: true }, 'railCloseCarValves', c.id); } }
      }
      for (const lk of S.leaks) if (lk.src.kind === 'field' && !lk.fixed && !lk.fixReq && lk.seen) { lk.fixReq = true; go('emergencyField', { title: 'Field operator sent to shut the manual block valve', why: 'This release is on a line with no remote valve. Someone has to close it by hand, approaching from upwind.', key: 'gas-manual', important: true }, 'crewIsolateField', lk.id); }
    }
    if (S.fires.length && !style.reckless) {
      if (!S.fireBrigade.called) go('emergency', { title: 'Fire service called', why: 'Call early. They take about 12 minutes to arrive and bring cooling capacity the terminal does not have.', key: 'fire-call', important: true }, 'callFireBrigade');
      if (!S.muster.active) go('emergency', { title: 'General alarm — everyone to the muster point', why: 'Anyone not fighting the emergency goes to the muster point so they can be counted and kept out of harm\'s way. All permits are suspended.', key: 'fire-muster', important: true }, 'muster', true);
      for (const d of L2.data.DELUGE) if (!S.fw.deluge[d.id].open && !touched(['deluge'], d.id, 5)) go('emergency', { title: d.tag + ' deluge opened', why: 'Water on the shells keeps the steel cool. An uncooled vessel in a fire can fail as a BLEVE within minutes.', key: 'fire-deluge', important: true }, 'deluge', d.id, true);
    } else if (S.muster.active && !S.leaks.some((l) => l.rate > 0.01) && !touched(['muster'], true, 10)) go('emergency', { title: 'All clear given', why: 'The release is stopped and the gas has cleared, so people can return to their work areas.', key: 'allclear' }, 'muster', false);
    if (!S.fires.length && !S.leaks.some((l) => l.rate > 0.01)) {
      for (const d of L2.data.DELUGE) if (S.fw.deluge[d.id].open && !touched(['deluge'], d.id, 10)) go('emergency', { title: d.tag + ' deluge closed', why: 'No fire left to cool. Saving fire water.', key: 'deluge-off' }, 'deluge', d.id, false);
      if (S.esd.site) go('emergency', { title: 'Site ESD reset', why: 'The cause has cleared (no gas above 10% LEL, no fire). Resetting does not restart anything; valves and pumps are brought back one at a time.', key: 'esd-reset', important: true }, 'esdReset', 'site');
      for (const z of ['TF', 'PA', 'LR', 'RL']) if (S.esd.zones[z]) go('emergency', { title: L2.data.ZONES[z].name + ' ESD reset', why: 'Gas has cleared from the area.', key: 'esd-reset' }, 'esdReset', z);
      if (!S.esd.site && !S.esd.zones.TF) for (const id of S.tankOrder) {
        const t = S.tanks[id];
        if (!t.xvOut && !S.events.some((e) => e.kind === 'flange' && e.id === id && e.state === 'weep') && !touched(['setTankValve'], id)) go('routine', { title: t.tag + ' outlet valve reopened', why: 'Restoring the normal line-up after the area was made safe.', key: 'lineup' }, 'setTankValve', id, 'out', true);
        if (!t.xvIn && t.fill < 0.84 && !touched(['setTankValve'], id)) go('routine', { title: t.tag + ' inlet valve reopened', why: 'Restoring the line-up.', key: 'lineup' }, 'setTankValve', id, 'in', true);
      }
      for (const p of Object.values(S.pumps)) if (p.isolated && !p.loto && p.seal !== 'leak' && !touched(['pumpIsolate'], p.id)) go('routine', { title: p.tag + ' de-isolated', why: 'Gas cleared; the pump is returned to standby.', key: 'lineup' }, 'pumpIsolate', p.id, false);
    }

    // ---------------- Utilities
    for (const c of S.util.ia.comps) if (c.tripped) {
      const o = S.util.ia.comps.find((x) => x !== c);
      if (!o.running) go('utility', { title: o.tag + ' standby air compressor started', why: c.tag + ' tripped. Instrument air holds every ROSOV open; below 3.5 barg they all fail closed and the terminal stops.', key: 'ia', important: true }, 'iaStart', o.id);
      go('utility', { title: c.tag + ' reset and returned to standby', why: '', key: 'ia2' }, 'iaStart', c.id); go('utility', {}, 'iaStop', c.id);
    }
    for (const p of Object.values(S.pumps)) if (p.tripped && !p.loto) go('utility', { title: p.tag + ' trip reset', why: 'The pump stopped on ' + p.tripCause + '. Once the cause has cleared, the trip is reset so the auto-start can use it again.', key: 'pumpreset' }, 'pumpReset', p.id);
    if (S.util.odor.failed && !S.flags.botOdor) { if (go('field', { title: 'Field operator sent to re-prime the odorant pump', why: 'Propane for homes must be odorised (ethyl mercaptan, 25 ppm) so a leak can be smelt. No propane is loaded until injection is back.', key: 'odor', important: true }, 'odorRestore')) S.flags.botOdor = true; }
    if (!S.util.odor.failed) S.flags.botOdor = false;
    if (S.odorDelivery.arrived && !S.odorDelivery.done && !S.odorDelivery.inProgress) go('field', { title: 'Odorant delivery supervised', why: 'Mercaptan is toxic and smells appalling at tiny concentrations. A field operator watches the whole transfer.', key: 'odordel' }, 'odorDelivery');
    const fwt = S.tasks.find((t) => t.id === 'fwtest');
    if (fwt && fwt.status === 'pending' && S.t >= fwt.startT && !S.fw.diesel.running && !S.fw.diesel.failed) go('utility', { title: 'Weekly diesel fire pump test started', why: 'Fire pumps that are never run fail when needed. P-502 runs for 30 minutes every week; it is the backup if the power fails during a fire.', key: 'fwtest', important: true }, 'fwPump', 'diesel', true);
    if (S.fw.diesel.failed && !S.fw.diesel.repairing) go('field', { title: 'P-502 sent for repair', why: 'The test found a fault. That is the point of testing on a quiet day.', key: 'fwrepair', important: true }, 'fwRepair', 'diesel');
    if (S.fw.diesel.tested && S.fw.diesel.running && !S.fires.length) go('utility', { title: 'Diesel fire pump test complete', why: '', key: 'fwtest2' }, 'fwPump', 'diesel', false);
    if (S.fw.elec.running && !S.fires.length && !Object.values(S.fw.deluge).some((d) => d.open)) go('utility', {}, 'fwPump', 'elec', false);
    for (const k of ['in', 'out']) if (S.wb[k].zero && !S.wb[k].busy) go('utility', { title: (k === 'in' ? 'WB-1' : 'WB-2') + ' re-zeroed', why: 'The weighbridge read ' + S.wb[k].zero + ' kg with an empty deck. Every delivery note it prints would be wrong by that much.', key: 'wbzero', important: true }, 'wbZero', k);
    for (const t of S.tasks) if (t.id.startsWith('rounds') && t.status === 'pending' && S.t >= t.startT && !t.botSent) { if (go('field', { title: 'Field operator sent on plant rounds', why: 'A 40-minute walk-down of every area. Rounds find the weeping seal, the noisy bearing and the slack flange before they become a leak or a trip.', key: 'rounds', important: true }, 'crewRounds')) t.botSent = true; }
    S.findings.forEach((f, i) => {
      if (f.kind === 'leak' && f.status === 'open') { const lk = S.leaks.find((x) => x.id === f.leakId); if (lk && lk.src.kind === 'manifold') go('emergency', { title: 'Leaking manifold isolated', why: 'Rounds found a leak downstream of the outlet valve; closing it isolates the leak.', key: 'find-leak', important: true }, 'setTankValve', lk.src.id, 'out', false); if (lk && lk.src.kind === 'pump') go('emergency', { title: 'Leaking pump isolated', why: '', key: 'find-leak' }, 'pumpIsolate', lk.src.id, true); }
      if (f.status !== 'open' || f.botTried) return;
      if (f.kind === 'seal' || f.kind === 'bearing') {
        const p = S.pumps[f.id];
        if (p.running) { const o = Object.values(S.pumps).find((q) => q.product === p.product && q.id !== p.id && !q.loto); if (!o) return; go('routine', { title: 'Duty swapped to ' + o.tag, why: p.tag + ' needs maintenance, so its standby takes over first.', key: 'dutyswap' }, 'pumpDuty', o.id); go('routine', {}, 'pumpStop', p.id); }
      }
      if (f.kind === 'flange') go('routine', { title: S.tanks[f.id].tag + ' outlet closed for flange repair', why: 'The flange is re-torqued only once it is isolated.', key: 'flange' }, 'setTankValve', f.id, 'out', false);
      const cat = f.kind === 'radar' ? 'radar' : 'field';
      if (go(cat, { title: f.kind === 'radar' ? 'Radar flagged suspect from rounds' : 'Finding handed to maintenance: ' + f.text.split(':')[0], why: 'Fix the small problem before it becomes the big one.', key: 'finding', important: true, akey: 'finding:' + i }, 'fixFinding', i)) f.botTried = true;
    });

    // ---------------- Gauging
    const doGauge = (which) => {
      const g = S.gauge[which];
      if (!g || g.status !== 'open') return;
      for (const id of S.tankOrder) if (g.readings[id].manual === null && !g.readings[id].pending) go('gaugeRead', { title: 'Field operator reading ' + S.tanks[id].tag + '\'s local gauge', why: 'The radar is the control gauge, but it can stick. An independent local reading every shift is how a lying gauge is caught.', key: 'gauge-read' }, 'gaugeManual', which, id);
      if (S.tankOrder.every((id) => g.readings[id].manual !== null)) {
        for (const id of S.tankOrder) {
          const rd = g.readings[id], d = rd.manual - rd.radarAt;
          if (Math.abs(d) > 10 && !rd.flag) go('radar', { title: S.tanks[id].tag + ' radar flagged as faulty', why: 'Local gauge ' + rd.manual + ' mm, radar ' + rd.radarAt + ' mm at the same moment: ' + (d > 0 ? '+' : '') + d + ' mm apart. More than ~10 mm on a static tank means the radar is wrong. Receipts into that sphere are watched by hand until the technician fixes it — the Buncefield lesson.', key: 'radar', important: true, akey: 'radar:' + which + ':' + id }, 'gaugeFlag', which, id, true);
        }
        go('gaugeSign', { title: (which === 'opening' ? 'Opening' : 'Closing') + ' stock signed', why: 'For each sphere: level → volume from the sphere geometry → corrected to 15 °C → mass, plus the vapour above the liquid. ' + (which === 'closing' ? 'Then book stock (opening + receipts − dispatches) is compared with what the gauges say.' : ''), key: 'gauge-sign:' + which, important: true }, 'gaugeSign', which);
      }
    };
    doGauge('opening');
    if (S.t > 10.8 * 3600) { if (!S.gauge.closing) go('gaugeSign', {}, 'gaugeOpenClosing'); doGauge('closing'); }

    // ---------------- Header line-up
    for (const prod of ['propane', 'butane']) {
      const H = S.headers[prod];
      const src = S.tanks[H.source];
      const alts = S.tankOrder.map((id) => S.tanks[id]).filter((t) => t.product === prod && t.id !== H.source && !t.offspec);
      if ((src.fillMeas < 0.15 || !src.xvOut) && alts.length && !touched(['setHeaderSource'], prod, 20)) {
        const best = alts.sort((a, b) => b.fill - a.fill)[0];
        if (best.fill > src.fill + 0.1 || !src.xvOut) go('header', { title: prod[0].toUpperCase() + prod.slice(1) + ' loading switched to ' + best.tag, why: src.xvOut ? src.tag + ' is down to ' + F.pct(src.fillMeas) + '. Below about 10% the pumps lose suction head (NPSH) and start to cavitate.' : src.tag + '\'s outlet is shut, so the pumps would have no suction.', key: 'header', important: true }, 'setHeaderSource', prod, best.id);
      }
    }

    // ---------------- Gate
    for (const tr of S.trucks.filter((t) => t.state === 'QUEUE')) {
      const d = tr.docs, today = S.date;
      let reason = null;
      if (d.adrDriver < today) reason = 'adrDriver';
      else if (d.vehicleCert < today) reason = 'vehicleCert';
      else if (d.tankTest < today) reason = 'tankTest';
      else if (tr.product === 'propane' && d.un === '1011') reason = 'placard';
      else if (!d.ext6 || !d.ext2) reason = 'extinguisher';
      else if (!tr.booked && !d.salesNote) reason = 'noBooking';
      else if (/Propylene/.test(d.lastProduct) && !d.purgeCert) reason = 'lastProduct';
      else if (d.tyres !== 'Good') reason = 'tyres';
      if (S.esd.site) continue;
      if (style.reckless) reason = null;
      const ds = (ms) => new Date(ms).toISOString().slice(0, 10);
      if (reason) {
        const def = L2.rack.GATE_DEFECTS[reason];
        go('gate', { title: tr.plate + ' refused at the gate: ' + def.reason.toLowerCase(), why: def.lesson, key: 'gate-reject:' + reason, important: true, akey: 'gate:' + tr.id }, 'gateDecision', tr.id, 'reject', reason);
      } else {
        go('gate', { title: tr.plate + ' admitted (' + tr.product + ', ' + (tr.order === 'FULL' ? 'full load' : F.kg(tr.order)) + ')', why: 'Documents checked: driver ADR certificate to ' + ds(d.adrDriver) + ', vehicle certificate to ' + ds(d.vehicleCert) + ', tank test due ' + ds(d.tankTest) + ', orange plate 23/' + d.un + ' matches ' + tr.product + ', both extinguishers present, ' + (tr.booked ? 'booked slot ' + U.clock(S, tr.slotT) : 'spot order confirmed by Sales') + '.', key: 'gate-admit', akey: 'gate:' + tr.id }, 'gateDecision', tr.id, 'admit');
      }
    }

    // ---------------- Bays
    for (const b of S.bays) {
      const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId);
      if (b.hold) {
        const opt = b.hold.options[0];
        go('bayHold', { title: b.tag + ': ' + opt[1].toLowerCase(), why: b.hold.msg + ' The safe answer is to fix the problem, never to override or accept it.', key: 'hold:' + b.hold.key, important: true, akey: 'hold:' + b.id + ':' + b.hold.key }, 'bayResolve', b.id, opt[0]);
      }
      if (b.state === 'READY' && !hold && !S.simopsHold.LR && !(b.product === 'propane' && S.util.odor.failed)) {
        const mx = L2.rack.maxNet(S, tr);
        const heel = tr.grossIn - tr.tare;
        const fr = P.PRODUCTS[tr.product].fillRatio;
        const adr = fr * tr.capL - heel, wt = tr.gvw - tr.grossIn;
        const want = tr.order === 'FULL' ? mx.max : Math.min(tr.order, mx.max);
        const preset = style.reckless ? Math.floor(tr.capL * mx.fr * 1.12) : Math.floor(want - 80);
        go('preset', { title: b.tag + ': loading ' + tr.plate + ', preset ' + F.kg(preset), why: 'Preset = the lowest of: the order (' + (tr.order === 'FULL' ? 'full load' : F.kg(tr.order)) + '); the ADR filling limit ' + F.n0(tr.capL) + ' L × ' + fr + ' kg/L − heel ' + F.kg(heel) + ' = ' + F.kg(adr) + '; and the weight limit ' + F.kg(tr.gvw) + ' − gross in ' + F.kg(tr.grossIn) + ' = ' + F.kg(wt) + '. Less a small margin. ' + (adr < wt ? 'Here the filling ratio limits it.' : 'Here the legal weight limits it.'), key: 'preset', important: true, akey: 'preset:' + b.id + ':' + tr.id }, 'bayAuthorize', b.id, preset);
      }
      if (b.state === 'LOADING' && hold) go('bayRun', { title: b.tag + ' stopped for lightning', why: 'Strikes within 10 km: transfers stop and stay stopped until 30 minutes after the last strike inside that radius. Arms stay connected, valves closed.', key: 'lightning', important: true }, 'bayStop', b.id);
      else if (b.state === 'LOADING' && tr.engineOn) go('bayRun', { title: b.tag + ' stopped: engine running', why: 'A running engine is an ignition source next to the coupling, and a driver in the cab can drive off with the arms connected. Stop first, then talk to the driver.', key: 'engine', important: true }, 'bayStop', b.id);
      else if (b.state === 'LOADING' && b.product === 'propane' && S.util.odor.failed) go('bayRun', { title: b.tag + ' stopped: odorant injection failed', why: 'Unodorised propane cannot be smelt if it leaks in someone\'s home.', key: 'odor-stop', important: true }, 'bayStop', b.id);
      if (b.state === 'STOPPED' && !touched(['bayStop', 'bayStopAll'], b.id, 20) && !touched(['bayStopAll'], undefined, 20)) {
        if (tr.engineOn) go('bayRun', { title: 'Driver told to switch off over the bay PA', why: '', key: 'pa' }, 'bayPA', b.id);
        if (b.ground !== 'ok') go('bayRun', { title: 'Driver re-attached the earth clamp', why: 'Loading stopped because the earth monitor lost the truck. It restarts only with a proven earth (below 10 Ω).', key: 'reground', important: true }, 'bayReground', b.id);
        if (b.damaged) go('bayRun', { title: b.tag + ' batch ended after drive-away', why: '', key: 'finish' }, 'bayFinish', b.id);
        else if (!hold && !(b.product === 'propane' && S.util.odor.failed) && !S.gd.some((g) => g.zone === 'LR' && g.lel > 10) && !L2.plant.esdActive(S, 'LR') && !S.leaks.some((l) => l.src.kind === 'bay' && l.src.id === b.id && l.reported)) go('bayRun', { title: b.tag + ' resumed', why: 'The reason for the stop has cleared.', key: 'resume' }, 'bayResume', b.id);
      }
      const armLeak = S.leaks.find((l) => l.src.kind === 'bay' && l.src.id === b.id && l.reported);
      if (armLeak && b.state === 'LOADING') go('bayRun', { title: b.tag + ' stopped: leak on the loading arm', why: 'The driver reported gas at the swivel. Stopping closes the arm valves and isolates the leak.', key: 'armleak', important: true }, 'bayStop', b.id);
      if (armLeak && b.state === 'STOPPED') go('bayRun', {}, 'bayFinish', b.id);
      if (armLeak && b.state === 'IDLE' && !b.suspended) go('bayRun', { title: b.tag + ' taken out of service', why: 'The arm swivel needs repair before anyone loads there again.', key: 'suspend' }, 'baySuspend', b.id, true);
      if (b.damaged && b.state === 'IDLE') go('bayRun', { title: b.tag + ' arms repaired', why: '', key: 'repair' }, 'bayRepair', b.id);
      if (b.suspended && b.repairUntil && S.t > b.repairUntil) go('bayRun', { title: b.tag + ' back in service', why: '', key: 'unsuspend' }, 'baySuspend', b.id, false);
    }
    const waiting = S.trucks.filter((t) => t.state === 'PARKED' || t.state === 'DECANT_WAIT').sort((a, b) => a.parkedT - b.parkedT);
    for (const tr of waiting) {
      const b = S.bays.find((x) => x.state === 'IDLE' && !x.truckId && !x.suspended && !x.damaged && x.product === tr.product);
      if (b) go('bayAssign', { title: tr.plate + ' called forward to ' + b.tag, why: b.tag + ' is lined up for ' + b.product + ', the same product as the order. Never send a truck to a bay on the wrong product.', key: 'assign' }, 'assignBay', tr.id, b.id);
      else {
        const sw = S.bays.find((x) => x.swing && x.state === 'IDLE' && !x.truckId && x.product !== tr.product && !waiting.some((w) => w.product === x.product));
        if (sw) go('bayAssign', { title: sw.tag + ' swung over to ' + tr.product, why: 'Bay 4 can load either product. The line is drained to vapour recovery and the block valves swapped, which takes 10 minutes.', key: 'swing', important: true }, 'bayChangeover', sw.id, tr.product);
      }
    }
    for (const tr of S.trucks.filter((t) => t.state === 'WEIGHED')) {
      const mx = L2.rack.maxNet(S, tr);
      const kgL = tr.content / tr.capL;
      const meterNet = tr.loaded - tr.vapRet;
      if (!style.reckless && (tr.grossOut > tr.gvw || tr.content > mx.fr * tr.capL * 1.002)) go('release', { title: tr.plate + ' held for decanting', why: (tr.grossOut > tr.gvw ? 'Gross ' + F.kg(tr.grossOut) + ' is over the ' + F.kg(tr.gvw) + ' legal limit. ' : '') + (tr.content > mx.fr * tr.capL * 1.002 ? 'Content ' + kgL.toFixed(3) + ' kg/L is above the ' + mx.fr + ' filling ratio. ' : '') + 'The excess goes back to the sphere before the truck may leave.', key: 'decant', important: true, akey: 'release:' + tr.id }, 'truckDecant', tr.id);
      else go('release', { title: tr.plate + ' released with ' + F.kg(tr.wbNet), why: 'Weighbridge net ' + F.kg(tr.wbNet) + ' vs meter net ' + F.kg(meterNet) + ' (' + (tr.mismatch * 100).toFixed(2) + '% apart, limit 0.5%). Gross ' + F.kg(tr.grossOut) + ' within ' + F.kg(tr.gvw) + '. Fill ' + kgL.toFixed(3) + ' kg/L within ' + mx.fr + '. Delivery note and ADR transport document issued.', key: 'release', akey: 'release:' + tr.id }, 'truckRelease', tr.id);
    }

    // ---------------- Rail
    const comp = S.rail.comp;
    for (const c of S.rail.cars) {
      if (c.state === 'RELEASED' || c.state === 'ENROUTE') continue;
      if (!c.secured && !c.busy) go('railField', { title: 'Rail car at ' + c.spotId + ' being secured', why: 'Blue flag, derail, chocks and handbrake. A blue flag means people are working on the car and nothing may move it.', key: 'rail-secure', important: true }, 'railSecure', c.id);
      else if (c.secured && !c.sample && !c.busy) go('railField', { title: 'Sample taken from car ' + c.spotId, why: 'A pressure sample goes to the lab before unloading. Off-spec product cannot be taken back out of a sphere.', key: 'rail-sample', important: true }, 'railSample', c.id);
      else if (c.secured && !c.connected && !c.busy && c.sample && c.sample.status === 'done' && c.sample.pass) go('railField', { title: 'Car ' + c.spotId + ' connected', why: 'Earth and bonding first, then liquid and vapour hoses, leak test, open the car valves.', key: 'rail-connect' }, 'railConnect', c.id);
      if (c.sample && c.sample.status === 'done' && !c.sample.pass && !c.rejected) go('railSpec', { title: 'Car ' + c.spotId + ' refused: off specification', why: 'Lab: C4+ ' + c.sample.c4.toFixed(1) + '% against a 5.0% limit. Unloading it would put a whole sphere off-spec and every truck loaded from it after.', key: 'rail-reject', important: true, akey: 'railspec:' + c.id }, 'railReject', c.id);
    }
    const cur = S.rail.cars.find((x) => x.id === comp.lineup && x.state !== 'RELEASED');
    if (!touched(['compStop', 'compStart', 'compMode', 'compLineup'], undefined, 15)) {
      if (!cur) {
        const next = S.rail.cars.find((x) => x.connected && x.state !== 'RELEASED' && !x.done);
        if (next) {
          const tk = ['V101', 'V102'].map((id) => S.tanks[id]).filter((t) => t.radar && !t.radar.fault).sort((a, b) => a.fill - b.fill)[0] || S.tanks.V101;
          go('railComp', { title: 'C-301 lined up: car ' + next.spotId + ' → ' + tk.tag, why: tk.tag + ' has the most room (' + F.pct(tk.fillMeas) + ') and a trusted level gauge.', key: 'comp-lineup' }, 'compLineup', next.id, tk.id);
          go('railComp', {}, 'compMode', 'LIQUID');
        }
      } else if (cur.connected) {
        const tk = S.tanks[comp.tank];
        if (comp.running && comp.mode === 'LIQUID' && tk.fillMeas > 0.84) { go('railComp', { title: 'Receipt stopped: ' + tk.tag + ' near high level', why: 'Receipts stop before the 85% high-level alarm. The independent high-high switch at 90% is the last line of defence, not the plan.', key: 'comp-high', important: true }, 'compStop'); const o = tk.id === 'V101' ? 'V102' : 'V101'; if (S.tanks[o].fillMeas < 0.8) go('railComp', {}, 'compLineup', cur.id, o); }
        if (!comp.running && !comp.tripped && !hold && cur.phase === 'liquid' && S.tanks[comp.tank].fillMeas < 0.84 && !L2.plant.esdActive(S, 'RL')) go('railComp', { title: 'C-301 started: liquid transfer', why: 'The compressor takes vapour from the sphere and pushes it into the top of the car. The extra 2–2.5 bar drives the liquid out through the eduction pipe into the sphere.', key: 'comp-liquid', important: true }, 'compStart');
        if (cur.phase === 'liquid-done' && comp.mode === 'LIQUID') { go('railComp', { title: 'Liquid finished — switching to vapour recovery', why: 'The sight glass shows vapour only. The 4-way valve is reversed so the compressor now pulls the vapour out of the car: about 1.5 t of propane that would otherwise go back to the refinery.', key: 'comp-vapour', important: true }, 'compStop'); go('railComp', {}, 'compMode', 'VAPOUR'); }
        if (cur.phase === 'liquid-done' && comp.mode === 'VAPOUR' && !comp.running && cur.P > 1.6 && !hold) go('railComp', {}, 'compStart');
        if (comp.mode === 'VAPOUR' && comp.running && cur.P < 1.6) { go('railComp', { title: 'Vapour recovery stopped at ' + cur.P.toFixed(1) + ' barg', why: 'Going lower raises the compressor discharge temperature and risks pulling the car toward vacuum.', key: 'comp-stop', important: true }, 'compStop'); cur.done = true; go('railField', { title: 'Car ' + cur.spotId + ' disconnected and released', why: 'Hoses blown down to vapour recovery, valves closed, blue flag removed. The shunter can collect it.', key: 'rail-release' }, 'railRelease', cur.id); }
        if (comp.running && hold) go('railComp', { title: 'C-301 stopped for lightning', why: 'All transfers stop within 10 km of a strike.', key: 'lightning' }, 'compStop');
      }
    }
    if (comp.tripped) go('railComp', { title: 'C-301 trip reset', why: comp.tripCause, key: 'comp-reset' }, 'compReset');

    // ---------------- Permits
    for (const pm of S.permits) {
      if (pm.status === 'pending') {
        const as = L2.permits.assess(S, pm);
        const R = L2.permits.REJECT_REASONS, C = L2.permits.CONDITIONS;
        if (style.reckless) { go('permit', {}, 'permitDecide', pm.no, 'approve', { conditions: [] }); continue; }
        if (as.blockers.length) { go('permit', { title: pm.no + ' refused: ' + R[as.blockers[0]].toLowerCase(), why: pm.title + '. ' + (L2.permits.lessonFor ? L2.permits.lessonFor(pm, as) : ''), key: 'permit-reject:' + as.blockers[0], important: true, akey: 'permit:' + pm.no }, 'permitDecide', pm.no, 'reject', { reason: as.blockers[0] }); continue; }
        if (pm.facts.confined && !pm.isoVerified && !pm.isoReq) { if (go('permitPrep', { title: 'Isolation on V-104 being checked on site', why: 'Vessel entry needs positive isolation: spades or removed spools on every nozzle. The area authority checks it physically, not on paper.', key: 'permit-iso', important: true }, 'permitVerifyIso', pm.no)) pm.isoReq = true; continue; }
        if (pm.facts.confined && !pm.isoVerified) continue;
        if (as.needs.length) { if (!pm.gasTest) go('permitPrep', { title: 'Gas test for ' + pm.no, why: 'A gas test at the work site immediately before work: 0% LEL for hot work, O₂ 19.5–23.5% and under 1% LEL for vessel entry.', key: 'permit-gas', important: true }, 'permitGasTest', pm.no); continue; }
        if (pm.facts.pump && S.pumps[pm.facts.pump].running) continue;
        const conds = pm.facts.needsCond.filter((c) => c !== 'suspendLR' || as.simops.length);
        if ((pm.ignition || pm.type === 'vehicle') && as.simops.length) { go('permit', { title: pm.no + ' deferred: live operations nearby', why: 'Hot work or a vehicle within 35 m of ' + as.simops.join(', ') + '. Ignition sources and live LPG transfers do not mix (SIMOPS). The contractor can resubmit later.', key: 'permit-simops', important: true, akey: 'permit:' + pm.no }, 'permitDecide', pm.no, 'reject', { reason: 'simops' }); continue; }
        go('permit', { title: pm.no + ' issued: ' + pm.title, why: (pm.gasTest && pm.gasTest.status === 'done' ? 'Gas test clean (LEL ' + pm.gasTest.lel.toFixed(1) + '%, O₂ ' + pm.gasTest.o2.toFixed(1) + '%). ' : '') + (conds.length ? 'Conditions: ' + conds.map((c) => C[c].toLowerCase()).join('; ') + '.' : 'No special conditions needed.'), key: 'permit-issue', important: true, akey: 'permit:' + pm.no }, 'permitDecide', pm.no, 'approve', { conditions: conds });
      }
      if (pm.status === 'workdone' || (pm.status === 'suspended' && !S.leaks.length && !S.fires.length)) go('permitClose', { title: pm.no + ' closed', why: 'The work site was inspected and handed back. Closing the permit removes its locks, bypasses and inhibits.', key: 'permit-close' }, 'permitClose', pm.no);
    }
  }

  // ---------------------------------------------------------------- Autonomy system (crew act on their own in play)
  L.sim.register({
    name: 'autonomy', order: 85,
    tick(S) {
      const a = S.cfg.autonomy;
      if (!a || a === 'off' || S.over) return;
      if (S.t - (S._autoT || -99) < 15) return;
      S._autoT = S.t;
      const asked = new Set();
      step(L, S, {
        policy: policyFor(S),
        ask: (q) => {
          asked.add(q.key);
          if (S.declined && S.declined[q.key]) return;
          let ap = S.approvals.find((x) => x.key === q.key);
          if (!ap) {
            ap = Object.assign({ id: ++S.approvalSeq, t: S.t, deadline: S.t + 600 }, q);
            S.approvals.push(ap);
            L.sim.log(S, 'crew', 'Approval requested: ' + q.title);
            if (S.cfg.narrate) narrate(S, { cat: q.cat, title: 'Waiting for your approval: ' + q.title, why: q.why, key: 'ask', loc: q.loc, important: true });
          } else Object.assign(ap, { title: q.title, why: q.why, name: q.name, args: q.args, loc: q.loc });
        },
        narrate: (n) => {
          if (S.cfg.narrate) narrate(S, n);
          if (!FIELD.has(n.cat) && S.cfg.autonomy !== 'watch') L.sim.log(S, 'crew', 'CCR assistant: ' + n.title);
        },
      });
      // Drop requests the crew no longer needs (the player dealt with it, or the situation changed).
      S.approvals = S.approvals.filter((x) => asked.has(x.key));
      // Approvals left unanswered: on 'timeout' the crew act on their recommendation after 10 minutes.
      if (S.cfg.approvals === 'timeout') for (const ap of S.approvals.slice()) if (S.t >= ap.deadline) runApproval(S, ap, 'No answer from the control room after 10 min — crew went ahead: ');
    },
  });
  function narrate(S, n) {
    S.narration.push(Object.assign({ id: ++S.narrSeq, t: S.t }, n));
    if (S.narration.length > 200) S.narration.splice(0, S.narration.length - 200);
  }
  function runApproval(S, ap, prefix) {
    S.approvals = S.approvals.filter((x) => x !== ap);
    S._ap = true;
    let res;
    try { res = L.sim.act(S, ap.name, ...ap.args); } finally { S._ap = false; }
    const ok = !res || res.ok !== false;
    if (ok) L.sim.log(S, 'crew', (prefix || 'Approved: ') + ap.title);
    if (ok && S.cfg.narrate) narrate(S, { cat: ap.cat, title: ap.title, why: ap.why, key: ap.cat, loc: ap.loc });
    return res;
  }
  L.sim.action('approvalAccept', (S, id) => {
    const ap = S.approvals.find((x) => x.id === id);
    if (!ap) return { ok: false, msg: 'That request has already been dealt with.' };
    const res = runApproval(S, ap, 'Approved by you: ');
    return res && res.ok === false ? res : { ok: true, msg: 'Approved: ' + ap.title };
  });
  L.sim.action('approvalDecline', (S, id) => {
    const ap = S.approvals.find((x) => x.id === id);
    if (!ap) return { ok: false };
    S.declined = S.declined || {};
    S.declined[ap.key] = true;
    S.approvals = S.approvals.filter((x) => x !== ap);
    L.sim.log(S, 'crew', 'You declined: ' + ap.title + '. Over to you.');
    return { ok: true, msg: 'Declined — handle it yourself from the console.' };
  });
  L.sim.action('setAutonomy', (S, level, approvals) => {
    S.cfg.autonomy = level;
    if (approvals) S.cfg.approvals = approvals;
    S._autoT = -99;
    L.sim.log(S, 'crew', 'Crew autonomy set to ' + ({ off: 'none — every order comes from you', field: 'field work', full: 'full — crew run routine work and ask you for key decisions', watch: 'demonstration' }[level] || level) + '.');
    return { ok: true };
  });

  L.autopilot = { step, policyFor, locate, CAT_LABEL, FIELD, ROUTINE, DECIDE, narrate };
})(globalThis.LPG = globalThis.LPG || {});
