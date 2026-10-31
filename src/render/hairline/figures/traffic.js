/**
 * Traffic: a two-lane road in a jam, each lane a queue of cars stopped nose
 * to tail, the queues' heads nearest the viewer, the empty road running on
 * behind them. At rest the gaps are uneven, the way a jam stands, and the
 * lead car of the near lane carries the bright edge: the near lane is never
 * hidden behind the other, so the bright edge is always seen whole. When the
 * pointer comes over the road a car drives slowly in over the road's far end
 * in each lane, the far lane's a moment after, and brakes in behind its
 * queue; the near lane's newcomer takes the bright edge: the jam grows. Let go, the jam moves
 * up: in each lane every car rolls forward one place, the lead first, and the
 * lead drives off the road's near end. Cars are cut at the road's ends, so
 * only what is on the road is drawn, and not at all while that is a sliver.
 * The slider is the gap the newcomers stop at.
 *
 * The pattern: an arrival, then a move-up staggered from the front, in two
 * lanes at once. A car rolling up to a jam takes its time, so that tween runs
 * 2.4s, not the kernel's 700ms; the move-up is the kernel's. When it lands
 * each lane's cars are relabelled, the one gone off the end becoming the next
 * to arrive, so rest is the same. Cars are painted by depth, re-sorted when
 * they pass one another. The hit test is the road's rest box on its plane,
 * which never moves.
 */
const {
  Cam, clamp, facing, fit, hull, open, poly, proj, rings, prism, ringAt, rrect, run, unproj,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const L = 36, WD = 22, LG = 12, PAD = 4, PB = 4, Z0 = 3, ZB = 14, ZC = 26, WR = 6;
// the lanes, far then near: where each starts across the road, its queue, and how long its newcomer waits
const LANES = [{ y0: 0, queue: [26, 85], wait: 450 }, { y0: WD + LG, queue: [0, 50], wait: 0 }];
// the lit lane: the near one, which nothing stands in front of
const LIT = 1;
const RX0 = -110, RX1 = 85 + L + PAD, EDGE = RX0 + 3, HOME = EDGE - L - 1, ROLL = 2400, STEP = 90, SLIVER = 14;
const NEAR = RX1 - 3, GONE = NEAR + 4, YW = 2 * WD + LG;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let gap = value;
  const C = Cam(45, 0.5, 1.6);
  fit(C, [[RX0, -PAD, -PB], [RX1, YW + PAD, -PB], [RX1, -PAD, 0], [RX0, YW + PAD, -PB], [EDGE, 0, ZC], [85 + L, WD, ZC]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const [rr, ri] = rings(RX0, -PAD, RX1, YW + PAD, 8, 2);
  put(solid(g), prism(P, front, rr, ri, -PB, 0));
  // the line between the lanes, dashed
  mk("path", { class: "dash nf", d: open([P(RX0 + 6, WD + LG / 2, 0), P(RX1 - 6, WD + LG / 2, 0)]) }, g);
  const carsG = mk("g", {}, g);

  // One car at x in the lane starting at y0: a body, a cabin whose top is shorter than its foot (the windscreen
  // slopes to the front, +x), two wheels. Everything off the road, x < EDGE or x > NEAR, is cut off.
  const cut = (x0, x1) => [Math.max(x0, EDGE), Math.min(x1, NEAR)];
  const wheel = (cx, y0) => { const pts = []; for (let k = 0; k < 20; k++) { const t = (k / 20) * Math.PI * 2; pts.push(P(cx + WR * Math.cos(t), y0 + WD + 0.4, WR + WR * Math.sin(t))); } return poly(pts); };
  function carPaths(x, y0) {
    if (Math.min(x + L, NEAR) - Math.max(x, EDGE) < SLIVER) return null;
    const [b0, b1] = cut(x, x + L), [body, bodyIn] = rings(b0, y0, b1, y0 + WD, Math.min(7, (b1 - b0) / 2 - 0.1), 1.4);
    const out = { body: prism(P, front, body, bodyIn, Z0, ZB), cabin: null, wheels: [] };
    const [f0, f1] = cut(x + 7, x + L - 8), [t0, t1] = cut(x + 10, x + L - 17);
    if (t1 - t0 > 4) {
      const foot = rrect(f0, y0 + 2, f1, y0 + WD - 2, 4, 4), top = rrect(t0, y0 + 3.6, t1, y0 + WD - 3.6, 2, 4), topIn = rrect(t0 + 1.2, y0 + 4.8, t1 - 1.2, y0 + WD - 4.8, 1.2, 4);
      out.cabin = { sil: poly(hull(ringAt(P, foot, ZB).concat(ringAt(P, top, ZC)))), crease: open(ringAt(P, run(topIn, front), ZC)) };
    }
    for (const cx of [x + 8.5, x + L - 8.5]) if (cx - WR > EDGE && cx + WR < NEAR) out.wheels.push(wheel(cx, y0));
    return out;
  }

  // each lane back to front: cars[0] is the one that arrives, the last the lead
  const lanes = LANES.map((ln) => ({
    ...ln,
    moving: false,
    cars: [HOME, ...ln.queue].map((x) => {
      const grp = mk("g", {}, carsG);
      return { grp, y0: ln.y0, b: solid(grp), c: solid(grp), w: [0, 1].map(() => mk("path", { class: "sil" }, grp)), x: tween(x), drawn: NaN, at: x };
    }),
  }));
  function draw(car, x) {
    car.at = x;
    if (x === car.drawn) return;
    car.drawn = x;
    const p = carPaths(x, car.y0);
    put(car.b, p ? p.body : { sil: "", crease: "" });
    put(car.c, p && p.cabin ? p.cabin : { sil: "", crease: "" });
    car.w.forEach((el, k) => el.setAttribute("d", p ? p.wheels[k] ?? "" : ""));
  }

  /** Lights one car, lane li's car i, or none. */
  const paint = (li, i) => lanes.forEach((ln, l) => ln.cars.forEach((car, k) => { const on = l === li && k === i; car.b.sil.classList.toggle("hi", on); car.c.sil.classList.toggle("hi", on); }));
  const restLit = () => paint(LIT, lanes[LIT].cars.length - 1);

  /** A lane's move-up has landed: the car gone off the near end goes round to wait behind the far end. */
  function relabel(ln) {
    ln.moving = false;
    const gone = ln.cars[ln.cars.length - 1];
    gone.x = tween(HOME);
    ln.cars = [gone, ...ln.cars.slice(0, -1)];
  }

  // painted far to near: by each car's middle, x + y, re-sorted only when the order changes
  let order = "";
  function sortCars() {
    const all = lanes.flatMap((ln) => ln.cars), key = (c) => c.at + L / 2 + c.y0 + WD / 2;
    const sorted = [...all].sort((a, b) => key(a) - key(b)), sig = sorted.map((c) => all.indexOf(c)).join();
    if (sig === order) return;
    order = sig;
    sorted.forEach((c) => carsG.appendChild(c.grp));
  }

  const B = register(stage, (_dt, now) => {
    let busy = false;
    for (const ln of lanes) {
      let laneBusy = false;
      for (const car of ln.cars) { draw(car, tval(car.x, now)); if (!tdone(car.x, now)) laneBusy = true; }
      if (ln.moving && !laneBusy) { relabel(ln); if (!lanes.some((o) => o.moving)) restLit(); }
      busy = busy || laneBusy;
    }
    sortCars();
    return busy;
  });
  bag.add(B.unregister);

  let act = null;
  function setActive(a) {
    if (a === act) return;
    act = a;
    lanes.forEach((ln) => { if (ln.moving) relabel(ln); });
    const now = performance.now();
    if (a) {
      // arriving: a newcomer rolls slowly in over the far end in each lane, the far lane's a moment later
      lanes.forEach((ln) => { const car = ln.cars[0]; car.x = tween(tval(car.x, now), ROLL); tset(car.x, ln.queue[0] - L - gap, now, ln.wait); });
      paint(LIT, 0);
    } else {
      // let go: in each lane that has a newcomer on the road, everyone moves up a place, the lead first,
      // and the lead drives off the near end
      let any = false;
      lanes.forEach((ln) => {
        if (tval(ln.cars[0].x, now) <= HOME + 1) { ln.cars[0].x = tween(HOME); return; }
        ln.moving = any = true;
        const n = ln.cars.length, to = [...ln.queue, GONE];
        ln.cars.forEach((car, i) => { car.x = tween(tval(car.x, now)); tset(car.x, to[i], now, (n - 1 - i) * STEP); });
      });
      if (any) paint(LIT, lanes[LIT].cars.length - 2); else restLit();
    }
    read.textContent = a ? "jam" : "rest";
    B.wake();
  }
  restLit();
  setActive(false);

  /** On the road's plane: anywhere along it, end to head. */
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], ZB);
    return y > -PAD - 14 && y < YW + PAD + 14 && x > RX0 - 6 && x < RX1 + 6;
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(false) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { gap = clamp(v, 1.5, 12); if (act) { act = null; setActive(true); } }, destroy: bag.dispose };
}

hairline({
  name: "traffic",
  means: "Two lanes in a jam: a car rolls in behind each queue, then both move up and their leads drive off.",
  rules: [1, 2, 4, 5],
  range: [2, 5, 10],
  tour: [[150, 150], [250, 195], null],
  mount,
});
