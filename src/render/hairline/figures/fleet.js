/**
 * Fleet: one delivery van (a long cargo box, a lower cab with a sloping
 * windscreen, big wheels) parked in the middle of its geofence, a ring on the
 * ground. Between them lie three sonar rings: its live location. While the
 * pointer is on the stage the van is online: the rings pulse outward from
 * under it to the fence, staggered so one is always travelling, the newest
 * bright, then mid, then dim as it grows. The van turns on a spring to face
 * the pointer. When the pointer leaves, the pulse runs on to its rest phase
 * and stops, so the still frame still shows three rings. The slider is the
 * pulse's period, in seconds.
 *
 * The pattern: ambient motion that runs only under the pointer, through
 * register, plus a continuous heading on a spring. The hit test is the
 * ground plane, which never moves.
 */
const {
  Cam, circ, clamp, facing, fit, hull, open, poly, proj, prism, rings, ringAt, rrect, run, unproj,
  reducedMotion, spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const FR = 46, R0 = 18, B0 = -32, B1 = 6, NOSE = 24, VW = 11, TOP = 26, CAB = 16, Z0 = 3, WR = 4.2, WX = [-22, 15];
const RINGS = 3, REST = 0.2, YAW0 = 0;
const E = 1 / Math.SQRT2;

/** A ring of samples turned by a about the van's centre, normals with it. */
const turn = (ring, c, s) => ring.map((q) => ({ u: q.u * c - q.v * s, v: q.u * s + q.v * c, nu: q.nu * c - q.nv * s, nv: q.nu * s + q.nv * c }));
/** A wheel: a disc standing upright on the van's side y, in the van's own frame. */
const disc = (cx, y, cz, r, n = 22) => {
  const out = [];
  for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; out.push([cx + r * Math.cos(a), y, cz + r * Math.sin(a)]); }
  return out;
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let period = value, on = false, ph = REST / RINGS;
  const C = Cam(45, 0.5, 2.92);
  const RT = Math.hypot(B0, VW);
  fit(C, [[FR * E, -FR * E, 0], [-FR * E, FR * E, 0], [FR * E, FR * E, 0], [-RT * E, -RT * E, TOP]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  mk("path", { d: poly(ringAt(P, circ(FR, 72), 0)), class: "nf sil" }, g);
  const pings = [];
  for (let i = 0; i < RINGS; i++) pings.push({ el: mk("path", { class: "nf" }, g), drawn: "" });

  // the van, back to front: far wheels, then body and cab in the order the heading asks, then near wheels
  const farW = mk("g", {}, g), van = mk("g", {}, g), nearW = mk("g", {}, g);
  const body = solid(van), cab = solid(van);
  const wheels = [-1, 1].map(() => WX.map(() => [mk("path", { class: "sil" }), mk("path", { class: "nf lo" })]));

  const [br, bi] = rings(B0, -VW, B1, VW, 4, 1.4);
  const cabFoot = rrect(B1, -VW, NOSE, VW, 4, 4), cabTop = rrect(B1, -VW + 1, B1 + 6, VW - 1, 2.5, 4), cabIn = rrect(B1 + 1.4, -VW + 2.4, B1 + 4.6, VW - 2.4, 1.2, 4);
  const yaw = spring(YAW0, { eps: 0.002 });
  let drawn = NaN, side = 0, cabFirst = null;

  function drawVan(a) {
    if (a === drawn) return;
    drawn = a;
    const c = Math.cos(a), s = Math.sin(a);
    const W = (x, y, z) => P(x * c - y * s, x * s + y * c, z);
    put(body, prism(P, front, turn(br, c, s), turn(bi, c, s), Z0, TOP));
    const foot = turn(cabFoot, c, s), top = turn(cabTop, c, s), inn = turn(cabIn, c, s);
    put(cab, { sil: poly(hull(ringAt(P, foot, Z0).concat(ringAt(P, top, CAB)))), crease: open(ringAt(P, run(inn, front), CAB)) });
    // the cab is painted after the body only while it faces the viewer
    const cf = !front({ nu: c, nv: s });
    if (cf !== cabFirst) { cabFirst = cf; if (cf) van.prepend(cab.g); else van.append(cab.g); }
    // the side whose wheels face the viewer goes in front of the body
    const near = front({ nu: -s, nv: c }) ? 1 : -1;
    if (near !== side) {
      side = near;
      wheels.forEach((set, k) => set.forEach((w) => ((k === 1) === (near === 1) ? nearW : farW).append(...w)));
    }
    wheels.forEach((set, k) => WX.forEach((wx, j) => {
      const y = (k === 1 ? 1 : -1) * (VW - 0.4);
      set[j][0].setAttribute("d", poly(disc(wx, y, WR, WR).map((p) => W(...p))));
      set[j][1].setAttribute("d", poly(disc(wx, y + Math.sign(y) * 0.2, WR, 1.6).map((p) => W(...p))));
    }));
  }

  /** Ring i at phase f: from under the van out to the fence, bright, then mid, then dim. */
  function drawPings() {
    pings.forEach((p, i) => {
      const k = (ph + i / RINGS) % 1, r = R0 + (FR - 2 - R0) * k, key = r.toFixed(2);
      if (key === p.drawn) return;
      p.drawn = key;
      p.el.setAttribute("d", poly(ringAt(P, circ(r, 56), 0)));
      p.el.setAttribute("class", k < 1 / RINGS ? "nf hi" : k < 2 / RINGS ? "nf" : "nf lo");
    });
  }

  const B = register(stage, (dt) => {
    let m = stepS(yaw, dt);
    if (on && !reducedMotion()) { ph = (ph + dt / period) % 1; m = true; }
    else {
      // run on to the rest phase, then hold: the still frame keeps three rings
      const goal = REST / RINGS, left = (goal - (ph % (1 / RINGS)) + 1 / RINGS) % (1 / RINGS);
      if (left > 1e-4) { const step = Math.min(left, dt / period); ph = (ph + step) % 1; m = left - step > 1e-4; if (!m) ph = goal; }
    }
    drawPings();
    drawVan(yaw.x);
    return m;
  });
  bag.add(B.unregister);

  bag.add(pointer(stage, {
    move: (p) => {
      const [x, y] = unproj(C, p[0], p[1], 0);
      if (Math.hypot(x, y) > 6) yaw.t = yaw.x + wrap(Math.atan2(y, x) - yaw.x);
      on = true; read.textContent = "live"; B.wake();
    },
    leave: () => { on = false; yaw.t = yaw.x + wrap(YAW0 - yaw.x); read.textContent = "rest"; B.wake(); },
  }));
  read.textContent = "rest";
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { period = clamp(v, 0.5, 6); }, destroy: bag.dispose };
}

hairline({
  name: "fleet",
  means: "A van online in its geofence: sonar rings pulse out to the fence, and the van turns to face the pointer.",
  rules: [1, 4, 5, 7],
  range: [3.6, 2.4, 1.4],
  tour: [[310, 210], [130, 130], [120, 230], null],
  mount,
});
