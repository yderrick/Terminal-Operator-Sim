# Harrowmere LPG Terminal

A browser game where you run the control room of a pressurised LPG terminal for a twelve-hour day shift. Road tankers queue at the gate, rail cars of propane wait to be unloaded, contractors want permits, the sun warms the spheres, and things go wrong. You are scored on **safety**, **throughput** and **compliance**.

Open `index.html` in a browser. No install, no server, no build step needed to play. `dist/harrowmere-standalone.html` is the same game as one self-contained file.

## What you do

- **Gate.** Inspect each tanker's documents: driver ADR certificate, vehicle certificate of approval, tank inspection date, the orange plate and the product the tank is approved for, extinguishers, booking, previous cargo. Admit it or refuse it with the right reason.
- **Weighbridges.** Trucks weigh in (tare plus heel) and out. Keep the bridges zeroed.
- **Loading rack.** Call trucks to compatible bays. The driver works through the pre-load checks (ground monitor, arms, leak test). You resolve defects, calculate the preset — the lowest of the order, the ADR filling limit (capacity × 0.42 kg/L propane, 0.51 butane, minus heel) and the legal weight limit — and authorise loading. Watch flow, odorant, ground and the driver.
- **Release.** Compare weighbridge net to meter net. Decant overweight or overfilled trucks; never let them on the road.
- **Rail.** Secure, sample and connect tank cars, then drive compressor C-301: liquid transfer first, then switch the 4-way valve to vapour recovery and stop at about 1.5 barg. Avoid demurrage, off-spec product and liquid carry-over.
- **Tank farm.** Line up the loading headers, watch level, pressure and temperature, and gauge the spheres at the start and end of the shift against an independent local reading. A radar can stick. The stock reconciliation catches it if you don't.
- **Permits.** As area authority, review hot work, confined space entry, electrical isolation, work at height, excavation, vehicle entry, detector inhibits and safety-system overrides. Gas test, verify isolation, check simultaneous operations, attach conditions, issue or refuse, then close at hand-back.
- **Alarms.** ISA-18.2 priorities with a response procedure behind every alarm. Acknowledge, act, and keep the alarm rate down.
- **Emergencies.** Gas detectors (20/40% LEL, 2-out-of-N voting), flame detectors, area and site ESD, deluge, fire pumps, muster, fire service. Leaks drift with the wind and can find ignition sources — including your own permits.
- **Field crew.** Two field operators walk the plant in real time to gauge, gas test, connect rail cars, investigate and do rounds. Rounds find weeping seals, worn bearings and flange leaks before they fail.

## What is simulated

- Vapour pressure and density of propane/butane mixtures from saturation-data fits; sphere pressure follows the liquid surface temperature (sun, deluge, fire).
- Sphere geometry, liquid/vapour inventory split, VCF to 15 °C, stock calculation step by step.
- Pump capacity, NPSH and cavitation, vibration (ISO 10816 zones), seal wear; header line-ups and auto start.
- Loading with low-flow start and topping, Coriolis net metering with vapour return, odorant injection.
- Truck filling ratio, gross weight, heel, liquid-full relief.
- Compressor unloading physics: car overpressure, liquid flow, vapour recovery, compression-ratio discharge temperature, knock-out pot.
- Gaussian heavy-gas plume dispersion with wind, ignition by real sources, jet fires, heat input to vessels, shell temperature and BLEVE.
- Weather: diurnal temperature, sun, wind, thunderstorms with the 30-minute lightning rule.
- Instrument air (fail-safe ROSOVs), power dips, fire water ring main, diesel pump weekly test.

The handbook inside the game explains every rule and the accidents behind them (Feyzin, Los Alfaques, San Juanico, Piper Alpha, Buncefield, Viareggio).

All people, companies and the terminal are fictional.

## Project layout

```
index.html              page that loads the scripts below (generated)
css/hmi.css             ISA-101 style console, light and dark themes
js/core/                simulation, no DOM: physics, plant, rack, rail, crew, permits, events, scoring, handbook
js/ui/                  rendering and interaction
tools/build.js          writes index.html and the single-file builds in dist/
tests/                  headless shifts played by scripted operators
```

## Development

```
npm run build   # regenerate index.html and dist/
npm test        # play full shifts headlessly: competent, idle, reckless and random-click operators
```
