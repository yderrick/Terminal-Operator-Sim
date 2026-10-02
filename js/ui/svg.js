/* Plant overview: static schematic built once, dynamic layer redrawn a few times per second. */
(function (L) {
  'use strict';
  const D = L.data, U = L.util;
  const f1 = (v) => (Math.round(v * 10) / 10).toString();

  function staticLayer() {
    let s = '';
    // Zones
    for (const k of Object.keys(D.ZONES)) {
      const z = D.ZONES[k];
      s += '<rect class="zone" x="' + z.x + '" y="' + z.y + '" width="' + z.w + '" height="' + z.h + '"></rect>';
      s += '<text class="zlbl" x="' + (z.x + 1.5) + '" y="' + (z.y + z.h - 1.5) + '">' + z.name + '</text>';
    }
    // Roads
    s += '<path class="road" d="M292 162 L184 162 M240 162 L240 128 L268 112 L268 52 L182 52 L182 104 L268 104 M204 104 L204 162"></path>';
    // Rail track with sleepers
    s += '<line class="rail" x1="0" y1="138.6" x2="128" y2="138.6"></line><line class="rail" x1="0" y1="142.4" x2="128" y2="142.4"></line>';
    for (let x = 1; x < 128; x += 3) s += '<line class="rail" x1="' + x + '" y1="137.6" x2="' + x + '" y2="143.4" stroke-width=".25"></line>';
    // Fixed equipment outlines
    s += '<rect class="eq" x="115" y="33.9" width="26" height="4.2" rx="2.1"></rect><text class="lbl" x="128" y="31.8" text-anchor="middle">V-104</text><text class="val" x="128" y="42.6" text-anchor="middle">OUT OF SERVICE</text>';
    s += '<rect class="canopy" x="184" y="58" width="58" height="40"></rect>';
    for (const b of D.BAYS) s += '<g class="hot" data-nav="rack:' + b.id + '"><rect class="lane" x="' + (b.x - 5.5) + '" y="60" width="11" height="36"></rect><text class="lbl" x="' + b.x + '" y="101" text-anchor="middle">' + b.tag.toUpperCase() + '</text></g>';
    const wb = (p, t) => '<g class="hot" data-nav="gate"><rect class="eq" x="' + (p.x - 4) + '" y="' + (p.y - 8) + '" width="8" height="16"></rect><text class="val" x="' + p.x + '" y="' + (p.y + 11) + '" text-anchor="middle">' + t + '</text></g>';
    s += wb(D.POINTS.wbIn, 'WB-1 IN') + wb(D.POINTS.wbOut, 'WB-2 OUT');
    s += '<g class="hot" data-nav="gate"><line x1="256" y1="157" x2="268" y2="157" stroke="var(--p1)" stroke-width="1" stroke-dasharray="1.4 1.4"></line><text class="val" x="262" y="154.5" text-anchor="middle">GATE</text></g>';
    s += '<rect class="eq" x="143" y="146" width="15" height="10"></rect><text class="lbl" x="150.5" y="152.3" text-anchor="middle">CCR</text>';
    s += '<rect class="eq" x="113" y="155" width="14" height="9"></rect><text class="val" x="120" y="160.6" text-anchor="middle">WORKSHOP</text>';
    s += '<g class="hot" data-nav="utilities"><rect class="eq" x="172" y="61" width="8" height="6"></rect><text class="val" x="176" y="59.6" text-anchor="middle">T-401</text></g>';
    s += '<g class="hot" data-nav="utilities"><circle class="eq" cx="18" cy="104" r="7"></circle><text class="val" x="18" y="104.9" text-anchor="middle">FW TANK</text></g>';
    s += '<g class="hot" data-nav="utilities"><rect class="eq" x="145" y="121" width="10" height="6"></rect><text class="val" x="150" y="119.6" text-anchor="middle">K-601A/B</text></g>';
    s += '<text class="val" x="168" y="170" text-anchor="middle">◆ MUSTER</text>';
    // Pipes
    s += '<g id="pipes"></g>';
    return s;
  }

  function pipes(S) {
    const H = S.headers;
    const pf = H.propane.flow > 0.5, bf = H.butane.flow > 0.5;
    const rf = S.rail.comp.running && (S.rail.flowKgS > 0.01 || S.rail.vapKgS < -0.01);
    const cls = (on) => 'pipe' + (on ? ' flow' : '');
    let s = '';
    const src = (id, on) => { const t = S.tanks[id]; return '<path class="' + cls(on) + '" d="M' + t.x + ' ' + (t.y + t.r) + ' L' + t.x + ' 66"></path>'; };
    s += src('V101', pf && H.propane.source === 'V101') + src('V102', pf && H.propane.source === 'V102') + src('V103', bf);
    s += '<path class="' + cls(pf) + '" d="M38 66 L70 66 M50 66 L50 71.4 M60 66 L60 71.4 M50 76.6 L50 86 L60 86 M60 76.6 L60 86 L178 86 L178 70.5 L240 70.5"></path>';
    s += '<path class="' + cls(bf) + '" d="M102 66 L102 69 L96 69 L96 71.4 M102 69 L106 69 L106 71.4 M96 76.6 L96 89 L106 89 M106 76.6 L106 89 L176 89 L176 67.5 L240 67.5"></path>';
    for (const b of S.bays) {
      const y0 = b.product === 'propane' ? 70.5 : 67.5;
      s += '<path class="' + cls(b.flowing) + '" d="M' + (b.x + 2) + ' ' + y0 + ' L' + (b.x + 2) + ' 74"></path>';
    }
    s += '<path class="' + cls(rf) + '" d="M46 136 L46 128 L86 128 M86 136 L86 128 M66 128 L66 104 L22 104 L22 58 L78 58 M42 58 L42 47 M74 58 L74 47"></path>';
    return s;
  }

  function dynamic(S) {
    let s = '';
    // ESD tint
    for (const z of ['TF', 'PA', 'LR', 'RL']) if (S.esd.site || S.esd.zones[z]) { const Z = D.ZONES[z]; s += '<rect class="esdmask" x="' + Z.x + '" y="' + Z.y + '" width="' + Z.w + '" height="' + Z.h + '"></rect><text class="val alm" x="' + (Z.x + Z.w - 1.5) + '" y="' + (Z.y + 4) + '" text-anchor="end">ESD</text>'; }
    // Spheres
    for (const id of S.tankOrder) {
      const t = S.tanks[id];
      const lv = t.levelMeas / 1000;
      const top = t.y + t.r - lv;
      const alm = S.alarms.some((a) => a.active && a.key.endsWith('-' + id) && a.pri <= 2);
      s += '<g class="hot" data-nav="tanks:' + id + '">';
      for (const sx of [-1, 1]) for (const k of [0.45, 0.85]) s += '<line class="pipe" x1="' + (t.x + sx * t.r * k) + '" y1="' + (t.y + t.r * Math.sqrt(1 - k * k)) + '" x2="' + (t.x + sx * t.r * (k + 0.05)) + '" y2="' + (t.y + t.r + 2.4) + '"></line>';
      s += '<clipPath id="cp' + id + '"><circle cx="' + t.x + '" cy="' + t.y + '" r="' + t.r + '"></circle></clipPath>';
      s += '<circle class="eq" cx="' + t.x + '" cy="' + t.y + '" r="' + t.r + '"></circle>';
      s += '<rect class="liq" clip-path="url(#cp' + id + ')" x="' + (t.x - t.r) + '" y="' + f1(top) + '" width="' + (2 * t.r) + '" height="' + f1(lv) + '"></rect>';
      s += '<circle cx="' + t.x + '" cy="' + t.y + '" r="' + t.r + '" fill="none" stroke="' + (alm ? 'var(--p1)' : 'var(--proc)') + '" stroke-width="' + (alm ? 0.9 : 0.5) + '"></circle>';
      s += '<path class="psv' + (t.psvLift ? ' on' : '') + '" d="M' + (t.x - 1) + ' ' + (t.y - t.r) + ' L' + (t.x + 1) + ' ' + (t.y - t.r) + ' L' + t.x + ' ' + (t.y - t.r - 1.8) + ' Z"></path>';
      s += '<text class="lbl" x="' + t.x + '" y="' + (t.y - t.r - 2.6) + '" text-anchor="middle">' + t.tag + '</text>';
      s += '<text class="val' + (t.fillMeas > 0.85 ? ' alm' : '') + '" x="' + t.x + '" y="' + (t.y - 0.6) + '" text-anchor="middle">' + (t.fillMeas * 100).toFixed(1) + '%</text>';
      s += '<text class="val' + (t.P > t.pah ? ' alm' : '') + '" x="' + t.x + '" y="' + (t.y + 2.6) + '" text-anchor="middle">' + t.P.toFixed(2) + ' barg</text>';
      s += '<text class="val" x="' + t.x + '" y="' + (t.y + 5.6) + '" text-anchor="middle">' + (t.product === 'propane' ? 'C3' : 'C4') + (t.radar.flagged ? ' · LT SUSPECT' : '') + '</text>';
      if (!t.xvOut || !L.plant.outletOpen(S, t)) s += '<text class="val alm" x="' + (t.x + 1.4) + '" y="' + (t.y + t.r + 5) + '">XV SHUT</text>';
      s += '</g>';
      if (L.plant.tankDelugeEff(S, id) > 0) for (let a = 0; a < 10; a++) { const an = a / 10 * Math.PI * 2 + S.t * 0.3; s += '<circle class="spray" cx="' + f1(t.x + Math.cos(an) * (t.r + 1.2)) + '" cy="' + f1(t.y + Math.sin(an) * (t.r + 1.2)) + '" r=".45"></circle>'; }
    }
    // Pumps
    for (const p of Object.values(S.pumps)) {
      const c = 'eq' + (p.running ? ' run' : '') + (p.tripped ? ' trip' : '');
      s += '<g class="hot" data-nav="utilities"><circle class="' + c + '" cx="' + p.x + '" cy="' + p.y + '" r="2.6"></circle>';
      s += '<text class="val" x="' + p.x + '" y="' + (p.y + 5.4) + '" text-anchor="middle">' + p.tag.slice(2) + '</text>';
      if (p.loto) s += '<text class="val alm" x="' + p.x + '" y="' + (p.y + 0.9) + '" text-anchor="middle">L</text>';
      s += '</g>';
    }
    // Compressor
    const comp = S.rail.comp;
    s += '<g class="hot" data-nav="rail"><rect class="eq' + (comp.running ? ' run' : '') + (comp.tripped ? ' trip' : '') + '" x="63" y="121.5" width="6" height="5"></rect><text class="val" x="66" y="119.8" text-anchor="middle">C-301 ' + (comp.running ? comp.mode.slice(0, 3) : '') + '</text></g>';
    // Rail cars
    for (const c of S.rail.cars) {
      if (!['SPOTTED', 'UNLOADING'].includes(c.state)) continue;
      const pt = D.POINTS[c.spotId === 'R1' ? 'railR1' : 'railR2'];
      s += '<g class="hot" data-nav="rail"><rect class="eq" x="' + (pt.x - 15) + '" y="138.3" width="30" height="4.4" rx="2.2"></rect>';
      s += '<rect class="liq" x="' + (pt.x - 14.5) + '" y="' + f1(142.5 - 4 * c.fill) + '" width="29" height="' + f1(4 * c.fill) + '" rx="1"></rect>';
      s += '<text class="val" x="' + pt.x + '" y="136.2" text-anchor="middle">' + c.spotId + ' ' + c.P.toFixed(1) + ' barg</text></g>';
    }
    // Trucks
    for (const tr of S.trucks) {
      if (!tr.pos || tr.state === 'GONE') continue;
      const atBay = tr.state === 'AT_BAY';
      const b = atBay ? S.bays.find((x) => x.id === tr.bay) : null;
      const vertical = atBay || ['PARKED', 'DECANT_WAIT', 'TO_BAY', 'WB_IN', 'WB_OUT'].includes(tr.state);
      const w = vertical ? 4 : 11, h = vertical ? 11 : 4;
      const cls = 'truck' + (b && b.flowing ? ' load' : '') + (b && (b.hold || b.state === 'STOPPED') ? ' prob' : '') + (tr.psvLift ? ' prob' : '');
      const nav = atBay ? 'rack:' + tr.bay : 'gate';
      s += '<g class="hot" data-nav="' + nav + '"><rect class="' + cls + '" x="' + f1(tr.pos.x - w / 2) + '" y="' + f1(tr.pos.y - h / 2) + '" width="' + w + '" height="' + h + '" rx=".8"></rect>';
      if (atBay) {
        const frac = U.clamp(b.preset ? b.net / b.preset : 0, 0, 1);
        s += '<rect x="' + f1(tr.pos.x - 2) + '" y="' + f1(tr.pos.y + 7) + '" width="4" height=".9" fill="var(--line)"></rect><rect x="' + f1(tr.pos.x - 2) + '" y="' + f1(tr.pos.y + 7) + '" width="' + f1(4 * frac) + '" height=".9" fill="var(--ink-2)"></rect>';
      }
      s += '</g>';
    }
    const q = S.trucks.filter((t) => t.state === 'QUEUE').length;
    if (q) s += '<g class="hot" data-nav="gate"><text class="val alm" x="286" y="158" text-anchor="end">' + q + ' AT GATE</text></g>';
    // Gas clouds for leaks the operator knows about
    const W = S.weather;
    const to = ((W.windDir + 180) % 360) * Math.PI / 180;
    const wx = Math.sin(to), wy = -Math.cos(to);
    for (const lk of S.leaks) {
      if (lk.rate < 0.003) continue;
      const known = lk.seen || S.gd.some((g) => !g.inhibited && !g.fault && g.lel >= 10 && U.dist(g.x, g.y, lk.x, lk.y) < 35);
      if (!known) continue;
      const len = 6 + 45 * Math.sqrt(lk.rate) * Math.min(1.6, 3 / Math.max(W.wind, 0.8));
      const cx = lk.x + wx * len / 2, cy = lk.y + wy * len / 2;
      const ang = Math.atan2(wy, wx) * 180 / Math.PI;
      s += '<ellipse class="cloud" cx="' + f1(cx) + '" cy="' + f1(cy) + '" rx="' + f1(len / 2) + '" ry="' + f1(len * 0.18 + 1.5) + '" transform="rotate(' + f1(ang) + ' ' + f1(cx) + ' ' + f1(cy) + ')"></ellipse>';
      s += '<circle class="cloud" cx="' + f1(lk.x) + '" cy="' + f1(lk.y) + '" r="' + f1(2 + 6 * Math.sqrt(lk.rate)) + '"></circle>';
    }
    // Fires
    for (const f of S.fires) {
      if (f.out) continue;
      const sz = 3 + 10 * Math.sqrt(Math.max(f.size, 0.02));
      s += '<path class="fire" d="M' + f1(f.x - sz * 0.4) + ' ' + f1(f.y) + ' Q' + f1(f.x - sz * 0.5) + ' ' + f1(f.y - sz * 0.6) + ' ' + f1(f.x) + ' ' + f1(f.y - sz) + ' Q' + f1(f.x + sz * 0.5) + ' ' + f1(f.y - sz * 0.6) + ' ' + f1(f.x + sz * 0.4) + ' ' + f1(f.y) + ' Z"></path>';
    }
    // Rack and pump area deluge
    if (L.plant.delugeEff(S, 'DV301') > 0) for (let i = 0; i < 24; i++) s += '<circle class="spray" cx="' + (186 + (i % 12) * 4.8) + '" cy="' + (62 + Math.floor(i / 12) * 30 + ((S.t * 2 + i) % 4)) + '" r=".45"></circle>';
    if (L.plant.delugeEff(S, 'DV201') > 0) for (let i = 0; i < 10; i++) s += '<circle class="spray" cx="' + (44 + i * 7) + '" cy="' + (68 + ((S.t * 2 + i) % 4)) + '" r=".45"></circle>';
    if (L.plant.delugeEff(S, 'DV401') > 0) for (let i = 0; i < 12; i++) s += '<circle class="spray" cx="' + (26 + i * 8) + '" cy="' + (130 + ((S.t * 2 + i) % 4)) + '" r=".45"></circle>';
    // Detectors
    for (const g of S.gd) {
      const c = 'gd' + (g.inhibited || g.fault ? ' inh' : g.lel >= 40 ? ' l2' : g.lel >= 20 ? ' l1' : '');
      s += '<g class="hot" data-nav="fg"><rect class="' + c + '" x="' + (g.x - 1) + '" y="' + (g.y - 1) + '" width="2" height="2" transform="rotate(45 ' + g.x + ' ' + g.y + ')"></rect>';
      if (g.lel >= 5) s += '<text class="val' + (g.lel >= 20 ? ' alm' : '') + '" x="' + (g.x + 1.8) + '" y="' + (g.y - 1.2) + '">' + Math.round(g.lel) + '</text>';
      s += '</g>';
    }
    for (const fd of S.fd) s += '<path class="fd' + (fd.fire && !fd.inhibited ? ' on' : '') + '" d="M' + (fd.x - 1) + ' ' + (fd.y + 0.8) + ' L' + (fd.x + 1) + ' ' + (fd.y + 0.8) + ' L' + fd.x + ' ' + (fd.y - 1) + ' Z"></path>';
    // Crew
    for (const c of S.crew) {
      s += '<circle class="crew" cx="' + f1(c.x) + '" cy="' + f1(c.y) + '" r="1.5"' + (c.injured ? ' style="fill:var(--p1)"' : '') + '></circle><text class="crew-l" x="' + f1(c.x + 2) + '" y="' + f1(c.y - 1.4) + '">' + c.call.replace('Field ', 'F') + '</text>';
    }
    // Wind
    const ax = 272, ay = 14, al = 7;
    s += '<g class="wind"><line x1="' + f1(ax - wx * al) + '" y1="' + f1(ay - wy * al) + '" x2="' + f1(ax + wx * al) + '" y2="' + f1(ay + wy * al) + '"></line>';
    const hx = ax + wx * al, hy = ay + wy * al, px = -wy, py = wx;
    s += '<path d="M' + f1(hx + wx * 1.8) + ' ' + f1(hy + wy * 1.8) + ' L' + f1(hx + px * 1.4) + ' ' + f1(hy + py * 1.4) + ' L' + f1(hx - px * 1.4) + ' ' + f1(hy - py * 1.4) + ' Z"></path></g>';
    s += '<text class="val" x="' + ax + '" y="27" text-anchor="middle">WIND ' + W.wind.toFixed(1) + ' m/s from ' + U.compass(W.windDir) + '</text>';
    s += '<text class="val" x="' + ax + '" y="4" text-anchor="middle">N ↑</text>';
    if (W.lightningKm < 25) s += '<text class="val alm" x="' + ax + '" y="31" text-anchor="middle">LIGHTNING ' + W.lightningKm.toFixed(0) + ' km</text>';
    return s;
  }

  function build() {
    return '<svg class="plant" viewBox="0 0 ' + D.SITE.w + ' ' + D.SITE.h + '" role="img" aria-label="Plant overview schematic">' + staticLayer() + '<g id="dyn"></g></svg>';
  }
  function update(root, S) {
    if (!root) return;
    const p = root.querySelector('#pipes'), d = root.querySelector('#dyn');
    if (p) { const h = pipes(S); if (p._h !== h) { p.innerHTML = h; p._h = h; } }
    if (d) { const h = dynamic(S); if (d._h !== h) { d.innerHTML = h; d._h = h; } }
  }

  L.plantSvg = { build, update };
})(globalThis.LPG = globalThis.LPG || {});
