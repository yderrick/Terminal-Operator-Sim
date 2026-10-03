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

// The competent operator lives in js/core/autopilot.js so the game can use it too.
function goodBot(L, S, style) { return L.autopilot.step(L, S, style); }

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
