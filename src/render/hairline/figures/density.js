/**
 * Density: a round district, a disc, with three faces standing on it, one per
 * neighbourhood: each a thick round plate on edge, facing the viewer, two eyes
 * and a mouth in relief on its face. The mouth says how much of the chosen
 * vibe, how much good living, that place holds. At rest the middle face smiles
 * and carries the bright edge, one is so-so, one is sad. The pointer pulls the
 * vibe toward it: each face's mood is a spring set by its distance, so faces
 * near it smile and rise a little, far ones frown and sink, and the face
 * nearest it takes the bright edge.
 * The slider is the pull's reach, in world units.
 *
 * The pattern: a field. The hit test is on one fixed plane, which never
 * moves; the read-out reads the mood's target, never its position. A face is
 * the figure's whole subject, built as a solid (rule 10).
 */
const {
  Cam, clamp, facing, fit, open, poly, prism, proj, rrect, unproj, spring, stepS,
  disposer, mk, pointer, put, register, solid, place, r2,
} = HL;

const RD = 70, PB = 7, R = 25, TH = 6, RISE = 14, HIT = 30;
// The neighbourhoods: where each face stands, its mood at rest (-1 sad to 1 happy), and its size.
const SPOTS = [[-44, 18, 0, 0.8], [8, 8, 1, 1], [28, -44, -0.8, 0.64]];
const GROW = 0.14, sizeOf = (b, m) => R * b * (1 + GROW * m);
const moodName = (m) => (m > 0.33 ? "happy" : m < -0.33 ? "sad" : "meh");

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value, over = null;

  const C = Cam(45, 0.5, 1.95), E = RD / Math.SQRT2, big = (b) => sizeOf(b, 1);
  const top = SPOTS.map(([x, y, , b]) => [x, y, RISE + 2 * big(b)]);
  const side = ([x, y, , b], k) => { const a = (k * big(b)) / Math.SQRT2; return [x + a, y - a, RISE + big(b)]; };
  const sides = [side(SPOTS[0], -1), side(SPOTS[2], 1)];
  fit(C, [[-E, -E, 0], [E, E, -PB], [E, -E, -PB], [-E, E, -PB], ...top, ...sides], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, rrect(-RD, -RD, RD, RD, RD, 14), rrect(-RD + 2, -RD + 2, RD - 2, RD - 2, RD - 2, 14), -PB, 0));

  // the face's outline at unit radius, (t across, s up), its centre one radius above its foot: upper half left to right, lower half right to left
  const N = 20, half = (a0) => Array.from({ length: N + 1 }, (_, i) => { const a = a0 - (Math.PI * i) / N; return [Math.cos(a), 1 + Math.sin(a)]; });
  const upper = half(Math.PI), lower = half(0);

  const faces = SPOTS.map(([x, y, m, b], k) => ({ k, x, y, m0: m, b }));
  const order = [...faces].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const f of order) {
    f.sp = spring(f.m0, { eps: 0.004 });
    f.el = solid(g);
    f.mouth = mk("path", { class: "nf sil" }, f.el.g);
    f.eyes = [0, 1].map(() => mk("ellipse", { rx: 3.2 * C.S, ry: 3.2 * C.S, class: "dot m" }, f.el.g));
    f.drawn = NaN;
  }
  const peak = faces.reduce((a, b) => (b.m0 > a.m0 ? b : a));

  /** A face at mood m: the back face's upper half and the front face's lower half make the silhouette; the front's upper half is the crease. */
  function draw(f) {
    const m = f.sp.x;
    if (m === f.drawn) return;
    f.drawn = m;
    const z = RISE * (m + 1) / 2, r = sizeOf(f.b, m);
    const pw = (t, s, d) => P(f.x + (t + d) / Math.SQRT2, f.y + (d - t) / Math.SQRT2, z + s);
    put(f.el, { sil: poly(upper.map((p) => pw(p[0] * r, p[1] * r, -TH)).concat(lower.map((p) => pw(p[0] * r, p[1] * r, 0)))), crease: open(upper.map((p) => pw(p[0] * r, p[1] * r, 0))) });
    const w = 0.56 * r, D = 0.46 * r, sm = 0.62 * r, mouth = [];
    for (let i = 0; i <= 10; i++) { const t = -w + (2 * w * i) / 10; mouth.push(pw(t, sm + m * D * ((t / w) ** 2 - 0.5), 0)); }
    f.mouth.setAttribute("d", open(mouth));
    const er = r2(Math.max(2.6, 3.2 * r / R) * C.S);
    f.eyes.forEach((e, i) => { e.setAttribute("rx", er); e.setAttribute("ry", er); place(e, pw((i ? 0.36 : -0.36) * r, 1.3 * r, 0)); });
  }

  const B = register(stage, (dt) => {
    let mv = false;
    for (const f of order) { if (stepS(f.sp, dt)) mv = true; draw(f); }
    return mv;
  });
  bag.add(B.unregister);

  function retarget() {
    let lit = peak;
    if (over) {
      for (const f of faces) { const u = Math.hypot(f.x - over[0], f.y - over[1]) / reach; f.sp.t = clamp(2 * Math.exp(-u * u) - 1, -1, 1); }
      lit = faces.reduce((a, b) => (Math.hypot(b.x - over[0], b.y - over[1]) < Math.hypot(a.x - over[0], a.y - over[1]) ? b : a));
      read.textContent = moodName(lit.sp.t);
    } else {
      for (const f of faces) f.sp.t = f.m0;
      read.textContent = "rest";
    }
    for (const f of faces) {
      const on = f === lit;
      f.el.sil.classList.toggle("hi", on);
      f.mouth.classList.toggle("hi", on);
      for (const e of f.eyes) e.setAttribute("class", on ? "dot" : "dot m");
    }
    B.wake();
  }
  retarget();

  bag.add(pointer(stage, {
    move: (p) => {
      const [x, y] = unproj(C, p[0], p[1], HIT), d = Math.hypot(x, y), k = d > RD ? RD / d : 1;
      over = [x * k, y * k];
      retarget();
    },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { reach = v; retarget(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "density",
  means: "Faces over a round district, one per neighbourhood: the pointer pulls the vibe toward it, and the faces near it smile.",
  rules: [1, 3, 4, 5],
  range: [30, 45, 70],
  tour: [[115, 134], [299, 147], [200, 154], null],
  mount,
});
