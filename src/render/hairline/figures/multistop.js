/**
 * Multistop: one road from a start puck to a destination pin, a smooth S
 * (a sampled cubic Bézier). Beside the road at its midpoint, on the far side,
 * stands the charger: a lightning bolt, a thick plate facing the viewer. A small car (body, a narrower cabin with a sloped
 * windscreen, wheels, a battery bar on its roof) drives the road. The
 * pointer's place along the road is the trip's: the car rides there on a
 * spring and turns with the curve, its charge (in the read-out) draining.
 * Anywhere near the charger holds the car beside it; arriving starts the
 * charge, a tween of CHARGE_MS from what was left to full, while the charger
 * takes the bright edge. At rest the car sits just past the start. The slider
 * is the consumption, in tenths of a percent per unit of road.
 *
 * The pattern: a scrub along a path. The hit test is the nearest point of the
 * road's centre line to the pointer on the ground plane, which never moves.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, open, poly, prism, proj, ringAt, rings, rrect, run, unproj,
  spring, stepS, tdone, tset, tval, tween, disposer, flatDot, mk, place, pointer, put, register, solid,
} = HL;

/** The road's centre line: a cubic S from the origin (near) to the destination (far), sampled finely. */
const BZ = [[40, 83], [-105, 80], [105, -80], [-40, -83]];
const PATH = Array.from({ length: 73 }, (_, k) => {
  const t = k / 72, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
  return [0, 1].map((j) => a * BZ[0][j] + b * BZ[1][j] + c * BZ[2][j] + d * BZ[3][j]);
});
const O = PATH[0], D = PATH[PATH.length - 1];
const HW = 7, TH = 3, PK = 6, PKR = 14, PIN_R = 15, PIN_H = 40, PIN_T = 5;
const FULL = 0.95, ZONE = 10;
const SEGS = PATH.slice(1).map((b, i) => { const a = PATH[i]; return { a, b, l: Math.hypot(b[0] - a[0], b[1] - a[1]) }; });
const LEN = SEGS.reduce((t, s) => t + s.l, 0), HOLD = LEN / 2, STOP = HOLD + ZONE / 2, S0 = PKR + 14, S1 = LEN - 10, REST = 30, CHARGE_MS = 1000;
const CH = [-32, -5];

/** The point s units along the road's centre line. */
function along(s) {
  for (const g of SEGS) { if (s <= g.l) return [g.a[0] + ((g.b[0] - g.a[0]) * s) / g.l, g.a[1] + ((g.b[1] - g.a[1]) * s) / g.l]; s -= g.l; }
  return D;
}
/** The place along the centre line nearest a ground point, and how far off it the point is. */
function nearest([x, y]) {
  let best = [0, Infinity], s0 = 0;
  for (const g of SEGS) {
    const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], t = clamp(((x - g.a[0]) * dx + (y - g.a[1]) * dy) / (g.l * g.l), 0, 1);
    const d = Math.hypot(g.a[0] + dx * t - x, g.a[1] + dy * t - y);
    if (d < best[1]) best = [s0 + t * g.l, d];
    s0 += g.l;
  }
  return best;
}
/** The road's outline: the centre line widened by HW, trimmed clear of the puck, every corner rounded. */
function outline() {
  const pts = [along(PKR + 4)];
  for (let s = PKR + 7; s < LEN - 5; s += 3.5) pts.push(along(s));
  pts.push(along(LEN - 3));
  const n = pts.length, nor = [];
  for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy); nor.push([-dy / l, dx / l]); }
  const side = (s) => pts.map((p, k) => {
    const a = nor[Math.max(0, k - 1)], b = nor[Math.min(n - 2, k)], m = [a[0] + b[0], a[1] + b[1]], q = 1 + a[0] * b[0] + a[1] * b[1];
    return [p[0] + (s * HW * m[0]) / q, p[1] + (s * HW * m[1]) / q];
  });
  const shape = side(1).concat(side(-1).reverse());
  return fillet(shape, shape.map(() => 1.5), 2);
}
function pinShape() {
  const cy = PIN_H - PIN_R, a0 = Math.acos(PIN_R / cy), pts = [];
  for (let k = 0; k <= 28; k++) { const a = a0 + (k / 28) * (2 * Math.PI - 2 * a0); pts.push([PIN_R * Math.sin(a), cy - PIN_R * Math.cos(a)]); }
  pts.push([0, 0]);
  return fillet(pts, pts.map((_, k) => (k === pts.length - 1 ? 2.5 : 0.4)), 3);
}
const BOLT = [[1.5, 19], [-6.5, 7.5], [-0.5, 7.5], [-3.5, 0], [6.5, 11.5], [0.5, 11.5]];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let rate = value / 1000;
  /** The charge driving to the stop, and driving on from it. At the stop itself it is the charge tween's. */
  const pre = (s) => clamp(FULL - rate * (s - S0), 0.05, 1), after = (s) => clamp(FULL - rate * (s - STOP), 0.05, 1);
  const atStop = (s) => Math.abs(s - HOLD) <= ZONE / 2 + 0.5;

  const C = Cam(45, 0.5, 1.8);
  const shape = outline();
  fit(C, [...shape.map((p) => [p[0], p[1], 0]), [O[0] + PKR, O[1] + PKR, 0], [O[0] - PKR, O[1], 0], [D[0], D[1], PIN_H], [...along(S1), 22]], 200, 166);
  const P = proj(C), front = facing(C);
  const shift = (r, c) => r.map((q) => ({ ...q, u: q.u + c[0], v: q.v + c[1] }));
  /** A plate facing the viewer at ground point c: across it is world (1, -1), through it (1, 1). */
  const plate = (c, z0) => (t, s, d) => P(c[0] + (t + d) / Math.SQRT2, c[1] + (d - t) / Math.SQRT2, z0 + s);

  const g = mk("g", {}, svg);
  mk("path", { d: poly(shape.map((p) => P(p[0], p[1], 0))), class: "lo" }, g);
  mk("path", { d: poly(shape.map((p) => P(p[0], p[1], TH))), class: "sil" }, g);

  // The destination pin on the far end of the road.
  const pw = plate(D, TH), ps = pinShape();
  put(solid(g), { sil: poly(hull(ps.map((p) => pw(p[0], p[1], -PIN_T)).concat(ps.map((p) => pw(p[0], p[1], 0))))), crease: poly(ps.map((p) => pw(p[0], p[1], 0))) });
  mk("path", { d: poly(circ(5.5, 24).map((q) => pw(q.u, PIN_H - PIN_R + q.v, 0))), class: "nf" }, g);

  // The car's two places in the paint order, either side of the charger.
  const behind = mk("g", {}, g);
  const chg = mk("g", {}, g), bw = plate(CH, 0), bolt = fillet(BOLT.map(([t, u]) => [t * 1.4, u * 1.4]), BOLT.map(() => 0.8), 2);
  mk("path", { d: poly(bolt.map((p) => bw(p[0], p[1], -4))), class: "lo" }, chg);
  const boltFace = mk("path", { d: poly(bolt.map((p) => bw(p[0], p[1], 0))), class: "sil" }, chg);
  const ahead = mk("g", {}, g);

  // The car: a body, a narrower cabin with a sloped windscreen, its wheels.
  // On its roof, a battery bar as long as the charge.
  const car = mk("g", {}, ahead), farW = [solid(car), solid(car)], body = solid(car), nearW = [solid(car), solid(car)], cabin = solid(car);
  const bar = mk("path", { class: "nf" }, car);

  // The origin puck, nearest of all.
  put(solid(g), prism(P, front, shift(circ(PKR, 48), O), shift(circ(PKR - 2, 48), O), 0, PK));
  place(flatDot(g, C, 3, "dot m"), P(O[0], O[1], PK));

  const pos = spring(REST, { eps: 0.05 });
  /** The car's heading at s: the centre line's tangent. */
  const heading = (s) => { const a = along(Math.max(0, s - 2)), b = along(Math.min(LEN, s + 2)); return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  /** A ring laid out in the car's own frame (u forward, v across), turned to th and set down at c. */
  const turn = (r, c, th) => {
    const k = Math.cos(th), n = Math.sin(th);
    return r.map((q) => ({ ...q, u: c[0] + K * (q.u * k - q.v * n), v: c[1] + K * (q.u * n + q.v * k), nu: q.nu * k - q.nv * n, nv: q.nu * n + q.nv * k }));
  };
  const BODY = rings(-12, -6.5, 12, 6.5, 4, 1.4), CFOOT = rrect(-7.5, -5.5, 6.5, 5.5, 3, 4);
  const CTOP = rrect(-6.5, -4.5, 1, 4.5, 2, 4), CIN = rrect(-5.7, -3.7, 0.2, 3.7, 1.2, 4), WHEEL = circ(4, 20);
  const K = 1.3, Z0 = TH + 2.5 * K, Z1 = Z0 + 7 * K, Z2 = Z1 + 6.5 * K;

  let drawn = NaN, barDrawn = NaN, side = null, lit = null, over = false, charging = false, ctw = tween(FULL, CHARGE_MS);
  const charge = (s, now) => (atStop(s) ? tval(ctw, now) : s < HOLD ? pre(s) : after(s));
  function draw(now) {
    const s = pos.x, c = along(s), th = heading(s);
    // Arriving at the stop starts the charge: from what was left to full, over CHARGE_MS.
    const on = atStop(s);
    if (on && !charging) { ctw = tween(pre(STOP - ZONE), CHARGE_MS); tset(ctw, FULL, now, 0); }
    charging = on;
    const ch = charge(s, now);
    if (over) read.textContent = `${Math.round(ch * 100)}%`;
    if (s !== drawn) {
      drawn = s;
      put(body, prism(P, front, turn(BODY[0], c, th), turn(BODY[1], c, th), Z0, Z1));
      const foot = turn(CFOOT, c, th), top = turn(CTOP, c, th);
      put(cabin, { sil: poly(hull(ringAt(P, foot, Z1).concat(ringAt(P, top, Z2)))), crease: open(ringAt(P, run(turn(CIN, c, th), front), Z2)) });
      // the near side: the one whose outward normal points toward the viewer, at +x +y
      const hx = Math.cos(th), hy = Math.sin(th), sg = Math.cos(th) - Math.sin(th) > 0 ? 1 : -1, nx = -hy * sg, ny = hx * sg;
      [[nearW, 1], [farW, -1]].forEach(([ws, f]) => [-7.5, 7.5].forEach((u, k) => {
        const face = (d) => WHEEL.map((q) => P(c[0] + K * (hx * (u + q.u) + nx * d * f), c[1] + K * (hy * (u + q.u) + ny * d * f), TH + K * (4 + q.v)));
        put(ws[k], { sil: poly(hull(face(4.5).concat(face(7)))), crease: poly(face(f > 0 ? 7 : 4.5)) });
      }));
      const at = c[0] + c[1] < CH[0] + CH[1] ? behind : ahead;
      if (at !== side) { side = at; at.appendChild(car); }
      barDrawn = NaN;
    }
    if (ch !== barDrawn) {
      barDrawn = ch;
      bar.setAttribute("d", poly(ringAt(P, turn(rrect(-5.8, -3.2, -5.8 + 6.4 * Math.max(ch, 0.25), 3.2, 1.2, 3), c, th), Z2 + 0.05)));
    }
    if (on !== lit) {
      lit = on;
      boltFace.classList.toggle("hi", on);
      body.sil.classList.toggle("hi", !on); cabin.sil.classList.toggle("hi", !on);
    }
  }
  draw(performance.now());

  const B = register(stage, (dt, now) => { const m = stepS(pos, dt); draw(now); return m || !tdone(ctw, now); });
  bag.add(B.unregister);

  /** The pointer's place along the road; anywhere near the charger holds the car beside it. */
  function retarget(p) {
    const [s, d] = p ? nearest(unproj(C, p[0], p[1], 0)) : [0, Infinity];
    over = d < 50;
    pos.t = !over ? REST : Math.abs(s - HOLD) < ZONE ? HOLD : clamp(s, S0, S1);
    if (!over) read.textContent = "rest";
    B.wake();
  }

  bag.add(pointer(stage, { move: retarget, leave: () => retarget(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { rate = v / 1000; barDrawn = NaN; draw(performance.now()); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "multistop",
  means: "A car drives the road from start to pin, its battery draining, and charges again at the charger halfway.",
  rules: [1, 3, 5, 8],
  range: [5, 6.5, 8],
  tour: [[106, 238], [200, 188], [262, 118], null],
  mount,
});
