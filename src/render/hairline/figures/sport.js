/**
 * Sport: an oval running track of three lanes, its infield raised a little,
 * and one runner, a pawn of a body and a head, standing in the middle lane.
 * The lap is the activity replayed: the start line crosses the near straight,
 * and the stretch of lane already run, with the split marks it has passed,
 * carries the bright edge. The pointer scrubs the replay: the runner springs
 * forward or back the shortest way round the lap, running on past the start
 * line into a new lap, to the point nearest it, the bright trail and the passed
 * splits following. At rest the runner is half a lap in. The slider is the
 * number of splits in the lap.
 *
 * The pattern: a position on the ground, on one spring. The hit test projects
 * the pointer onto the ground, which never moves, and takes the nearest point
 * of the lap.
 */
const {
  Cam, circ, facing, fit, mk, open, poly, prism, proj, ringAt, rrect, seg, unproj,
  spring, stepS, disposer, pointer, put, register, solid,
} = HL;

const S = 1.72, L = 172, W = 100, R = W / 2, T = 27, TZ = 7, IZ = 3;
const RB = 8, HB = 33, RH = 8.5, S0 = 0.5;
const RC = R - T / 2, A = L / 2 - R, PM = 4 * A + 2 * Math.PI * RC, CX = L / 2, CY = W / 2;

/** The point at share s of the lap, off units outward from the middle of the track. The lap starts mid near straight. */
function at(s, off) {
  let d = (((s % 1) + 1) % 1) * PM, x, y, nx, ny;
  const bend = (c, sg) => { const t = d / RC; nx = sg * Math.sin(t); ny = sg * Math.cos(t); x = c + RC * nx; y = CY + RC * ny; };
  if (d < A) { x = CX + d; y = CY + RC; nx = 0; ny = 1; }
  else if ((d -= A) < Math.PI * RC) bend(CX + A, 1);
  else if ((d -= Math.PI * RC) < 2 * A) { x = CX + A - d; y = CY - RC; nx = 0; ny = -1; }
  else if ((d -= 2 * A) < Math.PI * RC) bend(CX - A, -1);
  else { d -= Math.PI * RC; x = CX - A + d; y = CY + RC; nx = 0; ny = 1; }
  return [x + nx * off, y + ny * off];
}

const loop = (i) => rrect(i, i, L - i, W - i, R - i, 14);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let K = value, over = false;
  const C = Cam(45, 0.5, S);
  const ext = [[0, 0, -TZ], [L, W, -TZ], [L, 0, -TZ], [0, W, -TZ]];
  for (let k = 0; k < 8; k++) ext.push([...at(k / 8, 0), HB + 2 * RH]);
  fit(C, ext, 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, loop(0), loop(2), -TZ, 0));
  // lane lines, then the start line, the splits and the trail, all painted on the track's top
  mk("path", { class: "nf lo", d: [T / 3, (2 * T) / 3].map((i) => poly(ringAt(P, loop(i), 0))).join("") }, g);
  const across = (s) => seg(P(...at(s, -T / 2), 0), P(...at(s, T / 2), 0));
  mk("path", { class: "nf", d: across(0) }, g);
  const ticks = mk("g", {}, g), trail = mk("path", { class: "nf hi" }, g);
  put(solid(g), prism(P, front, loop(T), loop(T + 1.8), 0, IZ));
  const body = solid(g), head = mk("ellipse", { rx: RH * S, ry: RH * S, class: "sil" }, g);

  let splits = [];
  function build() {
    ticks.replaceChildren();
    splits = [];
    for (let k = 1; k < K; k++) splits.push({ s: k / K, el: mk("path", { class: "nf lo", d: across(k / K) }, ticks), on: null });
  }
  build();

  // the runner's distance run, in laps, unwrapped: it only wraps to draw and to read
  const sp = spring(S0, { eps: 0.0005 });
  const frac = (v) => v - Math.floor(v);
  let drawn = NaN;
  function draw() {
    const s = frac(sp.x);
    if (s === drawn) return;
    drawn = s;
    const pts = [];
    for (let k = 0, n = Math.max(2, Math.ceil(s * 120)); k <= n; k++) pts.push(P(...at((s * k) / n, 0), 0));
    trail.setAttribute("d", open(pts));
    for (const t of splits) { const on = s >= t.s; if (on !== t.on) { t.on = on; t.el.setAttribute("class", on ? "nf hi" : "nf lo"); } }
    const [x, y] = at(s, 0), ring = circ(RB, 32).map((q) => ({ ...q, u: q.u + x, v: q.v + y }));
    put(body, prism(P, front, ring, ring.map((q) => ({ ...q, u: q.u - q.nu * 1.2, v: q.v - q.nv * 1.2 })), 0, HB));
    const [hx, hy] = P(x, y, HB + RH * 0.9);
    head.setAttribute("cx", hx);
    head.setAttribute("cy", hy);
  }

  const B = register(stage, (dt) => { const m = stepS(sp, dt); draw(); return m; });
  bag.add(B.unregister);

  const say = () => { read.textContent = over ? `km ${Math.min(K, Math.floor(frac(sp.t) * K) + 1)}` : "rest"; };
  /** The share of the lap nearest the pointer on the ground, or null when it is off the track. */
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], 0);
    let best = null, bd = T / 2 + 30;
    for (let k = 0; k < 240; k++) {
      const q = at(k / 240, 0), d = Math.hypot(q[0] - x, q[1] - y);
      if (d < bd) { bd = d; best = k / 240; }
    }
    return best;
  }
  /** Aims at share s of the lap, the shortest way round from where the runner is headed, so crossing the start line runs on. */
  function aim(s) {
    over = s !== null;
    const to = over ? s : S0;
    sp.t = to + Math.round(sp.t - to);
    say();
    B.wake();
  }

  bag.add(pointer(stage, { move: (p) => aim(hit(p)), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { K = Math.round(v); build(); drawn = NaN; draw(); say(); }, destroy: bag.dispose };
}

hairline({
  name: "sport",
  means: "A running track replays a lap: the runner springs to the point nearest the pointer, the stretch run and its splits lit.",
  rules: [1, 3, 4, 8],
  range: [3, 5, 8],
  tour: [[140, 129], [133, 192], [260, 234], [267, 171], null],
  mount,
});
