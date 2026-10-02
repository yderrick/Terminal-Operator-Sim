/* Rail tank car unloading by vapour compressor (liquid transfer, then vapour recovery). */
(function (L) {
  'use strict';
  const U = L.util, P = L.phys, sim = L.sim;
  const { clamp, approach } = U;
  const ATM = 1.013;

  function carDerived(c) {
    const Pabs0 = P.psat(c.wP, c.T);
    const rl = P.rhoL(c.wP, c.T);
    const rvNow = P.rhoV(c.wP, c.T, Pabs0 + c.dP);
    const liquidVol = (c.M - rvNow * c.V) / (rl - rvNow);
    if (liquidVol > 0.02) {
      const part = P.partition(c.M, c.V, c.wP, c.T, Pabs0 + c.dP);
      c.ml = part.ml; c.mv = part.mv; c.Vl = part.Vl;
      c.Psat = Pabs0;
      c.Pabs = Pabs0 + c.dP;
    } else {
      // No liquid left: the car holds vapour only, pressure from the gas law.
      const mw = 44.1 * c.wP + 58.1 * (1 - c.wP);
      const Pgas = (c.M / c.V) * 8.314 * (c.T + 273.15) / mw / 100 / Math.max(0.75, 1 - 0.012 * (Pabs0 + c.dP));
      c.ml = 0; c.mv = c.M; c.Vl = 0;
      c.Pabs = Math.min(Pgas, Pabs0 + c.dP);
      c.Psat = Math.min(Pabs0, c.Pabs);
      c.dP = Math.max(0, c.Pabs - Pabs0);
    }
    c.P = c.Pabs - ATM;
    c.fill = c.Vl / c.V;
  }

  sim.register({
    name: 'rail', order: 35,
    init(S) {
      const r = S.rng;
      S.rail = {
        cars: [], spots: { R1: null, R2: null },
        comp: { tag: 'C-301', running: false, mode: 'LIQUID', lineup: null, tank: 'V102', dischT: 25, dischP: 0, suctP: 0, ko: 0, tripped: false, tripCause: '', ratio: 1 },
      };
      const arrivals = [r.range(1.2, 2.0) * 3600, r.range(6.4, 7.6) * 3600];
      let n = 0;
      arrivals.forEach((at, pi) => {
        const count = pi === 0 ? 2 : r.chance(0.6) ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const V = r.pick([95, 102, 110]);
          const offspec = r.chance(0.18 * S.diff.faultMult) && !S.rail.cars.some((c) => c.offspec);
          const wP = offspec ? r.range(0.81, 0.87) : r.range(0.975, 0.988);
          const T = r.range(13, 19);
          const fillMass = 0.42 * V * 1000 * r.range(0.97, 1.0);
          const c = {
            id: ++n, number: '33 80 7' + r.int(810, 899) + ' ' + r.int(100, 999) + '-' + r.int(0, 9), spotId: i === 0 ? 'R1' : 'R2',
            V, wP, T, M: fillMass, dP: 0, arrivalT: at + i * 120, freeUntil: at + 6 * 3600, declared: Math.round(fillMass / 10) * 10,
            state: 'ENROUTE', secured: false, connected: false, sample: null, valvesOpen: false, phase: 'liquid', released: false,
            received: 0, recovered: 0, offspec, gland: r.chance(0.25 * S.diff.faultMult), glandFound: false, demurH: 0, busy: null,
            docs: { tankCode: 'P25BN', testDue: S.date + r.int(90, 1500) * 86400000, rid: 'RID 2.1 F, UN 1978', shipper: 'Saltfleet Refinery' },
          };
          carDerived(c);
          S.rail.cars.push(c);
        }
      });
    },
    tick(S, dt) {
      const R = S.rail, comp = R.comp;
      for (const c of R.cars) {
        if (c.state === 'ENROUTE' && S.t >= c.arrivalT) {
          if (R.spots[c.spotId] === null) {
            R.spots[c.spotId] = c.id; c.state = 'SPOTTED';
            sim.log(S, 'rail', 'Rail car ' + c.number + ' placed at spot ' + c.spotId + ' by the shunter. Declared ' + U.fmt.kg(c.declared) + ' propane. Free time until ' + U.clock(S, c.freeUntil) + '.');
          } else if (!c.waitLogged) { c.waitLogged = true; sim.log(S, 'rail', 'Rail car ' + c.number + ' waiting in the exchange siding — spot ' + c.spotId + ' occupied.'); }
        }
        if (c.state === 'ENROUTE' && S.t >= c.arrivalT && R.spots[c.spotId] === null) { R.spots[c.spotId] = c.id; c.state = 'SPOTTED'; }
        // Demurrage
        if (['SPOTTED', 'ENROUTE'].includes(c.state) || (c.state !== 'RELEASED' && S.t >= c.arrivalT)) {
          if (c.state !== 'RELEASED' && S.t > c.freeUntil) {
            const h = Math.floor((S.t - c.freeUntil) / 3600) + 1;
            if (h > c.demurH) { c.demurH = h; S.stats.demurrageH++; sim.score(S, 'throughput', -2, 'Demurrage: car ' + c.number + ' hour ' + h + ' over free time'); }
          }
          sim.setAlarm(S, 'DEMUR-' + c.id, 'DEMUR', c.number, c.state !== 'RELEASED' && S.t > c.freeUntil);
        }
        c.T = approach(c.T, S.weather.Tamb + 3 * S.weather.solar, dt, 5 * 3600);
        if (!(comp.running && comp.lineup === c.id && comp.mode === 'LIQUID') && c.ml > 0) c.dP = approach(c.dP, 0, dt, 900);
        carDerived(c);
      }
      // Compressor
      const car = R.cars.find((x) => x.id === comp.lineup);
      const tank = S.tanks[comp.tank];
      if (comp.running) {
        let trip = null;
        if (!L.plant.powerOK(S)) trip = 'power dip';
        else if (L.plant.esdActive(S, 'RL')) trip = 'ESD';
        else if (!car || !car.connected || !car.valvesOpen) trip = 'car not connected';
        else if (comp.dischT > 135) trip = 'discharge temperature high-high';
        else if (comp.ko > 85) trip = 'knock-out pot level high-high';
        else if (comp.dischP > 18.5) trip = 'discharge pressure high-high';
        if (trip) {
          comp.running = false;
          if (trip !== 'ESD' && trip !== 'car not connected') { comp.tripped = true; comp.tripCause = trip; }
          sim.log(S, 'rail', 'C-301 stopped — ' + trip + '.', trip === 'ESD' ? 'info' : 'warn');
        }
      }
      let liqKgS = 0, vapKgS = 0;
      if (comp.running && car && tank) {
        const inOpen = L.plant.inletOpen(S, tank);
        if (comp.mode === 'LIQUID') {
          comp.suctP = tank.P;
          const target = inOpen ? 2.4 : 3.9;
          car.dP = approach(car.dP, target, dt, 240);
          carDerived(car);
          comp.dischP = car.P;
          const levelHead = tank.level / 1000 * 0.05;
          const dpEff = (car.Pabs - tank.Pabs) - levelHead - 0.3;
          if (inOpen && car.ml > 1 && dpEff > 0) {
            const m3h = 34 * Math.sqrt(dpEff);
            liqKgS = Math.min(car.ml / dt, m3h / 3600 * P.rhoL(car.wP, car.T));
            vapKgS = m3h / 3600 * tank.rv; // vapour pushed from sphere into car
          }
          if (car.ml <= 1 && car.phase === 'liquid') {
            car.phase = 'liquid-done';
            sim.log(S, 'rail', 'C-301 / car ' + car.number + ': sight glass shows vapour — liquid transfer complete. Stop, switch the 4-way valve to VAPOUR RECOVERY, restart.');
            sim.lesson(S, 'vaprec', 'Why recover the vapour?', 'An "empty" pressure car still holds its volume of vapour at several bar — around 1.5 t of propane in a 110 m³ car. Reversing the compressor pulls that vapour back into the sphere where it condenses. Stop around 1.5 barg: going lower raises compressor temperature, and a car must never go toward vacuum.');
          }
          comp.ko = approach(comp.ko, 5, dt, 300);
        } else {
          // VAPOUR RECOVERY: suction from car vapour space, discharge into sphere.
          comp.suctP = car.P;
          comp.dischP = tank.P + 0.4;
          if (car.ml > 300) {
            comp.ko = clamp(comp.ko + 1.2 * dt, 0, 100); // liquid carried over into suction
          } else comp.ko = approach(comp.ko, 5, dt, 300);
          if (inOpen) {
            vapKgS = -Math.min(car.mv / dt, 0.11 * Math.max(car.Pabs - 1.05, 0));
          }
          if (car.P < 1.5 && !car.recLogged) { car.recLogged = true; sim.log(S, 'rail', 'Car ' + car.number + ' at 1.5 barg — vapour recovery target reached. Stop C-301.'); }
        }
        const Ts = 273.15 + (comp.mode === 'LIQUID' ? tank.Ts : car.T);
        comp.ratio = Math.max(1, (comp.dischP + ATM) / Math.max(comp.suctP + ATM, 0.2));
        const Td = Ts * (1 + (Math.pow(comp.ratio, 0.115) - 1) / 0.72) - 273.15;
        comp.dischT = approach(comp.dischT, Td + 6, dt, 180);
        // Apply mass transfer
        car.M -= liqKgS * dt;
        car.M += vapKgS * dt;
        tank.M += liqKgS * dt - vapKgS * dt;
        if (liqKgS > 0) {
          const ml = Math.max(tank.ml, 1);
          tank.wP = (tank.wP * ml + car.wP * liqKgS * dt) / (ml + liqKgS * dt);
          tank.Tb = (tank.Tb * ml + car.T * liqKgS * dt) / (ml + liqKgS * dt);
          tank.inflow += liqKgS * 3.6 / tank.rl * 1000;
          if (tank.wP < 0.95 && !tank.offspec) {
            tank.offspec = true;
            sim.log(S, 'ops', tank.tag + ' composition now outside propane specification (C4+ ' + ((1 - tank.wP) * 100).toFixed(1) + '%).', 'warn');
            sim.score(S, 'compliance', -8, tank.tag + ' contaminated with off-spec rail receipt', 'Sample every rail car before unloading. Once off-spec product is in a sphere, every truck loaded from it carries the problem to customers.');
          }
        }
        car.received += liqKgS * dt - vapKgS * dt;
        if (vapKgS < 0) car.recovered += -vapKgS * dt;
        S.stats.received += liqKgS * dt - vapKgS * dt;
        R.flowKgS = liqKgS;
        R.vapKgS = vapKgS;
        carDerived(car);
      } else {
        comp.dischT = approach(comp.dischT, S.weather.Tamb, dt, 600);
        comp.dischP = 0; comp.suctP = 0; R.flowKgS = 0; R.vapKgS = 0;
        comp.ko = approach(comp.ko, comp.ko > 30 && !comp.drained ? comp.ko : 3, dt, 900);
      }
      sim.setAlarm(S, 'COMPT', 'COMPT', 'TT-301', comp.running && comp.dischT > 120, Math.round(comp.dischT) + ' °C');
      sim.setAlarm(S, 'COMPP', 'COMPP', 'PT-301', comp.running && comp.dischP > 16.5, comp.dischP.toFixed(1) + ' barg');
      sim.setAlarm(S, 'KOPOT', 'KOPOT', 'LT-301', comp.ko > 60, Math.round(comp.ko) + '%');
      if (car) sim.setAlarm(S, 'CARLOW', 'CARLOW', car.number, comp.running && comp.mode === 'VAPOUR' && car.P < 1.0, car.P.toFixed(2) + ' barg');
      if (comp.running && comp.mode === 'VAPOUR' && car && car.P < 0.3 && !car.vacPen) {
        car.vacPen = true;
        sim.score(S, 'safety', -5, 'Car ' + car.number + ' drawn down below 0.3 barg', 'Pressure tank cars are not designed for vacuum. Air can also be drawn in at disconnection, creating a flammable mixture inside the car.');
      }
      if (comp.tripped && comp.tripCause === 'knock-out pot level high-high' && !comp.koPen) {
        comp.koPen = true;
        sim.score(S, 'safety', -4, 'C-301 tripped on liquid carry-over (vapour recovery started with liquid still in the car)', 'Reciprocating compressors cannot compress liquid. The knock-out pot trip saved the machine. Wait for the sight glass to show vapour before reversing the 4-way valve.');
      }
    },
  });

  function leakFed(S, carId) {
    const c = S.rail.cars.find((x) => x.id === carId);
    return !!c && c.valvesOpen && c.M > 50;
  }
  function esdStop(S) {
    const comp = S.rail.comp;
    if (comp.running) { comp.running = false; sim.log(S, 'rail', 'C-301 stopped by ESD. Plant-side ROSOVs on the unloading hoses closed.'); }
  }

  // ---------------------------------------------------------------------------------
  const A = sim.action;
  function car(S, id) { return S.rail.cars.find((x) => x.id === id); }
  function needCrew(S, c, kind, label, dur, done) {
    const pt = L.data.POINTS[c.spotId === 'R1' ? 'railR1' : 'railR2'];
    return L.crewMod.dispatch(S, null, { kind, label: label + ' — car ' + c.number, x: pt.x, y: pt.y - 4, work: dur, done });
  }
  A('railSecure', (S, id) => {
    const c = car(S, id);
    if (!c || c.state !== 'SPOTTED') return { ok: false, msg: 'Car not spotted.' };
    if (c.secured || c.busy) return { ok: false, msg: 'Already done or in progress.' };
    const res = needCrew(S, c, 'rail', 'Secure car: blue flag, derail, chocks, handbrake', 6 * 60, (S2) => {
      c.secured = true; c.busy = null;
      sim.log(S2, 'rail', 'Car ' + c.number + ' secured: blue flag up, derail on, chocks in, handbrake applied. Spot locked out from shunting.');
    });
    if (res.ok) c.busy = 'secure';
    return res;
  });
  A('railConnect', (S, id) => {
    const c = car(S, id);
    if (!c || !c.secured) return { ok: false, msg: 'Secure the car with blue flag and derail first.' };
    if (c.connected || c.busy) return { ok: false, msg: 'Already done or in progress.' };
    const res = needCrew(S, c, 'rail', 'Ground, connect hoses, leak test', 12 * 60, (S2, crew) => {
      c.busy = null;
      if (c.gland && !c.glandFound) {
        c.glandFound = true;
        sim.radio(S2, crew.call, 'Leak test on car ' + c.number + ': I\'ve got a weep at the liquid valve gland, sniffer reads 15% LEL right at the stem. Tightening the gland nut now.');
        sim.log(S2, 'rail', 'Gland on car ' + c.number + ' tightened; retest passed.');
        S2.stats.nearMisses++;
        c.gland = false;
      }
      c.connected = true; c.valvesOpen = true;
      sim.log(S2, 'rail', 'Car ' + c.number + ': ground and bonding connected, liquid and vapour hoses connected, leak test passed, car valves open.');
    });
    if (res.ok) c.busy = 'connect';
    return res;
  });
  A('railSample', (S, id) => {
    const c = car(S, id);
    if (!c || !c.secured) return { ok: false, msg: 'Secure the car first.' };
    if (c.sample) return { ok: false, msg: 'Sample already taken.' };
    if (c.busy) return { ok: false, msg: 'Field crew already working on this car.' };
    const res = needCrew(S, c, 'rail', 'Take pressure sample cylinder to lab', 8 * 60, (S2) => {
      c.busy = null;
      c.sample = { status: 'lab', t: S2.t + 20 * 60 };
      sim.log(S2, 'rail', 'Sample from car ' + c.number + ' at the lab. Gas chromatograph result due ' + U.clock(S2, c.sample.t) + '.');
    });
    if (res.ok) c.busy = 'sample';
    return res;
  });
  A('railRelease', (S, id) => {
    const c = car(S, id);
    if (!c || c.state === 'RELEASED') return { ok: false, msg: 'Nothing to release.' };
    if (S.rail.comp.running && S.rail.comp.lineup === c.id) return { ok: false, msg: 'Stop C-301 first.' };
    if (c.busy) return { ok: false, msg: 'Field crew busy on this car.' };
    const doRelease = (S2) => {
      c.busy = null;
      c.connected = false; c.valvesOpen = false; c.secured = false; c.state = 'RELEASED'; c.releasedT = S2.t;
      S2.rail.spots[c.spotId] = null;
      if (S2.rail.comp.lineup === c.id) S2.rail.comp.lineup = null;
      const rec = c.received;
      sim.log(S2, 'rail', 'Car ' + c.number + ' released to the shunter. Received ' + U.fmt.kg(rec) + ' (declared ' + U.fmt.kg(c.declared) + '), residual ' + U.fmt.kg(c.M) + ' at ' + c.P.toFixed(1) + ' barg.');
      if (c.received < 0.5 * c.declared && !c.rejected) sim.score(S2, 'throughput', -3, 'Car ' + c.number + ' released largely unloaded');
      if (!c.rejected && c.M > 1500) sim.score(S2, 'throughput', -1, 'Car ' + c.number + ' released without vapour recovery (' + U.fmt.kg(c.M) + ' left aboard)');
      if (c.rejected) sim.log(S2, 'rail', 'Car returned to shipper as off-spec. Claim raised.');
      // Next car waiting for this spot
      const next = S2.rail.cars.find((x) => x.state === 'ENROUTE' && x.spotId === c.spotId && S2.t >= x.arrivalT);
      if (next) { S2.rail.spots[c.spotId] = next.id; next.state = 'SPOTTED'; sim.log(S2, 'rail', 'Car ' + next.number + ' placed at ' + c.spotId + '.'); }
    };
    if (!c.connected && !c.secured) { doRelease(S); return { ok: true }; }
    const res = needCrew(S, c, 'rail', 'Close valves, blow down hoses, disconnect, remove blue flag', 10 * 60, doRelease);
    if (res.ok) c.busy = 'release';
    return res;
  });
  A('railReject', (S, id) => {
    const c = car(S, id);
    if (!c) return { ok: false };
    if (c.received > 500) return { ok: false, msg: 'Already partly unloaded.' };
    c.rejected = true;
    if (c.offspec) { sim.score(S, 'compliance', +3, 'Off-spec car ' + c.number + ' refused'); S.stats.nearMisses++; }
    else sim.score(S, 'throughput', -5, 'In-spec car ' + c.number + ' refused');
    sim.log(S, 'rail', 'Car ' + c.number + ' refused for unloading.');
    return A_release(S, id);
  });
  function A_release(S, id) { return sim.actions.railRelease(S, id); }
  A('compLineup', (S, carId, tankId) => {
    const comp = S.rail.comp;
    if (comp.running) return { ok: false, msg: 'Stop C-301 before changing the line-up.' };
    const t = S.tanks[tankId];
    if (!t || t.product !== 'propane') return { ok: false, msg: 'Rail receipts go to a propane sphere.' };
    comp.lineup = carId; comp.tank = tankId;
    sim.log(S, 'rail', 'C-301 lined up: car ' + (car(S, carId) || { number: '—' }).number + ' → ' + t.tag + '.');
    return { ok: true };
  });
  A('compMode', (S, mode) => {
    const comp = S.rail.comp;
    if (comp.running) return { ok: false, msg: 'Stop the compressor before moving the 4-way valve.' };
    comp.mode = mode;
    sim.log(S, 'rail', 'C-301 4-way valve set to ' + (mode === 'LIQUID' ? 'LIQUID TRANSFER (sphere vapour → car top)' : 'VAPOUR RECOVERY (car vapour → sphere)') + '.');
    return { ok: true };
  });
  A('compStart', (S) => {
    const comp = S.rail.comp;
    const c = car(S, comp.lineup);
    if (comp.tripped) return { ok: false, msg: 'C-301 tripped: ' + comp.tripCause + '. Reset first.' };
    if (!c) return { ok: false, msg: 'No car lined up.' };
    if (!c.connected) return { ok: false, msg: 'Car not connected.' };
    if (L.plant.esdActive(S, 'RL')) return { ok: false, msg: 'Rail ESD active.' };
    if (!L.plant.powerOK(S)) return { ok: false, msg: 'No power.' };
    if (S.simopsHold.RL) return { ok: false, msg: 'Rail unloading suspended under ' + S.simopsHold.RL + '.' };
    if (S.weather.hold) sim.score(S, 'safety', -6, 'Started rail unloading during a lightning stop');
    if (!c.sample && !c.unsampledPen) { c.unsampledPen = true; sim.score(S, 'compliance', -4, 'Started unloading car ' + c.number + ' without a lab sample', 'Always sample before you unload. You cannot take product back out of a sphere.'); }
    else if (c.sample && c.sample.status === 'lab' && !c.unsampledPen) { c.unsampledPen = true; sim.score(S, 'compliance', -2, 'Started unloading car ' + c.number + ' before the lab result'); }
    if (c.sample && c.sample.status === 'done' && c.offspec && !c.offspecPen) { c.offspecPen = true; sim.score(S, 'compliance', -5, 'Knowingly unloaded off-spec car ' + c.number + ' into a propane sphere'); }
    comp.running = true; comp.drained = false;
    if (c.state === 'SPOTTED') c.state = 'UNLOADING';
    sim.log(S, 'rail', 'C-301 started in ' + comp.mode + ' mode on car ' + c.number + '.');
    return { ok: true };
  });
  A('compStop', (S) => { const comp = S.rail.comp; comp.running = false; sim.log(S, 'rail', 'C-301 stopped by operator.'); return { ok: true }; });
  A('compReset', (S) => {
    const comp = S.rail.comp;
    if (!comp.tripped) return { ok: true };
    if (comp.tripCause.includes('knock-out') && comp.ko > 30) {
      return L.crewMod.dispatch(S, null, { kind: 'rail', label: 'Drain C-301 knock-out pot to closed drain', x: L.data.POINTS.comp.x, y: L.data.POINTS.comp.y, work: 8 * 60, done: (S2) => { comp.ko = 3; comp.drained = true; comp.tripped = false; comp.tripCause = ''; sim.log(S2, 'rail', 'C-301 knock-out pot drained, trip reset.'); } });
    }
    if (comp.dischT > 110) return { ok: false, msg: 'Discharge temperature still high — let it cool.' };
    comp.tripped = false; comp.tripCause = '';
    sim.log(S, 'rail', 'C-301 trip reset.');
    return { ok: true };
  });

  // Lab results
  sim.register({
    name: 'lab', order: 36,
    tick(S) {
      for (const c of S.rail.cars) {
        if (c.sample && c.sample.status === 'lab' && S.t >= c.sample.t) {
          c.sample.status = 'done';
          const c3 = c.wP * 100 - S.rng.range(0.4, 1.2);
          const c3e = S.rng.range(0.4, 1.4);
          c.sample.c3 = c3; c.sample.c4 = (1 - c.wP) * 100; c.sample.c3e = c3e; c.sample.c2 = Math.max(0.2, 100 - c3 - c3e - (1 - c.wP) * 100);
          c.sample.pass = c.sample.c4 <= 5.0;
          sim.log(S, 'rail', 'Lab: car ' + c.number + ' — propane ' + c3.toFixed(1) + '%, propylene ' + c3e.toFixed(1) + '%, C4+ ' + c.sample.c4.toFixed(1) + '% — ' + (c.sample.pass ? 'ON SPEC.' : 'OFF SPEC (C4+ limit 5.0%).'), c.sample.pass ? 'info' : 'warn');
        }
      }
    },
  });

  L.rail = { leakFed, esdStop, carDerived };
})(globalThis.LPG = globalThis.LPG || {});
