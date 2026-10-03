/* World HUD: hover tooltips, selection inspector, crew orders, minimap, view toolbar. */
(function (L) {
  'use strict';
  const U = L.util, D = L.data;
  const { UI, setHTML, btn, ubtn, pill, e } = L.ui;
  const F = U.fmt;
  const H = { orders: [], ctxAt: null };

  const ROLE = { operator: 'Field operator', driver: 'Tanker driver', guard: 'Gate security', contractor: 'Contractor', fitter: 'Maintenance fitter', instrument: 'Instrument technician', lab: 'Lab technician', fire: 'Firefighter', shunter: 'Rail shunter', deliver: 'Delivery driver' };
  const truckState = { QUEUE: 'Waiting at the gate', TO_WB_IN: 'Driving to WB-1', WB_IN_Q: 'Queueing for WB-1', WB_IN: 'Weighing in', TO_PARK: 'Driving to the lorry park', PARKED: 'Parked — waiting for a bay', DECANT_WAIT: 'Parked — waiting to decant', TO_BAY: 'Driving to the bay', AT_BAY: 'At the bay', TO_WB_OUT: 'Driving to WB-2', WB_OUT_Q: 'Queueing for WB-2', WB_OUT: 'Weighing out', WEIGHED: 'Waiting for release documents', EXITING: 'Leaving site', REJECTED: 'Turned away' };

  function crewActivity(S, c) {
    if (c.injured) return 'Injured — awaiting casualty evacuation';
    if (!c.task) return c.queue.length ? 'Between jobs' : 'Available in the control room';
    const t = c.task;
    if (c.state === 'walk') return 'Walking: ' + t.label + ' (' + U.dur(U.dist(c.x, c.y, c.target.x, c.target.y) / L.crewMod.WALK) + ' away)';
    if (c.state === 'retreat') return 'Backing out of gas, upwind';
    if (t.kind === 'move') return 'Standing by at ' + t.label.replace(/^Go to /, '');
    if (t.kind === 'muster') return 'At the muster point';
    if (t.work) return t.label + ' — ' + U.dur(Math.max(0, t.work - (S.t - c.workT))) + ' left';
    return t.label;
  }
  function driverActivity(S, tr) {
    const b = S.bays.find((x) => x.id === tr.bay);
    if (tr.driverEvacuated) return 'Evacuated to the muster point';
    if (!b) return truckState[tr.state] || tr.state;
    if (b.hold) return 'Stopped: ' + b.hold.msg;
    if (b.state === 'PREP') return 'Pre-load check: ' + ((L.rack.CHECKS[b.checkIdx] || {}).label || '');
    if (b.state === 'READY') return 'Waiting for you to authorise loading';
    if (b.state === 'LOADING') return 'Standing at the bay ESD while loading (' + F.n0(b.net) + ' / ' + F.n0(b.preset) + ' kg)';
    if (b.state === 'STOPPED') return 'Loading stopped: ' + b.stopReason;
    if (b.state === 'COMPLETE') return 'Disconnecting arms and earth';
    if (b.state === 'DECANTING') return 'Decanting the excess';
    return b.state;
  }

  // ---------------------------------------------------------------- Describe (tooltip)
  function describe(S, p) {
    if (!p) return null;
    const lines = [];
    let title = p.name || p.kind, sub = '';
    switch (p.kind) {
      case 'crew': { const c = S.crew.find((x) => x.id === p.id); title = c.name; sub = 'Field operator · ' + c.call; lines.push(crewActivity(S, c)); lines.push('Personal gas monitor ' + Math.round(c.lel || 0) + '% LEL'); if (c.queue.length) lines.push(c.queue.length + ' job(s) queued'); break; }
      case 'driver': { const tr = S.trucks.find((x) => x.id === p.id); if (!tr) return null; title = tr.driver; sub = 'Tanker driver · ' + tr.haulier; lines.push(driverActivity(S, tr)); break; }
      case 'truck': { const tr = S.trucks.find((x) => x.id === p.id); if (!tr) return null; title = tr.plate; sub = tr.haulier + ' · ' + tr.product + (tr.rigid ? ' · rigid' : ' · artic'); lines.push(truckState[tr.state] || tr.state); lines.push('Driver ' + tr.driver); if (tr.content) lines.push('Content ' + F.kg(tr.content) + ' (' + (tr.content / tr.capL).toFixed(3) + ' kg/L)'); break; }
      case 'guard': title = 'Gate security'; sub = 'Gatehouse'; lines.push(S.trucks.some((t) => t.state === 'QUEUE') ? 'Holding trucks at the gate until you check their documents' : 'Watching the gate'); break;
      case 'permit': { const pm = S.permits.find((x) => x.no === p.id); if (!pm) return null; title = pm.contractor; sub = L.permits.TYPES[pm.type] + ' · ' + pm.no; lines.push(pm.status === 'pending' ? 'Waiting at the control room for you to sign ' + pm.no : pm.status === 'suspended' ? 'Work suspended — standing clear' : pm.status === 'workdone' ? 'Work finished — waiting for hand-back' : pm.title); break; }
      case 'lab': title = 'Lab technician'; sub = 'Gas chromatograph'; lines.push('Analysing a rail car sample'); break;
      case 'radar': title = 'Vale Instruments'; sub = 'Instrument technician'; lines.push('Repairing radar LT-' + p.id.slice(1) + ' on top of ' + S.tanks[p.id].tag); break;
      case 'fire': title = 'Fire service'; sub = 'Hose team'; lines.push('Cooling ' + (S.fireBrigade.target ? (S.tanks[S.fireBrigade.target] ? S.tanks[S.fireBrigade.target].tag : S.fireBrigade.target) : 'all exposures')); break;
      case 'shunter': case 'loco': title = 'Shunting locomotive'; sub = 'Network Rail freight'; lines.push('Placing or collecting tank cars'); break;
      case 'odor': title = 'Odorant delivery'; sub = 'Ethyl mercaptan, UN 2363'; lines.push(S.odorDelivery.inProgress ? 'Transferring under supervision' : 'Waiting for a field operator to supervise'); break;
      case 'tank': { const t = S.tanks[p.id]; title = t.tag; sub = t.product + ' sphere · ' + F.n0(t.Vtot) + ' m³'; lines.push('Level ' + F.pct(t.fillMeas) + ' (' + F.n0(t.levelMeas) + ' mm)'); lines.push('Pressure ' + t.P.toFixed(2) + ' barg · surface ' + t.Ts.toFixed(1) + ' °C'); lines.push('Inlet ' + (L.plant.inletOpen(S, t) ? 'open' : 'SHUT') + ' · outlet ' + (L.plant.outletOpen(S, t) ? 'open' : 'SHUT')); if (t.radar.flagged) lines.push('Radar flagged suspect'); break; }
      case 'valve': { const [tid, w] = p.id.split(':'); const t = S.tanks[tid]; const open = w === 'in' ? L.plant.inletOpen(S, t) : L.plant.outletOpen(S, t); const cmd = w === 'in' ? t.xvIn : t.xvOut; title = 'XV-' + tid.slice(1) + (w === 'in' ? 'A' : 'B'); sub = t.tag + (w === 'in' ? ' inlet' : ' outlet') + ' ROSOV · fail-closed'; lines.push(open ? 'OPEN' : 'CLOSED' + (cmd && !open ? ' (held shut by ' + (t.lshhTrip && w === 'in' ? 'LSHH trip' : 'ESD / air') + ')' : '')); break; }
      case 'bullet': title = 'V-104'; sub = 'Bullet — out of service'; lines.push(D.BULLET.status); break;
      case 'pump': { const pu = S.pumps[p.id]; title = pu.tag; sub = pu.product + ' loading pump' + (pu.duty ? ' · duty' : ' · standby'); lines.push(pu.loto ? 'Locked out' : pu.tripped ? 'TRIPPED: ' + pu.tripCause : pu.running ? 'Running ' + pu.flow.toFixed(0) + ' m³/h · ' + pu.amps.toFixed(0) + ' A' : pu.isolated ? 'Isolated' : 'Stopped'); lines.push('Vibration ' + pu.vib.toFixed(1) + ' mm/s'); break; }
      case 'bay': { const b = S.bays.find((x) => x.id === p.id); title = b.tag; sub = b.product + (b.swing ? ' · swing bay' : ''); const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId); lines.push(tr ? tr.plate + ' · ' + (L.views.bayPill ? b.state.toLowerCase() : '') : b.suspended ? 'Out of service' : 'Free'); if (b.state === 'LOADING') lines.push(F.n0(b.net) + ' / ' + F.n0(b.preset) + ' kg · ' + F.n0(b.flowLpm) + ' L/min'); break; }
      case 'car': { const c = S.rail.cars.find((x) => x.id === p.id); if (!c) return null; title = 'Rail car ' + c.spotId; sub = c.number; lines.push(c.P.toFixed(2) + ' barg · liquid ' + F.kg(c.ml)); lines.push((c.secured ? 'secured' : 'not secured') + ' · ' + (c.sample ? (c.sample.status === 'done' ? (c.sample.pass ? 'on spec' : 'OFF SPEC') : 'sample at lab') : 'not sampled') + ' · ' + (c.connected ? 'connected' : 'not connected')); break; }
      case 'comp': { const c = S.rail.comp; title = 'C-301'; sub = 'Rail unloading compressor'; lines.push(c.running ? 'Running ' + c.mode : c.tripped ? 'TRIPPED: ' + c.tripCause : 'Stopped'); lines.push('Discharge ' + c.dischT.toFixed(0) + ' °C · KO pot ' + c.ko.toFixed(0) + '%'); break; }
      case 'gd': { const g = S.gd.find((x) => x.id === p.id); title = g.tag; sub = 'IR gas detector · ' + D.ZONES[g.zone].name; lines.push(g.fault ? 'FAULT' : g.inhibited ? 'Inhibited' : Math.round(g.lel) + '% LEL'); break; }
      case 'fd': { const f = S.fd.find((x) => x.id === p.id); title = f.tag; sub = 'UV/IR flame detector'; lines.push(f.fire ? 'FIRE SEEN' : 'Clear'); break; }
      case 'odorant': title = 'T-401 odorant skid'; sub = 'Ethyl mercaptan injection'; lines.push((S.util.odor.level * 100).toFixed(0) + '% · ' + (S.util.odor.failed ? 'injection FAILED' : 'injecting 25 ppm')); break;
      case 'fwtank': title = 'Fire water tank'; sub = F.n0(S.fw.tank) + ' m³'; lines.push('Ring main ' + S.fw.p.toFixed(1) + ' barg'); break;
      case 'fwpumps': title = 'Fire pump house'; sub = 'P-501 electric · P-502 diesel'; lines.push('P-501 ' + (S.fw.elec.failed ? 'FAILED' : S.fw.elec.running ? 'running' : 'auto') + ' · P-502 ' + (S.fw.diesel.failed ? 'FAILED' : S.fw.diesel.running ? 'running' : 'auto')); break;
      case 'ia': title = 'Air compressors'; sub = 'K-601A/B'; lines.push('Instrument air ' + S.util.ia.p.toFixed(2) + ' barg'); break;
      case 'ccr': title = 'Control room'; sub = 'That is you'; lines.push('Open the console pages from the left'); break;
      case 'gate': title = 'Gatehouse'; sub = 'Document checks'; lines.push(S.trucks.filter((t) => t.state === 'QUEUE').length + ' truck(s) waiting'); break;
      case 'wb': { const w = S.wb[p.id]; title = p.id === 'in' ? 'WB-1 inbound' : 'WB-2 outbound'; sub = 'Weighbridge'; lines.push((w.busy ? 'Weighing' : 'Empty deck') + ' · zero ' + (w.zero ? '+' + w.zero + ' kg' : 'OK')); break; }
      case 'icon': return null;
      case 'ground': title = 'Ground'; sub = Math.round(p.point.x) + ', ' + Math.round(p.point.z) + ' m'; break;
      default: break;
    }
    return { title, sub, lines };
  }

  // ---------------------------------------------------------------- Orders for a selected field operator
  function ordersFor(S, crewId, p) {
    const o = [];
    const c = S.crew.find((x) => x.id === crewId);
    if (!c || c.injured || !p) return o;
    const pr = (label, action, args) => o.push({ label, action, args: args || [], prefer: crewId });
    const direct = (label, action, args) => o.push({ label, action, args: args || [] });
    const inv = (label, x, z) => direct('Investigate ' + label, 'crewInvestigate', [crewId, x, z, label]);
    const x = p.point ? p.point.x : 0, z = p.point ? p.point.z : 0;
    switch (p.kind) {
      case 'tank': {
        const t = S.tanks[p.id];
        for (const w of ['opening', 'closing']) { const g = S.gauge[w]; if (g && g.status === 'open' && g.readings[p.id].manual === null && !g.readings[p.id].pending) pr('Read local level gauge (' + w + ')', 'gaugeManual', [w, p.id]); }
        inv(t.tag + ' manifold', t.x + 4, t.y + t.r + 4);
        break;
      }
      case 'pump': inv(S.pumps[p.id].tag, S.pumps[p.id].x, S.pumps[p.id].y + 2); break;
      case 'bay': { const b = S.bays.find((q) => q.id === p.id); inv(b.tag, b.x + 3, b.y + 6); break; }
      case 'car': {
        const car = S.rail.cars.find((q) => q.id === p.id);
        if (!car || car.busy) break;
        if (!car.secured) pr('Secure car (blue flag, derail, chocks)', 'railSecure', [car.id]);
        if (car.secured && !car.sample) pr('Take a sample to the lab', 'railSample', [car.id]);
        if (car.secured && !car.connected) pr('Earth, connect hoses, leak test', 'railConnect', [car.id]);
        if (car.valvesOpen) pr('Close the car internal valves', 'railCloseCarValves', [car.id]);
        if (car.connected && !(S.rail.comp.running && S.rail.comp.lineup === car.id)) pr('Disconnect and release the car', 'railRelease', [car.id]);
        break;
      }
      case 'comp': if (S.rail.comp.tripped) pr('Drain knock-out pot / reset trip', 'compReset', []); inv('C-301', 66, 128); break;
      case 'gd': { const g = S.gd.find((q) => q.id === p.id); inv(g.tag, g.x, g.y + 2); break; }
      case 'fd': { const f = S.fd.find((q) => q.id === p.id); inv(f.tag, f.x, f.y + 2); break; }
      case 'odorant': if (S.util.odor.failed) pr('Re-prime odorant pump P-401', 'odorRestore', []); if (S.odorDelivery.arrived && !S.odorDelivery.done && !S.odorDelivery.inProgress) pr('Supervise the odorant delivery', 'odorDelivery', []); break;
      case 'odor': if (S.odorDelivery.arrived && !S.odorDelivery.done && !S.odorDelivery.inProgress) pr('Supervise the odorant delivery', 'odorDelivery', []); break;
      case 'fwpumps': if (S.fw.diesel.failed) pr('Repair P-502 diesel pump', 'fwRepair', ['diesel']); if (S.fw.elec.failed) pr('Repair P-501 electric pump', 'fwRepair', ['elec']); inv('fire pumps', 34, 125); break;
      case 'permit': { const pm = S.permits.find((q) => q.no === p.id); if (pm && ['pending', 'suspended'].includes(pm.status)) { pr('Gas test the work site for ' + pm.no, 'permitGasTest', [pm.no]); if (pm.status === 'pending') pr('Verify the isolation on site', 'permitVerifyIso', [pm.no]); } break; }
      case 'ccr': direct('Return to the control room', 'crewReturn', [crewId]); break;
      default: break;
    }
    // Known manual-isolation leaks nearby
    if (p.point) for (const lk of S.leaks) if (lk.src.kind === 'field' && !lk.fixed && lk.seen && U.dist(lk.x, lk.y, x, z) < 25) pr('Close manual block valve at ' + lk.label, 'crewIsolateField', [lk.id]);
    if (p.point && p.kind !== 'ccr') {
      direct('Walk here', 'crewMove', [crewId, x, z, p.kind === 'ground' ? 'marked position' : (describe(S, p) || {}).title]);
      if (p.kind === 'ground') inv('here', x, z);
    }
    if (p.kind === 'ground') pr('Do plant rounds from here (40 min)', 'crewRounds', []);
    return o;
  }

  // ---------------------------------------------------------------- Inspector
  function inspector(S, sel) {
    if (!sel) return '';
    const d = describe(S, sel);
    if (!d) return '';
    let h = '<div class="insp-h"><div><b>' + e(d.title) + '</b><span>' + e(d.sub) + '</span></div><button type="button" class="x" data-a="ui:deselect" aria-label="Close">×</button></div>';
    h += '<ul class="insp-l">' + d.lines.map((l) => '<li>' + e(l) + '</li>').join('') + '</ul><div class="row insp-b">';
    const k = sel.kind;
    if (k === 'crew') {
      const c = S.crew.find((x) => x.id === sel.id);
      h += '</div><p class="small insp-hint">Click a sphere, pump, rail car, detector, skid or open ground to give ' + e(c.name.split(' ')[0]) + ' an order.</p><div class="row insp-b">';
      h += btn('Rounds', 'crewRounds', [], 'sm') + btn('Back to CCR', 'crewReturn', [c.id], 'sm quiet') + btn('Stand down', 'crewCancel', [c.id], 'sm quiet') + ubtn(UI.followKey === sel.key ? 'Stop following' : 'Follow', 'follow', [], 'sm ghost');
      if (c.queue.length) h += '<span class="small muted">Queue: ' + c.queue.map((t) => e(t.label)).join(' → ') + '</span>';
    } else if (k === 'driver' || k === 'truck') {
      const tr = S.trucks.find((x) => x.id === sel.id);
      const b = tr && tr.bay && S.bays.find((x) => x.id === tr.bay);
      if (tr && tr.state === 'QUEUE') h += ubtn('Inspect documents', 'modal', ['truck', tr.id], 'sm');
      if (b) { h += btn('Bay PA to driver', 'bayPA', [b.id], 'sm' + (tr.engineOn ? ' warn' : ' quiet')); if (b.state === 'LOADING') h += btn('Stop loading', 'bayStop', [b.id], 'sm danger'); h += ubtn('Open ' + b.tag, 'nav', ['rack', b.id], 'sm ghost'); }
      if (tr && (tr.state === 'PARKED' || tr.state === 'DECANT_WAIT')) for (const bb of S.bays) if (bb.state === 'IDLE' && !bb.truckId && bb.product === tr.product && !bb.suspended && !bb.damaged) h += btn('Call to ' + bb.tag, 'assignBay', [tr.id, bb.id], 'sm');
      if (tr && tr.state === 'WEIGHED') h += btn('Release', 'truckRelease', [tr.id], 'sm') + btn('Decant', 'truckDecant', [tr.id], 'sm warn') + ubtn('Weighbridge page', 'nav', ['gate'], 'sm ghost');
    } else if (k === 'guard' || k === 'gate') {
      const q = S.trucks.find((t) => t.state === 'QUEUE');
      if (q) h += ubtn('Inspect ' + q.plate, 'modal', ['truck', q.id], 'sm');
      h += ubtn('Gate page', 'nav', ['gate'], 'sm ghost');
    } else if (k === 'permit') {
      const pm = S.permits.find((x) => x.no === sel.id);
      if (pm.status === 'active') h += btn('Suspend work', 'permitSuspend', [pm.no], 'sm warn');
      if (pm.status === 'suspended') h += btn('Resume', 'permitResume', [pm.no], 'sm');
      if (['active', 'workdone', 'suspended'].includes(pm.status)) h += btn('Close permit', 'permitClose', [pm.no], 'sm quiet');
      h += ubtn('Review permit', 'nav', ['permits', pm.no], 'sm ghost');
    } else if (k === 'fire') {
      for (const id of S.tankOrder) h += btn('Cool ' + S.tanks[id].tag, 'fireBrigadeTarget', [id], 'sm' + (S.fireBrigade.target === id ? '' : ' quiet'));
      h += btn('Cool rack', 'fireBrigadeTarget', ['LR'], 'sm' + (S.fireBrigade.target === 'LR' ? '' : ' quiet')) + btn('All exposures', 'fireBrigadeTarget', [null], 'sm quiet');
    } else if (k === 'tank') {
      const t = S.tanks[sel.id];
      const dv = D.DELUGE.find((x) => x.covers === sel.id);
      h += btn((t.xvIn ? 'Close' : 'Open') + ' inlet', 'setTankValve', [t.id, 'in', !t.xvIn], 'sm quiet') + btn((t.xvOut ? 'Close' : 'Open') + ' outlet', 'setTankValve', [t.id, 'out', !t.xvOut], 'sm quiet');
      h += btn(S.fw.deluge[dv.id].open ? 'Stop deluge' : 'Deluge', 'deluge', [dv.id, !S.fw.deluge[dv.id].open], 'sm ' + (S.fw.deluge[dv.id].open ? 'warn' : 'quiet'));
      if (S.headers[t.product].source !== t.id) h += btn('Line up header', 'setHeaderSource', [t.product, t.id], 'sm ghost');
      h += ubtn('Tank farm page', 'nav', ['tanks', t.id], 'sm ghost');
    } else if (k === 'valve') {
      const [tid, w] = sel.id.split(':'); const t = S.tanks[tid]; const cmd = w === 'in' ? t.xvIn : t.xvOut;
      h += btn(cmd ? 'Close' : 'Open', 'setTankValve', [tid, w, !cmd], 'sm' + (cmd ? ' warn' : '')) + ubtn('Tank farm page', 'nav', ['tanks', tid], 'sm ghost');
    } else if (k === 'pump') {
      const p = S.pumps[sel.id];
      h += btn('Start', 'pumpStart', [p.id], 'sm', { disabled: p.running || p.loto }) + btn('Stop', 'pumpStop', [p.id], 'sm quiet', { disabled: !p.running });
      if (p.tripped) h += btn('Reset', 'pumpReset', [p.id], 'sm warn');
      h += btn(p.isolated ? 'De-isolate' : 'Isolate', 'pumpIsolate', [p.id, !p.isolated], 'sm ghost', { disabled: p.loto });
    } else if (k === 'bay') {
      const b = S.bays.find((x) => x.id === sel.id);
      if (b.state === 'LOADING' || b.state === 'DECANTING') h += btn('Stop', 'bayStop', [b.id], 'sm danger');
      if (b.state === 'STOPPED') h += btn('Resume', 'bayResume', [b.id], 'sm');
      h += ubtn('Open ' + b.tag, 'nav', ['rack', b.id], 'sm');
    } else if (k === 'car' || k === 'comp') {
      const comp = S.rail.comp;
      h += btn('Start C-301', 'compStart', [], 'sm', { disabled: comp.running }) + btn('Stop C-301', 'compStop', [], 'sm danger', { disabled: !comp.running }) + ubtn('Rail page', 'nav', ['rail'], 'sm ghost');
    } else if (k === 'gd') {
      const g = S.gd.find((x) => x.id === sel.id);
      h += btn(g.inhibited ? 'Remove inhibit' : 'Inhibit', 'gdInhibit', [g.id, !g.inhibited], 'sm ghost') + ubtn('Fire & gas page', 'nav', ['fg'], 'sm ghost');
    } else if (k === 'odorant' || k === 'odor') {
      h += ubtn('Utilities page', 'nav', ['utilities'], 'sm ghost');
    } else if (k === 'fwpumps' || k === 'fwtank' || k === 'ia') {
      h += btn(S.fw.diesel.running ? 'Stop P-502' : 'Start P-502', 'fwPump', ['diesel', !S.fw.diesel.running], 'sm quiet') + ubtn('Utilities page', 'nav', ['utilities'], 'sm ghost');
    } else if (k === 'ccr') {
      h += ubtn('Schematic', 'nav', ['overview'], 'sm') + ubtn('Shift log', 'nav', ['log'], 'sm quiet');
    } else if (k === 'wb') {
      h += btn('Zero check', 'wbZero', [sel.id], 'sm quiet') + ubtn('Gate page', 'nav', ['gate'], 'sm ghost');
    }
    h += '</div>';
    if (UI.selCrew && k !== 'crew') {
      const c = S.crew.find((x) => x.id === UI.selCrew);
      if (c) h += '<p class="small insp-hint">Commanding ' + e(c.name) + ' — click a target, or ' + '<button type="button" class="linkbtn" data-a="ui:dropCrew">stop commanding</button>.</p>';
    }
    return h;
  }

  // ---------------------------------------------------------------- Context menu
  function showOrders(S, crewId, p, cx, cy) {
    H.orders = ordersFor(S, crewId, p);
    const c = S.crew.find((x) => x.id === crewId);
    const d = describe(S, p) || { title: 'Here' };
    const el = document.getElementById('ctx');
    if (!H.orders.length) { el.hidden = true; return; }
    let h = '<div class="ctx-h">' + e(c.call) + ' → ' + e(d.title) + '</div>';
    H.orders.forEach((o, i) => { h += '<button type="button" data-a="ui:order" data-p="[' + i + ']">' + e(o.label) + '</button>'; });
    h += '<button type="button" class="ctx-x" data-a="ui:ctxClose">Cancel</button>';
    el.innerHTML = h;
    el.hidden = false;
    const w = el.offsetWidth || 260, hh = el.offsetHeight || 200;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, cx + 10)) + 'px';
    el.style.top = Math.max(60, Math.min(window.innerHeight - hh - 8, cy - 10)) + 'px';
  }
  function runOrder(S, i) {
    const o = H.orders[i];
    if (!o) return;
    if (o.prefer) L.crewMod.prefer = o.prefer;
    L.crewMod.direct = true;
    try { L.sim.act(S, o.action, ...o.args); } finally { L.crewMod.prefer = null; L.crewMod.direct = false; }
    document.getElementById('ctx').hidden = true;
  }

  // ---------------------------------------------------------------- Tooltip
  function tooltip(S, p, cx, cy) {
    const el = document.getElementById('tip');
    if (!p || p.kind === 'ground') { el.hidden = true; return; }
    let h;
    if (p.kind === 'icon') {
      const s = L.app.world && L.app.world.actors.icons.get(p.id);
      if (!s || !s.userData.tip) { el.hidden = true; return; }
      h = '<b>' + e(s.userData.tip) + '</b>';
    } else {
      const d = describe(S, p);
      if (!d) { el.hidden = true; return; }
      h = '<b>' + e(d.title) + '</b><span>' + e(d.sub) + '</span>' + d.lines.map((l) => '<div>' + e(l) + '</div>').join('');
      if (UI.selCrew && p.kind !== 'crew') h += '<div class="tip-cmd">Click to give ' + e(S.crew.find((x) => x.id === UI.selCrew).call) + ' an order</div>';
      else if (['crew'].includes(p.kind)) h += '<div class="tip-cmd">Click to select and command</div>';
    }
    if (el._h !== h) { el.innerHTML = h; el._h = h; }
    el.hidden = false;
    const w = el.offsetWidth, hh = el.offsetHeight;
    el.style.left = Math.min(window.innerWidth - w - 8, cx + 16) + 'px';
    el.style.top = Math.min(window.innerHeight - hh - 8, cy + 14) + 'px';
  }

  // ---------------------------------------------------------------- Minimap
  function minimapMount(el) {
    el.innerHTML = '<div class="mm-in" id="mm">' + L.plantSvg.build() + '<i class="mm-cam" id="mmcam"></i></div>';
  }
  function minimapUpdate(el, S, cam) {
    const box = el.querySelector('#mm');
    if (!box) return;
    L.plantSvg.update(box, S);
    const dot = el.querySelector('#mmcam');
    if (dot && cam) { dot.style.left = (U.clamp(cam.target.x / D.SITE.w, 0, 1) * 100) + '%'; dot.style.top = (U.clamp(cam.target.z / D.SITE.h, 0, 1) * 100) + '%'; }
  }
  function minimapClick(el, ev) {
    const svg = el.querySelector('svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * D.SITE.w, z: (ev.clientY - r.top) / r.height * D.SITE.h };
  }

  L.hud = { describe, ordersFor, inspector, showOrders, runOrder, tooltip, minimapMount, minimapUpdate, minimapClick, crewActivity };
})(globalThis.LPG = globalThis.LPG || {});
