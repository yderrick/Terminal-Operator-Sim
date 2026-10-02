/* Operator handbook: the reference material behind every decision in the game.
   Values quoted from the model are generated live from physics.js so the tables match the simulation. */
(function (L) {
  'use strict';

  function vpTable() {
    const P = L.phys;
    let rows = '';
    for (const T of [-10, 0, 10, 15, 20, 30, 40, 50]) {
      rows += '<tr><td>' + T + ' °C</td><td>' + (P.psatPure('propane', T) - 1.013).toFixed(1) + '</td><td>' + (P.psatPure('butane', T) - 1.013).toFixed(2) + '</td><td>' + P.rhoPure('propane', T).toFixed(0) + '</td><td>' + P.rhoPure('butane', T).toFixed(0) + '</td></tr>';
    }
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Liquid temp.</th><th>Propane barg</th><th>Butane barg</th><th>Propane kg/m³</th><th>Butane kg/m³</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  const SECTIONS = [
    {
      id: 'role', title: 'Your shift',
      html: () => `
<p>You are the control room operator on the 06:00–18:00 day shift at Harrowmere LPG Terminal. The terminal stores pressurised propane and butane in three spheres, receives propane by rail, and loads road tankers at a four-bay rack.</p>
<p>You are scored on three things:</p>
<ul>
<li><b>Safety</b> — starts at 100. Lost for unsafe decisions, releases, fires and injuries. Good catches earn a little back.</li>
<li><b>Throughput</b> — tonnes dispatched against the shift target, less complaints, demurrage and wrongly refused trucks.</li>
<li><b>Compliance</b> — procedures: gauging, permits, routine tasks, documents, alarm response.</li>
</ul>
<p>The overall grade weights them 45 / 35 / 20. Any injury caps the grade at D. A BLEVE ends the shift.</p>
<p>You have two field operators. Anything that needs hands on the plant — gauging, gas tests, rail connections, rounds, isolations — means sending one of them, and they take real time to walk there.</p>`,
    },
    {
      id: 'lpg', title: 'LPG properties',
      html: () => `
<p>LPG is stored as a liquid under its own vapour pressure. The pressure in a sphere is set by the temperature of the liquid surface, not by how full it is. Warm the surface and the pressure rises; that is why spheres are painted white and have deluge.</p>
${vpTable()}
<ul>
<li>Vapour is about 1.5 (propane) to 2 (butane) times heavier than air. It slumps, flows along the ground and collects in drains and pits.</li>
<li>Flammable range: propane 2.1–9.5% in air, butane 1.8–8.4%. Gas detectors read in <b>%LEL</b>: 100% LEL is the bottom of the flammable range.</li>
<li>1 litre of liquid propane makes about 270 litres of vapour.</li>
<li>Liquid expands roughly 0.3% per °C, far more than water. That is why tanks are never filled full.</li>
<li>Propane for heating is odorised with ethyl mercaptan (here 25 ppm) so a leak can be smelt.</li>
</ul>`,
    },
    {
      id: 'loading', title: 'Road tanker loading',
      html: () => `
<h4>1. Gate</h4>
<p>Check the documents before the truck enters. Refuse if any of these fail:</p>
<ul>
<li>Driver ADR training certificate in date.</li>
<li>Vehicle ADR certificate of approval in date.</li>
<li>Tank periodic inspection (pressure test) not overdue.</li>
<li>Tank approved for the product. A tank approved for UN 1011 (butane) only may have a lower design pressure than propane needs.</li>
<li>Fire extinguishers: 2 kg in the cab plus at least 6 kg more.</li>
<li>Booking or a confirmed order. Unbooked trucks need a sales confirmation.</li>
<li>Previous cargo compatible, or a purge certificate (propylene residue puts propane off-spec).</li>
<li>No visible roadworthiness defects (tyres, lights, leaks).</li>
</ul>
<p>Orange plate: hazard identification number <b>23</b> (flammable gas) over the UN number: 1978 propane, 1011 butane, 1965 mixture.</p>
<h4>2. Weigh in</h4>
<p>Gross in = tare + any heel (product left from the last trip). Heel ≈ gross in − registered tare.</p>
<h4>3. Pre-load checks at the bay</h4>
<p>Engine off and brake on, chocks, static ground clamp (the monitor only gives a permissive below 10 Ω), PPE and no phones, liquid arm and vapour-return arm, leak test, truck internal valve open. Never override the ground monitor.</p>
<h4>4. Calculate the preset</h4>
<p>The batch controller works in <b>net mass</b> (liquid meter minus vapour-return meter). The preset is the lowest of:</p>
<ul>
<li><b>Order</b> quantity (or "FULL").</li>
<li><b>ADR filling limit</b> = tank capacity (L) × filling ratio − heel. Filling ratio: propane 0.42 kg/L, butane 0.51 kg/L.</li>
<li><b>Legal weight limit</b> = gross vehicle weight limit − gross in.</li>
</ul>
<p class="eg">Example: 49,800 L propane trailer, tare 16,200 kg, gross in 16,800 kg (heel ≈ 600 kg), 40 t limit.<br>ADR: 49,800 × 0.42 − 600 = 20,316 kg. Weight: 40,000 − 16,800 = 23,200 kg. Preset: 20,300 kg (ADR limits).</p>
<p>Butane tankers often hit the weight limit first because the filling ratio is higher.</p>
<h4>5. Loading</h4>
<p>The controller starts at low flow (static control and leak check), runs at full rate, then tops off at low flow. Watch the flow, the ground permissive, the odorant injection and the truck. Stop at once if the engine starts.</p>
<h4>6. Weigh out and release</h4>
<p>Compare weighbridge net with the meter net. More than 0.5% difference needs explaining (weighbridge zero, meter factor). Check the gross is within the legal limit and the content within the filling ratio. If either fails, decant the excess before release — never send an overloaded or overfilled tanker onto the road.</p>`,
    },
    {
      id: 'rail', title: 'Rail car unloading',
      html: () => `
<p>Rail tank cars are unloaded by <b>vapour compressor</b>, not by pump. The compressor C-301 has a 4-way valve that sets the direction:</p>
<ol>
<li><b>Secure the car</b>: blue flag, derail, chocks, handbrake. Nobody shunts a car with people working on it.</li>
<li><b>Sample</b> the car and wait for the lab. Once off-spec product is in a sphere you cannot get it out. Spec here: C4+ at most 5%.</li>
<li><b>Connect</b>: ground and bond, liquid and vapour hoses, leak test, open the car valves.</li>
<li><b>Liquid transfer</b> (4-way: LIQUID): the compressor takes vapour from the sphere and pushes it into the top of the car. The extra 2–2.5 bar pushes liquid out of the car's eduction pipe into the sphere.</li>
<li>When the sight glass shows vapour, stop. Move the 4-way valve to <b>VAPOUR RECOVERY</b> and restart: now the compressor pulls vapour out of the car into the sphere, recovering 1–1.5 tonnes.</li>
<li>Stop at about <b>1.5 barg</b>. Going lower raises discharge temperature (high compression ratio) and risks pulling the car toward vacuum.</li>
<li>Close valves, blow down the hoses, disconnect, remove the blue flag, release the car.</li>
</ol>
<p>Never start vapour recovery with liquid still in the car: liquid reaches the compressor suction, the knock-out pot fills, and the machine trips (or is wrecked). Watch the receiving sphere level — the compressor will push against a closed inlet if the high-high switch trips.</p>
<p>Each drop has 6 hours free time; after that, demurrage is charged per car per hour.</p>`,
    },
    {
      id: 'gauging', title: 'Tank gauging and stock',
      html: () => `
<p>Every shift starts and ends with a gauge. The radar is the control gauge; it can stick or drift. Each sphere also has a local magnetic level gauge and an independent high-high level switch (LSHH).</p>
<h4>Calculation (for each sphere)</h4>
<ol>
<li>Observed liquid volume from level h in a sphere of radius R: <code>V = π h² (3R − h) / 3</code> (the strapping table).</li>
<li>Volume correction factor to 15 °C: <code>VCF = ρ(T) / ρ15</code> (API MPMS 11.2.4 / GPA TP-27 style).</li>
<li>Standard volume <code>V15 = V × VCF</code>; liquid mass <code>= V15 × ρ15</code>.</li>
<li>Vapour mass <code>= (V_sphere − V) × ρ_vapour</code>, with ρ_vapour from pressure and temperature. In a half-full propane sphere this is about 1–2% of the total — too big to ignore.</li>
</ol>
<p>A 1 mm level error at the equator of a 14.5 m sphere is about 85 kg of propane. If manual and radar differ by more than ~10 mm on a static tank, flag the radar, use the manual figure and restrict receipts into that sphere. Compare readings taken at the same time: a moving tank changes between readings.</p>
<h4>Reconciliation</h4>
<p>Book closing = opening + receipts − dispatches. Physical closing comes from the gauges. Difference within ±0.25% of movements (+ a small fixed allowance) is normal measurement noise. Larger differences mean a measurement fault or product lost to atmosphere.</p>`,
    },
    {
      id: 'alarms', title: 'Alarms',
      html: () => `
<p>Alarms follow ISA-18.2. Every alarm has a defined cause, consequence and operator action — click any alarm to read its response.</p>
<ul>
<li><span class="pri p1">P1</span> Critical — act now; the consequence is severe and close.</li>
<li><span class="pri p2">P2</span> High — act within minutes.</li>
<li><span class="pri p3">P3</span> Medium — act within the next half hour.</li>
<li><span class="pri p4">P4</span> Low — information, plan a response.</li>
</ul>
<p>Acknowledging an alarm means "I have seen it and I own it". It does not fix anything. Unacknowledged critical alarms cost compliance points every 5 minutes. A well-run console sees no more than one or two alarms per 10 minutes on average.</p>
<p>The HMI follows ISA-101 high-performance style: grey when normal, colour only when something needs you. Running equipment is drawn filled, stopped equipment hollow.</p>`,
    },
    {
      id: 'fg', title: 'Fire & gas, ESD and deluge',
      html: () => `
<ul>
<li><b>Gas detectors</b> alarm at 20% LEL and 40% LEL. Two detectors in a zone at 40% (2ooN voting) is <b>confirmed gas</b>: automatic area ESD.</li>
<li><b>Flame detectors</b>: confirmed fire releases deluge on the exposed equipment and trips the site ESD.</li>
<li><b>ESD</b> closes the fail-safe ROSOVs and stops pumps and the compressor. Area ESDs cover the tank farm, pump area, rack and rail; site ESD covers all. After a reset, nothing restarts on its own — reopen valves and restart equipment deliberately.</li>
<li><b>Deluge</b> puts a water film on the shell (NFPA 15 calls for about 10 L/min per m² on exposed vessels). It keeps the steel cool where it is not wetted inside by liquid. Fire pumps start automatically on falling ring-main pressure; the diesel pump is the backup if power fails.</li>
<li><b>BLEVE</b> (boiling liquid expanding vapour explosion): flame on the vapour-space shell heats steel that has no liquid behind it to cool it. Above ~400 °C the steel weakens; under pressure it tears, the liquid flashes and ignites as a fireball. Cooling and isolating the fuel are the defences.</li>
<li>Do not extinguish a gas fire unless the source is isolated. An unignited cloud is more dangerous than a burning jet.</li>
<li>Send field operators toward a leak from upwind, never into a cloud above 20% LEL.</li>
</ul>`,
    },
    {
      id: 'ptw', title: 'Permit to work',
      html: () => `
<p>As area authority you issue permits for work on your plant. Before signing, check:</p>
<ul>
<li><b>Gas test</b> at the work site, immediately before work: hot work 0% LEL; confined space entry O₂ 19.5–23.5% and LEL below 1%. Retest if more than 2 hours old or after any suspension.</li>
<li><b>Isolation</b> matches the certificate and is verified on site. Vessel entry needs positive isolation (spades or removed spools), never just closed valves.</li>
<li><b>SIMOPS</b> (simultaneous operations): no ignition source within about 35 m of live LPG transfers unless those transfers are suspended.</li>
<li><b>Equipment state</b>: you cannot isolate a running duty pump — swap to the standby first.</li>
<li><b>Competency</b> card of the performing authority in date.</li>
<li><b>Weather</b>: no work at height in lightning or strong wind.</li>
<li><b>Buried services</b> located before excavation.</li>
<li><b>Overrides</b> of safety functions only when the hazard they protect against cannot occur (no receipts into a vessel while its overfill switch is bypassed). Track and remove every override.</li>
</ul>
<p>Add the conditions the job needs (fire watch, continuous gas monitoring, standby person, suspension of nearby operations). A condition you sign is a commitment: if the permit says the rack is suspended, nothing on the rack moves. Close permits at hand-back once the site is safe.</p>`,
    },
    {
      id: 'weather', title: 'Weather',
      html: () => `
<ul>
<li><b>Lightning</b>: stop all loading and unloading when strikes are detected within 10 km. Resume only after 30 minutes with no strike inside 10 km. Keep arms connected and valves closed during the stop.</li>
<li><b>Heat</b>: sun on the spheres raises surface temperature and pressure through the day. A sphere that is too full has less room for the liquid to expand.</li>
<li><b>Wind</b> carries gas. Look at the wind arrow when a detector alarms: the leak is upwind of it. Above 12–15 m/s, stop work at height.</li>
</ul>`,
    },
    {
      id: 'cases', title: 'Why the rules exist',
      html: () => `
<dl class="cases">
<dt>Feyzin, France, 1966</dt><dd>Propane leaked while operators drained water from the bottom of a sphere and the valve froze open. The cloud reached a road and ignited. The fire under the sphere led to a BLEVE about 90 minutes later; 18 people died, most of them firefighters. <i>Lessons: sphere draining procedures, cooling water, remote isolation.</i></dd>
<dt>Los Alfaques, Spain, 1978</dt><dd>An overloaded road tanker of propylene with no relief valve ruptured beside a campsite. Over 200 people died. <i>Lessons: filling ratios, relief valves, weighbridge checks.</i></dd>
<dt>San Juanico, Mexico City, 1984</dt><dd>A pipeline rupture at an LPG terminal formed a cloud that ignited at a flare, followed by a chain of vessel BLEVEs. Around 500 people died. <i>Lessons: gas detection, ESD, layout and spacing.</i></dd>
<dt>Piper Alpha, North Sea, 1988</dt><dd>A pump was restarted on night shift without knowing its relief valve had been removed under a permit. 167 people died. <i>Lessons: permit to work, isolation control and shift handover.</i></dd>
<dt>Buncefield, UK, 2005</dt><dd>A storage tank overfilled: the automatic gauge stuck and the independent high-level switch did not work. The vapour cloud exploded. <i>Lessons: independent overfill protection, gauge checks, never rely on one instrument.</i></dd>
<dt>Viareggio, Italy, 2009</dt><dd>A freight train derailed and an LPG rail tank car was punctured. The cloud spread into the town and ignited; 32 people died. <i>Lessons: rail car integrity, emergency response.</i></dd>
</dl>`,
    },
    {
      id: 'glossary', title: 'Glossary',
      html: () => `
<dl class="gloss">
<dt>ADR</dt><dd>European agreement on the carriage of dangerous goods by road (RID is the rail equivalent).</dd>
<dt>BLEVE</dt><dd>Boiling liquid expanding vapour explosion.</dd>
<dt>Demurrage</dt><dd>Charge for holding a rail car beyond its free time.</dd>
<dt>ESD</dt><dd>Emergency shutdown.</dd>
<dt>Filling ratio</dt><dd>Maximum kg of product per litre of tank capacity.</dd>
<dt>GVW</dt><dd>Gross vehicle weight limit.</dd>
<dt>Heel</dt><dd>Product left in a tanker from its previous trip.</dd>
<dt>ICC</dt><dd>Isolation confirmation certificate.</dd>
<dt>LEL</dt><dd>Lower explosive limit.</dd>
<dt>LOTO</dt><dd>Lock-out, tag-out.</dd>
<dt>LSHH</dt><dd>Level switch high-high: independent overfill trip.</dd>
<dt>NPSH</dt><dd>Net positive suction head: the margin that keeps a pump from cavitating.</dd>
<dt>PSV</dt><dd>Pressure safety (relief) valve.</dd>
<dt>PTW</dt><dd>Permit to work.</dd>
<dt>ROSOV</dt><dd>Remotely operated shut-off valve; fails closed on loss of air.</dd>
<dt>SIMOPS</dt><dd>Simultaneous operations.</dd>
<dt>VCF</dt><dd>Volume correction factor to standard temperature (15 °C).</dd>
</dl>`,
    },
  ];

  L.content = { SECTIONS };
})(globalThis.LPG = globalThis.LPG || {});
