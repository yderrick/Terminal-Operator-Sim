/* Plant model: weather, utilities, storage spheres, pumps & headers, leaks, fire & gas, fires, ESD. */
(function (L) {
  'use strict';
  const U = L.util, P = L.phys, D = L.data, sim = L.sim;
  const { clamp, approach } = U;
  const ATM = 1.013;
  const NONCOND = 0.12; // bar of non-condensables in vapour space

  // ===================================================================================
  // Helpers shared with other modules
  // ===================================================================================
  function esdActive(S, zone) { return S.esd.site || !!S.esd.zones[zone]; }
  function powerOK(S) { return S.util.power.ok; }
  function iaOK(S) { return S.util.ia.p >= 3.5; }
  function tankPsetT(tank) {
    // Liquid surface temperature at which vapour pressure reaches PSV set.
    let lo = -20, hi = 120;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (P.psat(tank.wP, m) - ATM + NONCOND < tank.psv) lo = m; else hi = m;
    }
    return lo;
  }
  function inletOpen(S, t) { return t.xvIn && !esdActive(S, 'TF') && iaOK(S) && !t.lshhTrip; }
  function outletOpen(S, t) { return t.xvOut && !esdActive(S, 'TF') && iaOK(S); }
  function delugeEff(S, dvId) {
    const dv = S.fw.deluge[dvId];
    if (!dv || !dv.open) return 0;
    return clamp((S.fw.p - 2) / 6, 0, 1);
  }
  function tankDelugeEff(S, tankId) {
    const d = D.DELUGE.find((x) => x.covers === tankId);
    let e = d ? delugeEff(S, d.id) : 0;
    if (S.fireBrigade.onScene) e = Math.max(e, 0.6);
    return e;
  }
  // Max %LEL at a point from all active leaks.
  function lelAt(S, x, y) {
    let c = 0;
    for (const lk of S.leaks) {
      if (lk.rate <= 0) continue;
      c += P.plumeLEL(lk, x, y, S.weather.windDir, S.weather.wind, P.PRODUCTS[lk.product || 'propane'].lel);
    }
    return c;
  }

  // ===================================================================================
  // Weather
  // ===================================================================================
  sim.register({
    name: 'weather', order: 1,
    init(S) {
      const r = S.rng;
      const night = S.startHour >= 12;
      S.weather = {
        Tmean: r.range(16, 25), amp: r.range(5, 8), Tamb: 15, solar: 0, cloud: r.range(0.05, 0.45),
        wind: r.range(2, 5.5), windDir: r.range(180, 300), rain: 0, lightningKm: Infinity,
        lastStrike10: -1e9, lastStrike20: -1e9, strikes: [], storm: null, gust: 0,
      };
      if (r.chance(S.diff.storm)) {
        const start = r.range(3.5, 9) * 3600;
        S.weather.storm = { start, dur: r.range(55, 95) * 60, closest: r.range(1.5, 8), warned: false };
      }
      S.weather.night = night;
    },
    tick(S, dt) {
      const W = S.weather, r = S.rng, h = U.hourOf(S);
      let Tamb = W.Tmean + W.amp * Math.sin(2 * Math.PI * (h - 9) / 24);
      let cloud = W.cloud, rain = 0;
      const st = W.storm;
      let stormPhase = 0;
      if (st && S.t >= st.start - 3600 && S.t <= st.start + st.dur + 1800) {
        const x = (S.t - st.start) / st.dur; // 0..1 during storm
        // Lightning distance: approaches from ~45 km, holds, recedes.
        let d;
        if (x < 0) d = st.closest + 40 * (-x) * (st.dur / 3600) + 18;
        else if (x < 0.35) d = st.closest + (1 - x / 0.35) * 18;
        else if (x < 0.75) d = st.closest + r.range(-0.5, 1.5);
        else d = st.closest + (x - 0.75) / 0.25 * 22;
        W.lightningKm = Math.max(0.5, d);
        stormPhase = x >= -0.25 && x <= 1.1 ? 1 : 0;
        if (x >= 0 && x <= 1) { cloud = 0.95; rain = clamp(1 - Math.abs(x - 0.5) * 1.6, 0.2, 1); Tamb -= 4 * rain; }
        // Strikes: Poisson, more frequent when close.
        const rate = W.lightningKm < 30 ? (4 / 60) * (1 - W.lightningKm / 35) : 0;
        if (r.chance(rate * dt)) {
          const sd = Math.max(0.3, W.lightningKm + r.range(-2, 2.5));
          W.strikes.push({ t: S.t, km: sd });
          if (W.strikes.length > 60) W.strikes.shift();
          if (sd <= 10) W.lastStrike10 = S.t;
          if (sd <= 20) W.lastStrike20 = S.t;
          if (sd <= 1.0) {
            for (const lk of S.leaks) if (lk.rate > 0.01 && !lk.ignited && r.chance(0.25)) L.plant.ignite(S, lk, 'lightning');
          }
        }
        if (!st.warned && W.lightningKm < 40) {
          st.warned = true;
          sim.log(S, 'weather', 'Met office warning: thunderstorm cell tracking toward the terminal. Lightning detection network active.', 'warn');
          sim.lesson(S, 'lightning', 'Lightning and LPG transfers', 'Most terminals stop all loading and unloading when strikes are detected within about 10 km, and resume only after 30 minutes with no strike inside that radius (the "30-minute rule"). A strike can ignite vapour at vents, PSV tail pipes and open connections. Keep arms connected and valves closed rather than disconnecting in the storm.');
        }
      } else {
        W.lightningKm = Infinity;
      }
      W.Tamb = Tamb;
      W.cloud = cloud; W.rain = rain;
      const sun = Math.max(0, Math.sin(Math.PI * (h - 6.2) / 13));
      W.solar = sun * (1 - 0.85 * cloud);
      // Wind: mean-reverting random walk, gusty in storms.
      const meanWind = stormPhase ? 11 : 4;
      W.wind = clamp(W.wind + (meanWind - W.wind) * dt / 1800 + r.gauss() * 0.04 * Math.sqrt(dt) * (stormPhase ? 3 : 1), 0.4, 22);
      W.windDir = (W.windDir + r.gauss() * 0.35 * Math.sqrt(dt) * (W.wind < 2 ? 3 : 1) + 360) % 360;
      W.gust = W.wind * (1.25 + 0.3 * r());
      W.hold = S.t - W.lastStrike10 < 1800;
      sim.setAlarm(S, 'LTNG20', 'LTNG20', 'MET-LD', S.t - W.lastStrike20 < 900 && !W.hold);
      sim.setAlarm(S, 'LTNG10', 'LTNG10', 'MET-LD', W.hold, W.hold ? 'resume after ' + U.clock(S, W.lastStrike10 + 1800) : '');
      sim.setAlarm(S, 'WIND', 'WIND', 'MET-WS', W.wind > 15);
    },
  });

  // ===================================================================================
  // Utilities: power, instrument air, odorant, fire water
  // ===================================================================================
  sim.register({
    name: 'utilities', order: 5,
    init(S) {
      S.util = {
        power: { ok: true, dipUntil: 0 },
        ia: { p: 7.0, comps: [{ id: 'K601A', tag: 'K-601A', running: true, tripped: false, auto: false }, { id: 'K601B', tag: 'K-601B', running: false, tripped: false, auto: true }] },
        odor: { level: S.rng.range(0.32, 0.5), cap: 1200, pump: 'running', ppmTarget: 25, failed: false, injected: 0 },
      };
      S.fw = {
        p: 10.0, tank: 2800, tankCap: 3000,
        jockey: { running: true },
        elec: { tag: 'P-501', running: false, auto: true, failLatent: false, failed: false },
        diesel: { tag: 'P-502', running: false, auto: true, failLatent: S.rng.chance(0.45 * S.diff.faultMult), failed: false, runSec: 0, testStarted: null, tested: false },
        deluge: {},
      };
      for (const d of D.DELUGE) S.fw.deluge[d.id] = { open: false, by: null, t: 0 };
      S.esd = { site: false, zones: { TF: false, PA: false, LR: false, RL: false }, history: [] };
      S.muster = { active: false, t: null };
      S.fireBrigade = { called: false, tCall: null, onScene: false, arrival: null };
    },
    tick(S, dt) {
      const ut = S.util;
      // Power
      if (!ut.power.ok && S.t >= ut.power.dipUntil) { ut.power.ok = true; sim.log(S, 'ops', 'Grid supply restored. Motors may be restarted.'); }
      sim.setAlarm(S, 'POWER', 'POWER', 'EL-01', !ut.power.ok || S.t - (ut.power.lastDip || -1e9) < 120);
      // Instrument air
      const ia = ut.ia;
      for (const c of ia.comps) if (!powerOK(S) && c.running) { c.running = false; c.tripped = true; c.tripCause = 'power dip'; }
      const running = ia.comps.filter((c) => c.running).length;
      if (ia.p < 6.0) {
        const sb = ia.comps.find((c) => !c.running && !c.tripped && c.auto);
        if (sb && powerOK(S)) { sb.running = true; sim.log(S, 'ops', sb.tag + ' auto-started on falling air pressure.'); }
      }
      ia.p = clamp(ia.p + (running * 0.06 - 0.035) * dt, 0, 7.2);
      sim.setAlarm(S, 'IALOW', 'IALOW', 'PI-601', ia.p < 4.5, ia.p.toFixed(1) + ' barg');
      for (const c of ia.comps) sim.setAlarm(S, 'IATRIP-' + c.id, 'IATRIP', c.tag, c.tripped);
      if (!iaOK(S) && !S.flags.iaFailLogged) {
        S.flags.iaFailLogged = true;
        sim.log(S, 'ops', 'Instrument air below 3.5 barg — fail-safe ROSOVs closing across the terminal.', 'crit');
        sim.lesson(S, 'failsafe', 'Fail-safe valves', 'ROSOVs (remotely operated shut-off valves) are spring-return: they need air to stay open. Lose the air and they close. That is deliberate — the safe state for an LPG terminal is isolated. The price is an unplanned stop, so the standby air compressor matters.');
      }
      if (iaOK(S)) S.flags.iaFailLogged = false;
      // Odorant
      const od = ut.odor;
      sim.setAlarm(S, 'ODLOW', 'ODLOW', 'LT-401', od.level < 0.2, (od.level * 100).toFixed(0) + '%');
      sim.setAlarm(S, 'ODFAIL', 'ODFAIL', 'FT-401', od.failed || od.level <= 0.005);
      fireWater(S, dt);
    },
  });

  function fireWater(S, dt) {
    const fw = S.fw;
    let demand = 0;
    for (const d of D.DELUGE) if (fw.deluge[d.id].open) demand += d.flow;
    if (S.fireBrigade.onScene) demand += 120;
    // Main pumps
    const tryStart = (pump, why) => {
      if (pump.running || pump.failed) return;
      if (pump === fw.elec && !powerOK(S)) return;
      if (pump.failLatent) {
        pump.failed = true;
        sim.log(S, 'ops', pump.tag + ' FAILED TO START (' + why + ').', 'crit');
        return;
      }
      pump.running = true;
      sim.log(S, 'ops', pump.tag + ' running (' + why + ').');
    };
    if (fw.p < 8.5 && fw.elec.auto) tryStart(fw.elec, 'auto-start on low ring-main pressure');
    if ((fw.p < 7.5 || fw.elec.failed || (!powerOK(S) && demand > 0)) && fw.diesel.auto && demand > 0) tryStart(fw.diesel, 'auto-start');
    if (fw.elec.running && !powerOK(S)) { fw.elec.running = false; sim.log(S, 'ops', 'P-501 electric fire pump stopped — power dip.', 'warn'); }
    let supply = 25; // jockey
    if (fw.elec.running) supply += 1300;
    if (fw.diesel.running) supply += 1300;
    if (fw.tank <= 0) supply = 0;
    const target = demand <= 0 ? 10.0 : clamp(10.5 * Math.min(1, supply / demand), 0, 11);
    fw.p = approach(fw.p, demand > 0 && supply > 25 ? Math.min(target, 9.6) : target, dt, 12);
    const used = Math.min(demand, supply) / 3600 * dt;
    fw.tank = Math.max(0, fw.tank - used);
    if (fw.diesel.running) {
      fw.diesel.runSec += dt;
      if (fw.diesel.testStarted !== null && !fw.diesel.tested && S.t - fw.diesel.testStarted >= 1800) {
        fw.diesel.tested = true;
        sim.log(S, 'ops', 'P-502 diesel fire pump weekly run test: 30 min completed — discharge 10.8 barg, coolant 82 °C, no leaks. Record signed.');
        L.tasks && L.tasks.complete(S, 'fwtest');
      }
    }
    sim.setAlarm(S, 'FWLOW', 'FWLOW', 'PI-501', fw.p < 7.0, fw.p.toFixed(1) + ' barg');
    sim.setAlarm(S, 'FWFAIL-E', 'FWFAIL', 'P-501', fw.elec.failed);
    sim.setAlarm(S, 'FWFAIL-D', 'FWFAIL', 'P-502', fw.diesel.failed);
    sim.setAlarm(S, 'FWTANK', 'FWTANK', 'LT-501', fw.tank < fw.tankCap * 0.3);
    // Fire brigade
    const fb = S.fireBrigade;
    if (fb.called && !fb.onScene && S.t >= fb.arrival) {
      fb.onScene = true;
      sim.log(S, 'safety', 'Fire service on scene. Incident commander taking cooling positions on exposed equipment.', 'warn');
    }
    if (fb.onScene && S.fires.length === 0 && S.leaks.length === 0 && S.t - fb.arrival > 1800 && !fb.released) {
      fb.released = true; fb.onScene = false;
      sim.log(S, 'safety', 'Fire service stood down and left site.');
    }
  }

  // ===================================================================================
  // Storage spheres
  // ===================================================================================
  function tankDerived(S, t) {
    const Pabs = P.psat(t.wP, t.Ts) + NONCOND;
    const part = P.partition(t.M, t.Vtot, t.wP, t.Tb, Pabs);
    t.Pabs = Pabs; t.P = Pabs - ATM;
    t.ml = part.ml; t.mv = part.mv; t.rl = part.rl; t.rv = part.rv;
    t.Vl = part.Vl; t.fill = part.Vl / t.Vtot;
    t.level = P.sphereLevel(part.Vl, t.r) * 1000; // mm
  }

  sim.register({
    name: 'tanks', order: 10,
    init(S) {
      const r = S.rng;
      S.tanks = {};
      S.tankOrder = [];
      for (const cfg of D.TANKS) {
        const Vtot = 4 / 3 * Math.PI * Math.pow(cfg.r, 3);
        const fill = r.range(cfg.fill0[0], cfg.fill0[1]);
        const Tb = r.range(14, 18.5);
        const t = {
          id: cfg.id, tag: cfg.tag, product: cfg.product, x: cfg.x, y: cfg.y, r: cfg.r, Vtot,
          design: cfg.design, psv: cfg.psv, pah: cfg.pah, wP: cfg.wP + r.range(-0.004, 0.004),
          Tb, Ts: Tb - r.range(0.2, 1.2), M: 0, xvIn: true, xvOut: true,
          radar: { fault: null, bias: r.range(-1.5, 1.5), stuck: 0, drift: 0, flagged: false },
          lshhBypass: false, lshhTrip: false, psvLift: false, vented: 0, wallT: 20, fireQ: 0,
          inflow: 0, outflow: 0, mixing: 0, offspec: false,
        };
        const rl = P.rhoL(t.wP, Tb);
        t.M = fill * Vtot * rl * 1.02; // includes vapour approx
        tankDerived(S, t);
        t.Tset = tankPsetT(t);
        t.levelMeas = t.level + t.radar.bias;
        S.tanks[cfg.id] = t;
        S.tankOrder.push(cfg.id);
      }
      S.headers = {
        propane: { product: 'propane', source: 'V101', mode: 'auto', demand: 0, share: 0, idleSince: 0, pressure: 0, flow: 0 },
        butane: { product: 'butane', source: 'V103', mode: 'auto', demand: 0, share: 0, idleSince: 0, pressure: 0, flow: 0 },
      };
    },
    tick(S, dt) {
      const W = S.weather;
      for (const id of S.tankOrder) {
        const t = S.tanks[id];
        const del = tankDelugeEff(S, id);
        // Effective surroundings for the liquid surface: air + solar gain on white paint, or deluge water.
        let Teff = W.Tamb + 5.5 * W.solar - 1.5 * W.rain;
        let tauSurf = 3.2 * 3600;
        if (del > 0) { Teff = U.lerp(Teff, 17, del); tauSurf = 1800; }
        const mixing = t.inflow > 0.5 || t.outflow > 0.5;
        const tauMix = mixing ? 2400 : 6 * 3600;
        t.Ts = approach(t.Ts, Teff, dt, tauSurf);
        t.Ts = approach(t.Ts, t.Tb, dt, tauMix);
        t.Tb = approach(t.Tb, Teff, dt, 140 * 3600);
        // Fire heat input into the surface layer.
        if (t.fireQ > 0) {
          const q = t.fireQ * (1 - 0.8 * del);
          t.Ts += q * dt / (30000 * 2500);
          t.Tb += q * 0.15 * dt / (Math.max(t.ml, 1e4) * 2500);
        }
        // Shell wall in the vapour zone.
        const wallRate = t.fireQ > 0 ? 1.35 * Math.min(1.5, t.fireQ / 3e6) * (1 - 0.93 * del) : 0;
        t.wallT += wallRate * dt;
        t.wallT = approach(t.wallT, t.Ts + 5, dt, del > 0 ? 150 : 650);
        // Relief: clamp surface temperature at the set point and vent the excess as vapour.
        const Tset = t.Tset;
        if (t.Ts > Tset) {
          const excessJ = (t.Ts - Tset) * 30000 * 2500;
          const vent = excessJ / 3.6e5; // latent heat ~360 kJ/kg
          t.Ts = Tset;
          t.M -= vent;
          t.vented += vent;
          S.stats.vented += vent;
          t.psvLift = true;
          t.psvLiftT = S.t;
        } else if (t.psvLift && S.t - t.psvLiftT > 20) {
          t.psvLift = false;
        }
        tankDerived(S, t);
        // Overfill: liquid-full vessel relieves liquid through the PSV (two-phase release).
        if (t.fill > 0.975 && !t.overfilled) {
          t.overfilled = true;
          S.stats.incidents++;
          sim.log(S, 'safety', t.tag + ' LIQUID FULL — relief valve discharging two-phase LPG from the vent stack.', 'crit');
          sim.score(S, 'safety', -45, t.tag + ' overfilled to liquid-full; liquid relief to atmosphere', 'Buncefield (2005): a stuck level gauge and a high-level switch that did not work let a tank overfill. The vapour cloud exploded. Independent high-high protection must never be bypassed during a receipt.');
          L.plant.addLeak(S, { x: t.x, y: t.y - t.r, zone: 'TF', src: { kind: 'tankpsv', id: t.id }, rate: 4.5, product: t.product, label: t.tag + ' PSV liquid discharge' });
        }
        if (t.fill < 0.95) t.overfilled = false;
        // Radar measurement
        const rd = t.radar;
        if (rd.fault === 'stuck') t.levelMeas = rd.stuck;
        else {
          if (rd.fault === 'drift') rd.drift += rd.driftRate * dt;
          t.levelMeas = t.level + rd.bias + rd.drift + S.rng.gauss() * 0.4;
        }
        const measVol = P.sphereVol(t.levelMeas / 1000, t.r);
        t.fillMeas = measVol / t.Vtot;
        // Independent high-high level switch (point switch, sees the true level).
        if (t.fill >= 0.90 && !t.lshhBypass && !t.lshhTrip) {
          t.lshhTrip = true;
          sim.log(S, 'safety', 'LSHH-' + id.slice(1) + ' tripped — ' + t.tag + ' inlet XV closed by the safety system.', 'crit');
          if (t.fillMeas < 0.86) {
            sim.lesson(S, 'radar-vs-switch', 'Two level instruments disagree', 'The independent high-high switch tripped but the radar shows a lower level. When the safety switch and the control gauge disagree, believe the switch until proven otherwise: the radar is probably stuck or drifting. This is exactly the failure that preceded Buncefield.');
          }
        }
        if (t.lshhTrip && t.fill < 0.87) { t.lshhTrip = false; sim.log(S, 'ops', 'LSHH-' + id.slice(1) + ' reset — level below switch.'); }
        // Alarms from the radar (control system) except the independent switch.
        const tag = t.tag;
        sim.setAlarm(S, 'LAH-' + id, 'LAH', 'LT-' + id.slice(1), t.fillMeas > 0.85 && t.fillMeas <= 0.90, (t.fillMeas * 100).toFixed(1) + '%');
        sim.setAlarm(S, 'LAHH-' + id, 'LAHH', 'LT-' + id.slice(1), t.fillMeas > 0.90, (t.fillMeas * 100).toFixed(1) + '%');
        sim.setAlarm(S, 'LSHH-' + id, 'LSHH', 'LSHH-' + id.slice(1), t.lshhTrip);
        sim.setAlarm(S, 'LAL-' + id, 'LAL', 'LT-' + id.slice(1), t.fillMeas < 0.10 && t.fillMeas >= 0.05);
        sim.setAlarm(S, 'LALL-' + id, 'LALL', 'LT-' + id.slice(1), t.fillMeas < 0.05);
        sim.setAlarm(S, 'PAH-' + id, 'PAH', 'PT-' + id.slice(1), t.P > t.pah, t.P.toFixed(2) + ' barg');
        sim.setAlarm(S, 'PSV-' + id, 'PSV', 'PSV-' + id.slice(1), t.psvLift);
        sim.setAlarm(S, 'TAH-' + id, 'TAH', 'TT-' + id.slice(1), t.Ts > 38);
        sim.setAlarm(S, 'WALL-' + id, 'WALL', 'TW-' + id.slice(1), t.wallT > 250, Math.round(t.wallT) + ' °C');
        if (t.psvLift && !t.psvLogged) {
          t.psvLogged = true;
          sim.score(S, 'safety', -8, tag + ' relief valve lifted — LPG vented to atmosphere', 'A lifting PSV means the vessel is at its pressure limit. On a sphere that is almost always heat input: sun on an overfull vessel or fire. Deluge cools the shell and stops the lift.');
        }
        if (!t.psvLift) t.psvLogged = false;
        // BLEVE: unwetted shell weakened by fire while under pressure.
        if (t.wallT > 560 && t.P > 0.35 * t.design) {
          S.stats.incidents++;
          sim.log(S, 'safety', tag + ' SHELL FAILURE — BLEVE. Fireball and fragments across the terminal.', 'crit');
          sim.score(S, 'safety', -100, tag + ' BLEVE', 'Feyzin (1966) and San Juanico (1984): spheres exposed to fire without enough cooling failed catastrophically. Cooling water on the vapour-space shell and isolating the fuel are the only defences.');
          sim.endShift(S, 'BLEVE of ' + tag, 'catastrophe');
          return;
        }
        t.inflow = 0; t.outflow = 0;
      }
    },
  });

  // ===================================================================================
  // Pumps and loading headers
  // ===================================================================================
  sim.register({
    name: 'pumps', order: 20,
    init(S) {
      S.pumps = {};
      for (const cfg of D.PUMPS) {
        S.pumps[cfg.id] = {
          id: cfg.id, tag: cfg.tag, product: cfg.product, x: cfg.x, y: cfg.y, cap: cfg.cap,
          running: false, autoStarted: false, tripped: false, tripCause: '', loto: false, isolated: false,
          flow: 0, recirc: 0, dP: 0, amps: 0, vib: 1.6 + S.rng.range(0, 0.6), wear: S.rng.range(0, 0.08),
          wearRate: 0, seal: 'ok', sealWear: 0, sealRate: 0, hours: S.rng.int(2000, 31000), duty: cfg.id.endsWith('A'),
        };
      }
    },
    tick(S, dt) {
      for (const prod of ['propane', 'butane']) {
        const H = S.headers[prod];
        const src = S.tanks[H.source];
        const pumps = Object.values(S.pumps).filter((p) => p.product === prod);
        const srcOK = src && outletOpen(S, src) && src.fill > 0.05;
        const permissive = (p) => !p.loto && !p.tripped && !p.isolated && powerOK(S) && !esdActive(S, 'PA') && srcOK;
        // Trips
        for (const p of pumps) {
          if (!p.running) continue;
          let cause = null;
          if (!powerOK(S)) cause = 'power dip';
          else if (esdActive(S, 'PA')) cause = 'ESD';
          else if (!srcOK) cause = src && src.fill <= 0.05 ? 'low-low suction level' : 'suction valve closed';
          else if (p.vib > 11) cause = 'vibration high-high';
          if (cause) {
            p.running = false;
            if (cause !== 'ESD') { p.tripped = cause !== 'suction valve closed'; p.tripCause = cause; }
            sim.log(S, 'ops', p.tag + ' stopped — ' + cause + '.', cause === 'ESD' ? 'info' : 'warn');
          }
        }
        // Demand from bays
        let demand = 0;
        for (const b of S.bays) if (b.product === prod && b.wantFlow > 0) demand += b.wantFlow;
        H.demand = demand;
        let run = pumps.filter((p) => p.running);
        if (H.mode === 'auto') {
          if (demand > 0) {
            H.idleSince = S.t;
            const capNow = run.reduce((s, p) => s + p.cap, 0);
            if (run.length === 0 || capNow < demand * 0.98) {
              const cand = pumps.filter((p) => !p.running && permissive(p)).sort((a, b) => (b.duty ? 1 : 0) - (a.duty ? 1 : 0))[0];
              if (cand && (run.length === 0 || capNow < demand)) {
                cand.running = true; cand.autoStarted = true; cand.startT = S.t;
                sim.log(S, 'ops', cand.tag + ' started on rack demand (' + Math.round(demand) + ' m³/h).');
                run = pumps.filter((p) => p.running);
              }
            }
          } else if (run.length && S.t - H.idleSince > 600) {
            for (const p of run) if (p.autoStarted) { p.running = false; p.autoStarted = false; sim.log(S, 'ops', p.tag + ' stopped — no rack demand for 10 min.'); }
            run = pumps.filter((p) => p.running);
          }
        }
        // NPSH margin from suction vessel level.
        const npsh = src ? clamp((src.fill - 0.05) / 0.09, 0, 1) : 0;
        let cap = 0;
        for (const p of run) cap += p.cap * (0.55 + 0.45 * npsh) * (1 - 0.35 * p.wear);
        H.share = demand > 0 ? Math.min(1, cap / demand) : 0;
        const delivered = demand * H.share;
        H.flow = delivered;
        for (const p of pumps) {
          if (p.running) {
            const q = run.length ? delivered / run.length : 0;
            p.flow = q;
            p.recirc = Math.max(0, 25 - q);
            const frac = (q + p.recirc) / p.cap;
            p.dP = (prod === 'propane' ? 6.4 : 5.6) * (1 - 0.28 * frac * frac);
            p.amps = 38 + 118 * frac + S.rng.gauss() * 0.6;
            const cav = (1 - npsh) * 7.5;
            p.wear = clamp(p.wear + p.wearRate * dt, 0, 1);
            p.vib = approach(p.vib, 1.8 + p.wear * 10 + cav + Math.abs(S.rng.gauss()) * 0.25, dt, 40);
            p.hours += dt / 3600;
            if (npsh < 0.5) sim.lesson(S, 'npsh', 'Cavitation and suction level', 'Centrifugal pumps need enough liquid head above the impeller (NPSH). As a sphere empties, the margin collapses and vapour bubbles form and implode in the pump — that rattle is cavitation. Swap the header to a fuller vessel before the low-low trip.');
          } else {
            p.flow = 0; p.recirc = 0; p.dP = 0; p.amps = 0;
            p.vib = approach(p.vib, 0.2, dt, 30);
          }
          // Seal degradation (latent fault): weep -> leak.
          if (p.sealRate > 0 && p.seal !== 'leak') {
            p.sealWear += p.sealRate * dt * (p.running ? 1 : 0.3);
            if (p.sealWear > 0.5 && p.seal === 'ok') p.seal = 'weep';
            if (p.sealWear >= 1) {
              p.seal = 'leak';
              if (!p.isolated) L.plant.addLeak(S, { x: p.x, y: p.y + 2, zone: 'PA', src: { kind: 'pump', id: p.id }, rate: S.rng.range(0.06, 0.18), product: prod, label: p.tag + ' mechanical seal' });
            }
          }
          sim.setAlarm(S, 'VAH-' + p.id, 'VAH', 'VT-' + p.tag.slice(2), p.running && p.vib > 7.1 && p.vib <= 11, p.vib.toFixed(1) + ' mm/s');
          sim.setAlarm(S, 'VAHH-' + p.id, 'VAHH', 'VT-' + p.tag.slice(2), p.tripped && p.tripCause === 'vibration high-high');
          sim.setAlarm(S, 'SEAL-' + p.id, 'SEAL', 'PS-' + p.tag.slice(2), p.seal === 'leak' && !p.isolated);
          sim.setAlarm(S, 'PTRIP-' + p.id, 'PTRIP', p.tag, p.tripped && p.tripCause !== 'vibration high-high');
        }
        H.pressure = src ? src.P + (run.length ? Math.max(...run.map((p) => p.dP)) : 0) : 0;
        if (src && delivered > 0) src.outflow += delivered;
      }
    },
  });

  // ===================================================================================
  // Leaks, gas detection, ignition, fires
  // ===================================================================================
  function addLeak(S, o) {
    const lk = {
      id: (S.leakSeq = (S.leakSeq || 0) + 1), x: o.x, y: o.y, zone: o.zone, src: o.src, rate: o.rate * 0.4, rate0: o.rate,
      product: o.product || 'propane', label: o.label, t0: S.t, residual: o.residual || 60, ignited: false, total: 0, fieldFix: !!o.fieldFix, fixed: false,
    };
    S.leaks.push(lk);
    sim.log(S, 'safety', 'Loss of containment started: ' + lk.label + ' (not yet visible to operator).', 'hidden');
    return lk;
  }
  function leakFed(S, lk) {
    const s = lk.src;
    if (lk.fixed) return false;
    switch (s.kind) {
      case 'bay': { const b = S.bays.find((x) => x.id === s.id); return !!b && b.flowing; }
      case 'pump': { const p = S.pumps[s.id]; return !!p && !p.isolated; }
      case 'manifold': { const t = S.tanks[s.id]; return !!t && outletOpen(S, t); }
      case 'rail': { return L.rail ? L.rail.leakFed(S, s.id) : false; }
      case 'tankpsv': { const t = S.tanks[s.id]; return !!t && t.fill > 0.955; }
      case 'truckpsv': { const tr = S.trucks.find((x) => x.id === s.id); return !!tr && tr.psvLift && tr.state !== 'GONE' && !!tr.pos; }
      case 'field': return true; // needs a field operator to isolate
      default: return false;
    }
  }
  function ignite(S, lk, cause) {
    if (lk.ignited) return;
    lk.ignited = true;
    S.stats.incidents++;
    const fire = { id: lk.id, x: lk.x, y: lk.y, zone: lk.zone, leakId: lk.id, size: lk.rate, t0: S.t, cause, label: lk.label };
    S.fires.push(fire);
    sim.log(S, 'safety', 'IGNITION — ' + lk.label + ' (' + cause + '). ' + (lk.rate > 0.3 ? 'Jet fire.' : 'Flash fire back to the source, now burning as a jet fire.'), 'crit');
    sim.score(S, 'safety', -25, 'Gas release ignited at ' + lk.label + ' (' + cause + ')', 'Ignition needs fuel, air and an ignition source. Operators control the fuel (isolate fast) and the ignition sources (stop hot work, vehicles, non-rated equipment) while the gas detectors buy time.');
    // Flash fire: anyone inside the flammable cloud is harmed.
    for (const c of S.crew) {
      if (lelAt(S, c.x, c.y) > 60 || U.dist(c.x, c.y, lk.x, lk.y) < 6) {
        L.crewMod && L.crewMod.injure(S, c, 'caught in flash fire at ' + lk.label);
      }
    }
    for (const b of S.bays) {
      const tr = b.truckId && S.trucks.find((x) => x.id === b.truckId);
      if (tr && !tr.driverEvacuated && U.dist(b.x, b.y, lk.x, lk.y) < 14) {
        tr.driverEvacuated = true;
        S.stats.injuries = (S.stats.injuries || 0) + 1;
        sim.score(S, 'safety', -30, 'Driver of ' + tr.plate + ' burned in flash fire at ' + b.tag, 'Drivers must leave the bay on a gas alarm. Sound the bay alarm and stop loading at the first detector, not the second.');
        sim.log(S, 'safety', 'Driver of ' + tr.plate + ' injured at ' + b.tag + '. Ambulance requested.', 'crit');
      }
    }
    for (const pm of S.permits) {
      if (pm.status === 'active' && pm.loc && U.dist(pm.loc.x, pm.loc.y, lk.x, lk.y) < 30) {
        S.stats.injuries = (S.stats.injuries || 0) + 1;
        sim.score(S, 'safety', -30, 'Contractor working under ' + pm.no + ' injured by the fire', 'Live permits in an area with a gas alarm must be suspended and the workers withdrawn immediately.');
        pm.status = 'suspended';
      }
    }
    sim.requestPause(S, 'Fire at ' + lk.label);
  }

  sim.register({
    name: 'firegas', order: 40,
    init(S) {
      S.leaks = []; S.fires = [];
      S.gd = D.GAS_DET.map((d) => ({ id: d.id, tag: d.tag, zone: d.zone, x: d.x, y: d.y, lel: 0, inhibited: false, fault: false, why: '' }));
      S.fd = D.FLAME_DET.map((d) => ({ id: d.id, tag: d.tag, zone: d.zone, x: d.x, y: d.y, fire: false, inhibited: false }));
      S.confirmed = { gas: {}, fire: {} };
    },
    tick(S, dt) {
      const W = S.weather;
      // --- Leaks
      for (const lk of S.leaks) {
        const fed = leakFed(S, lk);
        lk.fed = fed;
        if (fed) lk.rate = approach(lk.rate, lk.rate0, dt, 60);
        else {
          // Trapped inventory bleeds down.
          const out = Math.min(lk.residual, lk.rate * dt);
          lk.residual -= out;
          lk.rate = lk.residual > 0.5 ? Math.max(0.002, lk.rate * Math.exp(-dt / 25)) : 0;
        }
        const kg = lk.rate * dt;
        lk.total += kg;
        S.stats.vented += kg;
        // Take released mass from the vessel it came from where we can.
        if (lk.src.kind === 'manifold' || lk.src.kind === 'tankpsv') S.tanks[lk.src.id].M -= kg;
        else if (lk.src.kind === 'truckpsv') {
          const tr = S.trucks.find((x) => x.id === lk.src.id);
          if (tr) { tr.content = Math.max(0, tr.content - kg); if (tr.pos) { lk.x = tr.pos.x; lk.y = tr.pos.y - 3; } }
        }
        else if (lk.src.kind === 'pump') { const tk = S.tanks[S.headers[S.pumps[lk.src.id].product].source]; if (tk) tk.M -= kg; }
        // First discovery messages
        if (!lk.seen) {
          const near = S.gd.some((g) => !g.inhibited && g.lel > 10 && U.dist(g.x, g.y, lk.x, lk.y) < 40);
          if (near) lk.seen = true;
        }
      }
      // --- Ignition
      for (const lk of S.leaks) {
        if (lk.ignited || lk.rate < 0.005) continue;
        let p = 0.00003 * Math.sqrt(lk.rate) * S.diff.faultMult;
        for (const src of ignitionSources(S)) {
          const c = lelAt(S, src.x, src.y);
          if (c > 55) p += 0.012 * (src.strength || 1);
          else if (c > 30) p += 0.0015 * (src.strength || 1);
        }
        if (S.rng.chance(p * dt)) ignite(S, lk, ignitionCause(S, lk));
      }
      // --- Fires
      for (const f of S.fires) {
        const lk = S.leaks.find((x) => x.id === f.leakId);
        f.size = lk ? lk.rate : 0;
        if (!lk || lk.rate < 0.004) {
          f.out = (f.out || 0) + dt;
        }
      }
      for (const f of S.fires.slice()) {
        if (f.out > 45) {
          S.fires.splice(S.fires.indexOf(f), 1);
          sim.log(S, 'safety', 'Fire at ' + f.label + ' is out — fuel exhausted after isolation.', 'warn');
          sim.lesson(S, 'gasfire', 'Let a gas fire burn until the fuel is isolated', 'Extinguishing a jet fire while the gas is still flowing creates an unignited cloud that can re-ignite explosively. The rule is: isolate the source, cool the exposures, and let the fire burn out.');
        }
      }
      // Remove dead leaks
      for (const lk of S.leaks.slice()) {
        if (lk.rate <= 0 && !lk.fed) {
          S.leaks.splice(S.leaks.indexOf(lk), 1);
          sim.log(S, 'ops', 'Release at ' + lk.label + ' has stopped (' + Math.round(lk.total) + ' kg released).');
        }
      }
      // Fire heat on tanks and trucks
      for (const id of S.tankOrder) S.tanks[id].fireQ = 0;
      for (const f of S.fires) {
        if (f.out) continue;
        const MW = f.size * 46; // heat release
        for (const id of S.tankOrder) {
          const t = S.tanks[id];
          const gap = U.dist(f.x, f.y, t.x, t.y) - t.r;
          if (gap < 14) t.fireQ += MW * 1e6 * 0.09 * clamp(1 - gap / 14, 0.1, 1) + 1.5e6 * clamp(1 - gap / 14, 0, 1);
        }
        for (const tr of S.trucks) {
          if (!tr.pos || tr.state === 'GONE') continue;
          const gap = U.dist(f.x, f.y, tr.pos.x, tr.pos.y);
          if (gap < 12) tr.fireQ = (tr.fireQ || 0) + MW * 1e6 * 0.08 * clamp(1 - gap / 12, 0.1, 1) + 1e6;
        }
      }
      // --- Gas detectors
      for (const g of S.gd) {
        const c = lelAt(S, g.x, g.y);
        g.lel = g.fault ? 0 : clamp(c + Math.abs(S.rng.gauss()) * 0.4, 0, 100);
        const live = !g.inhibited && !g.fault;
        sim.setAlarm(S, 'GDL-' + g.id, 'GDLOW', g.tag, live && g.lel >= 20 && g.lel < 40, Math.round(g.lel) + '% LEL');
        sim.setAlarm(S, 'GDH-' + g.id, 'GDHIGH', g.tag, live && g.lel >= 40, Math.round(g.lel) + '% LEL');
        sim.setAlarm(S, 'GDF-' + g.id, 'GDFAULT', g.tag, g.fault);
        sim.setAlarm(S, 'GDI-' + g.id, 'INHIBIT', g.tag, g.inhibited);
      }
      // Confirmed gas: 2ooN at 40% LEL per zone -> automatic area ESD.
      for (const z of ['TF', 'PA', 'LR', 'RL']) {
        const n = S.gd.filter((g) => g.zone === z && !g.inhibited && !g.fault && g.lel >= 40).length;
        const conf = n >= 2;
        if (conf && !S.confirmed.gas[z]) {
          sim.log(S, 'safety', 'Confirmed gas in ' + D.ZONES[z].name + ' (2ooN) — automatic area ESD.', 'crit');
          esdTrip(S, z, 'confirmed gas');
          suspendHotWork(S, 'confirmed gas in ' + D.ZONES[z].name);
        }
        S.confirmed.gas[z] = conf;
        sim.setAlarm(S, 'CONFGAS-' + z, 'CONFGAS', 'F&G-' + z, conf);
      }
      // Gas reaching live hot work
      for (const pm of S.permits) {
        if (pm.status === 'active' && pm.type === 'hot' && pm.loc) {
          const c = lelAt(S, pm.loc.x, pm.loc.y);
          sim.setAlarm(S, 'HW-' + pm.no, 'HWSIMOPS', pm.no, c > 5, Math.round(c) + '% LEL at work site');
        }
      }
      // --- Flame detectors
      for (const fd of S.fd) {
        fd.fire = S.fires.some((f) => !f.out && U.dist(f.x, f.y, fd.x, fd.y) < 55);
        sim.setAlarm(S, 'FD-' + fd.id, 'FLAME', fd.tag, fd.fire && !fd.inhibited);
      }
      for (const z of ['TF', 'PA', 'LR', 'RL']) {
        const n = S.fd.filter((f) => f.zone === z && f.fire && !f.inhibited).length;
        const conf = n >= 2 || (n >= 1 && S.fires.some((f) => f.zone === z && S.t - f.t0 > 60));
        if (conf && !S.confirmed.fire[z]) {
          sim.log(S, 'safety', 'Confirmed fire in ' + D.ZONES[z].name + ' — deluge released, site ESD.', 'crit');
          for (const d of D.DELUGE) {
            const covZone = d.zone === z;
            const nearTank = S.tanks[d.covers] && S.fires.some((f) => U.dist(f.x, f.y, S.tanks[d.covers].x, S.tanks[d.covers].y) < 40);
            if ((covZone && !S.tanks[d.covers]) || nearTank) openDeluge(S, d.id, 'F&G auto');
          }
          esdTrip(S, 'site', 'confirmed fire');
          suspendHotWork(S, 'fire');
        }
        S.confirmed.fire[z] = conf;
        sim.setAlarm(S, 'CONFFIRE-' + z, 'CONFFIRE', 'F&G-' + z, conf);
      }
      // People near a fire
      for (const c of S.crew) {
        if (c.injured) continue;
        for (const f of S.fires) if (!f.out && U.dist(c.x, c.y, f.x, f.y) < 10) L.crewMod && L.crewMod.injure(S, c, 'heat from fire at ' + f.label);
      }
      // No muster during a fire
      if (S.fires.length && !S.muster.active) {
        const f0 = Math.min(...S.fires.map((f) => f.t0));
        if (S.t - f0 > 300 && !S.flags.noMusterPen) {
          S.flags.noMusterPen = true;
          sim.score(S, 'safety', -6, 'No muster called 5 minutes into a fire', 'Sound the general alarm early so everyone not fighting the emergency goes to the muster point and can be counted.');
        }
      }
      if (S.fires.length && !S.fireBrigade.called) {
        const f0 = Math.min(...S.fires.map((f) => f.t0));
        if (S.t - f0 > 300 && !S.flags.noBrigadePen) {
          S.flags.noBrigadePen = true;
          sim.score(S, 'compliance', -5, 'Fire service not called within 5 minutes of a fire');
        }
      }
      sim.setAlarm(S, 'ESD-SITE', 'ESD', 'ESD-SITE', S.esd.site);
      for (const z of ['TF', 'PA', 'LR', 'RL']) sim.setAlarm(S, 'ESD-' + z, 'ESD', 'ESD-' + z, S.esd.zones[z]);
    },
  });

  function ignitionSources(S) {
    const out = [];
    for (const pm of S.permits) if (pm.status === 'active' && pm.ignition && pm.loc) out.push({ x: pm.loc.x, y: pm.loc.y, strength: 2, what: 'hot work ' + pm.no });
    for (const tr of S.trucks) {
      if (!tr.pos) continue;
      if (tr.engineOn || ['TO_WB_IN', 'TO_BAY', 'TO_WB_OUT', 'EXITING', 'TO_PARK', 'TO_DECANT'].includes(tr.state)) out.push({ x: tr.pos.x, y: tr.pos.y, strength: 1, what: 'vehicle ' + tr.plate });
    }
    for (const pm of S.permits) if (pm.status === 'active' && pm.type === 'vehicle' && pm.loc) out.push({ x: pm.loc.x, y: pm.loc.y, strength: 1.5, what: 'contractor vehicle ' + pm.no });
    return out;
  }
  function ignitionCause(S, lk) {
    let best = null, bc = 30;
    for (const src of ignitionSources(S)) { const c = lelAt(S, src.x, src.y); if (c > bc) { bc = c; best = src; } }
    return best ? best.what : 'static discharge / hot surface';
  }
  function suspendHotWork(S, why) {
    for (const pm of S.permits) {
      if (pm.status === 'active' && (pm.ignition || pm.type === 'confined' || pm.type === 'height')) {
        pm.status = 'suspended';
        pm.suspendedWhy = why;
        sim.log(S, 'permit', pm.no + ' suspended (' + why + '). Work stopped, crew withdrawn.', 'warn');
      }
    }
  }

  // ===================================================================================
  // ESD and deluge
  // ===================================================================================
  function esdTrip(S, scope, cause) {
    if (scope === 'site') {
      if (S.esd.site) return;
      S.esd.site = true;
    } else {
      if (S.esd.zones[scope] || S.esd.site) return;
      S.esd.zones[scope] = true;
    }
    S.esd.history.push({ t: S.t, scope, cause });
    sim.log(S, 'safety', 'ESD ' + (scope === 'site' ? 'SITE' : D.ZONES[scope].name) + ' activated — ' + cause + '.', 'crit');
    const zones = scope === 'site' ? ['TF', 'PA', 'LR', 'RL'] : [scope];
    if (zones.includes('TF')) for (const id of S.tankOrder) { S.tanks[id].xvIn = false; S.tanks[id].xvOut = false; }
    if (zones.includes('PA')) for (const p of Object.values(S.pumps)) if (p.running) { p.running = false; p.autoStarted = false; }
    if (zones.includes('LR') || zones.includes('TF') || zones.includes('PA')) for (const b of S.bays) L.rack && L.rack.esdStopBay(S, b, 'ESD');
    if (zones.includes('RL') || zones.includes('TF')) L.rail && L.rail.esdStop(S);
    if (scope === 'site') for (const tr of S.trucks) tr.engineOn = false;
  }
  function esdReset(S, scope) {
    const zones = scope === 'site' ? ['TF', 'PA', 'LR', 'RL'] : [scope];
    for (const z of zones) {
      if (S.confirmed.gas[z]) return { ok: false, msg: 'Cannot reset: confirmed gas still present in ' + D.ZONES[z].name + '.' };
      if (S.fires.some((f) => f.zone === z && !f.out)) return { ok: false, msg: 'Cannot reset: fire still burning in ' + D.ZONES[z].name + '.' };
      const maxLel = Math.max(0, ...S.gd.filter((g) => g.zone === z && !g.fault).map((g) => g.lel));
      if (maxLel > 10) return { ok: false, msg: 'Cannot reset: ' + Math.round(maxLel) + '% LEL still detected in ' + D.ZONES[z].name + '. Wait until below 10%.' };
    }
    if (scope === 'site') { S.esd.site = false; for (const z of zones) S.esd.zones[z] = false; }
    else S.esd.zones[scope] = false;
    sim.log(S, 'ops', 'ESD ' + (scope === 'site' ? 'SITE' : D.ZONES[scope].name) + ' reset by operator. Equipment remains stopped — restore the line-up deliberately.');
    return { ok: true, msg: 'ESD reset. ROSOVs stay closed until you reopen them.' };
  }
  function openDeluge(S, id, by) {
    const dv = S.fw.deluge[id];
    if (dv.open) return;
    dv.open = true; dv.by = by; dv.t = S.t;
    sim.log(S, 'safety', D.DELUGE.find((d) => d.id === id).tag + ' deluge OPEN (' + by + ').', 'warn');
  }

  // ===================================================================================
  // Actions
  // ===================================================================================
  const A = sim.action;
  A('setTankValve', (S, id, which, open) => {
    const t = S.tanks[id];
    if (!t) return { ok: false, msg: 'No such tank' };
    if (open && esdActive(S, 'TF')) return { ok: false, msg: 'Tank farm ESD active — reset it first.' };
    if (open && !iaOK(S)) return { ok: false, msg: 'Instrument air too low to stroke the ROSOV.' };
    if (which === 'in') t.xvIn = open; else t.xvOut = open;
    sim.log(S, 'ops', 'XV-' + id.slice(1) + (which === 'in' ? 'A (inlet)' : 'B (outlet)') + ' commanded ' + (open ? 'OPEN' : 'CLOSED') + '.');
    return { ok: true };
  });
  A('setHeaderSource', (S, prod, id) => {
    const t = S.tanks[id], H = S.headers[prod];
    if (!t || t.product !== prod) return { ok: false, msg: 'That vessel does not hold ' + prod + '.' };
    if (H.source === id) return { ok: true };
    H.source = id;
    sim.log(S, 'ops', prod[0].toUpperCase() + prod.slice(1) + ' loading header lined up to ' + t.tag + '.');
    if (t.offspec) sim.log(S, 'ops', 'Note: ' + t.tag + ' contents are flagged off-spec.', 'warn');
    return { ok: true, msg: 'Header now drawing from ' + t.tag + '.' };
  });
  A('setHeaderMode', (S, prod, mode) => { S.headers[prod].mode = mode; sim.log(S, 'ops', prod + ' header pump control set to ' + mode.toUpperCase() + '.'); return { ok: true }; });
  A('pumpStart', (S, id) => {
    const p = S.pumps[id];
    if (p.loto) return { ok: false, msg: p.tag + ' is locked out under a permit. Close the permit first.' };
    if (p.tripped) return { ok: false, msg: p.tag + ' is tripped (' + p.tripCause + '). Reset the trip first.' };
    if (p.isolated) return { ok: false, msg: p.tag + ' suction/discharge valves are closed.' };
    if (!powerOK(S)) return { ok: false, msg: 'No power to the motor control centre.' };
    if (esdActive(S, 'PA')) return { ok: false, msg: 'Pump area ESD is active.' };
    const src = S.tanks[S.headers[p.product].source];
    if (!src || !outletOpen(S, src)) return { ok: false, msg: 'Suction vessel outlet valve is closed.' };
    if (src.fill <= 0.05) return { ok: false, msg: 'Suction vessel at low-low level.' };
    p.running = true; p.autoStarted = false; p.startT = S.t;
    sim.log(S, 'ops', p.tag + ' started by operator.');
    return { ok: true };
  });
  A('pumpStop', (S, id) => { const p = S.pumps[id]; p.running = false; p.autoStarted = false; sim.log(S, 'ops', p.tag + ' stopped by operator.'); return { ok: true }; });
  A('pumpReset', (S, id) => {
    const p = S.pumps[id];
    if (!p.tripped) return { ok: true };
    if (p.tripCause === 'vibration high-high' && p.vib > 7) return { ok: false, msg: 'Vibration still high; inspect the pump first.' };
    p.tripped = false; p.tripCause = '';
    sim.log(S, 'ops', p.tag + ' trip reset.');
    return { ok: true };
  });
  A('pumpDuty', (S, id) => {
    const p = S.pumps[id];
    for (const q of Object.values(S.pumps)) if (q.product === p.product) q.duty = q.id === id;
    sim.log(S, 'ops', p.tag + ' selected as duty pump.');
    return { ok: true };
  });
  A('pumpIsolate', (S, id, iso) => {
    const p = S.pumps[id];
    if (iso && p.running) { p.running = false; p.autoStarted = false; }
    p.isolated = iso;
    sim.log(S, 'ops', p.tag + (iso ? ' isolated — suction and discharge MOVs closed.' : ' de-isolated — suction and discharge MOVs open.'));
    return { ok: true };
  });
  A('esd', (S, scope) => { esdTrip(S, scope, 'manual operator initiation'); return { ok: true }; });
  A('esdReset', (S, scope) => esdReset(S, scope));
  A('deluge', (S, id, open) => {
    if (open) openDeluge(S, id, 'operator');
    else { S.fw.deluge[id].open = false; sim.log(S, 'safety', D.DELUGE.find((d) => d.id === id).tag + ' deluge closed by operator.'); }
    return { ok: true };
  });
  A('fwPump', (S, which, run) => {
    const p = S.fw[which];
    if (run) {
      if (p.failed) return { ok: false, msg: p.tag + ' has failed — needs repair.' };
      if (which === 'elec' && !powerOK(S)) return { ok: false, msg: 'No power for the electric fire pump.' };
      if (p.failLatent) { p.failed = true; sim.log(S, 'ops', p.tag + ' FAILED TO START on manual start.', 'crit'); return { ok: false, msg: p.tag + ' failed to start.' }; }
      p.running = true;
      if (which === 'diesel' && p.testStarted === null && !p.tested) p.testStarted = S.t;
      sim.log(S, 'ops', p.tag + ' started by operator' + (which === 'diesel' && !p.tested ? ' (weekly run test).' : '.'));
    } else {
      if (which === 'diesel' && p.testStarted !== null && !p.tested) { p.testStarted = null; sim.log(S, 'ops', 'P-502 stopped before 30 min — run test incomplete.', 'warn'); }
      p.running = false;
      sim.log(S, 'ops', p.tag + ' stopped by operator.');
    }
    return { ok: true };
  });
  A('iaStart', (S, id) => {
    const c = S.util.ia.comps.find((x) => x.id === id);
    if (!powerOK(S)) return { ok: false, msg: 'No power.' };
    c.tripped = false; c.running = true;
    sim.log(S, 'ops', c.tag + ' started.');
    return { ok: true };
  });
  A('iaStop', (S, id) => { const c = S.util.ia.comps.find((x) => x.id === id); c.running = false; sim.log(S, 'ops', c.tag + ' stopped.'); return { ok: true }; });
  A('gdInhibit', (S, id, on) => {
    const g = S.gd.find((x) => x.id === id);
    g.inhibited = on;
    sim.log(S, 'safety', g.tag + (on ? ' INHIBITED by operator.' : ' inhibit removed.'), on ? 'warn' : 'info');
    if (on && !g.fault) sim.score(S, 'compliance', -2, 'Healthy detector ' + g.tag + ' inhibited without a work order', 'Inhibiting a healthy detector removes protection. Inhibits need authorisation, a reason and a compensating measure.');
    return { ok: true };
  });
  A('muster', (S, on) => {
    S.muster.active = on; S.muster.t = S.t;
    if (on) {
      sim.log(S, 'safety', 'GENERAL ALARM sounded — all non-essential personnel to muster point. Permits suspended.', 'crit');
      suspendHotWork(S, 'muster');
      for (const pm of S.permits) if (pm.status === 'active') { pm.status = 'suspended'; pm.suspendedWhy = 'muster'; }
      for (const tr of S.trucks) if (tr.bay) tr.driverEvacuated = true;
      L.crewMod && L.crewMod.musterAll(S);
      const real = S.leaks.some((l) => l.rate > 0.02) || S.fires.length > 0;
      if (!real && !S.flags.falseMuster) { S.flags.falseMuster = true; sim.score(S, 'throughput', -4, 'General alarm with no gas or fire present'); }
    } else {
      sim.log(S, 'safety', 'All clear given. Personnel may return to work areas.');
      for (const tr of S.trucks) tr.driverEvacuated = false;
      for (const c of S.crew) if (c.task && c.task.kind === 'muster') { c.task = null; c.state = 'idle'; }
    }
    return { ok: true };
  });
  A('callFireBrigade', (S) => {
    const fb = S.fireBrigade;
    if (fb.called) return { ok: false, msg: 'Fire service already called.' };
    fb.called = true; fb.tCall = S.t; fb.arrival = S.t + 12 * 60;
    sim.log(S, 'safety', 'Fire service called (999). Estimated arrival ' + U.clock(S, fb.arrival) + '.', 'warn');
    const real = S.leaks.some((l) => l.rate > 0.05) || S.fires.length > 0;
    if (!real) sim.score(S, 'throughput', -3, 'Fire service called with no incident in progress');
    return { ok: true };
  });

  L.plant = { esdActive, esdTrip, esdReset, powerOK, iaOK, inletOpen, outletOpen, addLeak, ignite, lelAt, tankDerived, delugeEff, tankDelugeEff, openDeluge, suspendHotWork, ATM, NONCOND };
})(globalThis.LPG = globalThis.LPG || {});
