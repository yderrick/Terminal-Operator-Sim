/* Simulation core: state container, clock, logging, alarms, scoring hooks, action dispatch. */
(function (L) {
  'use strict';
  const U = L.util;

  const systems = []; // { name, order, init(S), tick(S, dt) }
  const actions = {}; // name -> fn(S, ...args) => { ok, msg }

  function register(sys) { systems.push(sys); systems.sort((a, b) => a.order - b.order); }
  function action(name, fn) { actions[name] = fn; }

  function create(opts) {
    opts = opts || {};
    const seed = (opts.seed >>> 0) || (Math.floor(Math.random() * 1e9) >>> 0);
    // A config (from the settings screen) overrides the base difficulty field by field.
    const cfg = opts.config ? Object.assign({}, L.data.PRESETS.normal, opts.config) : null;
    const diffKey = cfg ? (cfg.base || 'operator') : (opts.difficulty || 'operator');
    const base = L.data.DIFFICULTY[diffKey];
    const diff = cfg ? Object.assign({}, base, L.data.FAULTS[cfg.faults] || {}, {
      label: cfg.label || base.label, trucks: cfg.trucks, permits: cfg.permits, storm: L.data.WEATHER[cfg.weather] !== undefined ? L.data.WEATHER[cfg.weather] : base.storm,
      hints: cfg.hints, autoPause: cfg.autoPause, unbooked: Math.max(0, Math.round(cfg.trucks / 9)),
    }) : base;
    const today = opts.date ? new Date(opts.date) : new Date();
    today.setHours(0, 0, 0, 0);
    const S = {
      version: 1,
      seed, rng: U.makeRng(seed), difficulty: cfg ? (opts.preset || 'custom') : diffKey, diff,
      cfg: Object.assign({ crew: 2, autonomy: 'off', approvals: 'wait', rail: 2, weather: null }, cfg || {}),
      date: today.getTime(),
      startHour: opts.startHour === undefined ? 6 : opts.startHour,
      shiftLen: 12 * 3600, t: 0, over: false, endReason: null, outcome: null,
      log: [], logSeq: 0, alarms: [], alarmHistory: [], alarmSeq: 0,
      toasts: [], toastSeq: 0, lessonsSeen: {}, lessons: [], pauseReq: null,
      score: { safety: 100, compliance: 100, events: [] },
      stats: { dispatched: 0, received: 0, trucksOut: 0, trucksRejected: 0, rejectedValid: 0, turnaround: [], vented: 0, alarmsRaised: 0, ackTimes: [], unackCritSec: 0, complaints: 0, demurrageH: 0, nearMisses: 0, incidents: 0, overfills: 0, lpgDispatchedByProduct: { propane: 0, butane: 0 } },
      hornActive: false, hornPri: 4,
      flags: {},
      settings: { autoPause: !!diff.autoPause, hints: !!diff.hints },
      approvals: [], approvalSeq: 0, narration: [], narrSeq: 0, touch: {},
    };
    for (const sys of systems) if (sys.init) sys.init(S);
    log(S, 'system', 'Shift started — ' + L.data.SITE.name + ', ' + S.diff.label + ' difficulty, seed ' + seed + '.');
    return S;
  }

  // Advance simulation by dt seconds, sub-stepping for stability.
  function tick(S, dt) {
    if (S.over) return;
    let remaining = dt;
    while (remaining > 1e-6 && !S.over) {
      const h = Math.min(remaining, 2);
      S.t += h;
      for (const sys of systems) {
        try { sys.tick(S, h); } catch (e) {
          if (!S._errLogged) { S._errLogged = true; console.error('System ' + sys.name + ' failed', e); }
          throw e;
        }
      }
      remaining -= h;
      if (S.t >= S.shiftLen && !S.over) endShift(S, 'complete');
    }
  }

  function endShift(S, reason, outcome) {
    if (S.over) return;
    S.over = true;
    S.endReason = reason;
    S.outcome = outcome || (reason === 'complete' ? 'completed' : 'terminated');
    log(S, 'system', reason === 'complete' ? 'End of shift. Handing over to the night shift.' : 'Shift terminated: ' + reason, reason === 'complete' ? 'info' : 'crit');
    if (L.report) S.report = L.report.build(S);
  }

  function act(S, name) {
    const fn = actions[name];
    if (!fn) return { ok: false, msg: 'Unknown action ' + name };
    if (S.over) return { ok: false, msg: 'The shift has ended.' };
    const args = Array.prototype.slice.call(arguments, 2);
    // Remember what the player did by hand so the crew does not immediately undo it.
    if (!S._ap && S.touch) S.touch[name + ':' + JSON.stringify(args[0])] = S.t;
    let res;
    try { res = fn.apply(null, [S].concat(args)) || { ok: true }; } catch (e) {
      if (L.sim.strict) throw e;
      console.error('Action ' + name + ' failed', e);
      res = { ok: false, msg: 'That command could not be carried out.' };
    }
    if (res.msg) toast(S, res.msg, res.ok ? 'ok' : 'warn');
    return res;
  }

  // ---- Logbook -------------------------------------------------------------------
  function log(S, cat, text, level) {
    S.log.push({ id: ++S.logSeq, t: S.t, cat, text, level: level || 'info' });
    if (S.log.length > 1500) S.log.splice(0, S.log.length - 1500);
  }
  function radio(S, who, text) { log(S, 'radio', who + ': “' + text + '”'); }
  function toast(S, text, kind) {
    S.toasts.push({ id: ++S.toastSeq, t: S.t, text, kind: kind || 'info' });
    if (S.toasts.length > 30) S.toasts.shift();
  }
  // Teaching moment, shown once per id.
  function lesson(S, id, title, body) {
    if (S.lessonsSeen[id]) return;
    S.lessonsSeen[id] = true;
    S.lessons.push({ id, t: S.t, title, body, read: false });
  }
  function requestPause(S, reason) {
    if (S.settings && S.settings.autoPause) S.pauseReq = reason;
  }

  // ---- Scoring -------------------------------------------------------------------
  // cat: 'safety' | 'compliance' | 'throughput'. pts negative for penalties.
  function score(S, cat, pts, text, lessonText) {
    S.score.events.push({ t: S.t, cat, pts, text, lesson: lessonText || '' });
    if (cat === 'safety') S.score.safety = U.clamp(S.score.safety + pts, 0, 100);
    else if (cat === 'compliance') S.score.compliance = U.clamp(S.score.compliance + pts, 0, 100);
    log(S, 'score', (pts >= 0 ? '+' : '') + pts + ' ' + cat + ': ' + text, pts < 0 ? 'warn' : 'info');
  }
  function throughputScore(S) {
    const target = S.target;
    // Live value is pro-rated to the elapsed shift so the bar means something mid-shift.
    const elapsed = S.over ? S.shiftLen : Math.max(S.t, 3 * 3600);
    const base = Math.min(110, 100 * S.stats.dispatched / (target * elapsed / S.shiftLen));
    let pen = 0;
    for (const e of S.score.events) if (e.cat === 'throughput') pen += e.pts;
    return U.clamp(base + pen, 0, 110);
  }

  // ---- Alarms (ISA-18.2 states) ---------------------------------------------------
  // Condition-driven: call every tick with active true/false. key must be unique per condition.
  function setAlarm(S, key, defKey, tag, active, detail) {
    let a = S.alarms.find((x) => x.key === key);
    if (active) {
      if (!a) {
        const def = L.data.ALARMS[defKey];
        a = { id: ++S.alarmSeq, key, defKey, tag, pri: def.pri, name: def.name, detail: detail || '', tIn: S.t, active: true, acked: false, tAck: null, shelvedUntil: 0 };
        S.alarms.push(a);
        S.stats.alarmsRaised++;
        log(S, 'alarm', 'ALM P' + def.pri + ' ' + tag + ' ' + def.name + (detail ? ' — ' + detail : ''), def.pri <= 1 ? 'crit' : def.pri === 2 ? 'warn' : 'info');
        if (def.pri <= 1) requestPause(S, tag + ' ' + def.name);
      } else if (!a.active) {
        // Re-alarm after return to normal.
        a.active = true; a.acked = false; a.tIn = S.t; a.tAck = null;
        S.stats.alarmsRaised++;
        log(S, 'alarm', 'ALM P' + a.pri + ' ' + tag + ' ' + a.name + ' (re-alarm)', a.pri <= 1 ? 'crit' : 'warn');
        if (a.pri <= 1) requestPause(S, tag + ' ' + a.name);
      } else if (detail) a.detail = detail;
    } else if (a && a.active) {
      a.active = false;
      a.tRtn = S.t;
      log(S, 'alarm', 'RTN ' + tag + ' ' + a.name);
      if (a.acked) retire(S, a);
    }
  }
  function retire(S, a) {
    const i = S.alarms.indexOf(a);
    if (i >= 0) S.alarms.splice(i, 1);
    S.alarmHistory.push(a);
    if (S.alarmHistory.length > 400) S.alarmHistory.shift();
  }
  function ackAlarm(S, id) {
    const a = S.alarms.find((x) => x.id === id);
    if (!a || a.acked) return;
    a.acked = true; a.tAck = S.t;
    S.stats.ackTimes.push(S.t - a.tIn);
    if (!a.active) retire(S, a);
  }
  function alarmTick(S, dt) {
    let horn = false, hornPri = 4;
    for (const a of S.alarms) {
      if (!a.acked && a.shelvedUntil <= S.t) {
        horn = true; hornPri = Math.min(hornPri, a.pri);
        if (a.pri === 1) S.stats.unackCritSec += dt;
      }
    }
    S.hornActive = horn; S.hornPri = hornPri;
    // Unacknowledged critical alarm penalty: every 5 sim-minutes left unacknowledged.
    for (const a of S.alarms) {
      if (a.pri === 1 && !a.acked) {
        const age = S.t - a.tIn;
        const n = Math.floor(age / 300);
        if (n > (a._penN || 0)) {
          a._penN = n;
          score(S, 'compliance', -2, 'Critical alarm ' + a.tag + ' unacknowledged for ' + U.dur(age), 'Acknowledge critical alarms promptly; an unacknowledged alarm tells your team nobody is responding.');
        }
      }
    }
  }
  register({ name: 'alarms', order: 90, tick: alarmTick });

  L.sim = { create, tick, act, endShift, register, action, actions, systems, log, radio, toast, lesson, score, throughputScore, setAlarm, ackAlarm, requestPause };
})(globalThis.LPG = globalThis.LPG || {});
