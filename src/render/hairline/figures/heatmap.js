/**
 * Heatmap: a sun, built as a thick disc standing face-on to the viewer, with
 * eight rays round it, each a small rounded bar. The pointer's height sets
 * the day's high: higher is hotter. As it heats, the sun rises and its rays
 * reach out, the rays that point at the pointer the farthest, each on its own
 * spring; as it cools they shrink to stubs and the sun sinks. From 30° up the
 * sun's rim takes the bright edge: a hot zone. At rest it is a 31° day. The
 * slider is the hottest the day can get, in °C.
 *
 * The pattern: a continuous value read through a threshold. Springs, a
 * falloff by angle, and a hit test on the screen's height and on the angle
 * round the sun's rest centre, neither of which moves.
 */
const { Cam, circ, clamp, fit, hull, lerp, open, poly, proj, rrect, run, spring, stepS, disposer, mk, pointer, put, register, solid } = HL;

const RD = 30, T = 8, GAP = 5, RW = 7.5, N = 8, LMIN = 4, LMAX = 26, Z0 = 2, RISE = 13;
const TMIN = 6, TTOP = 46, HOT = 30, REST = 31, YHOT = 40, YCOLD = 290;
// The sun's plane: turned a little from facing the camera, so its rim shows. e1 runs across it, n out of its face.
const BETA = (62 * Math.PI) / 180, E1 = [Math.sin(BETA), -Math.cos(BETA)], N1 = [Math.cos(BETA), Math.sin(BETA)];
/** Whether a side of the sun's plane with in-plane normal (nu, nv) faces the camera, which lies along (.61, .61, .5). */
const seen = (q) => q.nu * 0.612 * (E1[0] + E1[1]) + q.nv * 0.5 > 0.03;

/** The share of a ray's full reach, by its angle from the pointer: 1 facing it, .62 facing away. */
const toward = (d) => 0.62 + 0.38 * ((1 + Math.cos(d)) / 2) ** 2;
/** A ray's length at heat h, as a share of the hottest day. */
const len = (h) => lerp(LMIN, LMAX, clamp((h - TMIN) / (TTOP - TMIN), 0, 1));
const rot = (ring, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return ring.map((q) => ({ u: q.u * c - q.v * s, v: q.u * s + q.v * c, nu: q.nu * c - q.nv * s, nv: q.nu * s + q.nv * c }));
};

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let peak = value, heat = REST, aim = Math.PI / 4, up = -1;
  const C = Cam(45, 0.5, 2.2);
  const R1 = RD + GAP + LMAX;
  fit(C, [[R1 * E1[0], R1 * E1[1], Z0], [-R1 * E1[0], -R1 * E1[1], Z0], [T * N1[0], T * N1[1], Z0], [0, 0, Z0 + RISE + R1], [T * N1[0], T * N1[1], Z0 - R1]], 200, 166);
  const P = proj(C);
  const W = (z) => (u, v, w) => P(u * E1[0] + w * N1[0], u * E1[1] + w * N1[1], z + v);
  const lift = (h) => Z0 + RISE * clamp((h - TMIN) / (TTOP - TMIN), 0, 1);
  const centre = P(0, 0, lift(REST));

  /** A solid in the sun's plane: its silhouette, the hull of back and face, and the crease along the face's top. */
  const slab = (Q, out, inn) => ({
    sil: poly(hull(out.map((q) => Q(q.u, q.v, 0)).concat(out.map((q) => Q(q.u, q.v, T))))),
    crease: open(run(inn, seen).map((q) => Q(q.u, q.v, T))),
  });

  const g = mk("g", {}, svg);
  const rays = [];
  for (let k = 0; k < N; k++) {
    const a = (k * 2 * Math.PI) / N;
    rays.push({ a, el: solid(g), sp: spring(0, { eps: 0.02 }), drawn: "" });
  }
  const disc = solid(g);
  const dOut = circ(RD, 64), dIn = circ(RD - 1.8, 64);
  const z = spring(lift(REST), { eps: 0.02 });
  let zdrawn = NaN;

  const target = () => {
    for (const r of rays) r.sp.t = len(heat) * toward(r.a - aim);
    z.t = lift(heat);
  };
  target();
  for (const r of rays) r.sp.x = r.sp.t;

  function draw() {
    const Q = W(z.x);
    if (z.x !== zdrawn) { zdrawn = z.x; put(disc, slab(Q, dOut, dIn)); }
    for (const r of rays) {
      const key = z.x + "," + r.sp.x;
      if (key === r.drawn) continue;
      r.drawn = key;
      const L = Math.max(1.2, r.sp.x), r0 = RD + GAP;
      const out = rot(rrect(r0, -RW / 2, r0 + RW / 2 + L, RW / 2, RW / 2, 4), r.a);
      const inn = rot(rrect(r0 + 1.2, -RW / 2 + 1.2, r0 + RW / 2 + L - 1.2, RW / 2 - 1.2, RW / 2 - 1.2, 4), r.a);
      put(r.el, slab(Q, out, inn));
    }
  }

  const B = register(stage, (dt) => {
    let m = stepS(z, dt);
    for (const r of rays) if (stepS(r.sp, dt)) m = true;
    draw();
    return m;
  });
  bag.add(B.unregister);

  function retarget(on) {
    target();
    disc.sil.classList.toggle("hi", heat >= HOT);
    read.textContent = on ? `${Math.round(heat)}°` : "rest";
    B.wake();
  }

  bag.add(pointer(stage, {
    move: (p) => {
      up = clamp((YCOLD - p[1]) / (YCOLD - YHOT), 0, 1);
      heat = lerp(TMIN, peak, up);
      // the angle round the sun's rest centre, in its own plane: screen y runs down, v runs up
      aim = Math.atan2(centre[1] - p[1], p[0] - centre[0]);
      retarget(true);
    },
    leave: () => { up = -1; heat = REST; aim = Math.PI / 4; retarget(false); },
  }));
  bag.add(() => svg.replaceChildren());
  retarget(false);

  return {
    set: (v) => { peak = v; if (up >= 0) { heat = lerp(TMIN, peak, up); retarget(true); } },
    destroy: bag.dispose,
  };
}

hairline({
  name: "heatmap",
  means: "A sun whose rays reach out as the day heats up: raise the pointer for a hotter high, and from 30° the sun lights.",
  rules: [1, 3, 4, 5],
  range: [34, 40, 46],
  tour: [[250, 50], [130, 280], [330, 150], null],
  mount,
});
