/* Operational views: overview, tank farm & gauging, loading rack, gate & weighbridges, rail. */
(function (L) {
  'use strict';
  const U = L.util, P = L.phys, D = L.data;
  const { UI, btn, ubtn, draft, pill, meter, spark, e } = L.ui;
  const F = U.fmt;
  const V = {};

  const stateLabel = {
    IDLE: 'Idle', ARRIVING: 'Truck arriving', PREP: 'Pre-load checks', READY: 'Ready — awaiting preset', LOADING: 'Loading', STOPPED: 'Stopped',
    COMPLETE: 'Disconnecting', DECANTING: 'Decanting', CHANGEOVER: 'Changeover',
  };
  const bayPill = (b) => {
    if (b.hold) return pill('Hold', 'p2');
    if (b.state === 'STOPPED') return pill('Stopped', 'p2');
    if (b.state === 'LOADING' && !b.flowing) return pill('No flow', 'p3');
    if (b.state === 'LOADING' || b.state === 'DECANTING') return pill(b.state === 'LOADING' ? 'Loading' : 'Decanting', 'run');
    if (b.state === 'READY') return pill('Ready', 'p4');
    if (b.suspended) return pill('Out of service', '');
    return pill(stateLabel[b.state] || b.state, '');
  };
  V.bayPill = bayPill;

  // ------------------------------------------------------------------ Overview
  V.overview = {
    mount(el) { el.innerHTML = '<div class="plant-wrap" id="ov-plant">' + L.plantSvg.build() + '</div><div id="ov-dyn" style="margin-top:12px"></div>'; },
    update(el, S) {
      L.plantSvg.update(el.querySelector('#ov-plant'), S);
      let h = '<div class="grid g3">';
      for (const id of S.tankOrder) {
        const t = S.tanks[id];
        const H = Object.values(S.headers).find((x) => x.source === id);
        h += '<div class="card"><h3>' + t.tag + ' <span class="tag">' + t.product + (H ? ' · header source' : '') + '</span></h3>';
        h += meter(t.fillMeas, [0.85, 0.9], t.fillMeas > 0.9 ? 'p1' : t.fillMeas > 0.85 ? 'p2' : '');
        h += '<dl class="kv"><dt>Level</dt><dd>' + F.n0(t.levelMeas) + ' mm · ' + F.pct(t.fillMeas) + '</dd><dt>Pressure</dt><dd>' + t.P.toFixed(2) + ' barg</dd><dt>Surface / bulk</dt><dd>' + t.Ts.toFixed(1) + ' / ' + t.Tb.toFixed(1) + ' °C</dd></dl></div>';
      }
      h += '</div><div class="grid g4" style="margin-top:12px">';
      for (const b of S.bays) {
        const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId);
        h += '<div class="card hotcard"><div class="row sp"><h3>' + b.tag + ' <span class="tag">' + b.product + '</span></h3>' + bayPill(b) + '</div>';
        h += '<div class="small muted">' + (tr ? e(tr.plate) + ' · ' + e(tr.haulier) : 'No truck') + '</div>';
        if (b.state === 'LOADING' || b.state === 'DECANTING') h += '<div class="progress"><i style="width:' + (U.clamp(b.net / Math.max(b.preset, 1), 0, 1) * 100).toFixed(1) + '%"></i><span>' + F.n0(b.net) + ' / ' + F.n0(b.preset) + ' kg · ' + F.n0(b.flowLpm) + ' L/min</span></div>';
        h += '<div class="row" style="margin-top:4px">' + ubtn('Open', 'nav', ['rack', b.id], 'sm quiet') + '</div></div>';
      }
      h += '</div>';
      const comp = S.rail.comp;
      const car = S.rail.cars.find((c) => c.id === comp.lineup);
      h += '<div class="grid g3" style="margin-top:12px"><div class="card"><h3>Headers</h3><dl class="kv">';
      for (const prod of ['propane', 'butane']) {
        const Hh = S.headers[prod];
        const run = Object.values(S.pumps).filter((p) => p.product === prod && p.running).map((p) => p.tag).join(', ') || 'no pump running';
        h += '<dt>' + prod + '</dt><dd>' + S.tanks[Hh.source].tag + ' · ' + run + ' · ' + F.n0(Hh.flow) + ' m³/h</dd>';
      }
      h += '</dl></div><div class="card"><h3>Rail</h3><dl class="kv"><dt>C-301</dt><dd>' + (comp.running ? 'RUNNING ' + comp.mode : comp.tripped ? 'TRIPPED' : 'stopped') + '</dd><dt>Line-up</dt><dd>' + (car ? car.spotId + ' → ' + S.tanks[comp.tank].tag : '—') + '</dd><dt>Transfer</dt><dd>' + F.n0((S.rail.flowKgS || 0) * 3.6) + ' t/h</dd></dl></div>';
      h += '<div class="card"><h3>Shift so far</h3><dl class="kv"><dt>Dispatched</dt><dd>' + F.t1(S.stats.dispatched) + ' of ' + F.t1(S.target) + '</dd><dt>Received</dt><dd>' + F.t1(S.stats.received) + '</dd><dt>Trucks out</dt><dd>' + S.stats.trucksOut + '</dd></dl></div></div>';
      L.ui.setHTML(el.querySelector('#ov-dyn'), h);
    },
  };

  // ------------------------------------------------------------------ Tank farm
  function recordHistory(S) {
    if (S.t - UI.lastHist < 120) return;
    UI.lastHist = S.t;
    for (const id of S.tankOrder) {
      const t = S.tanks[id];
      const hh = UI.hist[id] || (UI.hist[id] = { lvl: [], p: [] });
      hh.lvl.push(t.fillMeas * 100); hh.p.push(t.P);
      if (hh.lvl.length > 200) { hh.lvl.shift(); hh.p.shift(); }
    }
  }
  V.recordHistory = recordHistory;

  function gaugeSession(S, which) {
    const g = S.gauge[which];
    if (!g) return '';
    let h = '<div class="card' + (g.status === 'open' ? ' alert' : '') + '"><div class="row sp"><h3>' + (which === 'opening' ? 'Opening' : 'Closing') + ' gauge</h3>' + (g.status === 'signed' ? pill('Signed ' + U.clock(S, g.signedT), 'ok') : pill('Open', 'p4')) + '</div>';
    h += '<p class="small muted">Send a field operator to read each sphere\'s local magnetic gauge. Compare it with what the radar showed <i>at the same moment</i>. More than ~10 mm apart on a static tank: flag the radar.</p>';
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sphere</th><th class="num">Radar now</th><th class="num">Manual</th><th class="num">Radar at reading</th><th class="num">Diff</th><th>Radar</th><th></th></tr></thead><tbody>';
    for (const id of S.tankOrder) {
      const t = S.tanks[id], rd = g.readings[id];
      const diff = rd.manual !== null ? rd.manual - rd.radarAt : null;
      h += '<tr><td>' + t.tag + '</td><td class="num">' + F.n0(t.levelMeas) + ' mm</td><td class="num">' + (rd.manual !== null ? F.n0(rd.manual) + ' mm' : rd.pending ? '<span class="muted">reading…</span>' : '—') + '</td>';
      h += '<td class="num">' + (rd.radarAt !== null ? F.n0(rd.radarAt) + ' mm' : '—') + '</td><td class="num' + (diff !== null && Math.abs(diff) > 10 ? ' flag' : '') + '">' + (diff !== null ? U.fmt.sign(diff, 0) + ' mm' : '—') + '</td>';
      h += '<td>' + (rd.flag || t.radar.flagged ? pill('Suspect', 'p3') : pill('In use', '')) + '</td><td class="row">';
      if (g.status === 'open') {
        h += btn('Manual read', 'gaugeManual', [which, id], 'sm', { disabled: rd.pending || rd.manual !== null });
        h += rd.flag ? btn('Unflag', 'gaugeFlag', [which, id, false], 'sm ghost') : btn('Flag radar', 'gaugeFlag', [which, id, true], 'sm warn', { disabled: t.radar.flagged });
      }
      h += '</td></tr>';
    }
    h += '</tbody></table></div>';
    if (g.status === 'open') h += '<div class="row" style="margin-top:8px">' + btn('Sign ' + which + ' stock', 'gaugeSign', [which], '') + '<span class="small muted">Signing uses the manual figure for flagged spheres and the radar for the rest.</span></div>';
    if (g.status === 'signed' && g.results) {
      h += '<h4>Stock at ' + U.clock(S, g.signedT) + '</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sphere</th><th>Source</th><th class="num">Level</th><th class="num">V obs m³</th><th class="num">T °C</th><th class="num">VCF</th><th class="num">V15 m³</th><th class="num">ρ15</th><th class="num">Liquid kg</th><th class="num">Vapour kg</th><th class="num">Total kg</th></tr></thead><tbody>';
      for (const id of S.tankOrder) {
        const r = g.results[id], c = r.calc;
        h += '<tr><td>' + S.tanks[id].tag + '</td><td>' + r.used + '</td><td class="num">' + F.n0(c.levelMm) + '</td><td class="num">' + c.Vobs.toFixed(2) + '</td><td class="num">' + c.tempC.toFixed(1) + '</td><td class="num">' + c.vcf.toFixed(4) + '</td><td class="num">' + c.V15.toFixed(2) + '</td><td class="num">' + c.rho15.toFixed(1) + '</td><td class="num">' + F.n0(c.mLiq) + '</td><td class="num">' + F.n0(c.mVap) + '</td><td class="num">' + F.n0(c.total) + '</td></tr>';
      }
      h += '<tr><td colspan="10"><b>Total</b></td><td class="num"><b>' + F.n0(g.total) + '</b></td></tr></tbody></table></div>';
    }
    if (which === 'closing' && S.gauge.recon) {
      const r = S.gauge.recon;
      const ok = Math.abs(r.diff) <= r.tol;
      h += '<h4>Reconciliation</h4><dl class="kv"><dt>Opening stock</dt><dd>' + F.kg(r.opening) + '</dd><dt>+ Rail receipts</dt><dd>' + F.kg(r.receipts) + '</dd><dt>− Road dispatches (weighbridge)</dt><dd>' + F.kg(r.dispatched) + '</dd><dt>= Book closing</dt><dd>' + F.kg(r.book) + '</dd><dt>Physical closing</dt><dd>' + F.kg(r.physical) + '</dd><dt>Gain / loss</dt><dd class="' + (ok ? '' : 'flag') + '">' + U.fmt.sign(r.diff / 1000, 2) + ' t (tolerance ±' + (r.tol / 1000).toFixed(2) + ' t) ' + (ok ? pill('Within tolerance', 'ok') : pill('Investigate', 'p2')) + '</dd></dl>';
    }
    return h + '</div>';
  }

  V.tanks = {
    mount(el) { el.innerHTML = '<div id="v"></div>'; },
    update(el, S) {
      let h = '<div class="sec-h"><h2>Tank farm</h2><span class="sub">Pressurised spheres · radar level, independent LSHH, local magnetic gauges</span></div><div class="grid g3">';
      for (const id of S.tankOrder) {
        const t = S.tanks[id];
        const sel = UI.sel.tank === id;
        const hh = UI.hist[id] || { lvl: [], p: [] };
        const crit = t.lshhTrip || t.psvLift || t.wallT > 250 || t.fillMeas > 0.9;
        h += '<div class="card' + (crit ? ' crit' : t.fillMeas > 0.85 || t.P > t.pah ? ' alert' : '') + '"' + (sel ? ' style="outline:2px solid var(--accent)"' : '') + '>';
        h += '<div class="row sp"><h3>' + t.tag + ' <span class="tag">' + (t.product === 'propane' ? 'Propane sphere' : 'Butane sphere') + ' · Ø ' + (t.r * 2).toFixed(1) + ' m · ' + F.n0(t.Vtot) + ' m³</span></h3>' + (t.offspec ? pill('Off-spec', 'p3') : '') + '</div>';
        h += '<div class="tankcard" style="margin-top:8px"><div class="lvl">';
        h += '<div class="liq" style="height:' + (t.levelMeas / (t.r * 20)).toFixed(1) + '%"></div>';
        const mk = (f, lbl, cls) => { const lv = P.sphereLevel(f * t.Vtot, t.r) / (2 * t.r) * 100; return '<div class="mk ' + (cls || '') + '" style="bottom:' + lv.toFixed(1) + '%">' + lbl + '</div>'; };
        h += mk(0.9, 'HH', 'hh') + mk(0.85, 'H') + mk(0.1, 'L');
        h += '</div><div class="stack">';
        h += '<div class="big">' + F.pct(t.fillMeas) + ' <small>vol · ' + F.n0(t.levelMeas) + ' mm</small></div>';
        h += '<div class="big">' + t.P.toFixed(2) + ' <small>barg · PAH ' + t.pah + ' · PSV ' + t.psv + '</small></div>';
        h += '<dl class="kv"><dt>Surface temp.</dt><dd>' + t.Ts.toFixed(1) + ' °C</dd><dt>Bulk temp.</dt><dd>' + t.Tb.toFixed(1) + ' °C</dd><dt>Liquid density</dt><dd>' + t.rl.toFixed(1) + ' kg/m³</dd>';
        h += '<dt>Composition</dt><dd>C3 ' + (t.wP * 100).toFixed(1) + '% · C4 ' + ((1 - t.wP) * 100).toFixed(1) + '%</dd>';
        h += '<dt>Liquid / vapour</dt><dd>' + F.t1(t.ml) + ' / ' + F.t1(t.mv) + '</dd><dt>Ullage to 85%</dt><dd>' + F.t1(Math.max(0, 0.85 * t.Vtot - t.Vl) * t.rl) + '</dd>';
        if (t.wallT > 60) h += '<dt>Shell (vapour zone)</dt><dd class="flag">' + Math.round(t.wallT) + ' °C</dd>';
        h += '<dt>LSHH-' + id.slice(1) + '</dt><dd>' + (t.lshhBypass ? '<span class="flag">BYPASSED</span>' : t.lshhTrip ? '<span class="flag">TRIPPED</span>' : 'healthy') + '</dd>';
        h += '<dt>Radar LT-' + id.slice(1) + '</dt><dd>' + (t.radar.flagged ? '<span class="flag">SUSPECT — WO raised</span>' : 'in service') + '</dd></dl>';
        h += '<div class="small muted">Level, last ' + U.dur(hh.lvl.length * 120) + '</div>' + spark(hh.lvl) + '<div class="small muted">Pressure</div>' + spark(hh.p);
        h += '</div></div><div class="hr"></div><div class="row">';
        const inO = L.plant.inletOpen(S, t), outO = L.plant.outletOpen(S, t);
        h += '<span class="small">XV-' + id.slice(1) + 'A inlet ' + (inO ? '<b>OPEN</b>' : '<b class="flag">SHUT</b>') + '</span>' + btn(t.xvIn ? 'Close' : 'Open', 'setTankValve', [id, 'in', !t.xvIn], 'sm quiet');
        h += '<span class="small">XV-' + id.slice(1) + 'B outlet ' + (outO ? '<b>OPEN</b>' : '<b class="flag">SHUT</b>') + '</span>' + btn(t.xvOut ? 'Close' : 'Open', 'setTankValve', [id, 'out', !t.xvOut], 'sm quiet');
        h += '</div><div class="row" style="margin-top:6px">';
        const dv = D.DELUGE.find((d) => d.covers === id);
        h += btn(S.fw.deluge[dv.id].open ? 'Stop deluge ' + dv.tag : 'Start deluge ' + dv.tag, 'deluge', [dv.id, !S.fw.deluge[dv.id].open], S.fw.deluge[dv.id].open ? 'sm warn' : 'sm quiet');
        const H = S.headers[t.product];
        h += H.source === id ? '<span class="small muted">Feeding the ' + t.product + ' loading header</span>' : btn('Line up ' + t.product + ' header', 'setHeaderSource', [t.product, id], 'sm ghost');
        h += '</div></div>';
      }
      h += '</div><div class="grid" style="margin-top:12px">' + gaugeSession(S, 'opening');
      if (S.gauge.closing) h += gaugeSession(S, 'closing');
      else h += '<div class="card"><div class="row sp"><h3>Closing gauge</h3>' + btn('Open closing gauge', 'gaugeOpenClosing', [], 'sm', { disabled: S.t < 10.5 * 3600, title: 'Available from 16:30' }) + '</div><p class="small muted">Open it in the last hour of the shift, after the last big movements, then reconcile against the opening stock.</p></div>';
      h += '</div>';
      L.ui.setHTML(el.querySelector('#v'), h);
    },
  };

  // ------------------------------------------------------------------ Loading rack
  function presetCalc(S, b, tr) {
    const mx = L.rack.maxNet(S, tr);
    const heelEst = tr.grossIn - tr.tare;
    let h = '<div class="calc"><div class="row"><b>Truck data</b><span class="muted small">for the preset</span></div>';
    h += '<div class="row"><span>Tank capacity (water)</span><span class="num">' + F.n0(tr.capL) + ' L</span></div>';
    h += '<div class="row"><span>Filling ratio (' + tr.product + ')</span><span class="num">' + P.PRODUCTS[tr.product].fillRatio.toFixed(2) + ' kg/L</span></div>';
    h += '<div class="row"><span>Registered tare</span><span class="num">' + F.kg(tr.tare) + '</span></div>';
    h += '<div class="row"><span>Gross in (weighbridge)</span><span class="num">' + F.kg(tr.grossIn) + '</span></div>';
    h += '<div class="row"><span>GVW limit</span><span class="num">' + F.kg(tr.gvw) + '</span></div>';
    h += '<div class="row"><span>Order</span><span class="num">' + (tr.order === 'FULL' ? 'FULL LOAD' : F.kg(tr.order)) + '</span></div>';
    if (S.settings.hints) {
      h += '<div class="hr"></div><div class="row"><span>Heel ≈ gross in − tare</span><span class="num">' + F.kg(heelEst) + '</span></div>';
      h += '<div class="row"><span>ADR limit = cap × ratio − heel</span><span class="num">' + F.kg(P.PRODUCTS[tr.product].fillRatio * tr.capL - heelEst) + '</span></div>';
      h += '<div class="row"><span>Weight limit = GVW − gross in</span><span class="num">' + F.kg(tr.gvw - tr.grossIn) + '</span></div>';
      const sug = Math.floor(Math.min(tr.order === 'FULL' ? Infinity : tr.order, P.PRODUCTS[tr.product].fillRatio * tr.capL - heelEst, tr.gvw - tr.grossIn) / 10) * 10 - 50;
      h += '<div class="row"><b>Suggested preset</b><b class="num">' + F.kg(sug) + '</b></div>';
    }
    return h + '</div>';
  }

  function bayCard(S, b) {
    const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId);
    const sel = UI.sel.bay === b.id;
    const cls = b.hold || b.state === 'STOPPED' || S.alarms.some((a) => a.active && a.tag === b.tag && a.pri === 1) ? ' alert' : '';
    let h = '<div class="card' + cls + '"' + (sel ? ' style="outline:2px solid var(--accent)"' : '') + '><div class="row sp"><h3>' + b.tag + ' <span class="tag">' + b.product + (b.swing ? ' · swing bay' : '') + '</span></h3>' + bayPill(b) + '</div>';
    if (!tr) {
      h += '<p class="small muted">' + (b.state === 'CHANGEOVER' ? 'Changing over to ' + b.nextProduct + ' — ready at ' + U.clock(S, b.changeoverT + 600) + '.' : b.damaged ? 'Arms damaged in a drive-away. Repair before use.' : b.suspended ? 'Out of service.' : 'Free. Call a parked truck forward from Gate & weighbridge.') + '</p><div class="row">';
      if (b.swing && b.state === 'IDLE') h += btn('Change to ' + (b.product === 'propane' ? 'butane' : 'propane'), 'bayChangeover', [b.id, b.product === 'propane' ? 'butane' : 'propane'], 'sm quiet');
      if (b.damaged) h += btn('Repair arms', 'bayRepair', [b.id], 'sm warn');
      h += btn(b.suspended ? 'Return to service' : 'Take out of service', 'baySuspend', [b.id, !b.suspended], 'sm quiet', { disabled: b.state !== 'IDLE' });
      return h + '</div></div>';
    }
    h += '<dl class="kv"><dt>Truck</dt><dd>' + e(tr.plate) + ' · ' + e(tr.haulier) + '</dd><dt>Driver</dt><dd>' + e(tr.driver) + (tr.driverEvacuated ? ' <span class="flag">(evacuated)</span>' : '') + '</dd><dt>Customer</dt><dd>' + e(tr.customer) + '</dd>';
    h += '<dt>Ground</dt><dd>' + (b.groundOverride ? '<span class="flag">OVERRIDDEN</span>' : b.ground === 'ok' ? 'permissive ✓' : b.ground === 'lost' ? '<span class="flag">LOST</span>' : '—') + '</dd>';
    if (tr.engineOn) h += '<dt>Engine</dt><dd class="flag">RUNNING</dd>';
    h += '</dl>';
    if (b.state === 'PREP' || b.state === 'ARRIVING') {
      h += '<ul class="checks">';
      L.rack.CHECKS.forEach((c, i) => {
        const st = b.checks[c.key] || 'pending';
        h += '<li class="' + st + (i === b.checkIdx && st === 'pending' && b.state === 'PREP' ? ' cur' : '') + '">' + e(c.label) + '</li>';
      });
      h += '</ul>';
    }
    if (b.hold) {
      h += '<div class="holdbox"><b>' + e(b.hold.msg) + '</b>';
      for (const [k, lbl] of b.hold.options) h += btn(lbl, 'bayResolve', [b.id, k], k === 'reject' ? 'sm quiet' : k === 'override' || k === 'accept' || k === 'ignore' ? 'sm ghost' : 'sm');
      h += '</div>';
    }
    if (b.state === 'READY') {
      h += presetCalc(S, b, tr);
      const id = 'preset-' + b.id;
      h += '<div class="row" style="margin-top:6px"><label for="' + id + '" class="small">Preset (kg net)</label><input id="' + id + '" type="number" min="500" max="30000" step="10" style="width:110px" value="' + e(draft(id, '')) + '">';
      h += btn('Authorise loading', 'bayAuthorize', [b.id], '', { inputs: [id], disabled: !!S.simopsHold.LR });
      h += '</div>';
      if (S.simopsHold.LR) h += '<p class="small flag">Rack suspended under ' + S.simopsHold.LR + '.</p>';
      if (S.weather.hold) h += '<p class="small flag">Lightning stop in force until ' + U.clock(S, S.weather.lastStrike10 + 1800) + '.</p>';
      if (b.product === 'propane' && S.util.odor.failed) h += '<p class="small flag">Odorant injection failed — propane would leave unodorised.</p>';
    }
    if (['LOADING', 'STOPPED', 'COMPLETE', 'DECANTING'].includes(b.state)) {
      const mx = L.rack.maxNet(S, tr);
      const frac = U.clamp(b.net / Math.max(b.preset, 1), 0, 1);
      if (!b.decant) h += '<div class="progress"><i style="width:' + (frac * 100).toFixed(1) + '%"></i><span>' + F.n0(b.net) + ' / ' + F.n0(b.preset) + ' kg net</span></div>';
      h += '<dl class="kv">';
      h += '<dt>Flow</dt><dd>' + F.n0(b.flowLpm) + ' L/min' + (b.state === 'LOADING' && !b.flowing ? ' <span class="flag">NO FLOW</span>' : b.net < 250 ? ' (low-flow start)' : b.preset - b.net < 350 ? ' (topping)' : '') + '</dd>';
      h += '<dt>Meter liquid / vapour back</dt><dd>' + F.n0(tr.loaded) + ' / ' + F.n0(tr.vapRet) + ' kg</dd>';
      h += '<dt>Meter T / ρ</dt><dd>' + b.meterT.toFixed(1) + ' °C · ' + b.meterRho.toFixed(1) + ' kg/m³</dd>';
      if (b.product === 'propane') h += '<dt>Odorant</dt><dd' + (b.odorPpm < 17 && b.flowing ? ' class="flag"' : '') + '>' + b.odorPpm.toFixed(1) + ' ppm</dd>';
      h += '<dt>Truck content</dt><dd>' + (tr.content / tr.capL).toFixed(3) + ' kg/L (limit ' + mx.fr + ')</dd>';
      if (b.decant) h += '<dt>Decant target</dt><dd>' + F.kg(b.decantTarget) + ' content (now ' + F.kg(tr.content) + ')' + (b.decantBlocked ? ' <span class="flag">sphere inlet shut</span>' : '') + '</dd>';
      if (b.state === 'STOPPED') h += '<dt>Stopped</dt><dd class="flag">' + e(b.stopReason) + '</dd>';
      h += '</dl><div class="row" style="margin-top:6px">';
      if (b.state === 'LOADING' || b.state === 'DECANTING') h += btn('Stop', 'bayStop', [b.id], 'danger');
      if (b.state === 'STOPPED') {
        h += btn('Resume', 'bayResume', [b.id], '') + btn('End batch', 'bayFinish', [b.id], 'quiet');
        if (b.ground !== 'ok' && !b.groundOverride) h += btn('Driver: re-attach ground', 'bayReground', [b.id], 'quiet');
      }
      h += btn('Bay PA to driver', 'bayPA', [b.id], 'quiet' + (tr.engineOn ? ' warn' : ''));
      h += '</div>';
    }
    if (b.state === 'COMPLETE') h += '<p class="small muted">Driver closing valves, venting arms to vapour recovery, disconnecting.</p>';
    return h + '</div>';
  }

  V.rack = {
    mount(el) { el.innerHTML = '<div id="v"></div>'; },
    update(el, S) {
      let h = '<div class="sec-h"><h2>Loading rack</h2><span class="sub">4 bays · Coriolis metering, net of vapour return · bottom loading with dry-break couplings</span></div>';
      h += '<div class="row" style="margin-bottom:10px">' + btn('Stop all bays', 'bayStopAll', [], 'danger sm');
      for (const prod of ['propane', 'butane']) {
        const Hh = S.headers[prod];
        h += '<span class="small">' + prod + ' header: ' + S.tanks[Hh.source].tag + ' · ' + F.n0(Hh.flow) + ' / ' + F.n0(Hh.demand) + ' m³/h' + (Hh.demand > 0 && Hh.share < 0.99 ? ' <span class="flag">pump capacity short</span>' : '') + '</span>';
      }
      if (S.weather.hold) h += pill('Lightning stop', 'p2');
      if (S.simopsHold.LR) h += pill('Suspended: ' + S.simopsHold.LR, 'p3');
      h += '</div><div class="grid g2">';
      for (const b of S.bays) h += bayCard(S, b);
      h += '</div>';
      L.ui.setHTML(el.querySelector('#v'), h);
    },
  };

  // ------------------------------------------------------------------ Gate & weighbridge
  function dateStr(ms) { const d = new Date(ms); return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate()); }
  V.dateStr = dateStr;

  V.truckDocs = function (S, tr) {
    const d = tr.docs;
    const exp = (ms) => dateStr(ms) + (S.settings.hints && ms < S.date ? ' <span class="flag">EXPIRED</span>' : '');
    let h = '<p class="small muted">Today is ' + dateStr(S.date) + '. Check each document before admitting the truck.</p><div class="docs">';
    h += '<div class="doc"><h5>Driver</h5><dl class="kv"><dt>Name</dt><dd>' + e(tr.driver) + '</dd><dt>ADR training cert.</dt><dd>valid to ' + exp(d.adrDriver) + '</dd><dt>Haulier</dt><dd>' + e(tr.haulier) + '</dd></dl></div>';
    h += '<div class="doc"><h5>Vehicle</h5><dl class="kv"><dt>Registration</dt><dd>' + e(tr.plate) + '</dd><dt>Type</dt><dd>' + (tr.rigid ? 'Rigid tanker' : 'Articulated tank semi-trailer') + '</dd><dt>ADR cert. of approval</dt><dd>valid to ' + exp(d.vehicleCert) + '</dd><dt>Tank code</dt><dd>' + d.tankCode + '</dd><dt>Approved for</dt><dd>' + e(d.approvedFor) + '</dd><dt>Tank inspection due</dt><dd>' + exp(d.tankTest) + '<br><span class="muted">' + d.tankTestType + '</span></dd><dt>Capacity</dt><dd>' + F.n0(tr.capL) + ' L</dd><dt>Tare / GVW</dt><dd>' + F.kg(tr.tare) + ' / ' + F.kg(tr.gvw) + '</dd></dl></div>';
    h += '<div class="doc"><h5>Orange plate & cargo</h5><div class="row"><span class="orange"><span>' + d.kemler + '</span><span>' + d.un + '</span></span><span class="small">Hazard ID ' + d.kemler + '<br>UN ' + d.un + '</span></div><dl class="kv"><dt>Last cargo</dt><dd>' + e(d.lastProduct) + '</dd><dt>Purge certificate</dt><dd>' + (d.purgeCert ? e(d.purgeCert) : 'none presented') + '</dd></dl></div>';
    h += '<div class="doc"><h5>Booking</h5><dl class="kv"><dt>Slot</dt><dd>' + (tr.booked && tr.slotT !== null ? U.clock(S, tr.slotT) : '<b>not booked</b>') + '</dd><dt>Product</dt><dd>' + tr.product + '</dd><dt>Quantity</dt><dd>' + (tr.order === 'FULL' ? 'Full load' : F.kg(tr.order)) + '</dd><dt>Customer</dt><dd>' + e(tr.customer) + '</dd><dt>Order ref.</dt><dd>' + e(tr.orderRef) + '</dd>' + (d.salesNote ? '<dt>Sales note</dt><dd>' + e(d.salesNote) + '</dd>' : '') + '</dl></div>';
    h += '<div class="doc"><h5>Gate guard checks</h5><dl class="kv"><dt>Extinguisher 2 kg (cab)</dt><dd>' + (d.ext2 ? 'present' : '<b>missing</b>') + '</dd><dt>Extinguisher 6 kg</dt><dd>' + (d.ext6 ? 'present' : '<b>missing</b>') + '</dd><dt>Tyres</dt><dd>' + e(d.tyres) + '</dd><dt>Lights, leaks</dt><dd>no defects seen</dd></dl></div>';
    return h + '</div>';
  };

  V.gate = {
    mount(el) { el.innerHTML = '<div id="v"></div>'; },
    update(el, S) {
      let h = '<div class="sec-h"><h2>Gate & weighbridges</h2><span class="sub">Document checks · WB-1 inbound · WB-2 outbound · release</span></div>';
      const q = S.trucks.filter((t) => t.state === 'QUEUE');
      h += '<div class="grid g2"><div class="card' + (q.length ? ' alert' : '') + '"><h3>At the gate <span class="tag">' + q.length + ' waiting</span></h3>';
      if (!q.length) h += '<p class="small muted">No trucks waiting.</p>';
      else {
        h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Truck</th><th>Product</th><th>Slot</th><th>Waiting</th><th></th></tr></thead><tbody>';
        for (const tr of q) h += '<tr><td>' + e(tr.plate) + '<div class="small muted">' + e(tr.haulier) + '</div></td><td>' + tr.product + '</td><td>' + (tr.booked ? U.clock(S, tr.slotT) : '<b>unbooked</b>') + '</td><td class="num">' + U.dur(S.t - tr.queueT) + '</td><td>' + ubtn('Inspect documents', 'modal', ['truck', tr.id], 'sm') + '</td></tr>';
        h += '</tbody></table></div>';
      }
      h += '</div>';
      // Weighbridges
      h += '<div class="card"><h3>Weighbridges</h3><dl class="kv">';
      for (const k of ['in', 'out']) {
        const wb = S.wb[k];
        const occ = wb.busy ? S.trucks.find((t) => t.id === wb.busy) : null;
        h += '<dt>' + (k === 'in' ? 'WB-1 inbound' : 'WB-2 outbound') + '</dt><dd>' + (occ ? e(occ.plate) + ' weighing' : 'empty deck') + ' · zero ' + (wb.zero ? '<span class="flag">+' + wb.zero + ' kg</span>' : '0 kg') + ' ' + btn('Zero check', 'wbZero', [k], 'sm quiet', { disabled: !!wb.busy }) + '</dd>';
      }
      const inQ = S.trucks.filter((t) => ['TO_WB_IN', 'WB_IN_Q'].includes(t.state)).length, outQ = S.trucks.filter((t) => ['TO_WB_OUT', 'WB_OUT_Q'].includes(t.state)).length;
      h += '<dt>Queues</dt><dd>' + inQ + ' inbound · ' + outQ + ' outbound</dd></dl></div></div>';
      // Parked
      const parked = S.trucks.filter((t) => t.state === 'PARKED' || t.state === 'DECANT_WAIT');
      h += '<div class="card" style="margin-top:12px"><h3>Waiting for a bay <span class="tag">' + parked.length + '</span></h3>';
      if (!parked.length) h += '<p class="small muted">Nobody waiting.</p>';
      else {
        h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Truck</th><th>Product</th><th>Order</th><th>Gross in</th><th>Waiting</th><th>Call forward to</th></tr></thead><tbody>';
        for (const tr of parked) {
          h += '<tr><td>' + e(tr.plate) + (tr.state === 'DECANT_WAIT' ? ' ' + pill('Decant', 'p3') : '') + '</td><td>' + tr.product + '</td><td>' + (tr.order === 'FULL' ? 'Full' : F.kg(tr.order)) + '</td><td class="num">' + F.kg(tr.grossIn) + '</td><td class="num">' + U.dur(S.t - tr.parkedT) + '</td><td class="row">';
          for (const b of S.bays) {
            const ok = b.state === 'IDLE' && !b.truckId && !b.suspended && !b.damaged && b.product === tr.product;
            h += btn(b.tag, 'assignBay', [tr.id, b.id], 'sm' + (ok ? '' : ' quiet'), { disabled: !(b.state === 'IDLE' && !b.truckId), title: b.product });
          }
          h += '</td></tr>';
        }
        h += '</tbody></table></div>';
      }
      h += '</div>';
      // Release
      const w = S.trucks.filter((t) => t.state === 'WEIGHED');
      h += '<div class="card' + (w.length ? ' alert' : '') + '" style="margin-top:12px"><h3>Outbound — release or decant <span class="tag">' + w.length + '</span></h3>';
      if (!w.length) h += '<p class="small muted">No trucks awaiting release.</p>';
      for (const tr of w) {
        const mx = L.rack.maxNet(S, tr);
        const meterNet = tr.loaded - tr.vapRet;
        const kgL = tr.content / tr.capL;
        h += '<div class="doc" style="margin-top:8px"><div class="row sp"><b>' + e(tr.plate) + ' · ' + tr.product + ' · ' + e(tr.customer) + '</b><span class="row">' + btn('Release & issue documents', 'truckRelease', [tr.id], 'sm') + btn('Hold for decant', 'truckDecant', [tr.id], 'sm warn') + '</span></div>';
        h += '<dl class="kv"><dt>Gross in / out</dt><dd>' + F.kg(tr.grossIn) + ' / ' + F.kg(tr.grossOut) + '</dd><dt>Weighbridge net</dt><dd>' + F.kg(tr.wbNet) + '</dd><dt>Meter net (liquid − vapour)</dt><dd>' + F.kg(meterNet) + ' · difference ' + (tr.mismatch * 100).toFixed(2) + '%' + (tr.mismatch > 0.005 ? ' <span class="flag">check</span>' : '') + '</dd>';
        h += '<dt>GVW check</dt><dd>' + F.kg(tr.grossOut) + ' vs limit ' + F.kg(tr.gvw) + (S.settings.hints ? (tr.grossOut > tr.gvw ? ' <span class="flag">OVERWEIGHT</span>' : ' ✓') : '') + '</dd>';
        h += '<dt>Filling check</dt><dd>' + kgL.toFixed(3) + ' kg/L (heel incl.) vs ' + mx.fr + (S.settings.hints ? (kgL > mx.fr * 1.002 ? ' <span class="flag">OVERFILLED</span>' : ' ✓') : '') + '</dd>';
        if (tr.odorShort > 0) h += '<dt>Odorant</dt><dd class="flag">' + F.kg(tr.odorShort) + ' loaded without injection</dd>';
        h += '</dl></div>';
      }
      h += '</div>';
      // Departed
      const gone = S.trucks.filter((t) => t.exitT !== null && t.state !== 'REJECTED').slice(-10).reverse();
      h += '<div class="card" style="margin-top:12px"><h3>Departed</h3>';
      if (!gone.length) h += '<p class="small muted">None yet.</p>';
      else {
        h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Truck</th><th>Product</th><th class="num">Net</th><th class="num">Turnaround</th><th>Left</th></tr></thead><tbody>';
        for (const tr of gone) h += '<tr><td>' + e(tr.plate) + (tr.refusedAtBay ? ' ' + pill('Refused', '') : '') + '</td><td>' + tr.product + '</td><td class="num">' + (tr.wbNet ? F.kg(tr.wbNet) : '—') + '</td><td class="num">' + (tr.gateInT !== null ? U.dur(tr.exitT - tr.gateInT) : '—') + '</td><td>' + U.clock(S, tr.exitT) + '</td></tr>';
        h += '</tbody></table></div>';
      }
      h += '</div>';
      const up = S.trucks.filter((t) => t.state === 'INBOUND' && t.booked).slice(0, 6);
      h += '<div class="card" style="margin-top:12px"><h3>Next bookings</h3><div class="tbl-wrap"><table class="tbl"><tbody>';
      for (const tr of up) h += '<tr><td>' + U.clock(S, tr.slotT) + '</td><td>' + e(tr.haulier) + '</td><td>' + tr.product + '</td><td>' + (tr.order === 'FULL' ? 'Full load' : F.kg(tr.order)) + '</td></tr>';
      h += '</tbody></table></div></div>';
      L.ui.setHTML(el.querySelector('#v'), h);
    },
  };

  // ------------------------------------------------------------------ Rail
  V.rail = {
    mount(el) { el.innerHTML = '<div id="v"></div>'; },
    update(el, S) {
      const R = S.rail, comp = R.comp;
      let h = '<div class="sec-h"><h2>Rail siding</h2><span class="sub">Pressure tank cars · unloading by vapour compressor C-301 with 4-way valve</span></div><div class="grid g2">';
      for (const spot of ['R1', 'R2']) {
        const c = R.cars.find((x) => x.id === R.spots[spot]);
        h += '<div class="card"><h3>Spot ' + spot + '</h3>';
        if (!c) { h += '<p class="small muted">Empty.</p></div>'; continue; }
        h += '<dl class="kv"><dt>Car</dt><dd>' + c.number + '</dd><dt>Shipper / RID</dt><dd>' + c.docs.shipper + ' · ' + c.docs.rid + '</dd><dt>Tank code / test due</dt><dd>' + c.docs.tankCode + ' · ' + dateStr(c.docs.testDue) + '</dd><dt>Declared</dt><dd>' + F.kg(c.declared) + '</dd>';
        h += '<dt>Pressure</dt><dd>' + c.P.toFixed(2) + ' barg</dd><dt>Liquid in car</dt><dd>' + F.kg(c.ml) + ' (' + F.pct(c.fill) + ' vol)</dd><dt>Vapour in car</dt><dd>' + F.kg(c.mv) + '</dd><dt>Received so far</dt><dd>' + F.kg(c.received) + (c.recovered > 0 ? ' (incl. ' + F.kg(c.recovered) + ' vapour)' : '') + '</dd>';
        h += '<dt>Free time</dt><dd>' + (S.t < c.freeUntil ? 'until ' + U.clock(S, c.freeUntil) + ' (' + U.dur(c.freeUntil - S.t) + ' left)' : '<span class="flag">demurrage ' + c.demurH + ' h</span>') + '</dd>';
        const smp = c.sample;
        h += '<dt>Sample</dt><dd>' + (!smp ? 'not taken' : smp.status === 'lab' ? 'at lab — due ' + U.clock(S, smp.t) : 'C3 ' + smp.c3.toFixed(1) + '% · C3= ' + smp.c3e.toFixed(1) + '% · C4+ ' + smp.c4.toFixed(1) + '% ' + (smp.pass ? pill('On spec', 'ok') : pill('Off spec', 'p2'))) + '</dd></dl>';
        h += '<ul class="checks"><li class="' + (c.secured ? 'ok' : '') + '">Secured: blue flag, derail, chocks, brake</li><li class="' + (smp ? 'ok' : '') + '">Sampled</li><li class="' + (c.connected ? 'ok' : '') + '">Ground, hoses connected, leak tested, valves open</li></ul>';
        if (c.busy) h += '<p class="small muted">Field crew working: ' + c.busy + '…</p>';
        h += '<div class="row">' + btn('Secure car', 'railSecure', [c.id], 'sm', { disabled: c.secured || !!c.busy });
        h += btn('Take sample', 'railSample', [c.id], 'sm', { disabled: !c.secured || !!smp || !!c.busy });
        h += btn('Connect', 'railConnect', [c.id], 'sm', { disabled: !c.secured || c.connected || !!c.busy });
        h += btn('Line up C-301', 'compLineup', [c.id, comp.tank], 'sm quiet', { disabled: comp.running || comp.lineup === c.id });
        h += btn('Close car valves', 'railCloseCarValves', [c.id], 'sm quiet', { disabled: !c.valvesOpen });
        h += btn('Refuse car', 'railReject', [c.id], 'sm ghost', { disabled: c.received > 500 });
        h += btn('Disconnect & release', 'railRelease', [c.id], 'sm warn', { disabled: !!c.busy || (comp.running && comp.lineup === c.id) });
        h += '</div></div>';
      }
      h += '</div>';
      const car = R.cars.find((x) => x.id === comp.lineup);
      h += '<div class="card' + (comp.tripped ? ' crit' : '') + '" style="margin-top:12px"><div class="row sp"><h3>Compressor C-301</h3>' + (comp.running ? pill('Running ' + comp.mode, 'run') : comp.tripped ? pill('Tripped', 'p1') : pill('Stopped', '')) + '</div>';
      h += '<div class="grid g2"><div><dl class="kv"><dt>Line-up</dt><dd>' + (car ? 'Car ' + car.number + ' (' + car.spotId + ')' : 'no car') + ' ⇄ ' + S.tanks[comp.tank].tag + '</dd>';
      h += '<dt>4-way valve</dt><dd>' + (comp.mode === 'LIQUID' ? 'LIQUID TRANSFER — sphere vapour pushed into car top' : 'VAPOUR RECOVERY — car vapour drawn into sphere') + '</dd>';
      h += '<dt>Suction / discharge</dt><dd>' + comp.suctP.toFixed(2) + ' / ' + comp.dischP.toFixed(2) + ' barg (ratio ' + comp.ratio.toFixed(2) + ')</dd>';
      h += '<dt>Discharge temp.</dt><dd' + (comp.dischT > 120 ? ' class="flag"' : '') + '>' + comp.dischT.toFixed(0) + ' °C (alarm 120, trip 135)</dd>';
      h += '<dt>Knock-out pot</dt><dd' + (comp.ko > 60 ? ' class="flag"' : '') + '>' + comp.ko.toFixed(0) + '%</dd>';
      h += '<dt>Liquid to sphere</dt><dd>' + F.n0((R.flowKgS || 0) * 3600) + ' kg/h</dd><dt>Vapour</dt><dd>' + F.n0((R.vapKgS || 0) * 3600) + ' kg/h ' + ((R.vapKgS || 0) < 0 ? '(recovered)' : '(to car)') + '</dd>';
      if (comp.tripped) h += '<dt>Trip</dt><dd class="flag">' + e(comp.tripCause) + '</dd>';
      if (car && car.phase === 'liquid-done') h += '<dt>Sight glass</dt><dd><b>vapour only — liquid transfer finished</b></dd>';
      h += '</dl></div><div class="stack">';
      h += '<div class="row"><span class="small">Receiving sphere</span>';
      for (const id of ['V101', 'V102']) h += btn(S.tanks[id].tag + ' (' + F.pct(S.tanks[id].fillMeas) + ')', 'compLineup', [comp.lineup, id], 'sm' + (comp.tank === id ? '' : ' quiet'), { disabled: comp.running });
      h += '</div><div class="row"><span class="small">4-way valve</span>' + btn('LIQUID', 'compMode', ['LIQUID'], 'sm' + (comp.mode === 'LIQUID' ? '' : ' quiet'), { disabled: comp.running }) + btn('VAPOUR RECOVERY', 'compMode', ['VAPOUR'], 'sm' + (comp.mode === 'VAPOUR' ? '' : ' quiet'), { disabled: comp.running }) + '</div>';
      h += '<div class="row">' + btn('Start', 'compStart', [], '', { disabled: comp.running }) + btn('Stop', 'compStop', [], 'danger', { disabled: !comp.running }) + btn('Reset trip', 'compReset', [], 'quiet', { disabled: !comp.tripped }) + '</div>';
      if (S.simopsHold.RL) h += '<p class="small flag">Rail unloading suspended under ' + S.simopsHold.RL + '.</p>';
      h += '<p class="small muted">Liquid first. When the sight glass shows vapour: stop, switch to VAPOUR RECOVERY, restart, stop at about 1.5 barg.</p>';
      h += '</div></div></div>';
      const sched = R.cars.filter((c) => c.state === 'ENROUTE');
      h += '<div class="card" style="margin-top:12px"><h3>Rail schedule</h3>';
      if (!sched.length) h += '<p class="small muted">No more cars due this shift.</p>';
      else { h += '<div class="tbl-wrap"><table class="tbl"><tbody>'; for (const c of sched) h += '<tr><td>' + U.clock(S, c.arrivalT) + '</td><td>' + c.number + '</td><td>' + c.spotId + '</td><td class="num">' + F.kg(c.declared) + '</td></tr>'; h += '</tbody></table></div>'; }
      const done = R.cars.filter((c) => c.state === 'RELEASED');
      if (done.length) { h += '<h4>Released</h4><div class="tbl-wrap"><table class="tbl"><tbody>'; for (const c of done) h += '<tr><td>' + c.number + '</td><td class="num">' + F.kg(c.received) + ' received</td><td class="num">' + F.kg(c.M) + ' left aboard</td><td>' + (c.rejected ? 'refused' : U.clock(S, c.releasedT)) + '</td></tr>'; h += '</tbody></table></div>'; }
      h += '</div>';
      L.ui.setHTML(el.querySelector('#v'), h);
    },
  };

  L.views = Object.assign(L.views || {}, V);
})(globalThis.LPG = globalThis.LPG || {});
