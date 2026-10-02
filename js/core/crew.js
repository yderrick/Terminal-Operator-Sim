/* Field operators: dispatched from the control room, walk to the job, work, report by radio. */
(function (L) {
  'use strict';
  const U = L.util, D = L.data, sim = L.sim;
  const WALK = 1.25; // m/s

  sim.register({
    name: 'crew', order: 50,
    init(S) {
      const cr = D.POINTS.control;
      S.crew = D.PEOPLE.crew.map((c, i) => ({ id: c.id, name: c.name, call: c.call, x: cr.x - 3 + i * 6, y: cr.y - 4, state: 'idle', task: null, queue: [], injured: false, exposure: 0, backedOut: 0 }));
    },
    tick(S, dt) {
      for (const c of S.crew) {
        if (c.injured) continue;
        const lel = L.plant.lelAt(S, c.x, c.y);
        c.lel = lel;
        // Personal gas monitor: back out of a flammable atmosphere.
        if (lel >= 20 && c.state !== 'retreat') {
          c.backedOut++;
          if (lel >= 40 && !c.expPen) {
            c.expPen = true;
            sim.score(S, 'safety', -6, c.call + ' walked into ' + Math.round(lel) + '% LEL', 'Send field operators toward a suspected leak from upwind, with a personal four-gas monitor, and never into a cloud the fixed detectors already show above 20% LEL.');
          }
          sim.radio(S, c.call, 'My personal monitor is alarming — ' + Math.round(lel) + '% LEL. Backing out upwind.');
          if (c.task && c.task.kind !== 'muster') c.queue.unshift(c.task);
          retreat(S, c);
        }
        if (lel < 10) c.expPen = false;
        if (c.state === 'walk' || c.state === 'retreat') {
          const tx = c.target.x, ty = c.target.y;
          const d = U.dist(c.x, c.y, tx, ty);
          const step = WALK * dt;
          if (d <= step) {
            c.x = tx; c.y = ty;
            if (c.state === 'retreat') { c.state = 'idle'; c.task = null; c.retreated = S.t; }
            else { c.state = 'work'; c.workT = S.t; }
          } else { c.x += (tx - c.x) / d * step; c.y += (ty - c.y) / d * step; }
        } else if (c.state === 'work') {
          if (c.task.kind === 'firewatch' || c.task.kind === 'muster') { /* persistent until released */ }
          else if (S.t - c.workT >= c.task.work) {
            const t = c.task;
            c.task = null; c.state = 'idle';
            try { t.done && t.done(S, c); } catch (e) { console.error(e); }
          }
        } else if (c.state === 'idle') {
          if (c.queue.length && !S.muster.active && (!c.retreated || S.t - c.retreated > 120)) {
            const t = c.queue.shift();
            if (L.plant.lelAt(S, t.x, t.y) < 20) start(S, c, t); else c.queue.unshift(t);
          } else if (!c.task && U.dist(c.x, c.y, D.POINTS.control.x, D.POINTS.control.y) > 8 && !S.muster.active) {
            c.state = 'walk'; c.target = { x: D.POINTS.control.x + (c.id === 'FO1' ? -3 : 3), y: D.POINTS.control.y - 4 };
            c.task = { kind: 'return', label: 'Returning to control room', x: c.target.x, y: c.target.y, work: 0 };
          }
          if (c.task && c.task.kind === 'return' && c.state === 'idle') c.task = null;
        }
      }
    },
  });

  function retreat(S, c) {
    // Move upwind 30 m.
    const W = S.weather;
    const from = W.windDir * Math.PI / 180;
    const ux = Math.sin(from), uy = -Math.cos(from);
    c.target = { x: U.clamp(c.x + ux * 30, 4, D.SITE.w - 4), y: U.clamp(c.y + uy * 30, 4, D.SITE.h - 4) };
    c.state = 'retreat';
    c.task = { kind: 'retreat', label: 'Backing out upwind', x: c.target.x, y: c.target.y, work: 0 };
  }

  function start(S, c, task) {
    c.task = task;
    c.state = 'walk';
    c.target = { x: task.x, y: task.y };
    const d = U.dist(c.x, c.y, task.x, task.y);
    sim.radio(S, c.call, 'Copy. On my way to ' + task.label.toLowerCase() + ' — about ' + U.dur(d / WALK) + ' walk.');
  }

  // Dispatch: pick a crew member (or the given one). Queue if everyone is busy.
  function dispatch(S, crewId, task) {
    if (S.muster.active) return { ok: false, msg: 'Muster in progress — crew are at the muster point.' };
    let c = crewId ? S.crew.find((x) => x.id === crewId) : null;
    const avail = S.crew.filter((x) => !x.injured);
    if (!avail.length) return { ok: false, msg: 'No field operators available.' };
    if (!c) {
      c = avail.find((x) => x.state === 'idle' && !x.queue.length && !x.task) || avail.slice().sort((a, b) => a.queue.length - b.queue.length)[0];
    }
    if (c.injured) return { ok: false, msg: c.call + ' is injured.' };
    if (L.plant.lelAt(S, task.x, task.y) >= 20) {
      sim.score(S, 'safety', -3, 'Dispatched ' + c.call + ' into an area with ' + Math.round(L.plant.lelAt(S, task.x, task.y)) + '% LEL', 'Do not send people into a gas cloud. Isolate remotely first.');
    }
    if (c.state === 'idle' && !c.task) { start(S, c, task); return { ok: true, msg: c.call + ' dispatched: ' + task.label + '.' }; }
    c.queue.push(task);
    sim.log(S, 'radio', c.call + ' has the job queued: ' + task.label + ' (' + c.queue.length + ' in queue).');
    return { ok: true, msg: c.call + ' busy — queued: ' + task.label + '.' };
  }
  function musterAll(S) {
    for (const c of S.crew) {
      if (c.injured) continue;
      if (c.task && !['muster', 'return', 'retreat', 'firewatch'].includes(c.task.kind)) c.queue.unshift(c.task);
      c.task = { kind: 'muster', label: 'Muster point', x: D.POINTS.muster.x, y: D.POINTS.muster.y, work: 0 };
      c.state = 'walk'; c.target = { x: D.POINTS.muster.x + (c.id === 'FO1' ? -2 : 2), y: D.POINTS.muster.y };
    }
  }
  function injure(S, c, why) {
    if (c.injured) return;
    c.injured = true; c.state = 'injured'; c.task = null; c.queue = [];
    S.stats.injuries = (S.stats.injuries || 0) + 1;
    S.stats.incidents++;
    sim.log(S, 'safety', c.name + ' (' + c.call + ') INJURED — ' + why + '. Casualty evacuation requested.', 'crit');
    sim.score(S, 'safety', -35, c.call + ' injured: ' + why, 'People are the first priority. Withdraw them from danger before the situation escalates and never send anyone toward an active release.');
  }

  const A = sim.action;
  A('crewCancel', (S, crewId) => {
    const c = S.crew.find((x) => x.id === crewId);
    if (!c || c.injured) return { ok: false };
    if (c.task && c.task.kind === 'firewatch') return { ok: false, msg: c.call + ' is on fire watch for a permit — suspend or close the permit to release them.' };
    if (c.task && c.task.cancel) c.task.cancel(S, c);
    c.queue = []; c.task = null; c.state = 'idle';
    sim.radio(S, c.call, 'Copy, standing down.');
    return { ok: true };
  });
  A('crewClearMuster', (S) => {
    for (const c of S.crew) if (c.task && c.task.kind === 'muster') { c.task = null; c.state = 'idle'; }
    return { ok: true };
  });
  // Generic investigation of a location (alarm follow-up).
  A('crewInvestigate', (S, crewId, x, y, label) => {
    return dispatch(S, crewId, {
      kind: 'investigate', label: 'Investigate ' + label, x, y, work: 4 * 60,
      done: (S2, c) => L.events.investigateReport(S2, c, x, y, label),
    });
  });

  L.crewMod = { dispatch, musterAll, injure, WALK };
})(globalThis.LPG = globalThis.LPG || {});
