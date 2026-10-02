/* Static configuration: plant layout (metres, +x east, +y south), equipment, alarm rationalisation,
   people and companies (all fictional). */
(function (L) {
  'use strict';

  const SITE = { name: 'Harrowmere LPG Terminal', code: 'HMT', w: 290, h: 172 };

  const ZONES = {
    TF: { name: 'Tank farm', x: 20, y: 26, w: 140, h: 34 },
    PA: { name: 'Pump area', x: 40, y: 66, w: 76, h: 16 },
    LR: { name: 'Loading rack', x: 182, y: 56, w: 62, h: 44 },
    RL: { name: 'Rail siding', x: 20, y: 112, w: 100, h: 38 },
    UT: { name: 'Utilities', x: 6, y: 92, w: 40, h: 34 },
    GT: { name: 'Gate & weighbridges', x: 186, y: 128, w: 100, h: 40 },
  };

  const TANKS = [
    { id: 'V101', tag: 'V-101', kind: 'sphere', product: 'propane', x: 38, y: 40, r: 7.25, design: 17.2, psv: 17.2, pah: 14.5, wP: 0.975, fill0: [0.42, 0.62] },
    { id: 'V102', tag: 'V-102', kind: 'sphere', product: 'propane', x: 70, y: 40, r: 7.25, design: 17.2, psv: 17.2, pah: 14.5, wP: 0.972, fill0: [0.30, 0.50] },
    { id: 'V103', tag: 'V-103', kind: 'sphere', product: 'butane', x: 102, y: 40, r: 6.25, design: 8.6, psv: 8.6, pah: 6.5, wP: 0.06, fill0: [0.45, 0.65] },
  ];
  // Out-of-service bullet used by confined-space permit scenarios.
  const BULLET = { id: 'V104', tag: 'V-104', x: 128, y: 36, len: 26, r: 2.1, status: 'Out of service — internal inspection (positively isolated, blinded)' };

  const PUMPS = [
    { id: 'P201A', tag: 'P-201A', product: 'propane', x: 50, y: 74, cap: 150 },
    { id: 'P201B', tag: 'P-201B', product: 'propane', x: 60, y: 74, cap: 150 },
    { id: 'P202A', tag: 'P-202A', product: 'butane', x: 96, y: 74, cap: 110 },
    { id: 'P202B', tag: 'P-202B', product: 'butane', x: 106, y: 74, cap: 110 },
  ];

  const BAYS = [
    { id: 1, tag: 'Bay 1', x: 192, y: 78, product: 'propane', swing: false },
    { id: 2, tag: 'Bay 2', x: 206, y: 78, product: 'propane', swing: false },
    { id: 3, tag: 'Bay 3', x: 220, y: 78, product: 'butane', swing: false },
    { id: 4, tag: 'Bay 4', x: 234, y: 78, product: 'propane', swing: true },
  ];

  const POINTS = {
    gate: { x: 262, y: 158 }, wbIn: { x: 240, y: 140 }, wbOut: { x: 204, y: 140 },
    park: { x: 268, y: 62 }, control: { x: 150, y: 152 }, muster: { x: 168, y: 166 },
    workshop: { x: 120, y: 160 }, odorant: { x: 176, y: 64 }, comp: { x: 66, y: 124 },
    railR1: { x: 46, y: 140 }, railR2: { x: 86, y: 140 }, fwTank: { x: 18, y: 104 },
    fwPumps: { x: 34, y: 120 }, ia: { x: 150, y: 124 }, piperack: { x: 150, y: 74 }, lab: { x: 134, y: 152 },
  };

  // Gas detectors (IR point) — zone voting groups for confirmed gas.
  const GAS_DET = [
    { id: 'GD01', tag: 'GD-01', zone: 'TF', x: 38, y: 52 },
    { id: 'GD02', tag: 'GD-02', zone: 'TF', x: 70, y: 52 },
    { id: 'GD03', tag: 'GD-03', zone: 'TF', x: 102, y: 52 },
    { id: 'GD04', tag: 'GD-04', zone: 'TF', x: 54, y: 30 },
    { id: 'GD05', tag: 'GD-05', zone: 'PA', x: 46, y: 79 },
    { id: 'GD06', tag: 'GD-06', zone: 'PA', x: 64, y: 79 },
    { id: 'GD07', tag: 'GD-07', zone: 'PA', x: 92, y: 79 },
    { id: 'GD08', tag: 'GD-08', zone: 'PA', x: 110, y: 79 },
    { id: 'GD09', tag: 'GD-09', zone: 'LR', x: 196, y: 75 },
    { id: 'GD10', tag: 'GD-10', zone: 'LR', x: 210, y: 75 },
    { id: 'GD11', tag: 'GD-11', zone: 'LR', x: 224, y: 75 },
    { id: 'GD12', tag: 'GD-12', zone: 'LR', x: 238, y: 75 },
    { id: 'GD16', tag: 'GD-16', zone: 'LR', x: 199, y: 92 },
    { id: 'GD17', tag: 'GD-17', zone: 'LR', x: 227, y: 92 },
    { id: 'GD13', tag: 'GD-13', zone: 'RL', x: 46, y: 132 },
    { id: 'GD14', tag: 'GD-14', zone: 'RL', x: 86, y: 132 },
    { id: 'GD15', tag: 'GD-15', zone: 'RL', x: 66, y: 118 },
  ];
  // Flame detectors (UV/IR) — 2ooN voting per zone.
  const FLAME_DET = [
    { id: 'FD01', tag: 'FD-01', zone: 'TF', x: 30, y: 58 }, { id: 'FD02', tag: 'FD-02', zone: 'TF', x: 86, y: 58 },
    { id: 'FD03', tag: 'FD-03', zone: 'PA', x: 52, y: 84 }, { id: 'FD04', tag: 'FD-04', zone: 'PA', x: 100, y: 84 },
    { id: 'FD05', tag: 'FD-05', zone: 'LR', x: 186, y: 60 }, { id: 'FD06', tag: 'FD-06', zone: 'LR', x: 240, y: 60 },
    { id: 'FD07', tag: 'FD-07', zone: 'RL', x: 30, y: 128 }, { id: 'FD08', tag: 'FD-08', zone: 'RL', x: 100, y: 128 },
  ];
  const DELUGE = [
    { id: 'DV101', tag: 'DV-101', covers: 'V101', zone: 'TF', flow: 420 },
    { id: 'DV102', tag: 'DV-102', covers: 'V102', zone: 'TF', flow: 420 },
    { id: 'DV103', tag: 'DV-103', covers: 'V103', zone: 'TF', flow: 330 },
    { id: 'DV201', tag: 'DV-201', covers: 'PA', zone: 'PA', flow: 180 },
    { id: 'DV301', tag: 'DV-301', covers: 'LR', zone: 'LR', flow: 380 },
    { id: 'DV401', tag: 'DV-401', covers: 'RL', zone: 'RL', flow: 300 },
  ];

  /* Alarm rationalisation (ISA-18.2): priority, cause, consequence, operator action.
     pri 1 = Critical, 2 = High, 3 = Medium, 4 = Low. */
  const ALARMS = {
    LAH: { pri: 3, name: 'High level', cause: 'Liquid level above 85% of vessel volume during receipt.', consequence: 'Reduced ullage; continued receipt leads to high-high trip and, in the worst case, overfill and liquid relief.', action: 'Confirm level against the independent switch, stop or divert the receipt, plan dispatches from this vessel.' },
    LAHH: { pri: 1, name: 'High-high level', cause: 'Level above 90% — receipt not stopped at high level.', consequence: 'Overfill. A liquid-full pressurised vessel can reach relief pressure from a few degrees of warming.', action: 'Verify the inlet valve has closed. Stop transfer compressors. Do not reset until level is below 85%.' },
    LSHH: { pri: 1, name: 'Independent high-high switch trip', cause: 'Independent level switch (separate from the radar) has seen liquid.', consequence: 'Inlet ROSOV closed by the safety system. If the radar disagrees, the radar is suspect.', action: 'Stop all receipts to the vessel, compare radar with the switch, raise an instrument work order.' },
    LAL: { pri: 3, name: 'Low level', cause: 'Level below 10% while dispatching.', consequence: 'Pump suction margin (NPSH) falling; cavitation risk.', action: 'Switch the loading header to another vessel or slow dispatch.' },
    LALL: { pri: 2, name: 'Low-low level — pumps tripped', cause: 'Level below 5%.', consequence: 'Pumps tripped to protect seals from running dry.', action: 'Line up another vessel before restarting pumps.' },
    PAH: { pri: 2, name: 'High pressure', cause: 'Vessel pressure above alarm limit, usually from heating (sun or fire) or vapour return during receipt.', consequence: 'Approaching relief valve set pressure; venting to atmosphere.', action: 'Look for heat input (fire?). Consider deluge cooling. Stop vapour-pushing transfers into the vessel.' },
    PSV: { pri: 1, name: 'Relief valve lifting', cause: 'Pressure at relief set point.', consequence: 'Flammable vapour discharged to atmosphere from the vent stack.', action: 'Start deluge on the vessel. Check for fire impingement. Stop all transfers into the vessel.' },
    TAH: { pri: 3, name: 'High surface temperature', cause: 'Liquid surface temperature high (solar gain or external heat).', consequence: 'Pressure rising toward high alarm.', action: 'Monitor. Consider deluge if the trend continues or there is a fire.' },
    WALL: { pri: 1, name: 'Shell temperature high (vapour zone)', cause: 'Unwetted shell above the liquid is being heated by flame.', consequence: 'Steel loses strength above ~400 °C. Shell failure under pressure is a BLEVE.', action: 'Deluge on immediately. Isolate the fuel feeding the fire. Evacuate to muster point.' },
    VAH: { pri: 3, name: 'Pump vibration high', cause: 'Vibration above 7.1 mm/s (ISO 10816 zone C). Often cavitation from low suction level, or bearing wear.', consequence: 'Seal and bearing damage; trip at 11 mm/s.', action: 'Check suction vessel level. Swap to the standby pump and request inspection.' },
    VAHH: { pri: 2, name: 'Pump vibration trip', cause: 'Vibration above 11 mm/s.', consequence: 'Pump tripped. Loading on that product stops unless the standby starts.', action: 'Start the standby pump. Raise a work order. Inspect seal for leakage.' },
    SEAL: { pri: 2, name: 'Pump seal leak', cause: 'Seal pot pressure high — primary mechanical seal leaking into the barrier.', consequence: 'Secondary seal may fail and release LPG at the pump.', action: 'Stop the pump, close its suction and discharge valves, start the standby.' },
    PTRIP: { pri: 2, name: 'Pump tripped', cause: 'Motor protection or loss of power.', consequence: 'No flow to the loading header.', action: 'Find the cause before restarting. Start the standby pump.' },
    GND: { pri: 2, name: 'Static ground lost', cause: 'Ground monitor no longer sees the truck (clamp detached or poor contact).', consequence: 'Static charge can accumulate on the tank. Loading stopped by interlock.', action: 'Have the driver re-attach the clamp to a clean, unpainted lug. Do not bypass the interlock.' },
    BAYESD: { pri: 2, name: 'Bay emergency stop', cause: 'Emergency stop pressed at the bay.', consequence: 'Loading stopped, arm valves closed.', action: 'Find out why from the driver or CCTV before resetting.' },
    NOFLOW: { pri: 3, name: 'Bay authorised but no flow', cause: 'Loading authorised but the header is not delivering: no pump running, suction valve closed, or pump capacity taken by other bays.', consequence: 'Truck sits at the bay, turnaround time grows.', action: 'Check the header line-up (source sphere outlet open?) and pump status on the Pumps page.' },
    OVERFILL: { pri: 1, name: 'Truck high level (overfill)', cause: 'Truck tank above its permitted filling ratio.', consequence: 'Truck cannot leave. At liquid-full, warming can lift its relief valve on the road.', action: 'Stop loading. Decant the excess back before release.' },
    ENGINE: { pri: 1, name: 'Truck engine started during loading', cause: 'Driver started the engine while connected.', consequence: 'Ignition source in the bay and risk of drive-away with arms connected.', action: 'Stop loading at once and instruct the driver. Report the violation.' },
    ODLOW: { pri: 3, name: 'Odorant tank low', cause: 'Ethyl mercaptan tank level below 20%.', consequence: 'Injection will stop when empty and propane would leave unodorised.', action: 'Expedite the odorant delivery. Plan to stop propane loading if it runs dry.' },
    ODFAIL: { pri: 2, name: 'Odorant injection failure', cause: 'Injection pump flow lost or below target ppm.', consequence: 'Propane loaded now would be under-odorised. A leak at the customer would not be smelt.', action: 'Stop propane loading until injection is restored.' },
    COMPT: { pri: 2, name: 'Compressor discharge temperature high', cause: 'High compression ratio (car pressure low) or long running.', consequence: 'Valve damage; trip at 135 °C.', action: 'Check the 4-way valve position and car pressure. Stop if recovering vapour below 1.5 barg.' },
    COMPP: { pri: 2, name: 'Compressor discharge pressure high', cause: 'Discharge against a closed valve or receiving vessel full.', consequence: 'Relief valve lift, hose stress.', action: 'Stop the compressor. Check the receiving vessel inlet valve.' },
    KOPOT: { pri: 2, name: 'Compressor knock-out pot high level', cause: 'Liquid carried into compressor suction.', consequence: 'Liquid slugging destroys reciprocating compressors. Trip.', action: 'Drain the pot. Check the 4-way valve. Never recover vapour while liquid remains in the car.' },
    CARLOW: { pri: 3, name: 'Rail car pressure low', cause: 'Vapour recovered below 1.0 barg.', consequence: 'Risk of pulling the car toward vacuum; air ingress on disconnection.', action: 'Stop vapour recovery now.' },
    GDLOW: { pri: 2, name: 'Gas detected 20% LEL', cause: 'Flammable gas at a detector.', consequence: 'A leak is present. If it finds an ignition source it will burn.', action: 'Look at the wind and neighbouring detectors. Stop transfers in the area. Send a field operator from upwind with a personal gas monitor.' },
    GDHIGH: { pri: 1, name: 'Gas detected 40% LEL', cause: 'Significant flammable gas concentration.', consequence: 'Ignition likely to produce a flash fire or jet fire.', action: 'Activate the area ESD. Remove ignition sources. Keep people out of the cloud.' },
    CONFGAS: { pri: 1, name: 'Confirmed gas — area ESD', cause: 'Two detectors in a zone at 40% LEL (2ooN vote).', consequence: 'Automatic area shutdown executed.', action: 'Verify isolation. Sound muster if the cloud is growing. Do not reset until gas has cleared.' },
    FLAME: { pri: 1, name: 'Fire detected', cause: 'Flame detector sees a fire.', consequence: 'Fire can impinge on vessels and escalate.', action: 'Confirm deluge running. Site ESD. Call the fire service. Sound muster.' },
    CONFFIRE: { pri: 1, name: 'Confirmed fire — deluge & site ESD', cause: 'Two flame detectors in a zone.', consequence: 'Deluge released in the zone, site ESD initiated.', action: 'Cooling first. Isolate fuel. Never extinguish a gas fire while the source is still live.' },
    GDFAULT: { pri: 3, name: 'Detector fault', cause: 'Detector signal out of range.', consequence: 'Gap in detection coverage.', action: 'Arrange a portable detector at the location and raise a work order.' },
    INHIBIT: { pri: 4, name: 'Detector inhibited', cause: 'Detector inhibited from voting.', consequence: 'Coverage gap. Automatic actions may not happen.', action: 'Only inhibit with a compensating measure. Remove the inhibit as soon as possible.' },
    FWLOW: { pri: 2, name: 'Fire water ring main pressure low', cause: 'Demand (deluge) exceeds jockey pump capacity, or a main pump failed.', consequence: 'Deluge flow reduced.', action: 'Confirm main fire pumps have started. Start the diesel pump manually if needed.' },
    FWFAIL: { pri: 1, name: 'Fire pump failed to start', cause: 'Fire pump did not run on demand.', consequence: 'Insufficient cooling water.', action: 'Start the other fire pump by hand. Call the fire service.' },
    FWTANK: { pri: 2, name: 'Fire water tank low', cause: 'Extended deluge use.', consequence: 'Water supply time limited.', action: 'Request fire service water relay. Prioritise deluge to the most exposed vessels.' },
    IALOW: { pri: 2, name: 'Instrument air pressure low', cause: 'Air compressor trip or a large air leak.', consequence: 'Below 3.5 barg the ROSOVs fail closed and the terminal stops.', action: 'Start the standby air compressor.' },
    IATRIP: { pri: 3, name: 'Air compressor tripped', cause: 'Motor overload or high temperature.', consequence: 'Air header decays unless the standby runs.', action: 'Start the standby compressor.' },
    POWER: { pri: 2, name: 'Power dip — motors tripped', cause: 'Grid disturbance.', consequence: 'Running pumps and compressors stopped.', action: 'Wait for supply to stabilise, then restart equipment one at a time.' },
    LTNG20: { pri: 3, name: 'Lightning within 20 km', cause: 'Storm approaching (detection network).', consequence: 'Transfers must stop if strikes come within 10 km.', action: 'Prepare to suspend transfers. Do not start new trucks that cannot finish in time.' },
    LTNG10: { pri: 2, name: 'Lightning within 10 km — stop transfers', cause: 'Storm overhead.', consequence: 'Lightning can ignite vapour at vents and open connections.', action: 'Stop all loading and unloading. Keep arms connected and valves closed. Resume 30 min after the last strike within 10 km.' },
    WIND: { pri: 3, name: 'High wind', cause: 'Wind above 15 m/s.', consequence: 'Work at height must stop. Gas dispersion changes.', action: 'Suspend work-at-height permits.' },
    ESD: { pri: 1, name: 'Emergency shutdown active', cause: 'ESD initiated manually or by the fire & gas system.', consequence: 'Transfers stopped, ROSOVs closed.', action: 'Find the cause. Clear it, then reset and restart in a controlled way.' },
    WBFAULT: { pri: 4, name: 'Weighbridge zero drift', cause: 'Weighbridge reading off zero with nothing on the deck.', consequence: 'Inaccurate weights on delivery documents.', action: 'Perform a zero check before the next weighing.' },
    METER: { pri: 3, name: 'Meter / weighbridge mismatch', cause: 'Coriolis meter and weighbridge net differ by more than 0.5%.', consequence: 'Custody transfer dispute.', action: 'Check the weighbridge zero and the meter factor. Log for metering engineer.' },
    DEMUR: { pri: 4, name: 'Rail demurrage running', cause: 'Rail car held beyond the free time.', consequence: 'Demurrage charges accrue every hour.', action: 'Prioritise unloading the car.' },
    TRUCKPSV: { pri: 1, name: 'Truck relief valve lifting', cause: 'Truck tank pressure at relief setting (fire exposure or liquid-full).', consequence: 'Vapour release at the bay. Escalation to BLEVE if exposed to fire.', action: 'Deluge the rack. Evacuate the bay.' },
    PERMIT: { pri: 4, name: 'Permit requires attention', cause: 'A permit is waiting for a decision or is overdue to close.', consequence: 'Work delayed or a site left in an unknown state.', action: 'Open the Permits tab.' },
    HWSIMOPS: { pri: 2, name: 'Gas near active hot work', cause: 'Gas detected near an area with live hot work.', consequence: 'Hot work is an ignition source.', action: 'Stop hot work immediately (suspend the permit).' },
  };

  // Fictional names. Driver first names are neutral; pronouns are never assumed.
  const PEOPLE = {
    first: ['Alex', 'Sam', 'Jordan', 'Robin', 'Casey', 'Morgan', 'Taylor', 'Jamie', 'Ashley', 'Kit', 'Rowan', 'Avery', 'Quinn', 'Reese', 'Drew', 'Sasha', 'Nico', 'Remy', 'Toni', 'Lou', 'Jules', 'Dani', 'Ellis', 'Hayden', 'Kai', 'Marley', 'Ari', 'Bo', 'Charlie', 'Frankie'],
    last: ['Okafor', 'Brennan', 'Kowalski', 'Haddad', 'Lindqvist', 'Mensah', 'Doyle', 'Petrov', 'Nakamura', 'Fairweather', 'Silva', 'Achterberg', 'Moreau', 'Ibrahim', 'Caldwell', 'Varga', 'Rahman', 'Oduya', 'Lindgren', 'Sorensen', 'Duarte', 'Whitlock', 'Abara', 'Kerr', 'Novak', 'Esposito', 'Hale', 'Mbeki', 'Quist', 'Rourke'],
    hauliers: ['Northgate Haulage', 'Brenmar Gas Logistics', 'Coastline Tankers', 'Ridgeway Fuels Transport', 'Fenwick & Daughters', 'Tarn Valley Bulk', 'Orrin Road Freight'],
    customers: ['Westmoor Gas Supplies', 'Calder Heating Co-op', 'Brightwater Autogas', 'Penhallow Farm Fuels', 'Ashby Industrial Gases', 'Lowfield Catering Gas', 'Kestrel Energy Retail', 'Dunmore Rural Energy'],
    contractors: ['Stanmore Mechanical', 'Eastfield Electrical', 'Kinross Scaffolding', 'Holt Civil Works', 'Arden Inspection Services', 'Vale Instrument Services', 'Corran Painting & Coatings'],
    crew: [{ id: 'FO1', name: 'Mira Achebe', call: 'Field 1' }, { id: 'FO2', name: 'Tomas Reilly', call: 'Field 2' }],
  };

  const DIFFICULTY = {
    trainee: { label: 'Trainee', trucks: 15, unbooked: 1, randomEvents: 3, latent: 1, permits: 4, storm: 0.25, defectRate: 0.18, hints: true, autoPause: true, targetFrac: 0.85, faultMult: 0.6 },
    operator: { label: 'Operator', trucks: 19, unbooked: 2, randomEvents: 5, latent: 2, permits: 5, storm: 0.45, defectRate: 0.24, hints: true, autoPause: true, targetFrac: 0.92, faultMult: 1 },
    senior: { label: 'Senior operator', trucks: 23, unbooked: 3, randomEvents: 8, latent: 3, permits: 7, storm: 0.65, defectRate: 0.3, hints: false, autoPause: false, targetFrac: 0.97, faultMult: 1.5 },
  };

  L.data = { SITE, ZONES, TANKS, BULLET, PUMPS, BAYS, POINTS, GAS_DET, FLAME_DET, DELUGE, ALARMS, PEOPLE, DIFFICULTY };
})(globalThis.LPG = globalThis.LPG || {});
