/* Safety and support views: utilities, fire & gas, permits, crew & tasks, logbook, handbook. */
(function (L) {
  'use strict';
  const U = L.util, D = L.data;
  const { UI, btn, ubtn, draft, pill, meter, e } = L.ui;
  const F = U.fmt;
  const V = L.views;
  const simple = (fn) => ({ mount(el) { el.innerHTML = '<div id="v"></div>'; }, update(el, S) { L.ui.setHTML(el.querySelector('#v'), fn(S)); } });

  // ------------------------------------------------------------------ Utilities
  V.utilities = simple((S) => {
    let h = '<div class="sec-h"><h2>Pumps & utilities</h2><span class="sub">Loading pumps · instrument air · power · odorant · fire water</span></div>';
    h += '<div class="card"><h3>Loading pumps</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pump</th><th>Status</th><th class="num">Flow m³/h</th><th class="num">Recirc</th><th class="num">ΔP bar</th><th class="num">Motor A</th><th>Vibration mm/s</th><th>Seal</th><th class="num">Run h</th><th></th></tr></thead><tbody>';
    for (const p of Object.values(S.pumps)) {
      const st = p.loto ? pill('LOTO', 'p3') : p.tripped ? pill('Tripped', 'p1') : p.running ? pill('Running', 'run') : p.isolated ? pill('Isolated', '') : pill('Stopped', '');
      const vc = p.vib > 11 ? 'p1' : p.vib > 7.1 ? 'p2' : p.vib > 4.5 ? 'p3' : '';
      h += '<tr><td><b>' + p.tag + '</b><div class="small muted">' + p.product + (p.duty ? ' · duty' : ' · standby') + '</div></td><td>' + st + (p.tripped ? '<div class="small flag">' + e(p.tripCause) + '</div>' : '') + '</td>';
      h += '<td class="num">' + p.flow.toFixed(0) + '</td><td class="num">' + p.recirc.toFixed(0) + '</td><td class="num">' + p.dP.toFixed(1) + '</td><td class="num">' + p.amps.toFixed(0) + '</td>';
      h += '<td style="min-width:110px">' + meter(p.vib / 14, [4.5 / 14, 7.1 / 14, 11 / 14], vc) + '<span class="small num">' + p.vib.toFixed(1) + '</span></td><td>' + (p.seal === 'ok' ? 'normal' : p.seal === 'weep' ? 'normal' : '<span class="flag">LEAK</span>') + '</td><td class="num">' + Math.round(p.hours).toLocaleString('en-GB') + '</td><td class="row">';
      h += btn('Start', 'pumpStart', [p.id], 'sm', { disabled: p.running || p.loto }) + btn('Stop', 'pumpStop', [p.id], 'sm quiet', { disabled: !p.running });
      if (p.tripped) h += btn('Reset', 'pumpReset', [p.id], 'sm warn');
      if (!p.duty) h += btn('Make duty', 'pumpDuty', [p.id], 'sm ghost');
      h += btn(p.isolated ? 'De-isolate' : 'Isolate', 'pumpIsolate', [p.id, !p.isolated], 'sm ghost', { disabled: p.loto });
      h += '</td></tr>';
    }
    h += '</tbody></table></div><div class="row" style="margin-top:8px">';
    for (const prod of ['propane', 'butane']) {
      const Hh = S.headers[prod];
      h += '<span class="small"><b>' + prod + '</b> header from ' + S.tanks[Hh.source].tag + ' · ' + Hh.pressure.toFixed(1) + ' barg · demand ' + F.n0(Hh.demand) + ' m³/h · pump control</span>';
      h += btn('AUTO', 'setHeaderMode', [prod, 'auto'], 'sm' + (Hh.mode === 'auto' ? '' : ' quiet')) + btn('MANUAL', 'setHeaderMode', [prod, 'manual'], 'sm' + (Hh.mode === 'manual' ? '' : ' quiet'));
    }
    h += '</div><p class="small muted">AUTO starts the duty pump on rack demand and stops it after 10 minutes with no demand. Vibration zones per ISO 10816: alarm 7.1, trip 11 mm/s.</p></div>';

    const ia = S.util.ia, od = S.util.odor, fw = S.fw;
    h += '<div class="grid g3" style="margin-top:12px">';
    h += '<div class="card' + (ia.p < 4.5 ? ' crit' : '') + '"><h3>Instrument air</h3><div class="big">' + ia.p.toFixed(2) + ' <small>barg (alarm 4.5, ROSOVs fail at 3.5)</small></div>' + meter(ia.p / 7.5, [4.5 / 7.5, 3.5 / 7.5], ia.p < 4.5 ? 'p1' : '') + '<dl class="kv">';
    for (const c of ia.comps) h += '<dt>' + c.tag + '</dt><dd>' + (c.running ? 'running' : c.tripped ? '<span class="flag">tripped (' + e(c.tripCause || '') + ')</span>' : 'stopped') + (c.auto ? ' · auto standby' : ' · manual') + ' ' + (c.running ? btn('Stop', 'iaStop', [c.id], 'sm quiet') : btn('Start', 'iaStart', [c.id], 'sm')) + '</dd>';
    h += '<dt>Grid supply</dt><dd>' + (S.util.power.ok ? 'normal' : '<span class="flag">DIP — motors tripped</span>') + '</dd></dl></div>';
    h += '<div class="card' + (od.failed ? ' alert' : '') + '"><h3>Odorant T-401</h3><div class="big">' + (od.level * 100).toFixed(0) + '% <small>ethyl mercaptan · ' + F.n0(od.level * od.cap) + ' kg</small></div>' + meter(od.level, [0.2], od.level < 0.2 ? 'p3' : '');
    h += '<dl class="kv"><dt>Injection P-401</dt><dd>' + (od.failed ? '<span class="flag">FAILED — no flow</span>' : 'running · target 25 ppm') + '</dd><dt>Injected this shift</dt><dd>' + od.injected.toFixed(1) + ' kg</dd><dt>Delivery</dt><dd>' + (S.odorDelivery.done ? 'received' : S.odorDelivery.arrived ? '<b>at the gate</b>' : 'due ' + U.clock(S, S.odorDelivery.t)) + '</dd></dl><div class="row">' + btn('Send crew to re-prime P-401', 'odorRestore', [], 'sm', { disabled: !od.failed }) + btn('Supervise delivery', 'odorDelivery', [], 'sm quiet', { disabled: !S.odorDelivery.arrived || S.odorDelivery.done || S.odorDelivery.inProgress }) + '</div></div>';
    h += '<div class="card' + (fw.p < 7 || fw.elec.failed || fw.diesel.failed ? ' crit' : '') + '"><h3>Fire water</h3><div class="big">' + fw.p.toFixed(1) + ' <small>barg ring main</small></div><dl class="kv"><dt>Tank</dt><dd>' + F.n0(fw.tank) + ' / ' + F.n0(fw.tankCap) + ' m³</dd><dt>Jockey P-503</dt><dd>running</dd>';
    h += '<dt>P-501 electric</dt><dd>' + (fw.elec.failed ? '<span class="flag">FAILED</span>' : fw.elec.running ? 'running' : 'standby (auto)') + ' ' + (fw.elec.running ? btn('Stop', 'fwPump', ['elec', false], 'sm quiet') : btn('Start', 'fwPump', ['elec', true], 'sm quiet')) + '</dd>';
    h += '<dt>P-502 diesel</dt><dd>' + (fw.diesel.failed ? '<span class="flag">FAILED TO START</span>' : fw.diesel.running ? 'running ' + U.dur(fw.diesel.testStarted !== null && !fw.diesel.tested ? S.t - fw.diesel.testStarted : 0) : 'standby (auto)') + ' ' + (fw.diesel.running ? btn('Stop', 'fwPump', ['diesel', false], 'sm quiet') : btn('Start', 'fwPump', ['diesel', true], 'sm quiet', { disabled: fw.diesel.failed })) + '</dd>';
    if (fw.elec.failed || fw.diesel.failed) h += '<dt>Repair</dt><dd>' + (fw.elec.failed ? btn('Repair P-501', 'fwRepair', ['elec'], 'sm warn', { disabled: fw.elec.repairing }) : '') + (fw.diesel.failed ? btn('Repair P-502', 'fwRepair', ['diesel'], 'sm warn', { disabled: fw.diesel.repairing }) : '') + '</dd>';
    h += '<dt>Weekly run test</dt><dd>' + (fw.diesel.tested ? 'done ✓' : fw.diesel.testStarted !== null ? 'in progress — 30 min run' : 'due today') + '</dd></dl></div>';
    h += '</div>';
    return h;
  });

  // ------------------------------------------------------------------ Fire & gas
  V.fg = simple((S) => {
    let h = '<div class="sec-h"><h2>Fire & gas · ESD</h2><span class="sub">IR point gas detectors (20/40% LEL, 2ooN) · UV/IR flame detectors · deluge</span></div>';
    h += '<div class="card"><h3>Emergency shutdown</h3><div class="row" style="margin-top:6px">';
    for (const z of ['TF', 'PA', 'LR', 'RL']) {
      const on = S.esd.zones[z] || S.esd.site;
      h += '<div class="doc"><div class="small"><b>' + D.ZONES[z].name + '</b> ' + (on ? pill('Tripped', 'p1') : pill('Healthy', '')) + '</div><div class="row" style="margin-top:4px">' + (on ? btn('Reset', 'esdReset', [z], 'sm quiet', { disabled: S.esd.site }) : btn('Trip ' + z, 'esd', [z], 'sm danger')) + '</div></div>';
    }
    h += '<div class="doc"><div class="small"><b>Site</b> ' + (S.esd.site ? pill('Tripped', 'p1') : pill('Healthy', '')) + '</div><div class="row" style="margin-top:4px">' + (S.esd.site ? btn('Reset site ESD', 'esdReset', ['site'], 'sm quiet') : ubtn('Site ESD…', 'modal', ['esd'], 'sm danger')) + '</div></div></div>';
    h += '<div class="row" style="margin-top:10px">' + btn(S.muster.active ? 'Give all clear' : 'Sound general alarm (muster)', 'muster', [!S.muster.active], S.muster.active ? 'quiet' : 'warn') + btn(S.fireBrigade.called ? 'Fire service ' + (S.fireBrigade.onScene ? 'on scene' : 'due ' + U.clock(S, S.fireBrigade.arrival)) : 'Call fire service', 'callFireBrigade', [], 'danger', { disabled: S.fireBrigade.called }) + '</div></div>';
    h += '<div class="grid g2" style="margin-top:12px">';
    for (const z of ['TF', 'PA', 'LR', 'RL']) {
      const gds = S.gd.filter((g) => g.zone === z);
      const hot = gds.some((g) => g.lel >= 20 && !g.inhibited && !g.fault);
      h += '<div class="card' + (S.confirmed.gas[z] || S.confirmed.fire[z] ? ' crit' : hot ? ' alert' : '') + '"><h3>' + D.ZONES[z].name + (S.confirmed.gas[z] ? ' ' + pill('Confirmed gas', 'p1') : '') + (S.confirmed.fire[z] ? ' ' + pill('Confirmed fire', 'p1') : '') + '</h3><div class="tbl-wrap"><table class="tbl"><tbody>';
      for (const g of gds) {
        const c = g.lel >= 40 ? 'p1' : g.lel >= 20 ? 'p3' : '';
        h += '<tr><td>' + g.tag + '</td><td style="width:45%">' + (g.fault ? '<span class="flag">FAULT</span>' : meter(g.lel / 100, [0.2, 0.4], c)) + '</td><td class="num">' + (g.fault ? '—' : Math.round(g.lel) + '%') + '</td><td>' + (g.inhibited ? pill('Inhibited', 'p4') : '') + '</td><td>' + btn(g.inhibited ? 'Remove inhibit' : 'Inhibit', 'gdInhibit', [g.id, !g.inhibited], 'sm ghost') + '</td></tr>';
      }
      h += '</tbody></table></div><div class="small muted" style="margin-top:4px">Flame: ' + S.fd.filter((f) => f.zone === z).map((f) => f.tag + (f.fire ? ' <b class="flag">FIRE</b>' : ' clear')).join(' · ') + '</div><div class="row" style="margin-top:6px">';
      for (const d of D.DELUGE.filter((x) => x.zone === z)) {
        const dv = S.fw.deluge[d.id];
        h += btn((dv.open ? 'Close ' : 'Open ') + d.tag + (S.tanks[d.covers] ? ' (' + S.tanks[d.covers].tag + ')' : ''), 'deluge', [d.id, !dv.open], 'sm ' + (dv.open ? 'warn' : 'quiet'));
      }
      h += '</div></div>';
    }
    h += '</div>';
    const known = S.leaks.filter((l) => l.seen && l.rate > 0.003);
    h += '<div class="card" style="margin-top:12px"><h3>Known releases & fires</h3>';
    if (!known.length && !S.fires.length) h += '<p class="small muted">None confirmed. Detector readings above 0% LEL mean something is leaking somewhere upwind of the detector.</p>';
    for (const l of known) h += '<div class="row small">' + pill('Release', 'p2') + ' ' + e(l.label) + ' · ' + (l.fed ? 'still fed' : 'isolated, bleeding down') + (l.src.kind === 'field' && !l.fixed ? btn('Send crew to close manual valve', 'crewIsolateField', [l.id], 'sm') : '') + '</div>';
    for (const f of S.fires) h += '<div class="row small">' + pill('Fire', 'p1') + ' ' + e(f.label) + ' since ' + U.clock(S, f.t0) + (f.out ? ' — dying down' : '') + '</div>';
    h += '<p class="small muted">Wind ' + S.weather.wind.toFixed(1) + ' m/s from ' + U.compass(S.weather.windDir) + ' — the source is upwind of the detector that alarms first.</p></div>';
    return h;
  });

  // ------------------------------------------------------------------ Permits
  const statusPill = (p) => ({ pending: pill('Awaiting decision', 'p4'), active: pill('Live', 'run'), workdone: pill('Work complete', 'p3'), suspended: pill('Suspended', 'p2'), closed: pill('Closed', ''), rejected: pill('Refused', '') }[p.status] || pill(p.status, ''));

  function permitDetail(S, pm) {
    const P = L.permits;
    const as = P.assess(S, pm);
    let h = '<div class="card"><div class="row sp"><h3>' + pm.no + ' <span class="tag">' + P.TYPES[pm.type] + '</span></h3>' + statusPill(pm) + '</div>';
    h += '<div class="docs" style="margin-top:8px"><div class="doc"><h5>Work</h5><b>' + e(pm.title) + '</b><p class="small">' + e(pm.desc) + '</p><dl class="kv"><dt>Location</dt><dd>' + e(pm.loc.name) + '</dd><dt>Contractor</dt><dd>' + e(pm.contractor) + '</dd><dt>Performing authority</dt><dd>' + e(pm.performer) + '</dd><dt>Competency card</dt><dd>valid to ' + V.dateStr(pm.competentExp) + (S.settings.hints && pm.competentExp < S.date ? ' <span class="flag">EXPIRED</span>' : '') + '</dd><dt>Duration</dt><dd>' + pm.durH.toFixed(1) + ' h' + (pm.workEnd ? ' · until ' + U.clock(S, pm.workEnd) : '') + '</dd>' + (pm.resubmitOf ? '<dt>Re-submission of</dt><dd>' + pm.resubmitOf + '</dd>' : '') + '</dl></div>';
    const dcl = pm.declared;
    h += '<div class="doc"><h5>Requester\'s declarations</h5><dl class="kv"><dt>Hazards</dt><dd>' + pm.hazards.map(e).join('; ') + '</dd><dt>Isolation</dt><dd>' + e(dcl.isolation) + '</dd><dt>Gas test requested</dt><dd>' + (dcl.gasTest ? 'yes' : 'no') + '</dd>';
    if (dcl.standby !== undefined) h += '<dt>Standby & rescue</dt><dd>' + (dcl.standby ? 'standby named, rescue plan attached' : '<b>not provided</b>') + '</dd>';
    if (dcl.harness !== undefined) h += '<dt>Harness</dt><dd>' + (dcl.harness ? 'full body harness, double lanyard' : 'no') + '</dd>';
    if (dcl.lineLocate !== undefined) h += '<dt>Buried services</dt><dd>' + (dcl.lineLocate ? 'drawings checked + locator scan done' : '<b>no locate recorded</b>') + '</dd>';
    h += '<dt>Risk assessment</dt><dd>' + (dcl.jsa ? 'JSA attached' : 'missing') + '</dd></dl></div>';
    h += '<div class="doc"><h5>Live check (now)</h5><dl class="kv"><dt>Gas at location</dt><dd>' + (as.lel > 0.5 ? '<span class="flag">' + as.lel.toFixed(0) + '% LEL</span>' : 'none detected') + '</dd><dt>Nearby operations</dt><dd>' + (as.simops.length ? as.simops.map(e).join(', ') : 'none within 35 m') + '</dd><dt>Weather</dt><dd>wind ' + S.weather.wind.toFixed(1) + ' m/s' + (S.weather.lightningKm < 30 ? ', lightning ' + S.weather.lightningKm.toFixed(0) + ' km' : '') + '</dd>';
    if (pm.facts.pump || pm.facts.pumpCheck) { const p = S.pumps[pm.facts.pump || pm.facts.pumpCheck]; h += '<dt>' + p.tag + '</dt><dd>' + (p.running ? '<span class="flag">RUNNING</span>' : 'stopped') + (p.loto ? ', locked out' : '') + '</dd>'; }
    if (pm.facts.override) { const c = S.rail.comp; h += '<dt>Receipts to ' + S.tanks[pm.facts.override].tag + '</dt><dd>' + (c.running && c.tank === pm.facts.override ? '<span class="flag">rail unloading in progress</span>' : 'none in progress') + '</dd>'; }
    const gt = pm.gasTest;
    h += '<dt>Gas test</dt><dd>' + (!gt ? 'not done' : gt.status === 'pending' ? 'field operator on the way' : 'O₂ ' + gt.o2.toFixed(1) + '% · LEL ' + gt.lel.toFixed(1) + '% · H₂S ' + gt.h2s + ' · CO ' + gt.co + ' ppm at ' + U.clock(S, gt.t)) + '</dd>';
    h += '<dt>Isolation on site</dt><dd>' + (pm.isoVerified ? 'verified (see radio log)' : 'not verified') + '</dd>';
    for (const n of as.notes) h += '<dt>Note</dt><dd>' + e(n) + '</dd>';
    h += '</dl><div class="row" style="margin-top:6px">' + btn('Request gas test', 'permitGasTest', [pm.no], 'sm', { disabled: (gt && gt.status === 'pending') || !['pending', 'suspended'].includes(pm.status) }) + btn('Verify isolation on site', 'permitVerifyIso', [pm.no], 'sm quiet', { disabled: pm.status !== 'pending' }) + '</div></div></div>';
    if (pm.status === 'pending') {
      h += '<h4>Decision</h4><div class="grid g2"><div class="stack"><b class="small">Conditions to attach if issuing</b>';
      for (const k of Object.keys(P.CONDITIONS)) {
        const id = 'pc-' + pm.no + '-' + k;
        h += '<label class="chk"><input type="checkbox" id="' + id + '" data-draft="1"' + (draft(id, false) ? ' checked' : '') + '> ' + e(P.CONDITIONS[k]) + '</label>';
      }
      h += '<div class="row" style="margin-top:6px"><button type="button" class="btn" data-a="ui:permitApprove" data-p="' + e(JSON.stringify([pm.no])) + '">Issue permit</button></div></div>';
      const rid = 'pr-' + pm.no;
      h += '<div class="stack"><label class="small" for="' + rid + '"><b>Reason for refusal</b></label><select id="' + rid + '" data-draft="1">';
      for (const k of Object.keys(P.REJECT_REASONS)) h += '<option value="' + k + '"' + (draft(rid, 'simops') === k ? ' selected' : '') + '>' + e(P.REJECT_REASONS[k]) + '</option>';
      h += '</select><div class="row">' + btn('Refuse permit', 'permitDecide', [pm.no, 'reject'], 'quiet', { inputs: ['reason:' + rid] }) + '</div><p class="small muted">Refusing for gas test or SIMOPS lets the contractor re-submit later.</p></div></div>';
    } else {
      if (pm.conditions && pm.conditions.length) h += '<p class="small"><b>Conditions:</b> ' + pm.conditions.map((c) => e(P.CONDITIONS[c])).join('; ') + '</p>';
      if (pm.suspendedWhy) h += '<p class="small flag">Suspended: ' + e(pm.suspendedWhy) + '</p>';
      h += '<div class="row">';
      if (pm.status === 'active') h += btn('Suspend', 'permitSuspend', [pm.no], 'sm quiet');
      if (pm.status === 'suspended') h += btn('Resume', 'permitResume', [pm.no], 'sm');
      if (['active', 'workdone', 'suspended'].includes(pm.status)) h += btn(pm.status === 'workdone' ? 'Accept hand-back & close' : 'Close permit now', 'permitClose', [pm.no], 'sm' + (pm.status === 'workdone' ? '' : ' ghost'));
      h += '</div>';
    }
    return h + '</div>';
  }

  V.permits = simple((S) => {
    const vis = S.permits.filter((p) => p.status !== 'scheduled');
    if (!UI.sel.permit || !vis.find((p) => p.no === UI.sel.permit)) UI.sel.permit = (vis.find((p) => p.status === 'pending') || vis.find((p) => p.status === 'workdone') || vis[0] || {}).no;
    let h = '<div class="sec-h"><h2>Permit to work</h2><span class="sub">You are the area authority for this shift</span></div>';
    const order = { pending: 0, workdone: 1, suspended: 2, active: 3, rejected: 4, closed: 5 };
    const list = vis.slice().sort((a, b) => (order[a.status] - order[b.status]) || (a.requestT - b.requestT));
    h += '<div class="card"><div class="tbl-wrap" data-keep="pl"><table class="tbl"><thead><tr><th>Permit</th><th>Type</th><th>Work</th><th>Location</th><th>Status</th></tr></thead><tbody>';
    if (!list.length) h += '<tr><td colspan="5" class="muted">No permits yet today.</td></tr>';
    for (const p of list) h += '<tr class="click' + (p.no === UI.sel.permit ? ' sel' : '') + '" data-a="ui:selPermit" data-p="' + e(JSON.stringify([p.no])) + '"><td class="num">' + p.no + '</td><td>' + L.permits.TYPES[p.type] + '</td><td>' + e(p.title) + '</td><td>' + e(p.loc.name) + '</td><td>' + statusPill(p) + '</td></tr>';
    h += '</tbody></table></div></div>';
    const pm = vis.find((p) => p.no === UI.sel.permit);
    if (pm) h += '<div style="margin-top:12px">' + permitDetail(S, pm) + '</div>';
    return h;
  });

  // ------------------------------------------------------------------ Crew & tasks
  const LOCS = [
    ['Tank farm manifolds', 70, 56], ['Pump area', 78, 79], ['Loading rack', 213, 90], ['Rail siding', 66, 132], ['Compressor C-301', 66, 128], ['Odorant skid', 176, 68], ['Fire pumps', 34, 120],
  ];
  V.crew = simple((S) => {
    let h = '<div class="sec-h"><h2>Field crew & routine</h2><span class="sub">Two field operators · radio log in the side panel</span></div><div class="grid g2">';
    for (const c of S.crew) {
      h += '<div class="card' + (c.injured ? ' crit' : '') + '"><div class="row sp"><h3>' + e(c.name) + ' <span class="tag">' + c.call + '</span></h3>' + (c.injured ? pill('Injured', 'p1') : c.task ? pill(c.state === 'walk' ? 'Walking' : c.state === 'retreat' ? 'Backing out' : 'Working', 'run') : pill('Available', 'ok')) + '</div>';
      h += '<dl class="kv"><dt>Task</dt><dd>' + (c.task ? e(c.task.label) : '—') + '</dd><dt>Queue</dt><dd>' + (c.queue.length ? c.queue.map((t) => e(t.label)).join('<br>') : 'empty') + '</dd><dt>Personal monitor</dt><dd' + ((c.lel || 0) >= 10 ? ' class="flag"' : '') + '>' + Math.round(c.lel || 0) + '% LEL</dd></dl>';
      if (!c.injured) {
        h += '<div class="row" style="margin-top:6px">' + btn('Stand down', 'crewCancel', [c.id], 'sm quiet', { disabled: !c.task && !c.queue.length });
        const sid = 'inv-' + c.id;
        h += '<select id="' + sid + '" data-draft="1">' + LOCS.map((l, i) => '<option value="' + i + '"' + (String(draft(sid, '0')) === String(i) ? ' selected' : '') + '>' + l[0] + '</option>').join('') + '</select>';
        h += '<button type="button" class="btn sm" data-a="ui:investigate" data-p="' + e(JSON.stringify([c.id, sid])) + '">Investigate</button></div>';
      }
      h += '</div>';
    }
    h += '</div><div class="grid g2" style="margin-top:12px"><div class="card"><div class="row sp"><h3>Routine tasks</h3>' + btn('Send on rounds', 'crewRounds', [], 'sm') + '</div><div class="tbl-wrap"><table class="tbl"><tbody>';
    for (const t of S.tasks) {
      const st = { pending: S.t > t.dueT ? pill('Overdue', 'p2') : S.t >= t.startT ? pill('Due', 'p4') : pill('Later', ''), done: pill('Done', 'ok'), late: pill('Late', 'p3'), missed: pill('Missed', 'p1') }[t.status];
      h += '<tr><td>' + U.clock(S, t.startT) + '–' + U.clock(S, t.dueT) + '</td><td><b>' + e(t.title) + '</b><div class="small muted">' + e(t.detail) + '</div></td><td>' + st + '</td></tr>';
    }
    h += '</tbody></table></div></div><div class="card"><h3>Findings</h3>';
    if (!S.findings.length) h += '<p class="small muted">Nothing reported yet. Rounds and investigations report defects here.</p>';
    S.findings.forEach((f, i) => {
      h += '<div class="doc" style="margin-top:6px"><div class="small">' + U.clock(S, f.t) + ' · ' + e(f.text) + '</div><div class="row" style="margin-top:4px">' + (f.status === 'open' ? btn(f.kind === 'leak' ? 'Isolate' : f.kind === 'radar' ? 'Flag radar' : 'Raise work order', 'fixFinding', [i], 'sm') : pill(f.status === 'inwork' ? 'With maintenance' : 'Closed', '')) + '</div></div>';
    });
    h += '</div></div><div class="card" style="margin-top:12px"><div class="row sp"><h3>Shift handover from nights</h3>' + (S.handover.acked ? pill('Signed', 'ok') : btn('Sign handover', 'handoverAck', [], 'sm')) + '</div><ul class="small">' + S.handover.items.map((i) => '<li>' + e(i.text) + '</li>').join('') + '</ul></div>';
    return h;
  });
  V.crewLocs = LOCS;

  // ------------------------------------------------------------------ Logbook
  const CATS = { all: 'All', ops: 'Operations', rack: 'Rack', gate: 'Gate', rail: 'Rail', permit: 'Permits', alarm: 'Alarms', radio: 'Radio', safety: 'Safety', weather: 'Weather', score: 'Score', note: 'My notes' };
  V.log = simple((S) => {
    let h = '<div class="sec-h"><h2>Shift log</h2><span class="sub">Everything that happened, newest first</span></div><div class="card"><div class="row">';
    for (const k of Object.keys(CATS)) h += ubtn(CATS[k], 'logFilter', [k], 'sm' + (UI.logFilter === k ? '' : ' quiet'));
    h += '</div><div class="row" style="margin-top:8px"><input type="text" id="lognote" placeholder="Add a log entry (e.g. handover note)" style="flex:1;min-width:200px" value="' + e(draft('lognote', '')) + '"><button type="button" class="btn sm" data-a="ui:addNote">Add entry</button></div>';
    h += '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><tbody>';
    const rows = S.log.filter((l) => l.level !== 'hidden' && (UI.logFilter === 'all' || l.cat === UI.logFilter)).slice(-300).reverse();
    for (const l of rows) h += '<tr><td class="num">' + U.clock(S, l.t) + '</td><td><span class="pill' + (l.level === 'crit' ? ' p1' : l.level === 'warn' ? ' p3' : '') + '">' + (CATS[l.cat] || l.cat) + '</span></td><td>' + e(l.text) + '</td></tr>';
    h += '</tbody></table></div></div>';
    return h;
  });

  // ------------------------------------------------------------------ Handbook
  V.handbook = simple((S) => {
    const secs = L.content.SECTIONS;
    let h = '<div class="sec-h"><h2>Operator handbook</h2><span class="sub">The reference behind every decision in the game</span></div><div class="hb"><nav>';
    for (const s of secs) h += '<button type="button" class="' + (UI.hbSection === s.id ? 'on' : '') + '" data-a="ui:hb" data-p="' + e(JSON.stringify([s.id])) + '">' + e(s.title) + '</button>';
    h += '<button type="button" class="' + (UI.hbSection === 'lessons' ? 'on' : '') + '" data-a="ui:hb" data-p="[&quot;lessons&quot;]">This shift\'s lessons (' + S.lessons.length + ')</button></nav><div class="card prose">';
    if (UI.hbSection === 'lessons') {
      h += '<h3>Lessons from this shift</h3>';
      if (!S.lessons.length) h += '<p class="muted">Lessons appear as situations come up during the shift.</p>';
      for (const l of S.lessons) h += '<h4>' + U.clock(S, l.t) + ' · ' + e(l.title) + '</h4><p>' + e(l.body) + '</p>';
      const pen = S.score.events.filter((x) => x.lesson && x.pts < 0);
      if (pen.length) { h += '<h3 style="margin-top:14px">From your mistakes</h3>'; for (const p of pen) h += '<h4>' + U.clock(S, p.t) + ' · ' + e(p.text) + '</h4><p>' + e(p.lesson) + '</p>'; }
    } else {
      const s = secs.find((x) => x.id === UI.hbSection) || secs[0];
      h += '<h3>' + e(s.title) + '</h3>' + s.html();
    }
    return h + '</div></div>';
  });
})(globalThis.LPG = globalThis.LPG || {});
