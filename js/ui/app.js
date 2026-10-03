/* App shell: start screen, game loop, top bar, navigation, attention queue, alarm summary, modals, audio, debrief. */
(function (L) {
  'use strict';
  const U = L.util, D = L.data;
  const { UI, setHTML, btn, ubtn, pill, e } = L.ui;
  const F = U.fmt;
  const V = L.views;
  let S = null;
  let W = null; // 3D world, null when WebGL is unavailable
  let preview = null;
  const $ = (id) => document.getElementById(id);

  let TABS = [
    ['site', 'Site (3D)'], ['overview', 'Schematic'], ['tanks', 'Tank farm'], ['rack', 'Loading rack'], ['gate', 'Gate & weighbridge'], ['rail', 'Rail'],
    ['utilities', 'Pumps & utilities'], ['fg', 'Fire & gas'], ['permits', 'Permits'], ['crew', 'Crew & tasks'], ['log', 'Shift log'], ['handbook', 'Handbook'],
  ];
  const SPEEDS = [15, 30, 60, 120, 240];

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (err) { return null; } return null; }

  // ------------------------------------------------------------------ Attention queue
  function attention(S) {
    const out = [];
    const add = (pri, text, sub, tab, sel, loc) => out.push({ pri, text, sub, tab, sel, loc });
    const at = (x, z, kind, id, key) => ({ x, z, kind, id, key });
    if (!S.handover.acked) add(3, 'Read and sign the handover', 'Night shift notes', 'crew', undefined, at(150, 151, 'ccr', 'CCR'));
    if (S.weather.hold && S.bays.some((b) => b.state === 'LOADING') ) add(1, 'Lightning inside 10 km — stop transfers', 'Bays still loading', 'rack');
    if (S.weather.hold && S.rail.comp.running) add(1, 'Lightning inside 10 km — stop C-301', 'Rail unloading running', 'rail');
    for (const tr of S.trucks.filter((t) => t.state === 'QUEUE')) add(S.t - tr.queueT > 1800 ? 2 : 3, tr.plate + ' at the gate', tr.product + (tr.booked ? '' : ' · unbooked') + ' · ' + U.dur(S.t - tr.queueT), 'gate', ['truck', tr.id], at(278, 162, 'truck', tr.id, 'trk:' + tr.id));
    for (const b of S.bays) {
      const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId);
      const bl = at(b.x, 78, 'bay', b.id);
      if (b.hold) add(2, b.tag + ': ' + (b.hold.key === 'ground' ? 'ground permissive' : b.hold.key === 'leak' ? 'leak test failed' : 'driver behaviour'), tr ? tr.plate : '', 'rack', b.id, bl);
      else if (b.state === 'READY') add(3, b.tag + ' ready — set preset', tr ? tr.plate : '', 'rack', b.id, bl);
      else if (b.state === 'STOPPED') add(2, b.tag + ' stopped', b.stopReason, 'rack', b.id, bl);
      else if (b.state === 'LOADING' && !b.flowing && (b.noFlowT || 0) > 60) add(2, b.tag + ' authorised but no flow', 'Check header line-up and pumps', 'utilities', undefined, at(78, 76, 'pump', 'P201A'));
      if (tr && tr.engineOn) add(1, b.tag + ': engine running while connected', tr.plate, 'rack', b.id, at(b.x, 78, 'driver', tr.id, 'trk:' + tr.id));
    }
    const parked = S.trucks.filter((t) => t.state === 'PARKED' || t.state === 'DECANT_WAIT');
    const freeBay = (p) => S.bays.some((b) => b.state === 'IDLE' && !b.truckId && !b.suspended && !b.damaged && b.product === p);
    for (const tr of parked) if (freeBay(tr.product)) { add(3, 'Call ' + tr.plate + ' to a ' + tr.product + ' bay', tr.state === 'DECANT_WAIT' ? 'to decant' : 'waiting ' + U.dur(S.t - tr.parkedT), 'gate', undefined, at(279, 80, 'truck', tr.id, 'trk:' + tr.id)); break; }
    for (const tr of S.trucks.filter((t) => t.state === 'WEIGHED')) add(3, 'Release ' + tr.plate, 'weighed out ' + F.t(tr.wbNet), 'gate', undefined, at(218, 162, 'truck', tr.id, 'trk:' + tr.id));
    for (const pm of S.permits) {
      if (pm.status === 'pending') add(S.t - pm.requestT > 900 ? 3 : 4, 'Permit ' + pm.no + ' waiting', pm.title, 'permits', pm.no, at(157, 158, 'permit', pm.no, 'pm:' + pm.no + ':a'));
      if (pm.status === 'workdone') add(4, 'Close ' + pm.no, 'work complete', 'permits', pm.no, at(pm.loc.x, pm.loc.y, 'permit', pm.no, 'pm:' + pm.no + ':a'));
    }
    for (const c of S.rail.cars) {
      const cl = at(c.spotId === 'R1' ? 46 : 86, 140.5, 'car', c.id, 'car:' + c.id);
      if (c.state === 'SPOTTED' && !c.secured && !c.busy) add(3, 'Rail car at ' + c.spotId + ' to secure', c.number, 'rail', undefined, cl);
      if (c.sample && c.sample.status === 'done' && !c.sample.pass && !c.rejected && c.received < 500) add(2, 'Car ' + c.spotId + ' sample OFF SPEC', 'decide before unloading', 'rail', undefined, cl);
      if (c.phase === 'liquid-done' && S.rail.comp.mode === 'LIQUID' && S.rail.comp.lineup === c.id) add(2, 'Car ' + c.spotId + ' liquid finished', 'switch C-301 to vapour recovery', 'rail', undefined, cl);
      if (S.rail.comp.running && S.rail.comp.mode === 'VAPOUR' && S.rail.comp.lineup === c.id && c.P < 1.6) add(2, 'Car ' + c.spotId + ' at ' + c.P.toFixed(1) + ' barg', 'stop vapour recovery', 'rail', undefined, cl);
    }
    if (S.rail.comp.tripped) add(2, 'C-301 tripped', S.rail.comp.tripCause, 'rail', undefined, at(66, 124, 'comp', 'C301'));
    for (const f of S.findings) if (f.status === 'open') add(3, 'Finding: ' + f.text.split(':')[0], 'from field crew', 'crew');
    for (const t of S.tasks) if (t.status === 'pending' && S.t >= t.startT && t.id !== 'handover') add(S.t > t.dueT - 900 ? 3 : 4, t.title, 'due ' + U.clock(S, t.dueT), t.id.includes('gauge') ? 'tanks' : t.id === 'fwtest' ? 'utilities' : t.id === 'odordel' ? 'utilities' : 'crew', undefined, t.id.includes('gauge') ? at(70, 40, 'tank', 'V102') : t.id === 'fwtest' ? at(34, 121, 'fwpumps', 'FWP') : t.id === 'odordel' ? at(176, 64, 'odorant', 'T401') : undefined);
    if (S.util.odor.failed) add(2, 'Odorant injection failed', 'propane loading unodorised', 'utilities', undefined, at(176, 64, 'odorant', 'T401'));
    if (S.util.ia.comps.some((c) => c.tripped)) add(2, 'Air compressor tripped', 'start the standby', 'utilities', undefined, at(150, 124, 'ia', 'IA'));
    if (Object.values(S.pumps).some((p) => p.tripped && !p.loto)) add(2, 'Pump tripped', 'reset or start standby', 'utilities');
    if (S.wb.in.zero || S.wb.out.zero) add(4, 'Weighbridge off zero', 'zero check', 'gate');
    if (S.esd.site || Object.values(S.esd.zones).some((x) => x)) add(1, 'ESD active', 'reset when safe, restore line-up', 'fg');
    if (S.fires.length) add(1, 'FIRE on site', 'deluge, isolate, muster, fire service', 'fg', undefined, at(S.fires[0].x, S.fires[0].y, 'ground'));
    out.sort((a, b) => a.pri - b.pri);
    return out;
  }

  // ------------------------------------------------------------------ Rendering
  function renderTop() {
    const W2 = S.weather;
    const thr = L.sim.throughputScore(S);
    const top = $('top');
    if (!top.querySelector('#t-clock')) {
      top.innerHTML = '<div class="brand"><b>Harrowmere LPG</b><span id="t-brand"></span></div><div class="clock" id="t-clock"></div><div class="speed" id="t-speed"></div><div class="wx" id="t-wx"></div><div class="scores" id="t-scores"></div><div class="topbtns" id="t-btns"></div>';
    }
    setHTML($('t-brand'), e(S.diff.label + ' · seed ' + S.seed));
    setHTML($('t-clock'), '<span class="num">' + U.clockSec(S).slice(0, 5) + '</span><div class="shiftbar"><i style="width:' + (S.t / S.shiftLen * 100).toFixed(1) + '%"></i></div>');
    setHTML($('t-speed'), '<button type="button" data-a="ui:pause" class="' + (UI.paused ? 'on' : '') + '" title="Pause (space)">❚❚</button>' + SPEEDS.map((sp, i) => '<button type="button" data-a="ui:speed" data-p="[' + sp + ']" class="' + (!UI.paused && UI.speed === sp ? 'on' : '') + '" title="1 s = ' + sp + ' s of shift time (key ' + (i + 1) + ')">' + sp + '×</button>').join(''));
    let wx = '<span><span class="num">' + W2.Tamb.toFixed(1) + ' °C</span></span><span class="hide-s">wind <span class="num">' + W2.wind.toFixed(1) + '</span> m/s ' + U.compass(W2.windDir) + '</span>';
    if (W2.hold) wx += '<span class="lt pill p2">Lightning stop to ' + U.clock(S, W2.lastStrike10 + 1800) + '</span>';
    else if (W2.lightningKm < 30) wx += '<span class="lt pill p3">Lightning ' + W2.lightningKm.toFixed(0) + ' km</span>';
    else wx += '<span class="hide-s">' + (W2.rain > 0.2 ? 'rain' : W2.cloud > 0.6 ? 'overcast' : W2.solar > 0.5 ? 'sunny' : 'fair') + '</span>';
    setHTML($('t-wx'), wx);
    const sc = (lbl, v) => '<div class="score' + (v < 60 ? ' bad' : v < 80 ? ' low' : '') + '"><label>' + lbl + '</label><span class="num">' + Math.round(v) + '</span><span></span><div class="bar"><i style="width:' + U.clamp(v, 0, 100) + '%"></i></div></div>';
    setHTML($('t-scores'), sc('Safety', S.score.safety) + sc('Throughput', thr) + sc('Compliance', S.score.compliance));
    setHTML($('t-btns'), ubtn(UI.sound ? '♪' : '♪̸', 'sound', [], 'quiet sm icon', { title: UI.sound ? 'Alarm horn on' : 'Alarm horn off' }) + ubtn('◐', 'theme', [], 'quiet sm icon', { title: 'Switch light / dark' }) + '<button type="button" class="esdbtn" data-a="ui:modal" data-p=\'["esd"]\'>ESD</button>');
  }

  function renderNav(att) {
    const count = {};
    for (const a of att) { const c = count[a.tab] || (count[a.tab] = { n: 0, pri: 9 }); c.n++; c.pri = Math.min(c.pri, a.pri); }
    let h = '';
    for (const [k, lbl] of TABS) {
      const c = count[k];
      h += '<button type="button" data-a="ui:nav" data-p="' + e(JSON.stringify([k])) + '" class="' + (UI.tab === k ? 'on' : '') + '"><span>' + lbl + '</span>' + (c ? '<span class="badge' + (c.pri <= 1 ? ' p1' : c.pri === 2 ? ' p2' : '') + '">' + c.n + '</span>' : '') + '</button>';
    }
    setHTML($('nav'), h);
  }

  let lastAtt = [];
  function renderSide(att) {
    lastAtt = att;
    const top = att.length ? Math.min(...att.map((a) => a.pri)) : 9;
    let h = '<div class="needs-h"><button type="button" class="needs-tab' + (UI.sideTab !== 'radio' ? ' on' : '') + '" data-a="ui:sideTab" data-p=\'["needs"]\'>Needs you <span class="badge' + (top <= 1 ? ' p1' : top === 2 ? ' p2' : '') + '">' + att.length + '</span></button><button type="button" class="needs-tab' + (UI.sideTab === 'radio' ? ' on' : '') + '" data-a="ui:sideTab" data-p=\'["radio"]\'>Radio</button><button type="button" class="x" data-a="ui:sideMin" aria-label="' + (UI.sideMin ? 'Expand' : 'Collapse') + '">' + (UI.sideMin ? '▾' : '▴') + '</button></div>';
    if (!UI.sideMin) {
      if (UI.sideTab !== 'radio') {
        h += '<div class="att" data-keep="att">';
        if (!att.length) h += '<p class="small muted">Nothing waiting. Watch the trends.</p>';
        att.slice(0, 12).forEach((a, i) => { h += '<button type="button" data-a="ui:need" data-p="[' + i + ']"><i class="p' + a.pri + '"></i><span>' + e(a.text) + (a.sub ? '<br><small>' + e(a.sub) + '</small>' : '') + '</span><span>' + (a.loc && W ? '⌖' : '›') + '</span></button>'; });
        if (att.length > 12) h += '<p class="small muted">+' + (att.length - 12) + ' more</p>';
        h += '</div>';
      } else {
        h += '<div class="feed" data-keep="feed">';
        const feed = S.log.filter((l) => ['radio', 'crew', 'rack', 'gate', 'rail', 'safety', 'ops', 'permit', 'weather'].includes(l.cat) && l.level !== 'hidden').slice(-14).reverse();
        for (const l of feed) h += '<div class="' + (l.cat === 'radio' ? 'radio' : l.level) + '"><span class="t">' + U.clock(S, l.t) + '</span>' + e(l.text) + '</div>';
        h += '</div>';
      }
    }
    $('side').className = 'needs' + (UI.sideMin ? ' min' : '');
    setHTML($('side'), h);
  }

  // ------------------------------------------------------------------ World HUD
  function renderWorldHud() {
    const insp = $('inspector');
    if (!W) { insp.hidden = true; return; }
    const sel = W.sel;
    const h = sel ? L.hud.inspector(S, sel) : (UI.selCrew ? '' : '');
    insp.hidden = !h;
    setHTML(insp, h);
    let v = '';
    const tb = (lbl, act, on, title) => '<button type="button" class="vb' + (on ? ' on' : '') + '" data-a="ui:' + act + '" title="' + e(title || lbl) + '">' + lbl + '</button>';
    v += tb('Underground', 'vUnder', W.flags.underground, 'See buried services: fire main, rail line, cables, drains, piles');
    v += tb('Levels', 'vXray', W.flags.xray, 'X-ray: liquid in spheres, trucks and rail cars');
    v += tb('Labels', 'vLabels', W.flags.labels, 'Equipment tags and readings');
    v += tb('Reset', 'vReset', false, 'Reset the camera');
    v += tb('+', 'vZoomIn', false, 'Zoom in') + tb('−', 'vZoomOut', false, 'Zoom out');
    v += '<span class="vb-sep"></span>';
    for (const [k, lbl] of [['tanks', 'Spheres'], ['rack', 'Rack'], ['gate', 'Gate'], ['rail', 'Rail']]) v += tb(lbl, 'vGo', false, 'Fly to ' + lbl).replace('data-a="ui:vGo"', 'data-a="ui:vGo" data-p=\'["' + k + '"]\'');
    setHTML($('viewbar'), v);
    if (UI.tab === 'site' || window.innerWidth > 1180) L.hud.minimapUpdate($('minimap'), S, W.camCtl);
  }

  function renderAlarms() {
    const list = S.alarms.filter((a) => a.shelvedUntil <= S.t).slice().sort((a, b) => (a.acked - b.acked) || (a.pri - b.pri) || (b.tIn - a.tIn));
    const cnt = [1, 2, 3, 4].map((p) => list.filter((a) => a.pri === p).length);
    const unack = list.filter((a) => !a.acked).length;
    let h = '<div class="ah"><h3>Alarms</h3><div class="cnt">' + cnt.map((n, i) => '<span class="pri p' + (i + 1) + '">' + n + '</span>').join('') + '</div><span class="small muted">' + unack + ' unacknowledged</span>';
    h += '<span class="row" style="margin-left:auto">' + ubtn('Silence horn', 'silence', [], 'sm quiet') + ubtn('Acknowledge all', 'ackAll', [], 'sm') + ubtn(UI.alarmMin ? 'Expand' : 'Collapse', 'alarmMin', [], 'sm quiet') + '</span></div>';
    h += '<div class="list" data-keep="al">';
    if (!list.length) h += '<div class="empty">No standing alarms.</div>';
    else {
      h += '<table><tbody>';
      for (const a of list) {
        const st = !a.active ? 'RTN' : a.acked ? 'ACK' : 'UNACK';
        h += '<tr class="p' + a.pri + (a.acked ? '' : ' unack') + (!a.active ? ' rtn' : '') + '" data-a="ui:modal" data-p="' + e(JSON.stringify(['alarm', a.id])) + '"><td class="num">' + U.clock(S, a.tIn) + '</td><td><span class="pri p' + a.pri + '">P' + a.pri + '</span></td><td class="num">' + e(a.tag) + '</td><td class="desc">' + e(a.name) + (a.detail ? ' — ' + e(a.detail) : '') + '</td><td class="small">' + st + '</td><td>' + (a.acked ? '' : '<button type="button" class="btn sm quiet" data-a="ui:ack" data-p="[' + a.id + ']">Ack</button>') + '</td></tr>';
      }
      h += '</tbody></table>';
    }
    h += '</div>';
    $('alarms').className = 'alarms' + (UI.alarmMin ? ' min' : '');
    setHTML($('alarms'), h);
    // Floating panels position themselves against the real bar heights.
    const rs = document.documentElement.style;
    rs.setProperty('--top-h', $('top').offsetHeight + 'px');
    rs.setProperty('--alarm-h', $('alarms').offsetHeight + 'px');
  }

  let mountedTab = null;
  function renderMain() {
    const dr = $('drawer');
    if (UI.tab === 'site') { dr.hidden = true; mountedTab = 'site'; return; }
    dr.hidden = false;
    const title = (TABS.find((t) => t[0] === UI.tab) || [0, ''])[1];
    setHTML($('drawer-title'), e(title));
    const view = V[UI.tab];
    const el = $('main');
    if (mountedTab !== UI.tab) { el._html = null; view.mount(el); mountedTab = UI.tab; el.scrollTop = 0; }
    view.update(el, S);
  }

  // ------------------------------------------------------------------ Modals
  function modalHTML() {
    const m = UI.modal;
    if (!m) return '';
    let title = '', body = '', wide = false;
    if (m.type === 'truck') {
      const tr = S.trucks.find((x) => x.id === m.id);
      if (!tr || tr.state !== 'QUEUE') { UI.modal = null; return ''; }
      title = tr.plate + ' — gate inspection';
      wide = true;
      body = V.truckDocs(S, tr);
      const rid = 'gr-' + tr.id;
      body += '<div class="hr"></div><div class="row sp"><div class="row">' + btn('Admit', 'gateDecision', [tr.id, 'admit'], '', { disabled: S.esd.site }) + '<span class="small muted">sends the truck to WB-1</span></div><div class="row"><label for="' + rid + '" class="small">Refusal reason</label><select id="' + rid + '" data-draft="1">';
      for (const r of L.rack.REASONS) body += '<option value="' + r.key + '"' + (L.ui.draft(rid, 'adrDriver') === r.key ? ' selected' : '') + '>' + e(r.text) + '</option>';
      body += '</select>' + btn('Refuse entry', 'gateDecision', [tr.id, 'reject'], 'warn', { inputs: [rid] }) + '</div></div>';
    } else if (m.type === 'alarm') {
      const a = S.alarms.find((x) => x.id === m.id) || S.alarmHistory.find((x) => x.id === m.id);
      if (!a) { UI.modal = null; return ''; }
      const d = D.ALARMS[a.defKey];
      title = a.tag + ' — ' + a.name;
      body = '<div class="row">' + pill('P' + a.pri + ' ' + ['', 'Critical', 'High', 'Medium', 'Low'][a.pri], 'p' + a.pri) + pill(a.active ? (a.acked ? 'Acknowledged' : 'Unacknowledged') : 'Returned to normal', '') + '<span class="small muted">raised ' + U.clock(S, a.tIn) + (a.detail ? ' · ' + e(a.detail) : '') + '</span></div>';
      body += '<div class="docs" style="margin-top:10px"><div class="doc"><h5>Cause</h5>' + e(d.cause) + '</div><div class="doc"><h5>Consequence</h5>' + e(d.consequence) + '</div><div class="doc"><h5>Operator action</h5>' + e(d.action) + '</div></div>';
      body += '<div class="row" style="margin-top:12px">' + (a.acked ? '' : '<button type="button" class="btn" data-a="ui:ack" data-p="[' + a.id + ']">Acknowledge</button>') + ubtn('Go to equipment', 'alarmGo', [a.id], 'quiet') + '</div>';
    } else if (m.type === 'esd') {
      title = 'Emergency shutdown';
      body = '<p>Site ESD closes every ROSOV, stops all pumps, the compressor and the rack, and locks the gate. Use it for a confirmed fire or an uncontrolled release. Area ESDs are on the Fire & gas page.</p><p class="small muted">A spurious site ESD costs throughput; a late one costs far more.</p><div class="row">' + btn('TRIP SITE ESD', 'esd', ['site'], 'danger') + ubtn('Cancel', 'close', [], 'quiet') + '</div>';
    } else if (m.type === 'report') {
      wide = true;
      title = 'End of shift debrief';
      body = reportHTML();
    }
    return '<div class="modal-bg" data-a="ui:bgclose"><div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + e(title) + '"><div class="modal-h"><h2>' + e(title) + '</h2>' + (m.type === 'report' ? '' : '<button type="button" class="x" data-a="ui:close" aria-label="Close">×</button>') + '</div>' + body + '</div></div>';
  }

  function reportHTML() {
    const r = S.report;
    if (!r) return '';
    const k = r.kpi;
    let h = '<div class="gradebox"><div class="grade ' + r.grade + '">' + r.grade + '</div><div><h3 style="font-size:26px">' + e(r.gradeText) + '</h3><p class="small muted">' + (r.outcome === 'catastrophe' ? 'Shift ended at ' + r.endClock + ': ' + e(r.endReason) + '.' : 'Shift completed 06:00–18:00.') + ' Overall ' + r.overall + ' / 100.</p>';
    h += '<div class="row" style="margin-top:6px">' + pill('Safety ' + Math.round(r.safety), r.safety < 60 ? 'p1' : '') + pill('Throughput ' + Math.round(r.throughput), '') + pill('Compliance ' + Math.round(r.compliance), r.compliance < 60 ? 'p2' : '') + '</div></div></div>';
    h += '<div class="grid g3" style="margin-top:14px"><div class="card"><h3>Product</h3><dl class="kv"><dt>Dispatched</dt><dd>' + F.t1(k.dispatched) + ' (target ' + F.t1(k.target) + ')</dd><dt>Received by rail</dt><dd>' + F.t1(k.received) + '</dd><dt>Trucks out / refused</dt><dd>' + k.trucksOut + ' / ' + k.trucksRejected + (k.rejectedValid ? ' (' + k.rejectedValid + ' wrongly)' : '') + '</dd><dt>Avg turnaround</dt><dd>' + (k.avgTurnaround ? U.dur(k.avgTurnaround) : '—') + '</dd><dt>Demurrage</dt><dd>' + k.demurrageH + ' car-hours</dd><dt>Complaints</dt><dd>' + k.complaints + '</dd></dl></div>';
    h += '<div class="card"><h3>Safety</h3><dl class="kv"><dt>Incidents</dt><dd>' + k.incidents + '</dd><dt>Injuries</dt><dd>' + k.injuries + '</dd><dt>Good catches</dt><dd>' + k.nearMisses + '</dd><dt>LPG to atmosphere</dt><dd>' + F.kg(k.vented) + '</dd><dt>Overfilled trucks released</dt><dd>' + k.overfills + '</dd></dl></div>';
    h += '<div class="card"><h3>Console</h3><dl class="kv"><dt>Alarms</dt><dd>' + k.alarms + ' (' + k.alarmsPer10.toFixed(2) + ' per 10 min)</dd><dt>Avg time to ack</dt><dd>' + U.dur(k.avgAck) + '</dd><dt>Stock reconciliation</dt><dd>' + (r.recon ? U.fmt.sign(r.recon.diff / 1000, 2) + ' t' : 'not done') + '</dd><dt>Open permits</dt><dd>' + r.openPermits.length + '</dd>' + (r.bypassed.length ? '<dt>Bypasses left</dt><dd class="flag">' + r.bypassed.join(', ') + '</dd>' : '') + '</dl></div></div>';
    if (r.lessons.length) {
      h += '<div class="card" style="margin-top:12px"><h3>What to do differently</h3><div class="prose">';
      for (const l of r.lessons.slice(0, 10)) h += '<p><b>' + e(l.text) + '.</b> ' + e(l.lesson) + '</p>';
      h += '</div></div>';
    }
    h += '<div class="grid g2" style="margin-top:12px"><div class="card"><h3>Deductions</h3><div class="tbl-wrap" style="max-height:260px;overflow-y:auto"><table class="tbl"><tbody>';
    for (const p of r.penalties) h += '<tr><td class="num">' + U.clock(S, p.t) + '</td><td>' + p.cat + '</td><td class="num">' + p.pts + '</td><td>' + e(p.text) + '</td></tr>';
    if (!r.penalties.length) h += '<tr><td class="muted">None. Remarkable.</td></tr>';
    h += '</tbody></table></div></div><div class="card"><h3>Good calls</h3><div class="tbl-wrap" style="max-height:260px;overflow-y:auto"><table class="tbl"><tbody>';
    for (const p of r.goods) h += '<tr><td class="num">' + U.clock(S, p.t) + '</td><td class="num">+' + p.pts + '</td><td>' + e(p.text) + '</td></tr>';
    if (!r.goods.length) h += '<tr><td class="muted">None recorded.</td></tr>';
    h += '</tbody></table></div></div></div>';
    h += '<div class="row" style="margin-top:14px">' + ubtn('Start a new shift', 'newShift', [], '') + ubtn('Replay this seed', 'replay', [], 'quiet') + ubtn('Review the log', 'reviewLog', [], 'ghost') + '</div>';
    return h;
  }

  function renderOverlays() {
    // Modal
    const mh = modalHTML();
    setHTML($('modal'), mh);
    // Toasts
    const fresh = S.toasts.filter((t) => t.id > UI.seenToast);
    if (fresh.length) {
      const box = $('toasts');
      for (const t of fresh.slice(-3)) {
        const d = document.createElement('div');
        d.className = 'toast ' + (t.kind === 'warn' ? 'warn' : '');
        d.textContent = t.text;
        box.appendChild(d);
        setTimeout(() => d.remove(), 3800);
        while (box.children.length > 4) box.firstChild.remove();
      }
      UI.seenToast = fresh[fresh.length - 1].id;
    }
    // Pause banner
    let pb = '';
    if (UI.pauseReason) pb = '<div class="pausebar"><b>Paused:</b> ' + e(UI.pauseReason) + ' <button type="button" class="btn sm quiet" data-a="ui:resume">Resume</button></div>';
    else if (S.over && !UI.modal) pb = '<div class="pausebar paused">Shift over <button type="button" class="btn sm quiet" data-a="ui:modal" data-p=\'["report"]\'>Open debrief</button></div>';
    else if (UI.paused && UI.started && !S.over) pb = '<div class="pausebar paused">Paused <button type="button" class="btn sm quiet" data-a="ui:resume">Resume</button></div>';
    setHTML($('pausebar'), pb);
    // Lesson card
    const lesson = S.lessons.find((l) => !l.read);
    setHTML($('lesson'), lesson ? '<div class="lesson" role="status"><div class="eyebrow">Lesson</div><h4>' + e(lesson.title) + '</h4><p>' + e(lesson.body) + '</p><div class="row"><button type="button" class="btn sm" data-a="ui:lessonRead" data-p="[' + JSON.stringify(lesson.id) + ']">Got it</button></div></div>' : '');
  }

  function renderAll() {
    const att = attention(S);
    renderTop(); renderNav(att); renderSide(att); renderAlarms(); renderMain(); renderWorldHud(); renderOverlays();
  }

  // ------------------------------------------------------------------ Audio (horn)
  let actx = null, hornGain = null, hornOsc = null, lastChimeSeq = 0;
  function audioInit() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      hornOsc = actx.createOscillator(); hornOsc.type = 'square';
      const filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 1800;
      hornGain = actx.createGain(); hornGain.gain.value = 0;
      hornOsc.connect(filt); filt.connect(hornGain); hornGain.connect(actx.destination);
      hornOsc.start();
    } catch (err) { actx = null; }
  }
  function audioTick() {
    if (!actx || !hornGain) return;
    const now = actx.currentTime;
    const live = S && UI.sound && !UI.paused && S.alarms.some((a) => !a.acked && a.id > (UI.silencedSeq || 0) && a.pri <= 2);
    let g = 0;
    if (live) {
      const pri = Math.min(...S.alarms.filter((a) => !a.acked && a.id > (UI.silencedSeq || 0)).map((a) => a.pri));
      const ph = (performance.now() / 1000) % (pri === 1 ? 0.5 : 1.4);
      if (pri === 1) { hornOsc.frequency.setValueAtTime(ph < 0.25 ? 880 : 660, now); g = 0.05; }
      else { hornOsc.frequency.setValueAtTime(620, now); g = ph < 0.35 ? 0.04 : 0; }
    }
    // Soft chime for new low-priority alarms
    if (S && UI.sound && S.alarmSeq > lastChimeSeq) {
      const fresh = S.alarms.filter((a) => a.id > lastChimeSeq && a.pri >= 3);
      lastChimeSeq = S.alarmSeq;
      if (fresh.length && !live) {
        const o = actx.createOscillator(), gg = actx.createGain();
        o.frequency.value = 1046; gg.gain.setValueAtTime(0.04, now); gg.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
        o.connect(gg); gg.connect(actx.destination); o.start(now); o.stop(now + 0.55);
      }
    }
    hornGain.gain.setTargetAtTime(g, now, 0.01);
  }

  // ------------------------------------------------------------------ Actions from the UI
  function readInputs(el) {
    const spec = el.getAttribute('data-in');
    if (!spec) return [];
    const out = [];
    let obj = null;
    for (const part of spec.split(',')) {
      if (part.includes(':')) {
        const [k, id] = part.split(':');
        const n = document.getElementById(id);
        obj = obj || {};
        obj[k] = n ? n.value : undefined;
      } else {
        const n = document.getElementById(part);
        out.push(n ? (n.type === 'number' ? Number(n.value) : n.value) : undefined);
      }
    }
    if (obj) out.push(obj);
    return out;
  }

  function selectWorld(loc) {
    if (!W || !loc) return;
    W.camCtl.focus(loc.x, loc.z, Math.min(W.camCtl.want.dist, 85));
    W.camCtl.follow = null;
    if (loc.kind && loc.kind !== 'ground') {
      W.sel = { kind: loc.kind, id: loc.id, key: loc.key || null, pos: { x: loc.x, z: loc.z } };
      if (loc.kind !== 'crew') UI.selCrew = UI.selCrew || null;
    }
  }
  const UIA = {
    need(i) {
      const a = lastAtt[i];
      if (!a) return;
      if (a.loc && W) selectWorld(a.loc);
      UIA.nav(a.tab, a.sel === undefined ? null : a.sel);
    },
    sideTab(t) { UI.sideTab = t; UI.sideMin = false; },
    sideMin() { UI.sideMin = !UI.sideMin; },
    closeDrawer() { UI.tab = W ? 'site' : 'overview'; },
    deselect() { if (W) { W.sel = null; W.camCtl.follow = null; } UI.selCrew = null; UI.followKey = null; $('ctx').hidden = true; },
    dropCrew() { UI.selCrew = null; },
    follow() {
      if (!W || !W.sel || !W.sel.key) return;
      if (UI.followKey === W.sel.key) { UI.followKey = null; W.camCtl.follow = null; return; }
      const key = W.sel.key; UI.followKey = key;
      W.camCtl.follow = () => { const a = W.actors.actors.get(key); return a ? a.obj.position : null; };
      W.camCtl.want.dist = Math.min(W.camCtl.want.dist, 70);
    },
    order(i) { L.hud.runOrder(S, i); },
    ctxClose() { $('ctx').hidden = true; },
    vUnder() { W.setUnderground(!W.flags.underground); },
    vXray() { W.flags.xray = !W.flags.xray; },
    vLabels() { W.flags.labels = !W.flags.labels; },
    vReset() { W.camCtl.reset(); if (W.flags.underground) W.setUnderground(false); },
    vZoomIn() { W.camCtl.zoom(0.7); },
    vZoomOut() { W.camCtl.zoom(1.4); },
    vGo(k) { const p = { tanks: [70, 44, 110], rack: [213, 80, 90], gate: [240, 150, 90], rail: [66, 132, 100] }[k]; W.camCtl.focus(p[0], p[1], p[2]); W.camCtl.follow = null; },
    nav(tab, sel) {
      if (tab.includes(':')) { const [t, s] = tab.split(':'); tab = t; sel = isNaN(+s) ? s : +s; }
      if (tab === 'site' && !W) tab = 'overview';
      UI.tab = tab;
      if (tab === 'rack' && sel !== undefined && sel !== null) UI.sel.bay = sel;
      if (tab === 'tanks' && sel) UI.sel.tank = sel;
      if (tab === 'permits' && sel) UI.sel.permit = sel;
      if (tab === 'gate' && Array.isArray(sel)) UI.modal = { type: sel[0], id: sel[1] };
      $('main').scrollTop = 0;
    },
    modal(type, id) { UI.modal = { type, id }; },
    close() { UI.modal = null; },
    bgclose(ev) { if (ev.target.classList.contains('modal-bg') && UI.modal && UI.modal.type !== 'report') UI.modal = null; },
    pause() { UI.paused = !UI.paused; UI.pauseReason = null; },
    resume() { UI.paused = false; UI.pauseReason = null; audioInit(); },
    speed(s) { UI.speed = s; UI.paused = false; UI.pauseReason = null; audioInit(); },
    sound() { UI.sound = !UI.sound; audioInit(); },
    theme() {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : cur === 'light' ? null : 'dark';
      if (next) document.documentElement.setAttribute('data-theme', next); else document.documentElement.removeAttribute('data-theme');
      store('hmt-theme', next || 'auto');
    },
    ack(id) { L.sim.ackAlarm(S, id); },
    ackAll() { for (const a of S.alarms.slice()) if (!a.acked) L.sim.ackAlarm(S, a.id); },
    silence() { UI.silencedSeq = S.alarmSeq; },
    alarmMin() { UI.alarmMin = !UI.alarmMin; },
    alarmGo(id) {
      const a = S.alarms.find((x) => x.id === id) || S.alarmHistory.find((x) => x.id === id);
      UI.modal = null;
      if (!a) return;
      const k = a.key;
      const tank = S.tankOrder.find((t) => k.endsWith('-' + t));
      if (tank) return UIA.nav('tanks', tank);
      if (/^(VAH|VAHH|SEAL|PTRIP|IA|POWER|OD|FW)/.test(k)) return UIA.nav('utilities');
      if (/^(GD|CONF|FD|ESD|HW)/.test(k)) return UIA.nav('fg');
      if (/^(COMP|KOPOT|CARLOW|DEMUR)/.test(k)) return UIA.nav('rail');
      if (/^(METER|WB)/.test(k)) return UIA.nav('gate');
      if (/^PERMIT/.test(k)) return UIA.nav('permits');
      const bay = S.bays.find((b) => a.tag === b.tag);
      if (bay) return UIA.nav('rack', bay.id);
      if (/^(LTNG|WIND)/.test(k)) return UIA.nav('rack');
      UIA.nav('overview');
    },
    selPermit(no) { UI.sel.permit = no; },
    permitApprove(no) {
      const conds = Object.keys(L.permits.CONDITIONS).filter((k) => { const n = document.getElementById('pc-' + no + '-' + k); return n && n.checked; });
      L.sim.act(S, 'permitDecide', no, 'approve', { conditions: conds });
    },
    investigate(crewId, sid) {
      const n = document.getElementById(sid);
      const loc = V.crewLocs[+(n ? n.value : 0)];
      L.sim.act(S, 'crewInvestigate', crewId, loc[1], loc[2], loc[0]);
    },
    logFilter(k) { UI.logFilter = k; },
    addNote() {
      const n = document.getElementById('lognote');
      const v = n && n.value.trim();
      if (!v) return;
      L.sim.log(S, 'note', v);
      n.value = ''; UI.drafts.lognote = '';
      n.blur();
    },
    hb(id) { UI.hbSection = id; },
    lessonRead(id) { const l = S.lessons.find((x) => x.id === id); if (l) l.read = true; },
    newShift() { UI.modal = null; showStart(); },
    replay() { const seed = S.seed, diff = S.difficulty; UI.modal = null; startShift(diff, seed); },
    reviewLog() { UI.modal = null; UI.tab = 'log'; UI.reviewing = true; },
  };

  function onClick(ev) {
    const el = ev.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const a = el.getAttribute('data-a');
    let args = [];
    try { args = JSON.parse(el.getAttribute('data-p') || '[]'); } catch (err) { args = []; }
    if (a.startsWith('ui:')) {
      if (!S && a !== 'ui:bgclose') return;
      const fn = UIA[a.slice(3)];
      if (fn) { if (a === 'ui:bgclose') fn(ev); else if (el === ev.target.closest('[data-a]')) fn.apply(null, args); }
    } else if (S && !S.over) {
      args = args.concat(readInputs(el));
      L.sim.act(S, a, ...args);
    }
    if (a !== 'ui:bgclose') ev.stopPropagation();
    if (S) renderAll();
  }

  function onInput(ev) {
    const t = ev.target;
    if (!t.id) return;
    if (t.tagName === 'SELECT') UI.lastSelectT = Date.now();
    UI.drafts[t.id] = t.type === 'checkbox' ? t.checked : t.value;
  }

  function onKey(ev) {
    if (!S || !UI.started) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
    if (ev.key === ' ') { ev.preventDefault(); UIA.pause(); renderAll(); }
    else if (/^[1-5]$/.test(ev.key)) { UIA.speed(SPEEDS[+ev.key - 1]); renderAll(); }
    else if (ev.key === 'Escape' && UI.modal && UI.modal.type !== 'report') { UI.modal = null; renderAll(); }
    else if (ev.key === 'Escape') { UIA.deselect(); if (UI.tab !== 'site' && W) UI.tab = 'site'; renderAll(); }
  }

  // ------------------------------------------------------------------ Loop
  let lastFrame = 0, lastRender = 0, lastSvg = 0;
  function frame(ts) {
    const dt = Math.min(0.25, (ts - (lastFrame || ts)) / 1000);
    lastFrame = ts;
    if (S && UI.started && !UI.paused && !S.over) {
      L.sim.tick(S, dt * UI.speed);
      if (S.pauseReq) { UI.paused = true; UI.pauseReason = S.pauseReq; S.pauseReq = null; if (UI.speed > 30) UI.speed = 30; }
      if (S.over) { UI.paused = true; UI.modal = { type: 'report' }; }
    }
    if (W) {
      if (S && UI.started) W.frame(S, dt, UI.paused || S.over ? 0 : UI.speed);
      else if (preview) { if (L.autopilot && preview.t - (preview._apT || -99) > 20) { preview._apT = preview.t; L.autopilot.step(L, preview); } L.sim.tick(preview, dt * 20); W.camCtl.want.yaw += dt * 0.04; W.frame(preview, dt, 20); }
      else W.frame(null, dt, 0);
    }
    if (S && UI.started) {
      V.recordHistory(S);
      if (ts - lastRender > 220) { lastRender = ts; renderAll(); if (UI.hoverPick) L.hud.tooltip(S, UI.hoverPick, UI.hoverX, UI.hoverY); }
      else if (UI.tab === 'overview' && ts - lastSvg > 120) { lastSvg = ts; L.plantSvg.update($('ov-plant'), S); }
      audioTick();
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ Start screen
  let startDiff = 'operator';
  function showStart() {
    UI.started = false; UI.paused = true;
    document.body.classList.add('pre');
    preview = L.sim.create({ seed: 4242, difficulty: 'operator' });
    if (W) { W.sel = null; W.camCtl.reset(); W.camCtl.want.dist = 175; W.camCtl.want.pitch = 0.62; }
    // A little life in the backdrop: the autopilot runs a shift that started an hour ago.
    if (L.autopilot) for (let i = 0; i < 180; i++) { L.autopilot.step(L, preview); L.sim.tick(preview, 20); }
    const seedVal = store('hmt-seed') || '';
    let h = '<div class="start-in"><div class="hero"><div><div class="eyebrow">HMT · day shift · 06:00–18:00</div><h1>Harrowmere LPG Terminal</h1>';
    h += '<p class="lede">Take the control room for twelve hours. Road tankers queue at the gate, rail cars of propane wait to be unloaded, contractors want permits, and the plant does what pressurised LPG does in the sun. Keep it safe, keep it moving, keep it by the book.</p></div>';
    h += W ? '<div></div></div>' : '<div class="plant-wrap" aria-hidden="true">' + L.plantSvg.build() + '</div></div>';
    h += '<div><h3 style="margin-bottom:8px">Choose your shift</h3><div class="diffs">';
    const desc = { trainee: 'Fewer trucks and faults. Hints on documents, presets and weighbridge checks. Auto-pause on critical alarms.', operator: 'A normal busy day. Hints on, auto-pause on critical alarms.', senior: 'Heavy traffic, more faults and permits, no hints, no auto-pause.' };
    for (const k of ['trainee', 'operator', 'senior']) h += '<button type="button" class="diff' + (startDiff === k ? ' on' : '') + '" data-s="diff" data-k="' + k + '"><b>' + D.DIFFICULTY[k].label + '</b><span>' + desc[k] + '</span><span class="small muted">' + D.DIFFICULTY[k].trucks + ' booked trucks · ' + D.DIFFICULTY[k].permits + ' permits</span></button>';
    h += '</div></div><div class="row"><label for="seed" class="small">Seed (blank for random)</label><input id="seed" type="number" min="1" style="width:140px" value="' + e(seedVal) + '"><label class="chk"><input type="checkbox" id="opt-sound" checked> Alarm horn</label><button type="button" class="btn" data-s="go" style="font-size:16px;padding:8px 18px">Take the shift</button></div>';
    h += '<div class="howto"><div><h4>Your site</h4>Drag to pan, right-drag (or two fingers) to rotate, scroll or pinch to zoom. Hover anyone or anything to see what it is doing. Select a field operator, then click a sphere, rail car, skid, detector or open ground to give an order.</div><div><h4>Your desk</h4>The <b>Needs you</b> panel lists every decision waiting on you and flies the camera there. Console pages slide in from the left menu. The alarm list sits along the bottom; click an alarm for its response procedure.</div>';
    h += '<div><h4>A truck\'s journey</h4>Inspect documents at the gate → weigh in → call to a bay → driver\'s checks → you set the preset and authorise → load → weigh out → you release it, or decant it if it is over the limit.</div>';
    h += '<div><h4>Rail and spheres</h4>Secure, sample and connect rail cars, then drive the compressor: liquid first, vapour recovery after. Gauge the spheres at the start and end of shift and watch for a radar that lies.</div>';
    h += '<div><h4>When it goes wrong</h4>A detector reading means a leak upwind. Stop transfers, isolate, keep people out of the cloud, cool what is exposed. The handbook explains every rule and the accidents behind them.</div></div></div>';
    $('start').hidden = false;
    $('start').className = 'start' + (W ? ' over-world' : '');
    $('start').innerHTML = h;
    if (!W) L.plantSvg.update($('start'), preview);
  }
  function startShift(diff, seed) {
    if (seed) store('hmt-seed', String(seed));
    S = L.sim.create({ difficulty: diff, seed: seed || undefined });
    preview = null;
    if (W) { W.sel = null; W.hover = null; W.camCtl.reset(); }
    UI.selCrew = null; UI.followKey = null; UI.sideMin = window.innerWidth < 760; UI.sideTab = 'needs';
    UI.tab = W ? 'site' : 'overview'; UI.sel = {}; UI.hist = {}; UI.lastHist = -1e9; UI.seenToast = S.toastSeq; UI.drafts = {}; UI.modal = null; UI.pauseReason = null; UI.silencedSeq = 0;
    UI.started = true; UI.paused = false; UI.speed = 30;
    document.body.classList.remove('pre');
    UI.alarmMin = window.innerWidth < 640;
    mountedTab = null;
    $('start').hidden = true;
    $('start').innerHTML = '';
    audioInit();
    window.LPG.S = S;
    renderAll();
  }
  function onStartClick(ev) {
    const el = ev.target.closest('[data-s]');
    if (!el) return;
    if (el.getAttribute('data-s') === 'diff') {
      startDiff = el.getAttribute('data-k');
      document.querySelectorAll('.diff').forEach((d) => d.classList.toggle('on', d.getAttribute('data-k') === startDiff));
    } else if (el.getAttribute('data-s') === 'go') {
      const sv = +document.getElementById('seed').value;
      UI.sound = document.getElementById('opt-sound').checked;
      startShift(startDiff, sv > 0 ? Math.floor(sv) : undefined);
    }
  }

  // ------------------------------------------------------------------ World pointer handling
  function worldInput() {
    const cv = W.renderer.domElement;
    let lastMove = 0, downAt = null;
    cv.addEventListener('pointermove', (ev) => {
      UI.hoverX = ev.clientX; UI.hoverY = ev.clientY;
      const now = performance.now();
      if (now - lastMove < 50 || !S || !UI.started) return;
      lastMove = now;
      const p = W.pick(ev.clientX, ev.clientY);
      W.hover = p && p.kind !== 'ground' && p.kind !== 'icon' ? p : null;
      UI.hoverPick = p && p.kind !== 'ground' ? p : null;
      cv.style.cursor = UI.hoverPick ? 'pointer' : UI.selCrew ? 'crosshair' : 'grab';
      L.hud.tooltip(S, UI.hoverPick, ev.clientX, ev.clientY);
    });
    cv.addEventListener('pointerleave', () => { $('tip').hidden = true; UI.hoverPick = null; W.hover = null; });
    cv.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY, b: ev.button }; $('ctx').hidden = true; });
    cv.addEventListener('pointerup', (ev) => {
      if (!downAt || !S || !UI.started) return;
      const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6 || W.camCtl.dragged;
      const b = downAt.b; downAt = null;
      if (moved) return;
      const p = W.pick(ev.clientX, ev.clientY);
      worldClick(p, ev.clientX, ev.clientY, b);
      renderAll();
    });
    cv.addEventListener('dblclick', (ev) => { const p = W.pick(ev.clientX, ev.clientY); if (p && p.point) W.camCtl.focus(p.point.x, p.point.z, Math.min(W.camCtl.want.dist, 60)); });
    W.onThunder = (km) => thunder(km);
  }
  function worldClick(p, cx, cy, button) {
    $('ctx').hidden = true;
    if (!p) return;
    if (p.kind === 'icon') return iconClick(p.id);
    if (UI.selCrew && p.kind !== 'crew') { L.hud.showOrders(S, UI.selCrew, p, cx, cy); return; }
    if (button === 2) return;
    if (p.kind === 'ground') { UIA.deselect(); return; }
    W.sel = { kind: p.kind, id: p.id, key: p.key, pos: p.pos ? { x: p.pos.x, z: p.pos.z } : null };
    UI.selCrew = p.kind === 'crew' ? p.id : null;
    if (UI.followKey && UI.followKey !== p.key) { UI.followKey = null; W.camCtl.follow = null; }
  }
  function iconClick(key) {
    const m = (re) => key.match(re);
    let r;
    if (key === 'gate') { const q = S.trucks.find((t) => t.state === 'QUEUE'); if (q) UI.modal = { type: 'truck', id: q.id }; return; }
    if ((r = m(/^bay(\d)/)) || (r = m(/^eng(\d)/))) return UIA.nav('rack', +r[1]);
    if (m(/^rel/)) return UIA.nav('gate');
    if (m(/^pl/)) return UIA.nav('utilities');
    if (m(/^(gd|fire|inj)/)) return UIA.nav('fg');
    if (m(/^(car|comp)/)) return UIA.nav('rail');
    if ((r = m(/^pm(.+)/))) return UIA.nav('permits', r[1]);
    if ((r = m(/^tk(.+)/))) return UIA.nav('tanks', r[1]);
  }
  function thunder(km) {
    if (!actx || !UI.sound) return;
    try {
      const len = 2.4, sr = actx.sampleRate, buf = actx.createBuffer(1, sr * len, sr), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = actx.createBufferSource(); src.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
      const g = actx.createGain(); const now = actx.currentTime + Math.min(3, km / 3);
      g.gain.setValueAtTime(0, actx.currentTime); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.25 * Math.max(0.2, 1 - km / 25), now + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, now + len);
      src.connect(f); f.connect(g); g.connect(actx.destination); src.start(now);
    } catch (err) { /* audio is optional */ }
  }

  function boot() {
    W = L.world ? L.world.init($('world')) : null;
    if (W) { worldInput(); L.hud.minimapMount($('minimap')); L.app.world = W; }
    else { TABS = TABS.filter((t) => t[0] !== 'site'); document.body.classList.add('no-world'); }
    $('minimap').addEventListener('click', (ev) => { if (!W) return; const p = L.hud.minimapClick($('minimap'), ev); if (p) { W.camCtl.focus(p.x, p.z); W.camCtl.follow = null; } });
    document.getElementById('ctx').addEventListener('click', onClick);
    document.getElementById('inspector').addEventListener('click', onClick);
    const th = store('hmt-theme');
    if (th === 'dark' || th === 'light') document.documentElement.setAttribute('data-theme', th);
    document.getElementById('app').addEventListener('click', onClick);
    document.getElementById('modal').addEventListener('click', onClick);
    document.getElementById('pausebar').addEventListener('click', onClick);
    document.getElementById('lesson').addEventListener('click', onClick);
    document.getElementById('start').addEventListener('click', onStartClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', (ev) => { UI.pressed = ev.target; }, true);
    const release = () => setTimeout(() => { UI.pressed = null; }, 0);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    showStart();
    requestAnimationFrame(frame);
  }

  L.app = { boot, UIA, attention, get S() { return S; }, get W() { return W; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(globalThis.LPG = globalThis.LPG || {});
