/**
 * Sharing: a shared parking bay, two marked spots nose to tail, holding a small
 * city car at the back (a body, a narrower cabin with a sloping windscreen,
 * wheels) and a bike in front of it (two big wheels, a diamond frame, a saddle
 * and bars). The vehicle under
 * the pointer lifts out of its spot and takes the bright edge; the other makes
 * room, after the stagger. At rest the car carries the bright edge.
 * The slider is the stagger, in ms.
 *
 * The pattern: one of many, in a single row: the hit test takes the vehicle
 * whose rest centre is nearest the pointer's screen x, which never moves.
 */
const {
  Cam, fit, poly, proj, rings, rrect, prism, facing, hull, ringAt, run, open, seg, unproj,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const L = 160, Y0 = -3, Y1 = 39, YC = 18, PB = 4, LIFT = 22, PART = 10, MID = 88, BX = 88;

/** A disc standing upright in the x–z plane at depth y: a wheel. */
const disc = (cx, y, cz, r, n = 28) => {
  const out = [];
  for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; out.push([cx + r * Math.cos(a), y, cz + r * Math.sin(a)]); }
  return out;
};
/** A rounded plate standing in the y–z plane at x: a handlebar seen end on. */
const plate = (x, y0, z0, y1, z1, r) => rrect(y0, z0, y1, z1, r, 4).map((q) => [x, q.u, q.v]);

/** Each vehicle is a list of parts, back to front; every `sil` stroke takes the bright edge. The car stands at the back of the bay, the bike in front of it, nearer the viewer, so it is appended after. */
function vehicles() {
  // a city car: a body, a cabin whose top is shorter than its foot (the windscreen slopes to the front, +x), wheels on the near side
  const [cb, ci] = rings(0, 0, 82, 36, 11, 1.6), W = 10, wy = 36.4;
  const car = [
    { solid: [cb, ci, 5, 22] },
    { cabin: [rrect(10, 3, 66, 33, 7, 4), rrect(14, 6, 48, 30, 5, 4), rrect(15.4, 7.4, 46.6, 28.6, 3.6, 4), 22, 42] },
    { pts: disc(20, wy, W, W), cls: "sil" }, { pts: disc(20, wy + 0.2, W, 4), cls: "nf lo" },
    { pts: disc(64, wy, W, W), cls: "sil" }, { pts: disc(64, wy + 0.2, W, 4), cls: "nf lo" },
  ];
  const X = BX, y = YC, R = 15, rh = [X + 18, y, R], fh = [X + 56, y, R], bb = [X + 35, y, 13], st = [X + 29, y, 40], hd = [X + 51, y, 38];
  const bike = [
    { pts: disc(X + 18, y, R, R), cls: "nf sil" }, { pts: disc(X + 18, y, R, R - 3), cls: "nf lo" },
    { lines: [[rh, bb], [rh, st], [bb, st], [st, hd], [bb, hd], [hd, fh], [[X + 22, y, 44], [X + 34, y, 44]], [st, [X + 28, y, 44]], [hd, [X + 50, y, 45]]], cls: "nf sil" },
    { pts: plate(X + 50, y - 10, 44, y + 10, 47.4, 1.6), cls: "sil" },
    { pts: disc(X + 56, y, R, R), cls: "nf sil" }, { pts: disc(X + 56, y, R, R - 3), cls: "nf lo" },
  ];
  return [
    { name: "car", parts: car, c: [41, y, 24] },
    { name: "bike", parts: bike, c: [X + 37, y, 24] },
  ];
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;
  const C = Cam(45, 0.5, 1.9);
  fit(C, [[-6 - PART, Y0, -PB], [L + PART, Y1, -PB], [L, Y0, -PB], [-6, Y1, -PB], [BX + 29, YC, 47.4 + LIFT], [14, 6, 42 + LIFT], [-PART, 36, 22]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  // the bay: one low pad, its two spots marked out on it
  const [pr, pi] = rings(-6, Y0, L, Y1, 7, 1.8);
  put(solid(g), prism(P, front, pr, pi, -PB, 0));
  mk("path", { d: [seg(P(MID, Y0 + 4, 0), P(MID, Y1 - 4, 0)), seg(P(2, Y1 - 5, 0), P(L - 8, Y1 - 5, 0))].join(""), class: "nf lo" }, g);

  const vs = vehicles().map((v) => {
    const grp = mk("g", {}, g), hi = [];
    v.els = v.parts.map((pt) => {
      if (pt.solid || pt.cabin) { const s = solid(grp); hi.push(s.sil); return s; }
      const el = mk("path", { class: pt.cls }, grp);
      if (pt.cls.includes("sil")) hi.push(el);
      return el;
    });
    return { ...v, hi, dx: tween(0), dz: tween(0), drawn: "" };
  });

  /** Draws a vehicle shifted along the bay by dx and lifted by dz. */
  function draw(v, dx, dz) {
    const key = dx + "," + dz;
    if (key === v.drawn) return;
    v.drawn = key;
    const Q = (x, y, z) => P(x + dx, y, z + dz), W = (p) => Q(p[0], p[1], p[2]);
    v.parts.forEach((pt, k) => {
      const el = v.els[k];
      if (pt.solid) put(el, prism(Q, front, ...pt.solid));
      else if (pt.cabin) {
        const [foot, top, inner, z0, z1] = pt.cabin;
        put(el, { sil: poly(hull(ringAt(Q, foot, z0).concat(ringAt(Q, top, z1)))), crease: open(ringAt(Q, run(inner, front), z1)) });
      } else if (pt.lines) el.setAttribute("d", pt.lines.map(([a, b]) => seg(W(a), W(b))).join(""));
      else el.setAttribute("d", poly(pt.pts.map(W)));
    });
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const v of vs) { draw(v, tval(v.dx, now), tval(v.dz, now)); if (!tdone(v.dx, now) || !tdone(v.dz, now)) moving = true; }
    return moving;
  });
  bag.add(B.unregister);

  let act = -1;
  const paint = (a) => vs.forEach((v, i) => v.hi.forEach((el) => el.classList.toggle("hi", i === (a < 0 ? 0 : a))));
  paint(-1);
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    vs.forEach((v, i) => {
      const delay = Math.abs(i - from) * stag;
      tset(v.dz, i === a ? LIFT : 0, now, delay);
      tset(v.dx, a < 0 || i === a ? 0 : Math.sign(i - a) * PART, now, delay);
    });
    paint(a);
    read.textContent = a < 0 ? "rest" : vs[a].name;
    B.wake();
  }

  /** Over the bay (or above it), the vehicle whose rest centre is nearest the pointer's screen x. */
  const cx = vs.map((v) => P(...v.c)[0]);
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], 0);
    if (x < -40 || y < -70 || x > L + 30 || y > Y1 + 14) return -1;
    return Math.abs(p[0] - cx[0]) < Math.abs(p[0] - cx[1]) ? 0 : 1;
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { stag = v; }, destroy: bag.dispose };
}

hairline({
  name: "sharing",
  means: "A small car and a bike parked nose to tail in a shared bay: the one under the pointer lifts out, the other makes room.",
  rules: [1, 2, 4, 5],
  range: [0, 60, 140],
  tour: [[152, 109], [265, 169], [105, 150], null],
  mount,
});
