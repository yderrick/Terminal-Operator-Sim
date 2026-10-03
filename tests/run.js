// Headless regression: plays full shifts with scripted operators across seeds and difficulties.
'use strict';
const H = require('./harness.js');
let fail = 0;
function check(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
for (const diff of ['trainee', 'operator', 'senior']) {
  for (const seed of [3, 17, 101]) {
    check('good operator completes shift — ' + diff + ' seed ' + seed, () => {
      const { S } = H.runShift({ seed, difficulty: diff });
      if (S.outcome !== 'completed') throw new Error('ended: ' + S.endReason);
      if (S.report.safety < 70) throw new Error('safety ' + S.report.safety);
      if (S.report.kpi.trucksOut < 5) throw new Error('only ' + S.report.kpi.trucksOut + ' trucks out');
    });
  }
}
check('idle operator: plant stays physically sane', () => { H.runShift({ seed: 5, bot: H.idleBot }); });
check('reckless operator: incidents are scored', () => {
  const { S } = H.runShift({ seed: 21, bot: H.recklessBot });
  if (S.score.safety > 40) throw new Error('reckless play kept safety at ' + S.score.safety);
});
for (const seed of [41, 42, 43]) check('random clicks do not crash — seed ' + seed, () => {
  const err = console.error;
  console.error = () => {}; // the monkey sends nonsense arguments on purpose; rejected actions are expected
  try { H.runShift({ seed, difficulty: 'senior', bot: H.monkeyBot }); } finally { console.error = err; }
});
// Crew autonomy: a player who never clicks anything.
for (const preset of ['easy', 'tutorial']) {
  check('autonomous crew run the shift with an idle player — ' + preset, () => {
    const { S } = H.runShift({ seed: 9, config: preset, bot: H.idleBot });
    if (S.outcome !== 'completed') throw new Error('ended: ' + S.endReason);
    if (S.report.kpi.trucksOut < 5) throw new Error('only ' + S.report.kpi.trucksOut + ' trucks out');
    if (S.report.safety < 70) throw new Error('safety ' + S.report.safety);
    console.log('     ' + preset + ': grade ' + S.report.grade + ', ' + S.report.kpi.trucksOut + ' trucks, S' + Math.round(S.report.safety) + ' T' + Math.round(S.report.throughput) + ' C' + Math.round(S.report.compliance));
  });
}
check('easy with approvals that wait: crew queue decisions for the player', () => {
  const L = H.load();
  const cfg = Object.assign({}, L.data.PRESETS.easy, { approvals: 'wait' });
  const S = L.sim.create({ seed: 9, config: cfg, date: '2026-10-02' });
  for (let i = 0; i < 600; i++) L.sim.tick(S, 20);
  if (!S.approvals.length) throw new Error('no approval requests raised');
  const before = S.approvals.length;
  const r = L.sim.act(S, 'approvalAccept', S.approvals[0].id);
  if (r.ok === false) throw new Error('approval failed: ' + r.msg);
  console.log('     ' + before + ' requests pending, e.g. "' + S.log.filter((l) => l.cat === 'crew').slice(-1)[0].text + '"');
});
check('field autonomy: crew do field work but leave decisions', () => {
  const { S } = H.runShift({ seed: 9, config: 'normal', bot: H.idleBot });
  if (S.report.kpi.trucksOut > 0) throw new Error('trucks released without the player');
  if (!S.tasks.find((t) => t.id === 'rounds1' && t.status !== 'missed')) throw new Error('crew did not do rounds');
});
check('physics: propane vapour pressure at 15 °C ≈ 7.3 bar abs', () => {
  const L = H.load();
  const p = L.phys.psatPure('propane', 15);
  if (Math.abs(p - 7.3) > 0.15) throw new Error(p);
  const v = L.phys.sphereVol(7.25, 7.25), half = 2 / 3 * Math.PI * Math.pow(7.25, 3);
  if (Math.abs(v - half) > 1e-6) throw new Error('half sphere volume ' + v);
});
console.log(fail ? fail + ' failed' : 'all passed');
process.exit(fail ? 1 : 0);
