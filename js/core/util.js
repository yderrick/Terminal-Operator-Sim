/* Harrowmere LPG Terminal — shared utilities.
   Every file attaches to the global LPG namespace so the game runs from file:// without a bundler. */
(function (L) {
  'use strict';

  // Seeded PRNG (mulberry32) so a shift can be replayed from its seed.
  function makeRng(seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + (hi - lo) * next();
    next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    next.gauss = () => {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.shuffle = (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    };
    return next;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // First-order lag toward a target with time constant tau (seconds).
  const approach = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(tau, 1e-6)));

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Sim time t (s since shift start) to wall clock "HH:MM".
  function clock(S, t) {
    const total = Math.floor((S.startHour * 3600 + (t === undefined ? S.t : t)) % 86400);
    return pad2(Math.floor(total / 3600)) + ':' + pad2(Math.floor((total % 3600) / 60));
  }
  function clockSec(S, t) {
    const total = Math.floor((S.startHour * 3600 + (t === undefined ? S.t : t)) % 86400);
    return clock(S, t) + ':' + pad2(total % 60);
  }
  // Duration in seconds to "1h 05m" / "12m" / "45s".
  function dur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + 's';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
  }
  // Clock hour (decimal, 0-24) for sim time t.
  function hourOf(S, t) { return ((S.startHour * 3600 + (t === undefined ? S.t : t)) / 3600) % 24; }

  const fmt = {
    n0: (v) => (isFinite(v) ? Math.round(v).toLocaleString('en-GB') : '—'),
    n1: (v) => (isFinite(v) ? v.toFixed(1) : '—'),
    n2: (v) => (isFinite(v) ? v.toFixed(2) : '—'),
    n3: (v) => (isFinite(v) ? v.toFixed(3) : '—'),
    t: (kg) => (isFinite(kg) ? (kg / 1000).toFixed(2) + ' t' : '—'),
    t1: (kg) => (isFinite(kg) ? (kg / 1000).toFixed(1) + ' t' : '—'),
    kg: (kg) => (isFinite(kg) ? Math.round(kg).toLocaleString('en-GB') + ' kg' : '—'),
    pct: (f) => (isFinite(f) ? (f * 100).toFixed(1) + '%' : '—'),
    sign: (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d === undefined ? 1 : d),
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  // Compass label for a meteorological direction (degrees the wind blows FROM).
  function compass(deg) {
    const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return pts[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  L.util = { makeRng, clamp, lerp, approach, clock, clockSec, dur, hourOf, fmt, esc, dist, compass, pad2 };
})(globalThis.LPG = globalThis.LPG || {});
