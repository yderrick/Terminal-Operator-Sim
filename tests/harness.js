// Loads the simulation core into Node and provides scripted players for headless shift runs.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const files = require('../tools/files.js');

function load() {
  delete globalThis.LPG;
  const root = path.join(__dirname, '..');
  for (const f of files.core) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
  return globalThis.LPG;
}

// A competent operator: reads documents, computes presets, follows procedures.
function goodBot(L, S, style) {
  style = style || {};
  const act = (...a) => L.sim.act(S, ...a);
  const U = L.util;
  for (const a of S.alarms.slice()) if (!a.acked) L.sim.ackAlarm(S, a.id);
  if (!S.handover.acked) act('handoverAck');
  const hold = S.weather.hold;
  // Emergencies
  const gas = style.reckless ? [] : S.gd.filter((g) => g.lel >= 20);
  if (gas.length) {
    for (const z of new Set(gas.map((g) => g.zone))) {
      if (z === 'LR') act('bayStopAll');
      if (z === 'PA') for (const p of Object.values(S.pumps)) if (!p.isolated && L.util.dist(p.x, p.y, gas[0].x, gas[0].y) < 15) act('pumpIsolate', p.id, true);
      if (z === 'TF') for (const id of S.tankOrder) { const t = S.tanks[id]; if (L.util.dist(t.x, t.y, gas[0].x, gas[0].y) < 20) act('setTankValve', id, 'out', false); }
      if (z === 'RL') { act('compStop'); for (const c of S.rail.cars) if (c.valvesOpen && c.state !== 'RELEASED') act('railCloseCarValves', c.id); }
    }
    for (const lk of S.leaks) if (lk.src.kind === 'field' && !lk.fixed && !lk.fixReq) { lk.fixReq = true; act('crewIsolateField', lk.id); }
  }
  if (S.fires.length && !style.reckless) {
    if (!S.fireBrigade.called) act('callFireBrigade');
    if (!S.muster.active) act('muster', true);
    for (const d of L.data.DELUGE) if (!S.fw.deluge[d.id].open) act('deluge', d.id, true);
  } else if (S.muster.active && !S.leaks.length) act('muster', false);
  if (!S.fires.length && !S.leaks.some((l) => l.rate > 0.01)) {
    for (const d of L.data.DELUGE) if (S.fw.deluge[d.id].open) act('deluge', d.id, false);
    if (S.esd.site) act('esdReset', 'site');
    for (const z of ['TF', 'PA', 'LR', 'RL']) if (S.esd.zones[z]) act('esdReset', z);
    if (!S.esd.site && !S.esd.zones.TF) for (const id of S.tankOrder) { const t = S.tanks[id]; if (!t.xvOut && !S.events.some((e) => e.kind === 'flange' && e.id === id && e.state === 'weep')) act('setTankValve', id, 'out', true); if (!t.xvIn && t.fill < 0.84) act('setTankValve', id, 'in', true); }
    for (const p of Object.values(S.pumps)) if (p.isolated && !p.loto && p.seal !== 'leak') act('pumpIsolate', p.id, false);
  }
  // Utilities
  for (const c of S.util.ia.comps) if (c.tripped) { const o = S.util.ia.comps.find((x) => x !== c); if (!o.running) act('iaStart', o.id); act('iaStart', c.id); act('iaStop', c.id); }
  for (const p of Object.values(S.pumps)) if (p.tripped && !p.loto) act('pumpReset', p.id);
  if (S.util.odor.failed && !S.flags.botOdor) { S.flags.botOdor = true; act('odorRestore'); }
  if (!S.util.odor.failed) S.flags.botOdor = false;
  if (S.odorDelivery.arrived && !S.odorDelivery.done && !S.odorDelivery.inProgress) act('odorDelivery');
  const fwt = S.tasks.find((t) => t.id === 'fwtest');
  if (fwt.status === 'pending' && S.t >= fwt.startT && !S.fw.diesel.running && !S.fw.diesel.failed) act('fwPump', 'diesel', true);
  if (S.fw.diesel.tested && S.fw.diesel.running && !S.fires.length) act('fwPump', 'diesel', false);
  if (S.fw.elec.running && !S.fires.length && !Object.values(S.fw.deluge).some((d) => d.open)) act('fwPump', 'elec', false);
  for (const k of ['in', 'out']) if (S.wb[k].zero && !S.wb[k].busy) act('wbZero', k);
  for (const t of S.tasks) if (t.id.startsWith('rounds') && t.status === 'pending' && S.t >= t.startT && !t.botSent) { t.botSent = true; act('crewRounds'); }
  S.findings.forEach((f, i) => { if (f.kind === 'leak' && f.status === 'open') { const lk = S.leaks.find((x) => x.id === f.leakId); if (lk && lk.src.kind === 'manifold') act('setTankValve', lk.src.id, 'out', false); if (lk && lk.src.kind === 'pump') act('pumpIsolate', lk.src.id, true); } if (f.status === 'open' && !f.botTried) { if (f.kind === 'seal' || f.kind === 'bearing') { const p = S.pumps[f.id]; if (p.running) { const o = Object.values(S.pumps).find((q) => q.product === p.product && q.id !== p.id && !q.loto); if (o) { act('pumpDuty', o.id); act('pumpStop', p.id); } else return; } } if (f.kind === 'flange') act('setTankValve', f.id, 'out', false); f.botTried = true; act('fixFinding', i); } });
  // Gauging
  const og = S.gauge.opening;
  const doGauge = (which) => {
    const g = S.gauge[which];
    if (!g || g.status !== 'open') return;
    for (const id of S.tankOrder) if (g.readings[id].manual === null && !g.readings[id].pending) act('gaugeManual', which, id);
    if (S.tankOrder.every((id) => g.readings[id].manual !== null)) {
      for (const id of S.tankOrder) if (Math.abs(g.readings[id].manual - g.readings[id].radarAt) > 10) act('gaugeFlag', which, id, true);
      act('gaugeSign', which);
    }
  };
  doGauge('opening');
  if (S.t > 10.8 * 3600) { act('gaugeOpenClosing'); doGauge('closing'); }
  // Header lineup
  for (const prod of ['propane', 'butane']) {
    const H = S.headers[prod];
    const src = S.tanks[H.source];
    const alts = S.tankOrder.map((id) => S.tanks[id]).filter((t) => t.product === prod && t.id !== H.source && !t.offspec);
    if ((src.fillMeas < 0.15 || !src.xvOut) && alts.length) { const best = alts.sort((a, b) => b.fill - a.fill)[0]; if (best.fill > src.fill + 0.1 || !src.xvOut) act('setHeaderSource', prod, best.id); }
  }
  // Gate
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
    act('gateDecision', tr.id, reason ? 'reject' : 'admit', reason);
  }
  // Bays
  for (const b of S.bays) {
    const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId);
    if (b.hold) act('bayResolve', b.id, b.hold.options[0][0]);
    if (b.state === 'READY' && !hold && !S.simopsHold.LR && !(b.product === 'propane' && S.util.odor.failed)) {
      const mx = L.rack.maxNet(S, tr);
      const want = tr.order === 'FULL' ? mx.max : Math.min(tr.order, mx.max);
      act('bayAuthorize', b.id, style.reckless ? Math.floor(tr.capL * mx.fr * 1.12) : Math.floor(want - 80));
    }
    if (b.state === 'LOADING' && (hold || tr.engineOn || (b.product === 'propane' && S.util.odor.failed))) act('bayStop', b.id);
    if (b.state === 'STOPPED') {
      if (tr.engineOn) act('bayPA', b.id);
      if (b.ground !== 'ok') act('bayReground', b.id);
      if (b.damaged) act('bayFinish', b.id);
      else if (!hold && !(b.product === 'propane' && S.util.odor.failed) && !S.gd.some((g) => g.zone === 'LR' && g.lel > 10) && !L.plant.esdActive(S, 'LR') && !S.leaks.some((l) => l.src.kind === 'bay' && l.src.id === b.id && l.reported)) act('bayResume', b.id);
    }
    const armLeak = S.leaks.find((l) => l.src.kind === 'bay' && l.src.id === b.id && l.reported);
    if (armLeak && b.state === 'LOADING') act('bayStop', b.id);
    if (armLeak && b.state === 'STOPPED') act('bayFinish', b.id);
    if (armLeak && b.state === 'IDLE' && !b.suspended) act('baySuspend', b.id, true);
    if (b.damaged && b.state === 'IDLE') act('bayRepair', b.id);
    if (b.suspended && b.repairUntil && S.t > b.repairUntil) act('baySuspend', b.id, false);
  }
  const waiting = S.trucks.filter((t) => t.state === 'PARKED' || t.state === 'DECANT_WAIT').sort((a, b) => a.parkedT - b.parkedT);
  for (const tr of waiting) {
    const b = S.bays.find((x) => x.state === 'IDLE' && !x.truckId && !x.suspended && !x.damaged && x.product === tr.product);
    if (b) act('assignBay', tr.id, b.id);
    else {
      const sw = S.bays.find((x) => x.swing && x.state === 'IDLE' && !x.truckId && x.product !== tr.product && !waiting.some((w) => w.product === x.product));
      if (sw) act('bayChangeover', sw.id, tr.product);
    }
  }
  for (const tr of S.trucks.filter((t) => t.state === 'WEIGHED')) {
    const mx = L.rack.maxNet(S, tr);
    if (!style.reckless && (tr.grossOut > tr.gvw || tr.content > mx.fr * tr.capL * 1.002)) act('truckDecant', tr.id); else act('truckRelease', tr.id);
  }
  // Rail
  const comp = S.rail.comp;
  for (const c of S.rail.cars) {
    if (c.state === 'RELEASED' || c.state === 'ENROUTE') continue;
    if (!c.secured && !c.busy) act('railSecure', c.id);
    else if (c.secured && !c.sample && !c.busy) act('railSample', c.id);
    else if (c.secured && !c.connected && !c.busy && c.sample && c.sample.status === 'done' && c.sample.pass) act('railConnect', c.id);
    if (c.sample && c.sample.status === 'done' && !c.sample.pass && !c.rejected) act('railReject', c.id);
  }
  const cur = S.rail.cars.find((x) => x.id === comp.lineup && x.state !== 'RELEASED');
  if (!cur) {
    const next = S.rail.cars.find((x) => x.connected && x.state !== 'RELEASED' && !x.done);
    if (next) {
      const tk = ['V101', 'V102'].map((id) => S.tanks[id]).filter((t) => t.radar && !t.radar.fault).sort((a, b) => a.fill - b.fill)[0] || S.tanks.V101;
      act('compLineup', next.id, tk.id); act('compMode', 'LIQUID');
    }
  } else if (cur.connected) {
    const tk = S.tanks[comp.tank];
    if (comp.running && comp.mode === 'LIQUID' && tk.fillMeas > 0.84) { act('compStop'); const o = tk.id === 'V101' ? 'V102' : 'V101'; if (S.tanks[o].fillMeas < 0.8) act('compLineup', cur.id, o); }
    if (!comp.running && !comp.tripped && !hold && cur.phase === 'liquid' && S.tanks[comp.tank].fillMeas < 0.84 && !L.plant.esdActive(S, 'RL')) act('compStart');
    if (cur.phase === 'liquid-done' && comp.mode === 'LIQUID') { act('compStop'); act('compMode', 'VAPOUR'); }
    if (cur.phase === 'liquid-done' && comp.mode === 'VAPOUR' && !comp.running && cur.P > 1.6 && !hold) act('compStart');
    if (comp.mode === 'VAPOUR' && comp.running && cur.P < 1.6) { act('compStop'); cur.done = true; act('railRelease', cur.id); }
    if (comp.running && hold) act('compStop');
  }
  if (comp.tripped) act('compReset');
  // Permits
  for (const pm of S.permits) {
    if (pm.status === 'pending') {
      const as = L.permits.assess(S, pm);
      if (style.reckless) { act('permitDecide', pm.no, 'approve', { conditions: [] }); continue; }
      if (as.blockers.length) { act('permitDecide', pm.no, 'reject', { reason: as.blockers[0] }); continue; }
      if (pm.facts.confined && !pm.isoVerified && !pm.isoReq) { pm.isoReq = true; act('permitVerifyIso', pm.no); continue; }
      if (pm.facts.confined && !pm.isoVerified) continue;
      if (as.needs.length) { if (!pm.gasTest) act('permitGasTest', pm.no); continue; }
      if (pm.facts.pump && S.pumps[pm.facts.pump].running) continue;
      const conds = pm.facts.needsCond.slice();
      if ((pm.ignition || pm.type === 'vehicle') && as.simops.length) { act('permitDecide', pm.no, 'reject', { reason: 'simops' }); continue; }
      act('permitDecide', pm.no, 'approve', { conditions: conds.filter((c) => c !== 'suspendLR' || as.simops.length) });
    }
    if (pm.status === 'workdone' || (pm.status === 'suspended' && !S.leaks.length && !S.fires.length)) act('permitClose', pm.no);
  }
}

// An operator who never does anything. Shows what the plant does on its own.
function idleBot() {}

// Random clicks with random arguments — robustness only.
function monkeyBot(L, S) {
  const r = Math.random;
  const pick = (a) => a[Math.floor(r() * a.length)];
  const names = Object.keys(L.sim.actions);
  for (let i = 0; i < 3; i++) {
    const n = pick(names);
    const args = [pick([1, 2, 3, 4, 'V101', 'V102', 'V103', 'P201A', 'P202B', 'opening', 'closing', 'site', 'LR', 'propane', 'butane', 'in', 'out', 'GD05', 'DV301', 'elec', 'diesel', 'K601B', 'FO1', null]),
      pick([1, 2, 'V102', 'in', 'out', true, false, 'approve', 'reject', 'LIQUID', 'VAPOUR', 'admit', 'retry', 20000]), pick([true, false, 'adrDriver', { conditions: [] }, { reason: 'simops' }])];
    if (n === 'gateDecision' || n === 'assignBay' || n === 'truckRelease' || n === 'truckDecant') { const tr = pick(S.trucks); args[0] = tr.id; }
    if (n.startsWith('permit')) { const pm = pick(S.permits); args[0] = pm.no; }
    if (n.startsWith('rail')) { args[0] = (pick(S.rail.cars) || {}).id; }
    try { L.sim.act(S, n, ...args); } catch (e) { e.message = 'action ' + n + '(' + JSON.stringify(args) + '): ' + e.message; throw e; }
  }
}

function runShift(opts) {
  const L = load();
  L.sim.strict = opts.bot !== monkeyBot;
  const S = L.sim.create({ seed: opts.seed, difficulty: opts.difficulty || 'operator', date: '2026-10-02' });
  const bot = opts.bot || goodBot;
  const step = opts.step || 20;
  let checks = 0;
  while (!S.over) {
    bot(L, S);
    L.sim.tick(S, step);
    checks++;
    if (checks % 50 === 0) sanity(L, S);
  }
  sanity(L, S);
  return { L, S };
}

function sanity(L, S) {
  for (const id of S.tankOrder) {
    const t = S.tanks[id];
    for (const k of ['M', 'Ts', 'Tb', 'P', 'fill', 'level', 'levelMeas', 'wP']) if (!isFinite(t[k])) throw new Error(id + '.' + k + ' not finite at t=' + S.t);
    if (t.M < 0) throw new Error(id + ' negative mass');
  }
  for (const c of S.rail.cars) for (const k of ['M', 'P', 'ml']) if (!isFinite(c[k])) throw new Error('car ' + c.id + '.' + k + ' not finite');
  for (const tr of S.trucks) if (!isFinite(tr.content)) throw new Error('truck content NaN');
  if (!isFinite(S.score.safety) || !isFinite(S.score.compliance)) throw new Error('score NaN');
}

const recklessBot = (L, S) => goodBot(L, S, { reckless: true });
module.exports = { load, runShift, goodBot, idleBot, monkeyBot, recklessBot };
