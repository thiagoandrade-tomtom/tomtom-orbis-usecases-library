/**
 * City: a round patch of neighbourhood with a house at its centre and a dashed
 * walking ring round it, and three things to walk to: a bus stop (a round sign
 * on a pole), a corner shop (a block under an awning) and a park's tree (a cone
 * on a trunk). The pointer's distance from the house is the walk: the ring
 * follows it on a spring; a place out of reach stands squat, and each one
 * inside the ring rises to full height, staggered from the ring's edge. The
 * farthest one inside takes the bright edge, the house when none is. The
 * slider is the stagger, in ms.
 *
 * The pattern: a field read as a choice. The ring's radius is a spring; which
 * places are inside reads the spring's target, on the ground plane.
 */
const {
  Cam, circ, clamp, facing, fit, hull, open, poly, prism, proj, ringAt, rings, rrect, run, unproj,
  spring, stepS, tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const GR = 70, GB = 4, RMIN = 16, RMAX = 68, REST = 39, LOW = 0.6;
const shift = (r, c) => r.map((q) => ({ ...q, u: q.u + c[0], v: q.v + c[1] }));

const tube = (c, r, z0, z1) => [shift(circ(r, 20), c), shift(circ(r * 0.7, 20), c), z0, z1];
/** Each place: where it stands, and its solids as [ring, inner, z0, z1], a taper {foot, top, inner, z0, z1}, or a plate facing the viewer {plate, r, zc, t}. */
const PLACES = [
  { at: [-36, 6], parts: (c) => [                     // the bus stop: a pole, a round sign on top
    tube(c, 1.8, 0, 30),
    { plate: c, r: 9, zc: 36, t: 2.5 },
  ] },
  { at: [12, 50], parts: (c) => [                      // the shop: a block, an awning over its front
    [...rings(c[0] - 13, c[1] - 11, c[0] + 13, c[1] + 11, 3, 1.2), 0, 24],
    { foot: rrect(c[0] - 14, c[1] + 11, c[0] + 14, c[1] + 20, 1.5, 4), top: rrect(c[0] - 14, c[1] + 10, c[0] + 14, c[1] + 12, 1, 4), inner: rrect(c[0] - 13, c[1] + 10.4, c[0] + 13, c[1] + 11.6, 0.5, 4), z0: 13, z1: 19 },
  ] },
  { at: [10, -52], parts: (c) => [                     // the park's tree: a trunk, a cone of a crown
    tube(c, 3.5, 0, 14),
    { foot: shift(circ(14, 40), c), top: shift(circ(1.2, 12), c), inner: shift(circ(0.6, 12), c), z0: 12, z1: 50 },
  ] },
].map((p) => ({ ...p, d: Math.hypot(p.at[0], p.at[1]) }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;
  const C = Cam(45, 0.5, 1.95);
  fit(C, [[-GR, -GR, -GB], [GR, GR, -GB], [GR, -GR, -GB], [-GR, GR, -GB], [10, -52, 50], [-36, 6, 45]], 200, 166);
  const P = proj(C), front = facing(C);
  /** A place's solid, its heights scaled by f: a place out of reach stands squat, one in reach full height. */
  const draw = (el, s, f) => {
    if (Array.isArray(s)) return put(el, prism(P, front, s[0], s[1], s[2] * f, s[3] * f));
    if (s.plate) {
      const face = (d) => circ(s.r, 28).map((q) => P(s.plate[0] + (q.u + d) / Math.SQRT2, s.plate[1] + (d - q.u) / Math.SQRT2, s.zc * f + q.v));
      return put(el, { sil: poly(hull(face(-s.t).concat(face(0)))), crease: poly(face(0)) });
    }
    put(el, { sil: poly(hull(ringAt(P, s.foot, s.z0 * f).concat(ringAt(P, s.top, s.z1 * f)))), crease: open(ringAt(P, run(s.inner, front), s.z1 * f)) });
  };

  const g = mk("g", {}, svg);
  // The neighbourhood's ground, then the walking ring on it, behind everything that stands.
  const [gr, gi] = [circ(GR, 72), circ(GR - 2, 72)];
  put(solid(g), prism(P, front, gr, gi, -GB, 0));
  const walk = mk("path", { class: "dash nf" }, g);
  const ringPath = (R) => poly(circ(R, 64).map((q) => P(q.u, q.v, 0)));

  // The house: walls and a gable in one solid, its ridge along x.
  const house = solid(mk("g", {}, g));
  const hf = rrect(-12, -10, 12, 10, 2.5, 4), ridge = rrect(-12, -0.6, 12, 0.6, 0.5, 4);
  put(house, {
    sil: poly(hull(ringAt(P, hf, 0).concat(ringAt(P, hf, 16), ringAt(P, ridge, 29)))),
    crease: open(ringAt(P, run(hf, front), 16)),
  });

  // Places painted back to front by x + y; the house sits among them.
  const order = PLACES.map((p, i) => i).sort((a, b) => PLACES[a].at[0] + PLACES[a].at[1] - (PLACES[b].at[0] + PLACES[b].at[1]));
  const places = PLACES.map((p) => ({ ...p, shapes: p.parts(p.at), els: [], z: tween(LOW), drawn: NaN }));
  for (const i of order) {
    const pl = places[i], grp = mk("g", {}, g);
    pl.els = pl.shapes.map(() => solid(grp));
    if (pl.at[0] + pl.at[1] < 0) house.g.parentNode.before(grp);
  }

  const R = spring(REST, { eps: 0.05 });
  let lastR = NaN;
  const B = register(stage, (dt, now) => {
    let m = stepS(R, dt);
    if (R.x !== lastR) { lastR = R.x; walk.setAttribute("d", ringPath(R.x)); }
    for (const pl of places) {
      const z = tval(pl.z, now);
      if (z !== pl.drawn) { pl.drawn = z; pl.shapes.forEach((s, k) => draw(pl.els[k], s, z)); }
      if (!tdone(pl.z, now)) m = true;
    }
    return m;
  });
  bag.add(B.unregister);

  let inside = -1, hot = null;
  function settle(target, live) {
    R.t = target;
    const now = performance.now(), n = places.filter((p) => p.d <= target).length;
    places.forEach((p, i) => tset(p.z, p.d <= target ? 1 : LOW, now, Math.abs(i - (n - 1)) * stag));
    const best = places.filter((p) => p.d <= target).sort((a, b) => b.d - a.d)[0] ?? null;
    if (best !== hot) {
      hot = best;
      house.sil.classList.toggle("hi", !best);
      places.forEach((p) => p.els.forEach((e) => e.sil.classList.toggle("hi", p === best)));
    }
    inside = n;
    read.textContent = live ? `${n} of ${places.length}` : "rest";
    B.wake();
  }
  places.sort((a, b) => a.d - b.d);
  settle(REST, false);

  bag.add(pointer(stage, {
    move: (p) => { const [x, y] = unproj(C, p[0], p[1], 0); settle(clamp(Math.hypot(x, y), RMIN, RMAX), true); },
    leave: () => settle(REST, false),
  }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { stag = v; }, destroy: bag.dispose };
}

hairline({
  name: "city",
  means: "A walking ring round a home: the bus stop, park and shop it reaches rise, and the read-out counts them.",
  rules: [1, 2, 3, 5],
  range: [0, 60, 120],
  tour: [[199, 147], [147, 215], [299, 138], null],
  mount,
});
