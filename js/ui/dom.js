/* UI helpers: diffed rendering that never stomps on an input being edited, event delegation, drafts. */
(function (L) {
  'use strict';
  const U = L.util;

  const UI = {
    tab: 'overview', modal: null, speed: 30, paused: true, started: false, drafts: {}, sel: {}, sound: true,
    hist: {}, lastHist: -1e9, seenToast: 0, lessonOpen: null, alarmMin: false, logFilter: 'all', hbSection: 'role',
    lastSelectT: 0,
  };

  // Replace innerHTML only when it changed, and never while the user is typing inside the container.
  function setHTML(el, html) {
    if (!el) return;
    if (el._html === html) return;
    const a = document.activeElement;
    if (a && el.contains(a) && a !== el) {
      const tag = a.tagName;
      if ((tag === 'INPUT' && /^(text|number|search)$/.test(a.type)) || tag === 'TEXTAREA') return;
      if (tag === 'SELECT' && Date.now() - UI.lastSelectT < 2500) return;
    }
    // Keep scroll positions of inner scrollers.
    const keep = [];
    el.querySelectorAll('[data-keep]').forEach((n) => keep.push([n.getAttribute('data-keep'), n.scrollTop]));
    let focusId = a && el.contains(a) ? a.id : null;
    el.innerHTML = html;
    el._html = html;
    for (const [k, top] of keep) { const n = el.querySelector('[data-keep="' + k + '"]'); if (n) n.scrollTop = top; }
    if (focusId) { const n = document.getElementById(focusId); if (n) n.focus({ preventScroll: true }); }
  }

  const e = U.esc;
  // Button that fires a sim action: btn('Label', 'actionName', [args], 'class')
  function btn(label, action, args, cls, opts) {
    opts = opts || {};
    const dis = opts.disabled ? ' disabled' : '';
    const title = opts.title ? ' title="' + e(opts.title) + '"' : '';
    const inp = opts.inputs ? ' data-in="' + e(opts.inputs.join(',')) + '"' : '';
    return '<button type="button" class="btn ' + (cls || '') + '" data-a="' + e(action) + '" data-p="' + e(JSON.stringify(args || [])) + '"' + inp + dis + title + '>' + label + '</button>';
  }
  // UI-only action (navigation, modal).
  function ubtn(label, action, args, cls, opts) { return btn(label, 'ui:' + action, args, cls, opts); }

  function draft(id, def) { return UI.drafts[id] !== undefined ? UI.drafts[id] : def; }

  function pill(text, cls) { return '<span class="pill ' + (cls || '') + '">' + e(text) + '</span>'; }

  function meter(frac, marks, cls) {
    let m = '';
    for (const k of marks || []) m += '<b style="left:' + (U.clamp(k, 0, 1) * 100).toFixed(1) + '%"></b>';
    return '<div class="meter ' + (cls || '') + '"><i style="width:' + (U.clamp(frac, 0, 1) * 100).toFixed(1) + '%"></i>' + m + '</div>';
  }

  // Sparkline from an array of numbers.
  function spark(vals, lo, hi) {
    if (!vals || vals.length < 2) return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg>';
    const n = vals.length;
    const mn = lo !== undefined ? lo : Math.min(...vals), mx = hi !== undefined ? hi : Math.max(...vals);
    const span = mx - mn || 1;
    const pts = vals.map((v, i) => [(i / (n - 1)) * 100, 28 - ((v - mn) / span) * 26]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[n - 1];
    return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><path class="a" d="' + d + ' L100 30 L0 30 Z"></path><path class="l" d="' + d + '" vector-effect="non-scaling-stroke"></path><circle cx="' + last[0] + '" cy="' + last[1] + '" r="1.6"></circle></svg>';
  }

  L.ui = { UI, setHTML, btn, ubtn, draft, pill, meter, spark, e };
})(globalThis.LPG = globalThis.LPG || {});
