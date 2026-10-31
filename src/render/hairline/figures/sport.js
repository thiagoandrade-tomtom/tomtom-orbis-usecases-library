/**
 * Sport: an outdoor run on a map. A map tile with a park in its middle, its
 * pines standing in it, two blocks of buildings beside it, and the streets round
 * the park that the route runs along, out along the near one, up the right,
 * in round a corner, along the back and down the left, and two more streets
 * running off it to the map's edge. The route's middle is
 * dashed where it is still to run; the runner on it is a round puck with a
 * dot on it, the start puck of Route Drawn. The run is the
 * activity replayed: a ring marks the start on the near street, and the
 * stretch already run, with the split dots it has passed, carries the bright edge,
 * the puck's dot with it. The pointer scrubs the replay: the runner springs forward
 * or back the shortest way round the route, running on past the start
 * into a new lap, to the point nearest it, the bright trail and the passed
 * splits following. At rest the runner is half a lap in. The slider is the
 * number of splits in the lap.
 *
 * The pattern: a position on the ground, on one soft, critically damped spring. The hit test projects
 * the pointer onto the ground, which never moves, and takes the nearest point
 * of the route.
 */
const {
  Cam, circ, facing, fillet, fit, hull, mk, open, poly, prism, proj, rings, rrect, unproj,
  spring, stepS, disposer, flatDot, place, pointer, put, register, solid,
} = HL;

const S = 1.48, L = 176, W = 116, T = 18, TZ = 6;
const S0 = 0.5, PKR = 7, PKH = 3, HB = PKH;
// the park inside the loop, its pines (a short trunk and a cone over it), and two blocks of buildings
// in the corner the route goes round [x0, y0, x1, y1, height]
const PARK = [40, 34, 96, 84], TREES = [[56, 50], [80, 62], [62, 72]], TRUNK = 3, CONE_R = 6, CONE_H = 16;
const BLOCKS = [[122, 10, 146, 30, 12], [152, 30, 170, 48, 8]];
// the map's tile, wider than the loop so streets can run off it to the edge; each street off the loop:
// the axis it runs along (0: x, 1: y), its middle across, and its run along, from the edge to the loop's middle
const TILE = [-30, -6, 184, 136];
const STUBS = [[0, 60, -30, 26], [1, 90, 96, 136]];
// the circuit's middle, round from the start on the near straight: out along it, up the right, in round
// a notch, along the back and down the left; every corner rounded, the notch's inner one too
const CIRCUIT = fillet(
  [[70, 96], [150, 96], [150, 62], [108, 62], [108, 22], [26, 22], [26, 96]],
  [0, 22, 18, 16, 18, 22, 22], 10,
);
const RUN = CIRCUIT.reduce((a, p, i) => (i ? [...a, a[i - 1] + Math.hypot(p[0] - CIRCUIT[i - 1][0], p[1] - CIRCUIT[i - 1][1])] : [0]), []);
const PM = RUN[RUN.length - 1] + Math.hypot(CIRCUIT[0][0] - CIRCUIT[CIRCUIT.length - 1][0], CIRCUIT[0][1] - CIRCUIT[CIRCUIT.length - 1][1]);

/** The point at share s of the lap, off units to the outside of the circuit's middle. The lap starts mid near straight. */
function at(s, off) {
  const d = (((s % 1) + 1) % 1) * PM, n = CIRCUIT.length;
  let i = 0;
  while (i < n - 1 && RUN[i + 1] <= d) i++;
  const p = CIRCUIT[i], q = CIRCUIT[(i + 1) % n], l = (i < n - 1 ? RUN[i + 1] : PM) - RUN[i], f = l > 0 ? (d - RUN[i]) / l : 0;
  // the circuit runs anticlockwise on the ground's x, y, so its outside is to the right of the way it runs
  const dx = (q[0] - p[0]) / (l || 1), dy = (q[1] - p[1]) / (l || 1);
  return [p[0] + (q[0] - p[0]) * f - dy * off, p[1] + (q[1] - p[1]) * f + dx * off];
}

/** The circuit's line off units outside its middle, as a closed ring of ground points. */
const edge = (off) => Array.from({ length: 360 }, (_, k) => at(k / 360, off));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let K = value, over = false;
  const C = Cam(45, 0.5, S);
  const [X0, Y0, X1, Y1] = TILE, ext = [[X0, Y0, -TZ], [X1, Y1, -TZ], [X1, Y0, -TZ], [X0, Y1, -TZ]];
  for (let k = 0; k < 8; k++) ext.push([...at(k / 8, 0), HB]);
  fit(C, ext, 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, ...rings(X0, Y0, X1, Y1, 10, 1.8), -TZ, 0));
  // the street the route runs along, its two kerbs, the outer one open where a street runs off it to the
  // map's edge; and those streets' kerbs, unbroken from the edge to the corner
  const off = ([x, y]) => STUBS.some(([k, c, a, b]) => Math.abs((k ? x : y) - c) < T / 2 && (k ? y : x) > a - 1 && (k ? y : x) < b + 1);
  const runs = [];
  let cur = [];
  for (const p of edge(T / 2).concat([at(0, T / 2)])) { if (off(p)) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(p); }
  if (cur.length > 1) runs.push(cur);
  const kerbs = STUBS.flatMap(([k, c, a, b]) => [-T / 2, T / 2].map((e) => (k ? [[c + e, a + T / 2], [c + e, b]] : [[a, c + e], [b - T / 2, c + e]])));
  mk("path", { class: "nf", d: poly(edge(-T / 2).map(([x, y]) => P(x, y, 0))) + runs.concat(kerbs).map((r) => open(r.map(([x, y]) => P(x, y, 0)))).join("") }, g);
  // the park inside the loop, its edge dim
  mk("path", { class: "nf lo", d: poly(rrect(...PARK, 8, 6).map((q) => P(q.u, q.v, 0))) }, g);
  // the route's middle, dashed where it is still to run; the trail over it, a ring at the start, and a dot
  // at each split, lit once passed
  mk("path", { class: "nf dash lo", d: poly(edge(0).map(([x, y]) => P(x, y, 0))) }, g);
  const trail = mk("path", { class: "nf hi" }, g), ticks = mk("g", {}, g);
  mk("path", { class: "nf", d: poly(circ(3.4, 24).map((q) => P(at(0, 0)[0] + q.u, at(0, 0)[1] + q.v, 0))) }, g);
  // the trees, the blocks and the runner, a round puck with a dot on it, each in a group of its own
  // so that the nearer is painted over the farther as the runner goes round
  const trees = TREES.map(([x, y]) => {
    const grp = mk("g", {}, g);
    put(solid(grp), prism(P, front, circ(1.8, 16).map((q) => ({ ...q, u: q.u + x, v: q.v + y })), circ(1.2, 16).map((q) => ({ ...q, u: q.u + x, v: q.v + y })), 0, TRUNK));
    const base = circ(CONE_R, 28).map((q) => P(x + q.u, y + q.v, TRUNK));
    mk("path", { class: "sil", d: poly(hull(base.concat(circ(1.3, 12).map((q) => P(x + q.u, y + q.v, TRUNK + CONE_H))))) }, grp);
    return { grp, depth: x + y };
  });
  const blocks = BLOCKS.map(([x0, y0, x1, y1, h]) => {
    const grp = mk("g", {}, g);
    put(solid(grp), prism(P, front, ...rings(x0, y0, x1, y1, 2.6, 1), 0, h));
    return { grp, depth: (x0 + x1) / 2 + (y0 + y1) / 2 };
  });
  const runner = mk("g", {}, g), puck = solid(runner), dot = flatDot(runner, C, 2.6, "dot");
  let splits = [];
  function build() {
    ticks.replaceChildren();
    splits = [];
    for (let k = 1; k < K; k++) {
      const el = flatDot(ticks, C, 1.9, "dot off");
      place(el, P(...at(k / K, 0), 0));
      splits.push({ s: k / K, el, on: null });
    }
  }
  build();

  // the runner's distance run, in laps, unwrapped: it only wraps to draw and to read
  // a soft spring, damped just enough not to overshoot: the runner sets off gently, runs, and slows into place
  const sp = spring(S0, { k: 12, c: 7, eps: 0.0005 });
  const frac = (v) => v - Math.floor(v);
  let drawn = NaN;
  function draw() {
    const s = frac(sp.x);
    if (s === drawn) return;
    drawn = s;
    const pts = [];
    for (let k = 0, n = Math.max(2, Math.ceil(s * 240)); k <= n; k++) pts.push(P(...at((s * k) / n, 0), 0));
    trail.setAttribute("d", open(pts));
    for (const t of splits) { const on = s >= t.s; if (on !== t.on) { t.on = on; t.el.setAttribute("class", on ? "dot" : "dot off"); } }
    const [x, y] = at(s, 0), sh = (r) => r.map((q) => ({ ...q, u: q.u + x, v: q.v + y }));
    put(puck, prism(P, front, sh(circ(PKR, 32)), sh(circ(PKR - 1.6, 32)), 0, PKH));
    place(dot, P(x, y, PKH));
    [...trees, ...blocks, { grp: runner, depth: x + y }].sort((a, b) => a.depth - b.depth).forEach((o) => g.appendChild(o.grp));
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
  /** Aims at share s of the lap, the shortest way round from where the runner is headed, so crossing the start runs on. */
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
  means: "A run on a map, round a park: the runner springs to the point of the route nearest the pointer, the stretch run lit.",
  rules: [1, 3, 4, 8],
  range: [3, 5, 8],
  tour: [[140, 129], [133, 192], [260, 234], [267, 171], null],
  mount,
});
