/* LPG thermodynamics and vessel geometry.
   Fits are deliberately simple but anchored to published saturation data:
   propane  Psat 0°C 4.74, 15°C 7.30, 40°C 13.7, 60°C 21.2 bar abs; rho 507 kg/m3 at 15°C
   n-butane Psat 0°C 1.03, 20°C 2.08, 40°C 3.79 bar abs;            rho 583 kg/m3 at 15°C */
(function (L) {
  'use strict';
  const R = 8.314; // J/(mol K)

  const PRODUCTS = {
    propane: {
      key: 'propane', name: 'Propane', short: 'C3', mw: 44.097, rho15: 507.0, drho: -1.40,
      A: 9.859, B: 2268, lel: 2.1, uel: 9.5, cp: 2520, un: '1978', kemler: '23',
      fillRatio: 0.42, // ADR 4.3.3.2.5 max filling ratio, kg per litre of tank capacity
      ait: 470, // autoignition temperature °C
    },
    butane: {
      key: 'butane', name: 'Butane', short: 'C4', mw: 58.12, rho15: 583.0, drho: -1.10,
      A: 10.222, B: 2784, lel: 1.8, uel: 8.4, cp: 2390, un: '1011', kemler: '23',
      fillRatio: 0.51, ait: 405,
    },
  };

  // Pure-component vapour pressure, bar absolute (Clausius-Clapeyron fit).
  function psatPure(key, T) {
    const p = PRODUCTS[key];
    return Math.exp(p.A - p.B / (T + 273.15));
  }
  function rhoPure(key, T) {
    const p = PRODUCTS[key];
    return p.rho15 + p.drho * (T - 15);
  }
  // Mass fraction propane -> mole fraction propane.
  function moleFrac(wP) {
    const nP = wP / PRODUCTS.propane.mw, nB = (1 - wP) / PRODUCTS.butane.mw;
    return nP / (nP + nB);
  }
  // Bubble-point pressure of a C3/C4 mix (Raoult), bar absolute.
  function psat(wP, T) {
    const x = moleFrac(wP);
    return x * psatPure('propane', T) + (1 - x) * psatPure('butane', T);
  }
  // Liquid density with ideal volume mixing, kg/m3.
  function rhoL(wP, T) {
    return 1 / (wP / rhoPure('propane', T) + (1 - wP) / rhoPure('butane', T));
  }
  function rhoL15(wP) { return rhoL(wP, 15); }
  // Saturated vapour density, kg/m3. Compressibility from a crude linear fit.
  function rhoV(wP, T, Pabs) {
    const x = moleFrac(wP);
    const pp = x * psatPure('propane', T);
    const y = pp / Math.max(pp + (1 - x) * psatPure('butane', T), 1e-6);
    const mw = y * PRODUCTS.propane.mw + (1 - y) * PRODUCTS.butane.mw;
    const Z = Math.max(0.6, 1 - 0.012 * Pabs);
    return (Pabs * 1e5 * mw / 1000) / (Z * R * (T + 273.15));
  }
  // Volume correction factor to 15°C (API MPMS 11.2.4 / GPA TP-27 style, density-ratio form).
  function vcf(wP, T) { return rhoL(wP, T) / rhoL(wP, 15); }

  // Sphere: volume of liquid at height h (m) for radius r.
  function sphereVol(h, r) {
    h = Math.max(0, Math.min(2 * r, h));
    return Math.PI * h * h * (3 * r - h) / 3;
  }
  function sphereLevel(V, r) {
    const Vt = 4 / 3 * Math.PI * r * r * r;
    if (V <= 0) return 0;
    if (V >= Vt) return 2 * r;
    let lo = 0, hi = 2 * r;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (sphereVol(mid, r) < V) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // Horizontal cylinder (bullet) with flat-ended approximation.
  function bulletVol(h, r, len) {
    h = Math.max(0, Math.min(2 * r, h));
    const seg = r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(Math.max(0, 2 * r * h - h * h));
    return seg * len;
  }

  // Split a vessel's total inventory into liquid and saturated vapour (closed form).
  function partition(M, Vtot, wP, T, Pabs) {
    const rl = rhoL(wP, T), rv = rhoV(wP, T, Pabs);
    let mv = rv * (Vtot - M / rl) / (1 - rv / rl);
    mv = Math.max(0, Math.min(mv, M));
    const ml = M - mv;
    return { ml, mv, rl, rv, Vl: ml / rl, Vv: Vtot - ml / rl };
  }

  // Gas concentration at a point from a continuous release, in %LEL.
  // Simplified heavy-gas plume: Gaussian crosswind spread, near-field pooling in low wind.
  function plumeLEL(leak, px, py, windFromDeg, windSpeed, lelVol) {
    const Q = leak.rate;
    if (Q <= 0) return 0;
    const toRad = ((windFromDeg + 180) % 360) * Math.PI / 180; // direction gas travels
    // Plant coordinates: +x east, +y south (SVG). Compass: N = up (-y).
    const wx = Math.sin(toRad), wy = -Math.cos(toRad);
    const dx = px - leak.x, dy = py - leak.y;
    const down = dx * wx + dy * wy;
    const cross = Math.abs(dx * wy - dy * wx);
    const u = Math.max(0.8, windSpeed);
    const r2 = dx * dx + dy * dy;
    let c = 0;
    if (down > 0) {
      const sig = 0.22 * down + 1.0;
      c = 2500 * Q / (u * (0.1 + sig * sig)) * Math.exp(-(cross * cross) / (2 * sig * sig));
    }
    // Pooling / jet momentum near source, stronger when calm.
    c += 900 * Q / ((1 + 0.25 * r2) * Math.sqrt(u));
    const scale = 2.1 / lelVol; // calibrated on propane
    return Math.min(250, c * scale);
  }

  L.phys = { PRODUCTS, psatPure, rhoPure, moleFrac, psat, rhoL, rhoL15, rhoV, vcf, sphereVol, sphereLevel, bulletVol, partition, plumeLEL };
})(globalThis.LPG = globalThis.LPG || {});
