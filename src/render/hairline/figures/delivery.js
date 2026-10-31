/**
 * Dispatch: a delivery van being loaded at the kerb, its back doors swung
 * open, and behind it on the ground three parcels queued for the doorway, each
 * a cardboard box with a strip of tape over its lid and down its end, and a
 * dot code beside the tape, the stop it goes to. At rest the boxes wait in
 * stop order, one dot by the doors, and that box, the next one in, carries the
 * bright edge. The pointer over a box changes the order: that stop becomes the
 * next, so its box steps out of the queue to the side, walks up beside the
 * others to the doors and steps back in there, taking the bright edge, while the boxes it passed slide back
 * along the queue. Let go, the queue goes back to stop order the same way.
 * The slider is the time a move takes, in seconds.
 *
 * The pattern: one of many, the chosen item moved to the front of the row. A
 * timed move each, out, along and back in, the boxes it passes sliding after it.
 * The hit test is the boxes' rest lids, which never move.
 */
const {
  Cam, clamp, facing, fit, hull, open, poly, prism, proj, ringAt, rings, rrect, run, unproj,
  reducedMotion, disposer, flatDot, mk, place, pointer, put, register, solid,
} = HL;

// the van along x, its back doors at +x, VW its half width; the yard it stands on
const VW = 12, Z0 = 3, TOP = 30, REAR = 34, WR = 5, WX = [-15, 24], DOOR = 11, SWING = 0.35;
const YARD = [-34, -24, 116, 30], TT = 3;
// the boxes: L along the queue, WD across, CH tall, at their rest slots from the doors outward; stop i + 1 in slot i
const L = 16, WD = 14, CH = 12, SLOT = [54, 73, 93], N = SLOT.length, SIDE = WD + 4;
const ease = (t) => t * t * (3 - 2 * t);
/** A ring turned by a and set down at (x, y), normals with it. */
const place2 = (ring, x, y, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return ring.map((q) => ({ ...q, u: x + q.u * c - q.v * s, v: y + q.u * s + q.v * c, nu: q.nu * c - q.nv * s, nv: q.nu * s + q.nv * c }));
};

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let period = value, dur = Math.min(1000, value * 650);
  const C = Cam(45, 0.5, 2);
  const [X0, Y0, X1, Y1] = YARD;
  fit(C, [[X0, Y0, -TT], [X1, Y1, -TT], [X1, Y0, -TT], [X0, Y1, -TT], [-14, -VW, TOP], [SLOT[1], SIDE + WD / 2, CH]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, ...rings(X0, Y0, X1, Y1, 8, 1.8), -TT, 0));

  // the far wheels, then the cab: a bonnet, and a glasshouse on it narrowing to the roof
  const wheel = (parent, y) => WX.forEach((wx) => {
    const d = (r) => poly(Array.from({ length: 22 }, (_, k) => { const a = (2 * Math.PI * k) / 22; return P(wx + r * Math.cos(a), y, WR + r * Math.sin(a)); }));
    mk("path", { class: "sil", d: d(WR) }, parent);
    mk("path", { class: "nf lo", d: d(1.7) }, parent);
  });
  wheel(g, -VW - 0.4);
  // the van, one body: up from the bumper to the bonnet's line, the windscreen sloping back to the roof, and the
  // roof running on over the cargo box to the back; the cab's door a dim seam on the side we see, a window in it
  const van = [[rrect(-25, -VW, REAR, VW, 4, 6), Z0], [rrect(-24, -VW, REAR, VW, 4, 6), 14], [rrect(-12, -VW, REAR, VW, 3, 6), TOP]];
  const roofIn = rrect(-10.8, -VW + 1.4, REAR - 1.4, VW - 1.4, 2, 6);
  put(solid(g), { sil: poly(hull(van.flatMap(([r, z]) => ringAt(P, r, z)))), crease: open(ringAt(P, run(roofIn, front), TOP)) });
  mk("path", { class: "nf lo", d: open([P(-20.5, VW, 14), P(-6, VW, 14)]) + open([P(-6, VW, Z0 + 2), P(-6, VW, TOP - 1.2)]) }, g);
  mk("path", { class: "nf", d: poly(rrect(-VW + 2.4, Z0 + 3, VW - 2.4, TOP - 3, 1.5, 4).map((q) => P(REAR, q.u, q.v))) }, g);
  mk("path", { class: "nf lo", d: poly([[-19.5, 16.5], [-8, 16.5], [-8, 26.5], [-12.8, 26.5]].map(([x, z]) => P(x, VW, z))) }, g);
  wheel(g, VW + 0.4);
  // the back doors, swung open from the corners: the far one now, the near one with the boxes
  const door = (parent, side) => put(solid(parent), prism(P, front, ...[0, 1].map((k) => place2(rrect(k * 0.4, -0.7 + k * 0.4, DOOR - k * 0.4, 0.7 - k * 0.4, 0.6, 3), REAR, side * (VW - 0.7), side * SWING)), Z0 + 1, TOP - 1));
  door(g, -1);

  // the boxes: a cardboard box each, tape over the lid and down its end, the dot code beside the tape
  const [br, bi] = rings(-L / 2, -WD / 2, L / 2, WD / 2, 1.2, 0.9), load = mk("g", {}, g);
  const near = { grp: mk("g", {}, load), x: REAR + DOOR / 2, y: 0, depth: REAR + DOOR / 2 + VW + 2 };
  door(near.grp, 1);
  const boxes = SLOT.map((x, i) => {
    const grp = mk("g", {}, load), el = solid(grp), tape = mk("path", { class: "nf lo" }, grp), k = i + 1;
    const dots = Array.from({ length: k }, () => flatDot(grp, C, 1.05, "dot m"));
    return { i, grp, el, tape, dots, k, x, y: 0, x0: x, x1: x, y0: 0, t0: -1e9, out: false, drawn: "" };
  });

  function draw(b) {
    const key = b.x + "," + b.y;
    if (key === b.drawn) return;
    b.drawn = key;
    const z0 = 0, z1 = CH, X = b.x, Y = b.y, sh = (r) => r.map((q) => ({ ...q, u: q.u + X, v: q.v + Y }));
    put(b.el, prism(P, front, sh(br), sh(bi), z0, z1));
    // the tape, two lines over the lid and down the end; the dot code beside it
    const tape = (v) => open([P(X - L / 2 + 1.2, Y + v, z1), P(X + L / 2 - 0.4, Y + v, z1), P(X + L / 2, Y + v, z1 - 0.6), P(X + L / 2, Y + v, z1 - 6)]);
    b.tape.setAttribute("d", tape(-1.6) + tape(1.6));
    b.dots.forEach((d, j) => place(d, P(X + (j - (b.k - 1) / 2) * 3.2, Y + WD / 4 + 0.8, z1)));
  }
  /** Where a box is at now: one that passes others steps out to the side, along and back in; the rest slide, later. */
  function step(b, now) {
    const u = clamp((now - b.t0) / dur, 0, 1);
    if (b.out) {
      b.y = u < 0.3 ? b.y0 + (SIDE - b.y0) * ease(u / 0.3) : u < 0.7 ? SIDE : SIDE * (1 - ease((u - 0.7) / 0.3));
      b.x = b.x0 + (b.x1 - b.x0) * ease(clamp((u - 0.25) / 0.5, 0, 1));
    } else {
      const v = clamp((now - b.t0 - dur * 0.3) / (dur * 0.6), 0, 1);
      b.x = b.x0 + (b.x1 - b.x0) * ease(v);
      b.y = b.y0 * (1 - ease(v));
    }
    return u < 1;
  }
  let order = "";
  function paintOrder() {
    // farther first: along the queue, and out towards the viewer; the near door by where it stands
    const all = [...boxes.map((b) => ({ ...b, depth: b.x + b.y })), near];
    const key = all.sort((a, b) => a.depth - b.depth).map((o) => o.i ?? "d").join();
    if (key === order) return;
    order = key;
    key.split(",").forEach((i) => load.appendChild(i === "d" ? near.grp : boxes[i].grp));
  }

  let on = false, seq = [0, 1, 2], wait = 0;
  const B = register(stage, (dt, now) => {
    let moving = false;
    if (on && !reducedMotion()) { wait -= dt; if (wait <= 0) reorder(); moving = true; }
    for (const b of boxes) { if (step(b, now)) moving = true; draw(b); }
    paintOrder();
    return moving;
  });
  bag.add(B.unregister);

  /** Moves the boxes to seq, the next stop first: one that passes others steps round them, the rest slide. */
  function setSeq(seq) {
    const now = performance.now();
    seq.forEach((i, s) => {
      const b = boxes[i], to = SLOT[s], from = SLOT.indexOf(b.x1);
      if (s === from) return;
      Object.assign(b, { x0: b.x, x1: to, y0: b.y, t0: now, out: Math.abs(s - from) > 1 });
      if (reducedMotion()) Object.assign(b, { x: to, y: 0, t0: -1e9 });
    });
    boxes.forEach((b) => {
      b.el.sil.classList.toggle("hi", b.i === seq[0]);
      b.dots.forEach((d) => d.setAttribute("class", b.i === seq[0] ? "dot" : "dot m"));
    });
    read.textContent = on ? seq.map((i) => i + 1).join("·") : "rest";
    B.wake();
  }
  // under the pointer the order is live: every period the last stop is moved up to next, round and round
  const reorder = () => { seq = [seq[N - 1], ...seq.slice(0, N - 1)]; wait = period; setSeq(seq); };
  setSeq(seq);
  function setOn(o) {
    if (o === on) return;
    on = o;
    if (on) reorder(); else { seq = [0, 1, 2]; setSeq(seq); }
  }

  /** On the yard's plane: anywhere on it. */
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], 0);
    return x > X0 - 6 && x < X1 + 6 && y > Y0 - 10 && y < Y1 + 6;
  }

  bag.add(pointer(stage, { move: (p) => setOn(hit(p)), leave: () => setOn(false) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { period = clamp(v, 1.2, 3); dur = Math.min(1000, period * 650); }, destroy: bag.dispose };
}

hairline({
  name: "delivery",
  means: "Parcels queued at a van's doors in stop order: under the pointer the order goes live, the last stop stepping round to the doors.",
  rules: [1, 2, 4, 10],
  range: [2.6, 1.9, 1.4],
  tour: [[220, 190], [250, 205], [280, 220], null],
  mount,
});
