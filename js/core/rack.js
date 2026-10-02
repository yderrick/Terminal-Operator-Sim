/* Road tankers: bookings, gate inspection, weighbridges, loading bays, release. */
(function (L) {
  'use strict';
  const U = L.util, P = L.phys, D = L.data, sim = L.sim;
  const { clamp } = U;
  const DAY = 86400000;

  const CHECKS = [
    { key: 'pos', label: 'Positioned, engine off, park brake on', dur: [40, 70] },
    { key: 'chocks', label: 'Wheel chocks in place', dur: [30, 50] },
    { key: 'ground', label: 'Static ground clamp — permissive green', dur: [30, 60] },
    { key: 'ppe', label: 'Driver PPE, no phone or lighter on person', dur: [20, 40] },
    { key: 'liquid', label: 'Liquid arm connected (dry-break coupling)', dur: [60, 100] },
    { key: 'vapour', label: 'Vapour return arm connected', dur: [50, 80] },
    { key: 'leak', label: 'Pressurise and leak test couplings', dur: [70, 110] },
    { key: 'internal', label: 'Truck internal valve open, remote ESD tested', dur: [30, 60] },
  ];

  const GATE_DEFECTS = {
    adrDriver: { reason: 'Driver ADR training certificate expired', pen: -6, lesson: 'Drivers of dangerous goods need a valid ADR training certificate (renewed every 5 years). An expired certificate means the driver is not legally qualified to carry LPG.' },
    vehicleCert: { reason: 'Vehicle ADR certificate of approval expired', pen: -6, lesson: 'The ADR certificate of approval confirms the vehicle meets construction rules for its class (FL for flammable liquids and gases). It is renewed annually after inspection.' },
    tankTest: { reason: 'Tank periodic inspection overdue', pen: -10, lesson: 'Pressure tanks have periodic inspections with a hydraulic pressure test (every 6 years, intermediate at 3). An overdue tank may have undetected corrosion or cracks — do not fill it.' },
    placard: { reason: 'Tank approved for butane only (UN 1011)', pen: -12, lesson: 'Butane-only tankers may be built to a lower design pressure. Propane has roughly four times the vapour pressure of butane at summer temperatures. Loading propane into a butane-rated tank can lift its relief valve on the road.' },
    extinguisher: { reason: 'Required fire extinguisher missing', pen: -4, lesson: 'ADR requires portable extinguishers on dangerous-goods vehicles (a 2 kg in the cab plus at least 6 kg more for vehicles over 7.5 t). Missing kit means the vehicle is not roadworthy for DG transport.' },
    noBooking: { reason: 'No booking or valid order reference', pen: -3, lesson: 'Unbooked vehicles disrupt scheduling and may be collecting for a customer without a credit-approved order. Check with sales before admitting.' },
    lastProduct: { reason: 'Previous cargo propylene, no purge certificate', pen: -5, lesson: 'Product changes need a purge certificate. Residual propylene would put propane out of specification (HD-5 limits propylene to 5%).' },
    tyres: { reason: 'Gate inspection: tyre sidewall damage', pen: -5, lesson: 'Gate checks catch roadworthiness defects. A tyre failure on a loaded LPG tanker is a serious road risk.' },
  };
  const REASONS = Object.keys(GATE_DEFECTS).map((k) => ({ key: k, text: GATE_DEFECTS[k].reason }));

  function name(r) { return r.pick(D.PEOPLE.first) + ' ' + r.pick(D.PEOPLE.last); }
  function plate(r) {
    const L2 = 'ABCDEFGHJKLMNPRSTUVWXY';
    return L2[r.int(0, L2.length - 1)] + L2[r.int(0, L2.length - 1)] + r.int(10, 75) + ' ' + L2[r.int(0, L2.length - 1)] + L2[r.int(0, L2.length - 1)] + L2[r.int(0, L2.length - 1)];
  }

  function makeTruck(S, opts) {
    const r = S.rng;
    const product = opts.product || (r.chance(0.68) ? 'propane' : 'butane');
    const rigid = r.chance(0.22);
    let capL, tare, gvw;
    if (rigid) { capL = r.pick([18500, 20500, 22800]); tare = r.int(11200, 12900); gvw = 26000; }
    else { capL = r.pick([38500, 42000, 45200, 49800, 52500]); tare = r.int(14200, 17900); gvw = r.chance(0.7) ? 40000 : 44000; }
    const fr = P.PRODUCTS[product].fillRatio;
    const heel = r.chance(0.85) ? r.int(150, 1400) : 0;
    const fullMax = Math.min(fr * capL - heel, gvw - tare - heel - 60);
    const order = r.chance(0.55) ? 'FULL' : Math.round(Math.min(fullMax * r.range(0.45, 0.9), fullMax) / 500) * 500;
    const today = S.date;
    const fwd = (a, b) => today + r.int(a, b) * DAY;
    const tr = {
      id: ++S.truckSeq, plate: plate(r), haulier: r.pick(D.PEOPLE.hauliers), driver: name(r), product, rigid,
      customer: r.pick(D.PEOPLE.customers), orderRef: 'SO-' + r.int(441000, 449999), order, booked: opts.booked !== false,
      slotT: opts.slotT, arrivalT: opts.arrivalT, capL, tare, gvw, heel, heelProduct: product,
      docs: {
        adrDriver: fwd(40, 1500), vehicleCert: fwd(20, 330), tankTest: fwd(60, 1100), tankTestType: r.chance(0.5) ? 'Intermediate (3-yr)' : 'Periodic (6-yr) hydraulic',
        un: P.PRODUCTS[product].un, kemler: '23', tankCode: product === 'propane' ? 'P26BN' : r.chance(0.5) ? 'P26BN' : 'P10BN', approvedFor: product === 'propane' ? 'UN 1965, 1978, 1011' : 'UN 1965, 1978, 1011',
        ext2: true, ext6: true, lastProduct: product === 'propane' ? 'Propane UN 1978' : 'Butane UN 1011', purgeCert: null, tyres: 'Good', salesNote: null,
      },
      defect: null, bayDefect: null, state: 'INBOUND', stateT: 0, pos: null, bay: null, decants: 0,
      grossIn: null, grossOut: null, wbNet: null, loaded: 0, vapRet: 0, content: heel, Tl: 15, wallT: 20, fireQ: 0, psvLift: false,
      odorShort: 0, offspecKg: 0, gateInT: null, exitT: null, waited: 0, lightningLoaded: 0, engineOn: false,
    };
    if (opts.defect) applyDefect(S, tr, opts.defect);
    return tr;
  }
  function applyDefect(S, tr, d) {
    const r = S.rng, today = S.date;
    tr.defect = d;
    switch (d) {
      case 'adrDriver': tr.docs.adrDriver = today - r.int(3, 120) * DAY; break;
      case 'vehicleCert': tr.docs.vehicleCert = today - r.int(2, 60) * DAY; break;
      case 'tankTest': tr.docs.tankTest = today - r.int(5, 200) * DAY; break;
      case 'placard': tr.product = 'propane'; tr.docs.un = '1011'; tr.docs.tankCode = 'P10BN'; tr.docs.approvedFor = 'UN 1011 only'; tr.docs.lastProduct = 'Butane UN 1011'; break;
      case 'extinguisher': tr.docs.ext6 = false; break;
      case 'noBooking': tr.booked = false; tr.orderRef = 'none quoted'; break;
      case 'lastProduct': tr.docs.lastProduct = 'Propylene UN 1077'; tr.docs.purgeCert = null; tr.product = 'propane'; break;
      case 'tyres': tr.docs.tyres = 'Nearside trailer axle 2: sidewall bulge'; break;
      default: break;
    }
  }

  // ---------------------------------------------------------------------------------
  function setState(S, tr, st) { tr.state = st; tr.stateT = S.t; }
  function truckPos(S, tr) {
    const Pt = D.POINTS;
    const prog = (dur) => clamp((S.t - tr.stateT) / dur, 0, 1);
    const lerpP = (a, b, f) => ({ x: U.lerp(a.x, b.x, f), y: U.lerp(a.y, b.y, f) });
    const bayP = (id) => { const b = S.bays.find((x) => x.id === id); return { x: b.x, y: b.y }; };
    const parkP = (i) => ({ x: Pt.park.x, y: Pt.park.y + (i % 6) * 10 });
    const qIdx = S.trucks.filter((x) => x.state === 'QUEUE').indexOf(tr);
    switch (tr.state) {
      case 'QUEUE': return { x: 274 + Math.min(qIdx, 1) * 10, y: 166 };
      case 'TO_WB_IN': return lerpP(Pt.gate, Pt.wbIn, prog(90));
      case 'WB_IN_Q': return { x: Pt.wbIn.x + 12, y: Pt.wbIn.y + 8 };
      case 'WB_IN': return Pt.wbIn;
      case 'TO_PARK': return lerpP(Pt.wbIn, parkP(tr.parkSlot || 0), prog(60));
      case 'PARKED': case 'DECANT_WAIT': return parkP(tr.parkSlot || 0);
      case 'TO_BAY': return lerpP(parkP(tr.parkSlot || 0), bayP(tr.bay), prog(90));
      case 'AT_BAY': return bayP(tr.bay);
      case 'TO_WB_OUT': return lerpP(bayP(tr.lastBay || 1), Pt.wbOut, prog(90));
      case 'WB_OUT_Q': return { x: Pt.wbOut.x + 10, y: Pt.wbOut.y - 10 };
      case 'WB_OUT': return Pt.wbOut;
      case 'WEIGHED': return { x: 222, y: 158 };
      case 'EXITING': return lerpP({ x: 222, y: 158 }, Pt.gate, prog(60));
      case 'REJECTED': return lerpP({ x: 274, y: 166 }, { x: 296, y: 166 }, prog(60));
      default: return null;
    }
  }
  function freeParkSlot(S) {
    const used = S.trucks.filter((t) => ['TO_PARK', 'PARKED', 'DECANT_WAIT', 'TO_BAY'].includes(t.state)).map((t) => t.parkSlot);
    for (let i = 0; i < 12; i++) if (!used.includes(i)) return i;
    return 0;
  }

  // Max net the truck may take: the lower of the ADR filling limit and the legal gross weight.
  function maxNet(S, tr) {
    const fr = P.PRODUCTS[tr.docs.un === '1011' ? 'butane' : tr.product].fillRatio;
    const adr = fr * tr.capL - tr.heel;
    const gvw = tr.gvw - (tr.tare + tr.heel);
    return { adr, gvw, max: Math.min(adr, gvw), fr };
  }

  // ---------------------------------------------------------------------------------
  sim.register({
    name: 'rack', order: 30,
    init(S) {
      const r = S.rng, d = S.diff;
      S.trucks = []; S.truckSeq = 0;
      S.wb = { in: { busy: null, zero: 0 }, out: { busy: null, zero: 0 } };
      S.bays = D.BAYS.map((b) => ({
        id: b.id, tag: b.tag, x: b.x, y: b.y, product: b.product, swing: b.swing, state: 'IDLE', truckId: null,
        checks: {}, checkIdx: 0, checkT: 0, checkDur: 0, hold: null, preset: 0, delivered: 0, net: 0, flowLpm: 0, wantFlow: 0,
        flowing: false, ground: 'none', groundOverride: false, stopReason: '', odorPpm: 0, meterT: 0, meterRho: 0, suspended: false,
        changeoverT: 0, startT: 0, engineT: null, decantTarget: 0,
      }));
      // Bookings: morning-heavy profile across the shift.
      const n = d.trucks;
      const times = [];
      for (let i = 0; i < n; i++) {
        const f = i / n;
        const shaped = Math.pow(f, 1.12);
        times.push(Math.round(8 * 60 + shaped * 10.4 * 3600 + r.range(-10, 10) * 60));
      }
      const defectsPool = Object.keys(GATE_DEFECTS).filter((k) => k !== 'noBooking');
      times.sort((a, b) => a - b).forEach((slot) => {
        const lateness = r.chance(0.25) ? r.range(10, 50) * 60 : r.range(-15, 12) * 60;
        const defect = r.chance(d.defectRate) ? r.pick(defectsPool) : null;
        const tr = makeTruck(S, { slotT: slot, arrivalT: Math.max(120, slot + lateness), defect });
        if (!defect && r.chance(0.32)) tr.bayDefect = r.pick(['ground', 'leak', 'ppe', 'ground', 'leak']);
        S.trucks.push(tr);
      });
      for (let i = 0; i < d.unbooked; i++) {
        const t = r.range(1.5, 9) * 3600;
        const valid = r.chance(0.5);
        const tr = makeTruck(S, { slotT: null, arrivalT: t, booked: false, defect: valid ? null : 'noBooking' });
        tr.booked = false;
        if (valid) { tr.docs.salesNote = 'Spot order ' + tr.orderRef + ' confirmed by Sales desk at ' + U.clock(S, t - r.range(20, 90) * 60) + ' (credit approved).'; }
        S.trucks.push(tr);
      }
      S.trucks.sort((a, b) => a.arrivalT - b.arrivalT);
      // Shift target: a fraction of what the compliant booked trucks could legally carry, rounded to 5 t.
      let possible = 0;
      for (const tr of S.trucks) {
        if (tr.defect) continue;
        const mx = maxNet(S, tr).max;
        possible += tr.order === 'FULL' ? mx : Math.min(tr.order, mx);
      }
      S.target = Math.round(possible * d.targetFrac / 5000) * 5000;
    },
    tick(S, dt) {
      const W = S.weather;
      for (const tr of S.trucks) {
        const age = S.t - tr.stateT;
        switch (tr.state) {
          case 'INBOUND':
            if (S.t >= tr.arrivalT) {
              setState(S, tr, 'QUEUE');
              tr.queueT = S.t;
              sim.log(S, 'gate', tr.plate + ' (' + tr.haulier + ') arrived at the gate for ' + tr.product + (tr.booked ? ', slot ' + U.clock(S, tr.slotT) : ', NO BOOKING') + '.');
            }
            break;
          case 'QUEUE':
            if (S.t - tr.queueT > 2700 && !tr.gateComplaint) {
              tr.gateComplaint = true; S.stats.complaints++;
              sim.score(S, 'throughput', -1, tr.plate + ' kept waiting at the gate for 45 min');
            }
            break;
          case 'TO_WB_IN':
            if (age >= 90) setState(S, tr, 'WB_IN_Q');
            break;
          case 'WB_IN_Q':
            if (!S.wb.in.busy) { S.wb.in.busy = tr.id; setState(S, tr, 'WB_IN'); }
            break;
          case 'WB_IN':
            if (age >= 150) {
              tr.grossIn = Math.round((tr.tare + tr.heel + S.rng.range(-40, 60) + S.wb.in.zero) / 20) * 20;
              tr.wbInZero = S.wb.in.zero;
              S.wb.in.busy = null;
              tr.parkSlot = freeParkSlot(S);
              setState(S, tr, 'TO_PARK');
              sim.log(S, 'gate', tr.plate + ' weighed in: ' + U.fmt.kg(tr.grossIn) + ' (registered tare ' + U.fmt.kg(tr.tare) + ').');
            }
            break;
          case 'TO_PARK':
            if (age >= 60) { setState(S, tr, tr.decants ? 'DECANT_WAIT' : 'PARKED'); tr.parkedT = S.t; }
            break;
          case 'PARKED':
            if (S.t - tr.parkedT > 3600 && !tr.parkComplaint) {
              tr.parkComplaint = true; S.stats.complaints++;
              sim.score(S, 'throughput', -1, tr.plate + ' waited over an hour for a bay');
            }
            break;
          case 'TO_BAY':
            if (age >= 90) {
              const b = S.bays.find((x) => x.id === tr.bay);
              setState(S, tr, 'AT_BAY');
              startPrep(S, b, tr);
            }
            break;
          case 'TO_WB_OUT':
            if (age >= 90) setState(S, tr, 'WB_OUT_Q');
            break;
          case 'WB_OUT_Q':
            if (!S.wb.out.busy) { S.wb.out.busy = tr.id; setState(S, tr, 'WB_OUT'); }
            break;
          case 'WB_OUT':
            if (age >= 150) {
              tr.grossOut = Math.round((tr.tare + tr.content + S.rng.range(-40, 60) + S.wb.out.zero) / 20) * 20;
              tr.wbOutZero = S.wb.out.zero;
              tr.wbNet = tr.grossOut - tr.grossIn;
              S.wb.out.busy = null;
              setState(S, tr, 'WEIGHED');
              sim.log(S, 'gate', tr.plate + ' weighed out: gross ' + U.fmt.kg(tr.grossOut) + ', net ' + U.fmt.kg(tr.wbNet) + '. Awaiting release.');
              const meterNet = tr.loaded - tr.vapRet;
              const mism = Math.abs(tr.wbNet - meterNet) / Math.max(meterNet, 1);
              tr.mismatch = mism;
              sim.setAlarm(S, 'METER-' + tr.id, 'METER', 'WB/' + tr.plate, mism > 0.005 && meterNet > 2000, (mism * 100).toFixed(2) + '%');
            }
            break;
          case 'WEIGHED':
            if (age > 1800 && !tr.docComplaint) { tr.docComplaint = true; S.stats.complaints++; sim.score(S, 'throughput', -1, tr.plate + ' waited 30 min for release documents'); }
            break;
          case 'EXITING':
            if (age >= 60) {
              setState(S, tr, 'GONE');
              tr.pos = null;
            }
            break;
          case 'REJECTED':
            if (age >= 60) { setState(S, tr, 'GONE'); tr.pos = null; }
            break;
          default: break;
        }
        if (tr.state !== 'GONE' && tr.state !== 'INBOUND') tr.pos = truckPos(S, tr);
        // Truck tank thermal & relief (fire exposure or liquid-full).
        if (tr.pos && tr.content > 0) {
          const prod = tr.product;
          const del = tr.bay && tr.state === 'AT_BAY' ? Math.max(L.plant.delugeEff(S, 'DV301'), S.fireBrigade.onScene ? 0.6 : 0) : 0;
          if (tr.fireQ > 0) {
            tr.wallT += 1.6 * Math.min(1.5, tr.fireQ / 2.5e6) * (1 - 0.9 * del) * dt;
            tr.Tl += tr.fireQ * (1 - 0.8 * del) * dt / (Math.max(tr.content, 2000) * 2500 * 0.5);
          }
          tr.wallT = U.approach(tr.wallT, tr.Tl + 5, dt, del > 0 ? 120 : 500);
          tr.Tl = U.approach(tr.Tl, W.Tamb + 3 * W.solar, dt, 6 * 3600);
          const rho = P.rhoL(prod === 'propane' ? 0.975 : 0.06, tr.Tl);
          tr.liqFrac = tr.content / rho / tr.capL * 1000;
          const pAbs = P.psat(prod === 'propane' ? 0.975 : 0.06, tr.Tl);
          tr.P = pAbs - 1.013;
          const setP = tr.docs.tankCode === 'P10BN' ? 10 : 25.5;
          const lift = tr.liqFrac > 0.985 || tr.P > setP * 0.95;
          if (lift && !tr.psvLift) {
            tr.psvLift = true;
            S.stats.incidents++;
            sim.log(S, 'safety', 'Truck ' + tr.plate + ' relief valve lifting' + (tr.liqFrac > 0.985 ? ' — tank liquid-full!' : ' — overpressure.'), 'crit');
            sim.score(S, 'safety', -20, 'Truck ' + tr.plate + ' relief valve lifted (' + (tr.liqFrac > 0.985 ? 'overfilled to liquid-full' : 'overpressure') + ')', 'A tanker filled beyond its filling ratio has no vapour space left. As the liquid warms it expands until the tank is liquid-full, then pressure rises extremely fast and the relief valve lifts. At Los Alfaques (1978) an overloaded tanker with no relief valve ruptured beside a campsite.');
            if (tr.pos) L.plant.addLeak(S, { x: tr.pos.x, y: tr.pos.y - 3, zone: tr.state === 'AT_BAY' ? 'LR' : 'GT', src: { kind: 'truckpsv', id: tr.id }, rate: 0.6, product: prod, label: 'Truck ' + tr.plate + ' PSV' });
          } else if (!lift && tr.psvLift && tr.liqFrac < 0.97) tr.psvLift = false;
          sim.setAlarm(S, 'TRUCKPSV-' + tr.id, 'TRUCKPSV', tr.plate, tr.psvLift);
          if (tr.wallT > 560 && tr.P > 4) {
            S.stats.incidents++;
            sim.score(S, 'safety', -100, 'Road tanker ' + tr.plate + ' BLEVE at the rack', 'A road tanker has a thin shell and a small liquid mass. Engulfed in fire without cooling, the vapour-space shell can fail in minutes. Rack deluge exists for exactly this.');
            sim.endShift(S, 'BLEVE of road tanker ' + tr.plate, 'catastrophe');
            return;
          }
        }
        tr.fireQ = 0;
      }
      for (const b of S.bays) bayTick(S, b, dt);
    },
  });

  // ---------------------------------------------------------------------------------
  function startPrep(S, b, tr) {
    b.state = 'PREP';
    b.truckId = tr.id;
    b.checks = {};
    for (const c of CHECKS) b.checks[c.key] = 'pending';
    b.checkIdx = 0; b.checkT = S.t; b.checkDur = S.rng.range(CHECKS[0].dur[0], CHECKS[0].dur[1]);
    b.hold = null; b.delivered = 0; b.net = 0; b.preset = 0; b.ground = 'none'; b.groundOverride = false; b.stopReason = '';
    b.decant = !!tr.decantPending;
    if (b.decant) b.decantTarget = tr.decantTargetContent;
    sim.log(S, 'rack', tr.plate + ' on ' + b.tag + (b.decant ? ' to decant excess' : '') + '. Driver starting pre-load checks.');
  }

  function bayTick(S, b, dt) {
    const tr = b.truckId ? S.trucks.find((x) => x.id === b.truckId) : null;
    b.wantFlow = 0; b.flowing = false; b.flowLpm = 0;
    const W = S.weather;
    switch (b.state) {
      case 'IDLE': b.ground = 'none'; break;
      case 'CHANGEOVER':
        if (S.t - b.changeoverT >= 600) {
          b.product = b.nextProduct; b.state = 'IDLE';
          sim.log(S, 'rack', b.tag + ' changeover complete — now on ' + b.product + '.');
        }
        break;
      case 'PREP': {
        if (b.hold) break;
        if (S.muster.active || (tr && tr.driverEvacuated)) break;
        if (S.t - b.checkT < b.checkDur) break;
        const c = CHECKS[b.checkIdx];
        // Defects discovered at the relevant check.
        if (tr.bayDefect === c.key && !tr.bayDefectCleared) {
          b.checks[c.key] = 'fail';
          b.hold = holdFor(c.key, tr);
          sim.log(S, 'rack', b.tag + ': ' + b.hold.msg, 'warn');
          break;
        }
        b.checks[c.key] = 'ok';
        if (c.key === 'ground') b.ground = 'ok';
        b.checkIdx++;
        if (b.checkIdx >= CHECKS.length) {
          if (b.decant) {
            b.state = 'DECANTING';
            b.startT = S.t;
            sim.log(S, 'rack', b.tag + ': decanting ' + tr.plate + ' down to ' + U.fmt.kg(b.decantTarget) + ' content.');
          } else {
            b.state = 'READY';
            sim.log(S, 'rack', b.tag + ': pre-load checks complete for ' + tr.plate + '. Awaiting preset and authorisation.');
          }
        } else {
          b.checkT = S.t; b.checkDur = S.rng.range(CHECKS[b.checkIdx].dur[0], CHECKS[b.checkIdx].dur[1]);
        }
        break;
      }
      case 'READY': break;
      case 'LOADING': {
        const H = S.headers[b.product];
        const src = S.tanks[H.source];
        // Interlocks
        if (b.ground !== 'ok' && !b.groundOverride) { stopBay(S, b, 'ground permissive lost'); break; }
        if (!L.plant.iaOK(S)) { stopBay(S, b, 'instrument air — arm valves closed'); break; }
        if (L.plant.esdActive(S, 'LR')) { stopBay(S, b, 'ESD'); break; }
        if (tr.driverEvacuated) { stopBay(S, b, 'driver left the bay'); break; }
        const remaining = b.preset - b.net;
        if (remaining <= 0.5) {
          b.state = 'COMPLETE'; b.completeT = S.t;
          sim.log(S, 'rack', b.tag + ': batch complete for ' + tr.plate + ' — ' + U.fmt.kg(b.net) + ' net. Driver disconnecting.');
          break;
        }
        const maxLpm = b.product === 'propane' ? 1100 : 950;
        let f = 1;
        if (b.net < 250) f = 0.3; // low-flow start
        else if (remaining < 350) f = 0.3; // topping off
        b.wantFlow = maxLpm * f * 0.06; // m3/h
        const flowOK = src && L.plant.outletOpen(S, src) && H.share > 0;
        if (!flowOK) { b.flowLpm = 0; b.noFlowT = (b.noFlowT || 0) + dt; break; }
        b.noFlowT = 0;
        const m3h = b.wantFlow * H.share;
        b.flowLpm = m3h / 0.06;
        b.flowing = true;
        const rhoL = src.rl, rhoV = src.rv;
        let kgs = m3h / 3600 * rhoL;
        const vr = (m3h / 3600) * rhoV; // vapour displaced from truck back to sphere
        let netRate = kgs - vr;
        if (netRate * dt > remaining) { const sc = remaining / (netRate * dt); kgs *= sc; netRate *= sc; }
        const vrA = vr * (kgs / Math.max(m3h / 3600 * rhoL, 1e-9));
        b.delivered += kgs * dt;
        b.net += netRate * dt;
        tr.loaded += kgs * dt;
        tr.vapRet += vrA * dt;
        tr.content += netRate * dt;
        tr.Tl = U.lerp(tr.Tl, src.Tb, clamp(netRate * dt / Math.max(tr.content, 1), 0, 1));
        src.M -= netRate * dt;
        b.meterT = src.Tb + 0.3; b.meterRho = rhoL;
        // Odorant (propane only, 25 ppm target)
        if (b.product === 'propane') {
          const od = S.util.odor;
          const ok = !od.failed && od.level > 0.005;
          b.odorPpm = ok ? 25 + S.rng.gauss() * 0.8 : Math.max(0, (b.odorPpm || 25) * 0.9);
          if (ok) { const use = netRate * dt * 25e-6; od.level = Math.max(0, od.level - use / od.cap); od.injected += use; }
          else tr.odorShort += netRate * dt;
        } else b.odorPpm = 0;
        if (src.offspec) tr.offspecKg += netRate * dt;
        if (W.hold) tr.lightningLoaded += dt;
        // Overfill detection on the truck
        const mx = maxNet(S, tr);
        const fillRatioNow = tr.content / tr.capL;
        if (fillRatioNow > mx.fr * 1.005) {
          if (!b.overfillNoticed && S.rng.chance(0.004 * dt)) {
            b.overfillNoticed = true;
            stopBay(S, b, 'driver hit e-stop — fixed level gauge spitting liquid');
            sim.log(S, 'rack', b.tag + ': driver reports liquid at the fixed maximum level gauge on ' + tr.plate + '. Overfilled.', 'warn');
          }
        }
        sim.setAlarm(S, 'OVERFILL-' + b.id, 'OVERFILL', b.tag, fillRatioNow > mx.fr * 1.03, (fillRatioNow / mx.fr * 100).toFixed(0) + '% of permitted');
        // Engine-start event: if not stopped within 2 min the driver pulls away -> breakaway coupling.
        if (tr.engineOn) {
          if (b.engineT === null) b.engineT = S.t;
          if (S.t - b.engineT > 120 && !b.pulledAway) {
            b.pulledAway = true;
            pullAway(S, b, tr);
          }
        }
        break;
      }
      case 'STOPPED':
        if (tr.engineOn && S.t - (b.engineT || S.t) > 240 && !b.pulledAway) { b.pulledAway = true; pullAway(S, b, tr); }
        break;
      case 'DECANTING': {
        if (L.plant.esdActive(S, 'LR') || !L.plant.iaOK(S)) { stopBay(S, b, 'ESD / air'); break; }
        const H = S.headers[b.product];
        const src = S.tanks[H.source];
        if (!src || !L.plant.inletOpen(S, src)) { b.flowLpm = 0; b.decantBlocked = true; break; }
        b.decantBlocked = false;
        const kgs = 400 / 60000 * src.rl;
        const take = Math.min(kgs * dt, tr.content - b.decantTarget);
        tr.content -= take; b.net -= take; src.M += take; tr.decanted = (tr.decanted || 0) + take;
        b.flowLpm = 400; b.flowing = true;
        if (tr.content <= b.decantTarget + 0.5) {
          b.state = 'COMPLETE'; b.completeT = S.t;
          sim.log(S, 'rack', b.tag + ': decant complete for ' + tr.plate + ' (' + U.fmt.kg(tr.decanted) + ' returned to ' + src.tag + ').');
        }
        break;
      }
      case 'COMPLETE':
        if (S.t - b.completeT >= 240) {
          b.ground = 'none';
          tr.lastBay = b.id;
          tr.bay = null;
          tr.decantPending = false;
          tr.bayDefectCleared = true;
          setState(S, tr, 'TO_WB_OUT');
          sim.log(S, 'rack', tr.plate + ' disconnected from ' + b.tag + ', heading to the outbound weighbridge.');
          b.truckId = null; b.state = 'IDLE'; b.overfillNoticed = false; b.engineT = null; b.pulledAway = false;
          sim.setAlarm(S, 'OVERFILL-' + b.id, 'OVERFILL', b.tag, false);
          sim.setAlarm(S, 'ENGINE-' + b.id, 'ENGINE', b.tag, false);
        }
        break;
      default: break;
    }
    if (tr) sim.setAlarm(S, 'ENGINE-' + b.id, 'ENGINE', b.tag, !!tr.engineOn && ['LOADING', 'STOPPED', 'READY'].includes(b.state));
    sim.setAlarm(S, 'NOFLOW-' + b.id, 'NOFLOW', b.tag, b.state === 'LOADING' && (b.noFlowT || 0) > 120);
    if (b.state !== 'LOADING') b.noFlowT = 0;
    sim.setAlarm(S, 'GND-' + b.id, 'GND', b.tag, b.state === 'STOPPED' && b.stopReason === 'ground permissive lost');
    sim.setAlarm(S, 'BAYESD-' + b.id, 'BAYESD', b.tag, b.state === 'STOPPED' && /e-stop/.test(b.stopReason));
    // Lightning: loading during a lightning hold
    if (b.state === 'LOADING' && W.hold) {
      b.ltSec = (b.ltSec || 0) + dt;
      if (b.ltSec > 120 && !b.ltPen) {
        b.ltPen = true;
        sim.score(S, 'safety', -6, b.tag + ' kept loading with lightning inside 10 km', 'Stop transfers when lightning is within 10 km and wait 30 minutes after the last strike before resuming.');
      }
    } else { b.ltSec = 0; if (!W.hold) b.ltPen = false; }
  }

  function holdFor(key, tr) {
    switch (key) {
      case 'ground': return { key, msg: 'Ground monitor will not give a permissive on ' + tr.plate + ' — resistance reads 2.4 kΩ (needs < 10 Ω). Clamp is on a painted lug.', options: [['retry', 'Instruct driver to clean the lug and re-clamp'], ['override', 'Override ground permissive with key switch'], ['reject', 'Refuse to load and send the truck away']] };
      case 'leak': return { key, msg: 'Leak test on ' + tr.plate + ': bubbles at the liquid coupling face on the soap test. Seal ring looks damaged.', options: [['retest', 'Depressurise, replace the seal ring and retest'], ['accept', 'Accept — it is a small weep'], ['reject', 'Refuse to load']] };
      case 'ppe': return { key, msg: 'CCTV: driver of ' + tr.plate + ' is using a mobile phone at the bay and is not wearing flame-retardant coveralls.', options: [['instruct', 'Use the bay PA: phone back in the cab, FR coveralls on'], ['ignore', 'Ignore — loading has not started yet'], ['reject', 'Refuse to load']] };
      default: return null;
    }
  }

  function stopBay(S, b, why) {
    if (b.state !== 'LOADING' && b.state !== 'DECANTING') return;
    b.state = 'STOPPED'; b.stopReason = why; b.stopT = S.t; b.flowing = false; b.wantFlow = 0;
    sim.log(S, 'rack', b.tag + ' STOPPED — ' + why + '.', 'warn');
  }
  function esdStopBay(S, b, why) {
    if (b.state === 'LOADING' || b.state === 'DECANTING') stopBay(S, b, why);
  }
  function pullAway(S, b, tr) {
    S.stats.incidents++;
    sim.log(S, 'safety', 'PULL-AWAY: ' + tr.plate + ' moved off ' + b.tag + ' with arms connected. Breakaway couplings parted.', 'crit');
    sim.score(S, 'safety', -18, 'Drive-away at ' + b.tag + ' — engine running for minutes while connected', 'Drive-aways are a classic loading-rack accident. Brake interlocks and breakaway couplings limit the release, but the first defence is the operator stopping the transfer the moment an engine starts.');
    L.plant.addLeak(S, { x: b.x, y: b.y + 4, zone: 'LR', src: { kind: 'field', id: b.id }, rate: 0.25, product: b.product, label: b.tag + ' breakaway coupling', residual: 30 });
    const lk = S.leaks[S.leaks.length - 1];
    lk.src = { kind: 'bay', id: b.id }; lk.residual = 35;
    b.state = 'STOPPED'; b.stopReason = 'drive-away — arms damaged';
    tr.engineOn = false;
    b.damaged = true;
  }

  // ---------------------------------------------------------------------------------
  const A = sim.action;
  A('gateDecision', (S, truckId, decision, reason) => {
    const tr = S.trucks.find((x) => x.id === truckId);
    if (!tr || tr.state !== 'QUEUE') return { ok: false, msg: 'That truck is not at the gate.' };
    if (decision === 'admit') {
      if (S.esd.site) return { ok: false, msg: 'Site ESD active — gate is locked.' };
      tr.gateInT = S.t;
      setState(S, tr, 'TO_WB_IN');
      sim.log(S, 'gate', tr.plate + ' admitted. Driver briefed: site rules, speed 10 km/h, no phones outside cab.');
      if (tr.defect) {
        const d = GATE_DEFECTS[tr.defect];
        sim.score(S, 'safety', d.pen, 'Admitted ' + tr.plate + ' despite: ' + d.reason, d.lesson);
        if (tr.defect === 'noBooking') sim.score(S, 'compliance', -2, 'Admitted unbooked truck without order confirmation');
      }
      return { ok: true, msg: tr.plate + ' admitted.' };
    }
    // Reject
    setState(S, tr, 'REJECTED');
    S.stats.trucksRejected++;
    if (tr.defect) {
      const d = GATE_DEFECTS[tr.defect];
      S.stats.nearMisses++;
      if (reason === tr.defect) {
        sim.score(S, 'safety', +2, 'Good catch at the gate: ' + tr.plate + ' — ' + d.reason, d.lesson);
      } else {
        sim.score(S, 'compliance', -1, 'Rejected ' + tr.plate + ' correctly but recorded the wrong reason (actual: ' + d.reason + ')', d.lesson);
      }
      sim.log(S, 'gate', tr.plate + ' turned away: ' + (REASONS.find((r) => r.key === reason) || { text: reason }).text + '.');
    } else {
      S.stats.rejectedValid++;
      sim.score(S, 'throughput', -4, 'Turned away a compliant truck (' + tr.plate + ')');
      sim.log(S, 'gate', tr.plate + ' turned away. Haulier disputes the refusal — documents were in order.', 'warn');
    }
    return { ok: true, msg: tr.plate + ' turned away.' };
  });

  A('assignBay', (S, truckId, bayId) => {
    const tr = S.trucks.find((x) => x.id === truckId);
    const b = S.bays.find((x) => x.id === bayId);
    if (!tr || !b) return { ok: false, msg: 'Invalid selection.' };
    if (!['PARKED', 'DECANT_WAIT'].includes(tr.state)) return { ok: false, msg: tr.plate + ' is not waiting for a bay.' };
    if (b.state !== 'IDLE' || b.truckId) return { ok: false, msg: b.tag + ' is not free.' };
    if (b.suspended) return { ok: false, msg: b.tag + ' is suspended.' };
    if (b.damaged) return { ok: false, msg: b.tag + ' arms are damaged — out of service.' };
    if (b.product !== tr.product) {
      sim.score(S, 'safety', -5, 'Tried to send ' + tr.plate + ' (' + tr.product + ') to ' + b.tag + ' (' + b.product + ')', 'Always check the bay product before assigning a truck. Cross-contamination or loading the wrong grade can put a customer\'s appliances outside their design pressure.');
      return { ok: false, msg: b.tag + ' is lined up for ' + b.product + '. Product mismatch.' };
    }
    tr.bay = b.id; b.truckId = tr.id; b.state = 'ARRIVING';
    if (tr.state === 'DECANT_WAIT') tr.decantPending = true;
    setState(S, tr, 'TO_BAY');
    sim.log(S, 'rack', tr.plate + ' called forward to ' + b.tag + '.');
    return { ok: true };
  });

  A('bayResolve', (S, bayId, option) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (!b || !b.hold) return { ok: false, msg: 'Nothing to resolve.' };
    const tr = S.trucks.find((x) => x.id === b.truckId);
    const key = b.hold.key;
    if (option === 'reject') {
      sim.log(S, 'rack', tr.plate + ' refused at ' + b.tag + ' (' + key + ' defect). Truck sent off site.');
      if (key === 'ppe') sim.score(S, 'throughput', -2, 'Refused ' + tr.plate + ' for a PPE issue that a briefing would have fixed');
      else { sim.score(S, 'safety', +1, 'Refused to load ' + tr.plate + ' with an unresolved ' + key + ' defect'); S.stats.nearMisses++; }
      releaseBayTruck(S, b, tr, true);
      return { ok: true };
    }
    if (key === 'ground') {
      if (option === 'override') {
        b.groundOverride = true; b.ground = 'ok'; b.checks.ground = 'override';
        sim.score(S, 'safety', -12, 'Ground permissive overridden on ' + b.tag, 'Static from LPG flowing at high velocity can reach thousands of volts on an ungrounded tank. The ground monitor checks the truck is genuinely bonded; overriding it removes the only verification.');
        tr.bayDefectCleared = true;
      } else {
        b.checkT = S.t; b.checkDur = 120;
        if (S.rng.chance(0.85)) tr.bayDefectCleared = true;
        b.checks.ground = 'pending';
        sim.log(S, 'rack', b.tag + ': driver cleaning the earthing lug with a wire brush and re-clamping.');
      }
    } else if (key === 'leak') {
      if (option === 'accept') {
        sim.score(S, 'safety', -10, 'Accepted a leaking coupling on ' + b.tag, 'No leak is acceptable on an LPG connection. A weep at 7 barg becomes a jet when the seal extrudes.');
        tr.bayDefectCleared = true;
        b.weepAccepted = true;
      } else {
        b.checkT = S.t; b.checkDur = 300;
        if (S.rng.chance(0.85)) tr.bayDefectCleared = true;
        b.checks.leak = 'pending';
        sim.log(S, 'rack', b.tag + ': coupling depressurised to vapour recovery, seal ring replaced, re-pressurising for leak test.');
      }
    } else if (key === 'ppe') {
      if (option === 'ignore') {
        sim.score(S, 'safety', -5, 'Ignored phone use and missing FR clothing at ' + b.tag, 'Phones are not intrinsically safe and FR clothing protects against flash fire. Correct unsafe behaviour on the spot.');
      } else {
        sim.log(S, 'rack', b.tag + ': PA announcement — driver returns phone to the cab and puts on FR coveralls.');
        S.stats.nearMisses++;
      }
      tr.bayDefectCleared = true;
      b.checkT = S.t; b.checkDur = 45;
      b.checks.ppe = 'pending';
    }
    b.hold = null;
    return { ok: true };
  });

  A('bayAuthorize', (S, bayId, preset) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (!b || b.state !== 'READY') return { ok: false, msg: 'Bay is not ready for authorisation.' };
    preset = Math.round(Number(preset));
    if (!isFinite(preset) || preset < 500) return { ok: false, msg: 'Enter a preset of at least 500 kg.' };
    if (preset > 30000) return { ok: false, msg: 'Preset exceeds the batch controller limit (30,000 kg).' };
    if (L.plant.esdActive(S, 'LR')) return { ok: false, msg: 'Loading rack ESD is active.' };
    if (S.simopsHold.LR) return { ok: false, msg: 'Rack suspended under ' + S.simopsHold.LR + '. Suspend or close that permit first.' };
    const tr = S.trucks.find((x) => x.id === b.truckId);
    b.preset = preset; b.state = 'LOADING'; b.startT = S.t; b.delivered = 0; b.net = 0;
    tr.preset = preset;
    if (S.weather.hold) sim.score(S, 'safety', -6, 'Authorised loading on ' + b.tag + ' during a lightning stop', 'Do not start transfers inside the 30-minute lightning window.');
    if (b.product === 'propane' && (S.util.odor.failed || S.util.odor.level <= 0.005)) sim.score(S, 'safety', -4, 'Started propane loading with odorant injection failed', 'Odorant is a safety additive. Without it, a leak in a customer\'s home or boat cannot be smelt.');
    const src = S.tanks[S.headers[b.product].source];
    if (src && src.offspec) sim.score(S, 'compliance', -3, 'Loading ' + tr.plate + ' from off-spec ' + src.tag);
    sim.log(S, 'rack', b.tag + ': loading authorised for ' + tr.plate + ', preset ' + U.fmt.kg(preset) + ' net.');
    return { ok: true, msg: b.tag + ' loading.' };
  });

  A('bayStop', (S, bayId) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (b.state !== 'LOADING' && b.state !== 'DECANTING') return { ok: false, msg: 'Bay is not transferring.' };
    stopBay(S, b, 'operator stop');
    const tr = S.trucks.find((x) => x.id === b.truckId);
    if (tr && tr.engineOn) {
      tr.engineOn = false; b.engineT = null;
      sim.log(S, 'rack', b.tag + ': driver told to switch off the engine. Engine off.');
      S.stats.nearMisses++;
      sim.score(S, 'safety', +2, 'Stopped loading on ' + b.tag + ' when the engine was started');
    }
    return { ok: true };
  });
  A('bayPA', (S, bayId) => {
    const b = S.bays.find((x) => x.id === bayId);
    const tr = b && b.truckId && S.trucks.find((x) => x.id === b.truckId);
    if (!tr) return { ok: false, msg: 'No truck at that bay.' };
    if (tr.engineOn) {
      tr.engineOn = false; b.engineT = null;
      sim.log(S, 'rack', b.tag + ': PA — driver instructed to switch off the engine. Engine off.');
      if (b.state === 'LOADING') sim.score(S, 'compliance', -1, 'Engine stopped by PA but loading on ' + b.tag + ' was not stopped first', 'Stop the transfer first, then deal with the driver.');
      else { S.stats.nearMisses++; sim.score(S, 'safety', +1, 'Engine running at ' + b.tag + ' dealt with promptly'); }
      return { ok: true };
    }
    sim.log(S, 'rack', b.tag + ': PA announcement to driver of ' + tr.plate + '.');
    return { ok: true, msg: 'Announcement made.' };
  });
  A('bayStopAll', (S) => {
    let n = 0;
    for (const b of S.bays) if (b.state === 'LOADING' || b.state === 'DECANTING') { stopBay(S, b, 'operator stop all'); n++; }
    return { ok: true, msg: n ? n + ' bay(s) stopped.' : 'No bays transferring.' };
  });
  A('bayResume', (S, bayId) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (b.state !== 'STOPPED') return { ok: false, msg: 'Bay is not stopped.' };
    const tr = S.trucks.find((x) => x.id === b.truckId);
    if (b.damaged) return { ok: false, msg: 'Arms damaged in the drive-away. Finish the batch and take the bay out of service.' };
    if (b.ground !== 'ok' && !b.groundOverride) return { ok: false, msg: 'No ground permissive. Have the driver re-attach the clamp first.' };
    if (L.plant.esdActive(S, 'LR')) return { ok: false, msg: 'ESD active.' };
    if (tr.engineOn) return { ok: false, msg: 'Engine is running. Get the driver to switch off.' };
    if (tr.driverEvacuated) return { ok: false, msg: 'The driver is not at the bay.' };
    if (S.weather.hold) sim.score(S, 'safety', -4, 'Resumed loading during lightning stop on ' + b.tag);
    b.state = b.decant ? 'DECANTING' : 'LOADING';
    sim.log(S, 'rack', b.tag + ' resumed.');
    return { ok: true };
  });
  A('bayFinish', (S, bayId) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (b.state !== 'STOPPED') return { ok: false, msg: 'Bay is not stopped.' };
    b.state = 'COMPLETE'; b.completeT = S.t;
    sim.log(S, 'rack', b.tag + ': batch ended early at ' + U.fmt.kg(b.net) + '. Driver disconnecting.');
    return { ok: true };
  });
  A('bayReground', (S, bayId) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (b.ground === 'ok') return { ok: true };
    b.ground = 'ok';
    sim.log(S, 'rack', b.tag + ': driver re-attached the ground clamp. Permissive green.');
    return { ok: true };
  });
  A('baySuspend', (S, bayId, on) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (on && b.state !== 'IDLE') return { ok: false, msg: 'Bay is in use; suspend it once the truck has left.' };
    b.suspended = on;
    sim.log(S, 'rack', b.tag + (on ? ' taken out of service.' : ' returned to service.'));
    return { ok: true };
  });
  A('bayRepair', (S, bayId) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (!b.damaged) return { ok: true };
    if (b.state !== 'IDLE') return { ok: false, msg: 'Clear the bay first.' };
    b.damaged = false; b.suspended = true;
    b.repairUntil = S.t + 3600;
    sim.log(S, 'rack', b.tag + ': breakaway couplings re-made by maintenance. Bay suspended for 60 min pending leak test.');
    return { ok: true };
  });
  A('bayChangeover', (S, bayId, product) => {
    const b = S.bays.find((x) => x.id === bayId);
    if (!b.swing) return { ok: false, msg: 'Only Bay 4 is a swing bay.' };
    if (b.state !== 'IDLE') return { ok: false, msg: 'Bay must be idle.' };
    if (b.product === product) return { ok: true };
    b.state = 'CHANGEOVER'; b.changeoverT = S.t; b.nextProduct = product;
    sim.log(S, 'rack', b.tag + ': swing-line changeover to ' + product + ' started (line drained to vapour recovery, block valves swapped, 10 min).');
    return { ok: true };
  });

  A('truckRelease', (S, truckId) => {
    const tr = S.trucks.find((x) => x.id === truckId);
    if (!tr || tr.state !== 'WEIGHED') return { ok: false, msg: 'Truck is not awaiting release.' };
    const mx = maxNet(S, tr);
    const net = tr.wbNet;
    const over = [];
    if (tr.grossOut > tr.gvw) {
      over.push('gvw');
      sim.score(S, 'compliance', -8, tr.plate + ' released over its legal gross weight (' + U.fmt.kg(tr.grossOut) + ' > ' + U.fmt.kg(tr.gvw) + ')', 'The weighbridge is the last check before an overweight LPG tanker joins public roads. Overloaded vehicles brake worse and overstress axles.');
      sim.score(S, 'safety', -3, tr.plate + ' overweight on the road');
    }
    if (tr.content > mx.fr * tr.capL * 1.002) {
      over.push('adr');
      S.stats.overfills++;
      sim.score(S, 'safety', -12, tr.plate + ' released above its ADR filling ratio (' + (tr.content / tr.capL).toFixed(3) + ' kg/L > ' + mx.fr + ')', 'The filling ratio leaves vapour space for the liquid to expand on a hot day. Over-filled tankers can go liquid-full on the road.');
    }
    if (tr.odorShort > 300) sim.score(S, 'safety', -8, tr.plate + ' released with ' + U.fmt.kg(tr.odorShort) + ' of under-odorised propane', 'Unodorised propane cannot be smelt if it leaks. Recall and re-odorise.');
    if (tr.offspecKg > 500) sim.score(S, 'compliance', -4, tr.plate + ' released with off-spec product');
    if (tr.lightningLoaded > 0) { /* scored at the bay */ }
    if (Math.abs(S.wb.out.zero) > 50 || Math.abs(tr.wbInZero || 0) > 50) sim.score(S, 'compliance', -2, 'Delivery note for ' + tr.plate + ' issued from a weighbridge out of zero');
    const target = tr.order === 'FULL' ? mx.max : Math.min(tr.order, mx.max);
    if (!over.length && net < target * 0.94) sim.score(S, 'throughput', -1, tr.plate + ' short-loaded (' + U.fmt.kg(net) + ' of ' + U.fmt.kg(target) + ' possible)');
    setState(S, tr, 'EXITING');
    tr.exitT = S.t;
    S.stats.dispatched += Math.max(0, net);
    S.stats.lpgDispatchedByProduct[tr.product] += Math.max(0, net);
    S.stats.trucksOut++;
    if (tr.gateInT !== null) S.stats.turnaround.push(S.t - tr.gateInT);
    sim.log(S, 'gate', tr.plate + ' released. Delivery note & ADR transport document issued: ' + U.fmt.kg(net) + ' ' + tr.product + ' to ' + tr.customer + '.');
    sim.setAlarm(S, 'METER-' + tr.id, 'METER', 'WB/' + tr.plate, false);
    return { ok: true, msg: tr.plate + ' released with ' + U.fmt.t(net) + '.' };
  });
  A('truckDecant', (S, truckId) => {
    const tr = S.trucks.find((x) => x.id === truckId);
    if (!tr || tr.state !== 'WEIGHED') return { ok: false, msg: 'Truck is not at the outbound weighbridge.' };
    const mx = maxNet(S, tr);
    const legal = Math.min(mx.fr * tr.capL, tr.gvw - tr.tare) - 150;
    if (tr.content <= legal + 150) sim.score(S, 'throughput', -2, 'Unnecessary decant of ' + tr.plate);
    tr.decants++;
    tr.decantTargetContent = Math.max(tr.heel, legal);
    tr.parkSlot = freeParkSlot(S);
    setState(S, tr, 'TO_PARK');
    S.stats.nearMisses++;
    sim.log(S, 'gate', tr.plate + ' held for decant: content to reduce to ' + U.fmt.kg(tr.decantTargetContent) + '. Assign a ' + tr.product + ' bay.');
    sim.setAlarm(S, 'METER-' + tr.id, 'METER', 'WB/' + tr.plate, false);
    return { ok: true };
  });
  A('wbZero', (S, which) => {
    const wb = S.wb[which];
    if (wb.busy) return { ok: false, msg: 'Weighbridge deck is occupied.' };
    wb.zero = 0;
    sim.log(S, 'gate', 'Weighbridge ' + (which === 'in' ? 'WB-1 (in)' : 'WB-2 (out)') + ' zero check performed and re-zeroed.');
    return { ok: true };
  });

  function releaseBayTruck(S, b, tr, offsite) {
    b.truckId = null; b.state = 'IDLE'; b.hold = null; b.ground = 'none';
    tr.bay = null;
    if (offsite) { setState(S, tr, 'EXITING'); tr.exitT = S.t; tr.refusedAtBay = true; }
  }

  L.rack = { CHECKS, GATE_DEFECTS, REASONS, maxNet, esdStopBay, stopBay, makeTruck, applyDefect };
})(globalThis.LPG = globalThis.LPG || {});
