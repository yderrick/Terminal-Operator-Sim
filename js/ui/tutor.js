/* Guided shift: an intro tour, then live narration of every decision the crew makes, with the camera on the action. */
(function (L) {
  'use strict';
  const U = L.util;
  const { UI, e } = L.ui;

  const INTRO = [
    { title: 'Welcome to Harrowmere LPG Terminal', cam: [150, 92, 230, 0.95, -0.35], body: 'Liquefied petroleum gas — propane and butane — arrives here by rail, is stored under pressure, and leaves in road tankers. An experienced crew is about to run a twelve-hour day shift. Just watch: every decision they make is explained on cards like this one. You can pause, look around with the mouse, or take over at any moment.' },
    { title: 'The spheres', cam: [70, 44, 95, 0.55, -0.2], body: 'These three spheres hold about 1,400 tonnes of LPG as a liquid under its own vapour pressure — around 7 bar for propane on a mild day. The pressure depends on the temperature of the liquid, not on how full the sphere is. That is why they are painted white and ringed with red deluge pipes. The tags show level, pressure and temperature live.' },
    { title: 'Pumps and the pipe rack', cam: [80, 80, 80, 0.6, 0.3], body: 'Loading pumps draw liquid from the bottom of a sphere and push it along the yellow pipes on the rack to the loading bays. A green lamp means a pump is running. Glowing dots travel along a pipe only while product is really moving.' },
    { title: 'The loading rack', cam: [213, 82, 85, 0.6, -0.5], body: 'Four bays. A tanker drives in, the driver earths it, connects a liquid arm and a vapour-return arm, and the control room authorises a preset quantity. Watch the arms swing onto the truck while it loads.' },
    { title: 'Gate and weighbridges', cam: [235, 150, 90, 0.7, -0.6], body: 'Every tanker\'s documents are checked at the gate before it is let in. It is weighed on the way in (WB-1) and again on the way out (WB-2). The outbound weighbridge is the last check before an overloaded tanker reaches public roads.' },
    { title: 'The rail siding', cam: [66, 132, 90, 0.6, 0.2], body: 'Rail cars of propane are unloaded by compressor, not pump. Pushing vapour into the top of the car drives the liquid out through a pipe to the sphere. Afterwards the compressor is reversed to recover the vapour left in the "empty" car.' },
    { title: 'The people', cam: [150, 140, 70, 0.6, -0.3], body: 'Orange coveralls are field operators, your hands on the plant. Drivers wear blue, contractors have green helmets, and the gate guard wears a cap. Hover over anyone to see what they are doing. In a normal game you select a field operator and click something to give them an order.' },
    { title: 'Your screen', cam: [150, 92, 230, 0.95, -0.35], body: 'Top: the clock, game speed and your three scores — safety, throughput and compliance. Right: "Needs you", every decision waiting for you. Bottom: the alarm list. Left: console pages with full detail. Bottom right: the map and view buttons. Try "Underground" to see the buried pipes, and "Levels" to see inside the tanks.' },
    { title: 'The shift starts now', cam: null, body: 'Each card pauses the action briefly so you can read it. Press Next to move on, or untick "Pause on each card" to let it flow. Smaller events scroll past under "Meanwhile". Press "Take over" whenever you want to run the terminal yourself.' },
  ];
  // Keys that always deserve a full card, however often they happen.
  const ALWAYS = /^(gate-reject|decant|hold:|permit-reject|permit-simops|permit-issue|radar|rail-reject|gas-|fire-|esd-reset|lightning|ask|comp-high|alarm:|lesson:|wbzero|odor)/;

  const T = { active: false, intro: -1, queue: [], cur: null, curStart: 0, curDur: 8, lastNarr: 0, lastLog: 0, seen: {}, follow: true, hold: true, ticker: [], held: false };

  function begin(S) {
    Object.assign(T, { active: true, intro: 0, queue: [], cur: null, lastNarr: S.narrSeq, lastLog: S.logSeq, seen: {}, ticker: [], held: false });
    UI.tutorHold = true;
    showIntro();
  }
  function end() { T.active = false; T.cur = null; T.queue = []; UI.tutorHold = false; const el = document.getElementById('tutor'); if (el) { el.hidden = true; el.innerHTML = ''; } }

  function camTo(c) {
    const W = L.app.W;
    if (!W || !c) return;
    W.camCtl.follow = null;
    W.camCtl.focus(c[0], c[1], c[2]);
    if (c[3] !== undefined) W.camCtl.want.pitch = c[3];
    if (c[4] !== undefined) W.camCtl.want.yaw = c[4];
  }
  function showIntro() {
    const it = INTRO[T.intro];
    if (!it) return;
    if (it.cam) camTo(it.cam);
    T.cur = { intro: true, title: it.title, why: it.body };
    T.curStart = performance.now();
    T.curDur = 1e9;
    render();
  }

  // Turn simulation events into cards (important or first time) or ticker lines.
  function collect(S) {
    for (const n of S.narration) {
      if (n.id <= T.lastNarr) continue;
      T.lastNarr = n.id;
      if (!n.title) continue;
      const card = ALWAYS.test(n.key) || !T.seen[n.key];
      T.seen[n.key] = true;
      if (card && n.why) T.queue.push({ eyebrow: L.autopilot.CAT_LABEL[n.cat] || 'Operations', title: n.title, why: n.why, loc: n.loc, t: n.t, decision: L.autopilot.DECIDE.has(n.cat) });
      else ticker(S, n.title, n.t);
    }
    for (const l of S.lessons) if (!l.read) { l.read = true; T.queue.push({ eyebrow: 'Lesson', title: l.title, why: l.body, t: l.t }); }
    for (const l of S.log) {
      if (l.id <= T.lastLog) continue;
      T.lastLog = l.id;
      if (l.cat === 'gate' && /arrived at the gate/.test(l.text) && !T.seen.arrive) { T.seen.arrive = true; T.queue.push({ eyebrow: 'Gate', title: 'A road tanker has arrived', why: 'The driver hands over the documents at the gatehouse. Before the truck may enter, the crew check them against today\'s date and the booking. Watch what they decide.', loc: { x: 278, z: 162 }, t: l.t }); }
      else if (l.cat === 'rail' && /placed at spot/.test(l.text) && !T.seen.railArrive) { T.seen.railArrive = true; T.queue.push({ eyebrow: 'Rail', title: 'Rail cars shunted in', why: 'A locomotive has pushed two propane tank cars into the siding. Each holds about 45 tonnes. The free time to unload them is six hours; after that the railway charges demurrage by the hour.', loc: { x: 66, z: 140 }, t: l.t }); }
      else if (l.cat === 'weather' && /thunderstorm/.test(l.text)) T.queue.push({ eyebrow: 'Weather', title: 'Thunderstorm on the way', why: 'The lightning detector is tracking a storm. If strikes come within 10 km, every transfer must stop until 30 minutes after the last strike inside that radius.', t: l.t });
      else if (l.cat === 'alarm' && /^ALM P1/.test(l.text)) { const k = 'alarm:' + l.text.slice(0, 40); if (!T.seen[k]) { T.seen[k] = true; T.queue.push({ eyebrow: 'Critical alarm', title: l.text.replace(/^ALM P1 /, ''), why: 'Critical alarms are the ones that need action in minutes. Watch how the crew respond, then click the alarm in the list below to read its response procedure.', t: l.t }); } }
      else if (l.cat === 'safety' && /IGNITION|INJURED|BLEVE/.test(l.text)) T.queue.push({ eyebrow: 'Incident', title: l.text, why: 'This is what the safety systems and procedures exist to prevent.', t: l.t });
      else if (l.cat === 'radio' && T.ticker.length < 2 && Math.random() < 0.2) ticker(S, l.text, l.t);
    }
    if (T.queue.length > 6) {
      // Never let the backlog run away: keep decisions and the newest, demote the rest to the ticker.
      const keep = T.queue.filter((q) => q.decision || q.eyebrow === 'Lesson' || q.eyebrow === 'Incident').slice(-4);
      for (const q of T.queue) if (!keep.includes(q)) ticker(S, q.title, q.t);
      T.queue = keep;
    }
  }
  function ticker(S, text, t) {
    T.ticker.unshift({ text, t });
    if (T.ticker.length > 4) T.ticker.length = 4;
  }

  function frame(S) {
    if (!T.active || !S) return;
    if (T.intro >= 0) return;
    collect(S);
    const now = performance.now();
    if (T.cur && now - T.curStart > T.curDur * 1000) next();
    if (!T.cur && T.queue.length) {
      T.cur = T.queue.shift();
      T.curStart = now;
      const words = (T.cur.title + ' ' + (T.cur.why || '')).split(/\s+/).length;
      T.curDur = U.clamp(words / 3.3, 6, 18);
      const W = L.app.W;
      if (T.follow && W && T.cur.loc) {
        W.camCtl.follow = null;
        W.camCtl.focus(T.cur.loc.x, T.cur.loc.z, 72);
        if (T.cur.loc.kind && T.cur.loc.kind !== 'ground') W.sel = { kind: T.cur.loc.kind, id: T.cur.loc.id, key: T.cur.loc.key || null, pos: { x: T.cur.loc.x, z: T.cur.loc.z } };
      }
    }
    UI.tutorHold = T.hold && !!T.cur;
    render();
  }
  function next() {
    if (T.intro >= 0) {
      T.intro++;
      if (T.intro >= INTRO.length) { T.intro = -1; T.cur = null; UI.tutorHold = false; render(); return; }
      showIntro();
      return;
    }
    T.cur = null;
    UI.tutorHold = false;
    render();
  }
  function back() { if (T.intro > 0) { T.intro--; showIntro(); } }

  function render() {
    const el = document.getElementById('tutor');
    if (!el) return;
    if (!T.active) { el.hidden = true; return; }
    const S = L.app.S;
    el.hidden = false;
    const c = T.cur;
    let h = '<div class="tut-in">';
    if (c) {
      const el2 = c.intro ? 'Tour ' + (T.intro + 1) + ' of ' + INTRO.length : (S ? U.clock(S, c.t) + ' · ' : '') + e(c.eyebrow || '');
      h += '<div class="tut-eyebrow">' + (c.decision ? '<span class="pill p4">Decision</span> ' : '') + el2 + '</div><h3>' + e(c.title) + '</h3><p>' + e(c.why || '') + '</p>';
      if (!c.intro) h += '<div class="tut-bar"><i></i></div>';
    } else {
      h += '<div class="tut-eyebrow">Guided shift' + (S ? ' · ' + U.clock(S) : '') + '</div><p class="tut-idle">The crew are working. The next decision will appear here.</p>';
    }
    if (T.ticker.length && T.intro < 0) h += '<div class="tut-tick"><b>Meanwhile</b>' + T.ticker.map((x) => '<div><span>' + (S ? U.clock(S, x.t) : '') + '</span> ' + e(x.text) + '</div>').join('') + '</div>';
    h += '<div class="tut-btns">';
    if (T.intro > 0) h += '<button type="button" class="btn sm quiet" data-a="ui:tutBack">‹ Back</button>';
    if (c) h += '<button type="button" class="btn sm" data-a="ui:tutNext">' + (T.intro === INTRO.length - 1 ? 'Start the shift' : 'Next ›') + '</button>';
    if (T.intro < 0) {
      h += '<label class="chk"><input type="checkbox" id="tut-hold"' + (T.hold ? ' checked' : '') + ' data-a="ui:tutHold"> Pause on each card</label>';
      h += '<label class="chk"><input type="checkbox" id="tut-follow"' + (T.follow ? ' checked' : '') + ' data-a="ui:tutFollow"> Camera follows</label>';
    }
    h += '<span class="tut-sp"></span><button type="button" class="btn sm ghost" data-a="ui:tutTakeover">Take over</button><button type="button" class="btn sm quiet" data-a="ui:tutExit">Exit tutorial</button></div></div>';
    L.ui.setHTML(el, h);
    // The countdown bar moves every frame; set it directly so the card's buttons are not rebuilt.
    const bar = el.querySelector('.tut-bar i');
    if (bar && c && !c.intro) bar.style.width = (Math.min(1, (performance.now() - T.curStart) / (T.curDur * 1000)) * 100).toFixed(1) + '%';
  }

  L.tutor = { T, begin, end, frame, next, back, render, INTRO };
})(globalThis.LPG = globalThis.LPG || {});
