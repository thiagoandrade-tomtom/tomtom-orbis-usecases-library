/**
 * Route: two roads from an origin to a destination, no tile under them. The
 * origin is a round puck with a dot on it, the start; the destination is a
 * map pin standing on the far end, a thick round-headed plate with a hole in
 * its head, its point in the ground. The main road takes two turns on the
 * left; the alternative swings wide round the right. The road the pointer is
 * on lifts and takes the bright edge; the other settles flat on the dim
 * stroke, and the pin hops up a little. The puck and pin keep the silhouette
 * weight always, so the ends outweigh every road but the chosen one. At rest
 * the main road sits a little raised and bright. The slider is the lift.
 *
 * The pattern: one of many. Tweens for which road, and a hit test on the
 * ground plane (which never moves): the side of the line from origin to
 * destination the pointer is on.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, poly, proj, prism, unproj,
  tdone, tset, tval, tween, disposer, flatDot, mk, place, pointer, put, register, solid,
} = HL;

const O = [50, 50], D = [-50, -50], HW = 5.5, TH = 3, PK = 9, PKR = 18, PIN_UP = 7;
const ROADS = [
  [O, [-8, 50], [-8, 14], [-50, 14], D],
  [O, [58, -50], D],
];
const PIN_R = 19, PIN_H = 52, PIN_T = 6;

/** A road's outline: the polyline widened by HW on each side, mitred at the turns, every corner rounded. */
function outline(raw) {
  const trim = (a, b, d) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l]; };
  const n = raw.length, nor = [], pts = raw.slice();
  pts[0] = trim(raw[0], raw[1], PKR + 4); pts[n - 1] = trim(raw[n - 1], raw[n - 2], 3);
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy);
    nor.push([-dy / l, dx / l]);
  }
  const side = (s) => pts.map((p, k) => {
    const a = nor[Math.max(0, k - 1)], b = nor[Math.min(n - 2, k)];
    const m = [a[0] + b[0], a[1] + b[1]], q = 1 + a[0] * b[0] + a[1] * b[1];
    return [p[0] + (s * HW * m[0]) / q, p[1] + (s * HW * m[1]) / q];
  });
  const shape = side(1).concat(side(-1).reverse());
  return fillet(shape, shape.map(() => 6));
}

/** The pin's outline in its own upright plane: a round head tangent down to a point, (t across, s up). */
function pinShape() {
  const cy = PIN_H - PIN_R, a0 = Math.acos(PIN_R / cy), pts = [];
  for (let k = 0; k <= 28; k++) {
    const a = a0 + (k / 28) * (2 * Math.PI - 2 * a0);
    pts.push([PIN_R * Math.sin(a), cy - PIN_R * Math.cos(a)]);
  }
  pts.push([0, 0]);
  return fillet(pts, pts.map((_, k) => (k === pts.length - 1 ? 2.5 : 0.4)), 3);
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let lift = value;
  const C = Cam(45, 0.5, 1.9);
  const shapes = ROADS.map(outline);
  const ext = shapes.flat().map((p) => [p[0], p[1], 0]);
  fit(C, [...ext, [O[0] + PKR, O[1] + PKR, 0], [D[0], D[1], PIN_H + PIN_UP], [-50, 14, 14 + TH]], 200, 166);
  const P = proj(C), front = facing(C);

  // The pin's plate faces the viewer: across it is world (1, -1), through it (1, 1).
  const pw = (t, s, d, z) => P(D[0] + (t + d) / Math.SQRT2, D[1] + (d - t) / Math.SQRT2, s + z);
  const ps = pinShape();

  const g = mk("g", {}, svg);
  const low = mk("g", {}, g), pin = mk("g", {}, g), puck = mk("g", {}, g), high = mk("g", {}, g);

  // The destination: a pin, a silhouette of both faces, the front face as its crease, a hole in its head.
  // It hops up a little while a route is chosen.
  // Its silhouette is stroked again over the crease, so the pin keeps the full silhouette weight all round.
  const pinS = solid(pin), pinEdge = mk("path", { class: "nf sil" }, pin), hole = mk("path", { class: "nf sil" }, pin), pinZ = tween(0);
  let pinDrawn = NaN;
  function drawPin(z) {
    if (z === pinDrawn) return;
    pinDrawn = z;
    const edge = poly(hull(ps.map((p) => pw(p[0], p[1], -PIN_T, z)).concat(ps.map((p) => pw(p[0], p[1], 0, z)))));
    put(pinS, { sil: edge, crease: poly(ps.map((p) => pw(p[0], p[1], 0, z))) });
    pinEdge.setAttribute("d", edge);
    hole.setAttribute("d", poly(circ(7, 28).map((q) => pw(q.u, PIN_H - PIN_R + q.v, 0, z))));
  }

  // The origin: a round puck on the near end, with a dot in its middle.
  const shift = (r) => r.map((q) => ({ ...q, u: q.u + O[0], v: q.v + O[1] }));
  put(solid(puck), prism(P, front, shift(circ(PKR, 48)), shift(circ(PKR - 2, 48)), 0, PK));
  place(flatDot(puck, C, 4, "dot m"), P(O[0], O[1], PK));

  const REST = [4, 0];
  const roads = shapes.map((shape, i) => {
    const grp = mk("g", {}, low);
    const under = mk("path", { class: "lo" }, grp), top = mk("path", { class: "lo" }, grp);
    return { shape, grp, under, top, z: tween(REST[i]), drawn: NaN, up: false };
  });

  function draw(r, z) {
    if (z === r.drawn) return;
    r.drawn = z;
    r.under.setAttribute("d", poly(r.shape.map((p) => P(p[0], p[1], z))));
    r.top.setAttribute("d", poly(r.shape.map((p) => P(p[0], p[1], z + TH))));
    const up = z > PK - TH;
    if (up !== r.up) { r.up = up; (up ? high : low).appendChild(r.grp); }
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const r of roads) { draw(r, tval(r.z, now)); if (!tdone(r.z, now)) moving = true; }
    drawPin(tval(pinZ, now)); if (!tdone(pinZ, now)) moving = true;
    return moving;
  });
  bag.add(B.unregister);

  let act = -1;
  // The chosen road takes the bright edge; the other drops to the dim stroke, so the ends always outweigh it.
  const paint = (a) => roads.forEach((r, i) => { const on = i === (a < 0 ? 0 : a); r.top.setAttribute("class", on ? "sil hi" : "lo"); });
  paint(-1);
  function setActive(a, force) {
    if (a === act && !force) return;
    const now = performance.now();
    act = a;
    roads.forEach((r, i) => tset(r.z, a < 0 ? REST[i] : i === a ? lift : 0, now, 0));
    tset(pinZ, a < 0 ? 0 : PIN_UP, now, 0);
    paint(a);
    read.textContent = a < 0 ? "rest" : `route ${a + 1}`;
    B.wake();
  }

  /** On the ground: left of the line from origin to destination is the main road, right of it the other. */
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], 0);
    if (Math.abs(x + y) > 125 || Math.abs(x - y) > 150) return -1;
    return x - y < 0 ? 0 : 1;
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { lift = clamp(v, 0, 14); if (act >= 0) setActive(act, true); }, destroy: bag.dispose };
}

hairline({
  name: "route",
  means: "Two roads from a start puck to a destination pin: the one under the pointer lifts and takes the bright edge, the pin hops.",
  rules: [1, 4, 5, 8],
  range: [6, 10, 14],
  tour: [[250, 180], [150, 150], [262, 120], null],
  mount,
});
