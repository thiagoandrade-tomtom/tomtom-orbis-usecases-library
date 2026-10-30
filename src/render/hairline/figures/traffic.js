/**
 * Traffic: a lane of three cars queued nose to tail on a short strip of
 * road, the queue's head nearest the viewer. At rest the gaps are uneven, the way a jam
 * stands, and the lead car carries the bright edge. The car under the pointer
 * lifts out of the queue; the cars behind it close up bumper to bumper and the
 * ones ahead pull away, staggered outwards from it. The slider is the stagger,
 * in ms.
 *
 * The pattern: one of many. Tweens, a stagger by distance, and a hit test on
 * the cars' rest centres along the lane, which never move.
 */
const {
  Cam, fit, hull, open, poly, proj, rings, prism, facing, ringAt, rrect, run, unproj,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const N = 3, L = 36, WD = 22, LIFT = 15, CLOSE = 1.5, OPEN = 12, PB = 4, PAD = 4;
const GAPS = [10, 3];
const Z0 = 3, ZB = 14, ZC = 26, WR = 6;

/** The cars' x positions with car a held still: closed up behind it, pulled away ahead. a < 0 is the rest queue. */
function layout(a) {
  const gap = (j) => (a < 0 ? GAPS[j] : j < a ? CLOSE : OPEN);
  const xs = [0];
  for (let j = 0; j < N - 1; j++) xs.push(xs[j] + L + gap(j));
  if (a < 0) return xs;
  const rest = layout(-1), d = rest[a] - xs[a];
  return xs.map((x) => x + d);
}

const shift = (ring, dx) => ring.map((q) => ({ ...q, u: q.u + dx }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const poses = [-1, 0, 1, 2].map(layout);
  const XMIN = Math.min(...poses.map((p) => p[0])), XMAX = Math.max(...poses.map((p) => p[N - 1] + L));
  const R0 = layout(-1), RX0 = Math.min(R0[0] - PAD, XMIN - 4), RX1 = Math.max(R0[N - 1] + L + PAD, XMAX + 5);

  const C = Cam(45, 0.5, 2.25);
  fit(C, [[RX0, -PAD, -PB], [RX1, WD + PAD, -PB], [RX1, -PAD, 0], [RX0, WD + PAD, -PB], [XMIN, 0, ZC + LIFT], [XMAX, 0, ZC + LIFT]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const [rr, ri] = rings(RX0, -PAD, RX1, WD + PAD, 8, 2);
  put(solid(g), prism(P, front, rr, ri, -PB, 0));

  // One car at x = 0: a body, a cabin whose top is shorter than its foot (the windscreen slopes to the front, +x), two wheels.
  const [body, bodyIn] = rings(0, 0, L, WD, 7, 1.4);
  const foot = rrect(7, 2, L - 8, WD - 2, 4, 4), top = rrect(10, 3.6, L - 17, WD - 3.6, 3, 4);
  const topIn = rrect(11.2, 4.8, L - 18.2, WD - 4.8, 1.8, 4);
  const wheel = (cx, dx, z, r) => {
    const pts = [];
    for (let k = 0; k < 20; k++) { const t = (k / 20) * Math.PI * 2; pts.push(P(cx + dx + r * Math.cos(t), WD + 0.4, WR + z + r * Math.sin(t))); }
    return poly(pts);
  };

  const cars = R0.map((x, i) => {
    const grp = mk("g", {}, g);
    const b = solid(grp), c = solid(grp);
    const w = [8.5, L - 8.5].map(() => mk("path", { class: "sil" }, grp));
    return { i, b, c, w, x: tween(x), z: tween(0), drawn: "" };
  });

  function draw(car, x, z) {
    const key = x + "," + z;
    if (key === car.drawn) return;
    car.drawn = key;
    put(car.b, prism(P, front, shift(body, x), shift(bodyIn, x), Z0 + z, ZB + z));
    put(car.c, {
      sil: poly(hull(ringAt(P, shift(foot, x), ZB + z).concat(ringAt(P, shift(top, x), ZC + z)))),
      crease: open(ringAt(P, run(shift(topIn, x), front), ZC + z)),
    });
    [8.5, L - 8.5].forEach((cx, k) => car.w[k].setAttribute("d", wheel(cx, x, z, WR)));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const car of cars) { draw(car, tval(car.x, now), tval(car.z, now)); if (!tdone(car.x, now) || !tdone(car.z, now)) moving = true; }
    return moving;
  });
  bag.add(B.unregister);

  let act = -1;
  const paint = (a) => cars.forEach((car, i) => {
    const on = i === (a < 0 ? N - 1 : a);
    car.b.sil.classList.toggle("hi", on); car.c.sil.classList.toggle("hi", on);
  });
  paint(-1);

  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act, xs = layout(a);
    act = a;
    cars.forEach((car, i) => {
      const delay = Math.abs(i - from) * stag;
      tset(car.x, xs[i], now, delay); tset(car.z, i === a ? LIFT : 0, now, delay);
    });
    paint(a);
    read.textContent = a < 0 ? "rest" : `car ${N - a}`;
    B.wake();
  }

  /** On the plane of the bodies' rest tops: inside the lane, the car whose rest centre is nearest. */
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], ZB);
    if (y < -PAD - 6 || y > WD + PAD + 6 || x < R0[0] - 6 || x > R0[N - 1] + L + 6) return -1;
    let best = 0;
    R0.forEach((x0, i) => { if (Math.abs(x0 + L / 2 - x) < Math.abs(R0[best] + L / 2 - x)) best = i; });
    return best;
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { stag = v; }, destroy: bag.dispose };
}

hairline({
  name: "traffic",
  means: "A queue of cars nose to tail: the one under the pointer lifts out, the cars behind close up and the ones ahead pull away.",
  rules: [1, 2, 5, 9],
  range: [0, 50, 110],
  tour: [[258, 201], [123, 133], [196, 170], null],
  mount,
});
