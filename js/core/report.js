/* End-of-shift report: scores, grade, KPIs, incident log and lessons. */
(function (L) {
  'use strict';
  const U = L.util, sim = L.sim;

  function grade(overall, catastrophic, injuries) {
    if (catastrophic) return { g: 'F', text: 'Shift terminated — catastrophic event' };
    let g = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 60 ? 'D' : 'F';
    if (injuries && 'ABC'.includes(g)) g = 'D';
    const text = { A: 'Excellent shift. Safe, productive and by the book.', B: 'Good shift with a few things to tighten up.', C: 'Acceptable, but the debrief has some hard questions.', D: 'Poor. Serious lapses would need investigation.', F: 'Failed. This shift would end up in an incident report.' }[g];
    return { g, text };
  }

  function build(S) {
    const st = S.stats;
    const safety = S.score.safety, compliance = S.score.compliance;
    const throughput = sim.throughputScore(S);
    const catastrophic = S.outcome === 'catastrophe';
    const overall = catastrophic ? 0 : Math.round(0.45 * safety + 0.35 * Math.min(100, throughput) + 0.2 * compliance);
    const gr = grade(overall, catastrophic, st.injuries || 0);
    const ta = st.turnaround.length ? st.turnaround.reduce((a, b) => a + b, 0) / st.turnaround.length : 0;
    const acks = st.ackTimes.length ? st.ackTimes.reduce((a, b) => a + b, 0) / st.ackTimes.length : 0;
    const hours = Math.max(S.t / 3600, 0.1);
    const pens = S.score.events.filter((e) => e.pts < 0).sort((a, b) => a.pts - b.pts);
    const goods = S.score.events.filter((e) => e.pts > 0);
    const lessons = [];
    const seen = {};
    for (const e of pens) if (e.lesson && !seen[e.lesson]) { seen[e.lesson] = true; lessons.push({ text: e.text, lesson: e.lesson }); }
    const openPermits = S.permits.filter((p) => ['active', 'workdone', 'suspended'].includes(p.status));
    const bypassed = S.tankOrder.filter((id) => S.tanks[id].lshhBypass);
    const tasks = S.tasks.map((t) => ({ title: t.title, status: t.status }));
    return {
      overall, grade: gr.g, gradeText: gr.text, safety, throughput, compliance,
      kpi: {
        dispatched: st.dispatched, received: st.received, target: S.target, trucksOut: st.trucksOut, trucksRejected: st.trucksRejected,
        rejectedValid: st.rejectedValid, avgTurnaround: ta, alarms: st.alarmsRaised, alarmsPer10: st.alarmsRaised / (hours * 6), avgAck: acks,
        vented: st.vented, incidents: st.incidents, injuries: st.injuries || 0, nearMisses: st.nearMisses, complaints: st.complaints,
        demurrageH: st.demurrageH, overfills: st.overfills,
      },
      penalties: pens, goods, lessons, openPermits: openPermits.map((p) => p.no + ' — ' + p.title), bypassed, tasks,
      recon: S.gauge.recon, endReason: S.endReason, outcome: S.outcome, endClock: U.clock(S),
    };
  }

  // End-of-shift checks that only make sense at handover time.
  sim.register({
    name: 'handover-end', order: 99,
    tick(S) {
      if (S.t >= S.shiftLen - 1 && !S.flags.endChecks) {
        S.flags.endChecks = true;
        for (const id of S.tankOrder) if (S.tanks[id].lshhBypass) sim.score(S, 'safety', -10, 'LSHH-' + id.slice(1) + ' still bypassed at shift end', 'A forgotten bypass is a hidden hazard handed to the next shift. Every override must be tracked and removed.');
        for (const p of S.permits) if (p.status === 'workdone') sim.score(S, 'compliance', -2, p.no + ' work finished but permit not closed');
        for (const g of S.gd) if (g.inhibited && !S.permits.some((p) => p.facts && (p.facts.inhibit === g.id || p.facts.handoverGD === g.id) && ['active', 'workdone'].includes(p.status))) sim.score(S, 'compliance', -3, g.tag + ' left inhibited without a permit');
        if (!S.handover.acked) sim.score(S, 'compliance', -3, 'Handover never signed');
      }
    },
  });

  L.report = { build };
})(globalThis.LPG = globalThis.LPG || {});
