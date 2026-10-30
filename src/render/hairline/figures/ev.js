/**
 * EV: a lightning bolt, extruded into a thick solid, standing over a round
 * charging pad. At rest the bolt hovers low, turned three-quarters, and the
 * pad's coil carries the bright edge. As the pointer comes near, the bolt
 * charges: it rises off the pad, turns to face the pointer and takes the
 * bright edge from the coil, more the nearer the pointer is. The slider is
 * the reach, in viewBox units.
 *
 * The bolt is non-convex, so its hull is built as route.js builds a ribbon:
 * the outline projected twice, back and front, joined at the vertices where
 * the sweep turns, with the front's far-facing edges drawn as silhouette.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, lerp, open, poly, prism, proj, rad, ringAt, seg,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const PR = 70, PH = 8, TK = 16, BH = 112, YAW = -8, SWING = 30, LIFT0 = 8, LIFT1 = 30;
/** The bolt, upright in its own plane: a across, h up; the tip at the bottom left. */
const BOLT = fillet(
  [[0, 100], [28, 100], [6, 57], [26, 57], [-16, 0], [-4, 43], [-26, 43]],
  [4, 4, 3, 4, 3, 3, 4],
).map(([a, h]) => [a, (h * BH) / 100]);

/** The share of full charge at u reaches from the bolt: 1 to 40%, .3 at 80%, .06 from 130%. */
const falloff = (u) => (u <= 0.4 ? 1 : u <= 0.8 ? 1 - ((u - 0.4) / 0.4) * 0.7 : u <= 1.3 ? 0.3 - ((u - 0.8) / 0.5) * 0.24 : 0.06);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value, over = null;

  /** The bolt's outline in the world, turned to `yaw`, raised by `lift`, at depth w across its plane. */
  const world = (yaw, lift, w) => {
    const c = Math.cos(rad(yaw)), s = Math.sin(rad(yaw));
    return BOLT.map(([a, h]) => [a * c - w * s, a * s + w * c, h + lift]);
  };

  const C = Cam(45, 0.5, 1.6);
  const ext = [[PR, 0, -PH], [-PR, 0, -PH], [0, PR, -PH], [0, -PR, -PH]];
  for (const y of [YAW - SWING, YAW + SWING]) for (const w of [-TK / 2, TK / 2]) ext.push(...world(y, LIFT1, w));
  fit(C, ext, 200, 156); // the pad's near rim hangs low: centred on the drawn box, not the fitted one
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, circ(PR, 64), circ(PR - 2, 64), -PH, 0));
  const coil = mk("path", { class: "nf", d: poly(ringAt(P, circ(PR * 0.58, 64), 0)) }, g);

  // back to front: the back face and the side bands as ground only, then the back's lit edges, the joins, the front face
  const back = mk("path", { class: "fo" }, g), sides = mk("path", { class: "fo" }, g);
  const rim = mk("path", { class: "nf sil" }, g), join = mk("path", { class: "nf sil" }, g);
  const face = mk("path", { class: "lo" }, g), edge = mk("path", { class: "nf sil" }, g);
  const sYaw = spring(YAW, { eps: 0.05 }), sLift = spring(LIFT0, { eps: 0.05 });
  let drawn = "";

  function draw() {
    const key = sYaw.x.toFixed(2) + "," + sLift.x.toFixed(2);
    if (key === drawn) return;
    drawn = key;
    const F = world(sYaw.x, sLift.x, TK / 2).map((p) => P(...p)), Bk = world(sYaw.x, sLift.x, -TK / 2).map((p) => P(...p));
    const t = [Bk[0][0] - F[0][0], Bk[0][1] - F[0][1]], n = F.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const a = F[i], b = F[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    // an edge faces the sweep when its outward normal points along t: its back copy is the silhouette there
    const faces = F.map((a, i) => {
      const b = F[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1];
      return (area > 0 ? dy * t[0] - dx * t[1] : -dy * t[0] + dx * t[1]) > 0;
    });
    let j = "", e = "", r = "", q = "";
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      if (faces[i] !== faces[(i + n - 1) % n]) j += seg(F[i], Bk[i]);
      if (!faces[i]) { e += seg(F[i], F[k]); continue; }
      r += seg(Bk[i], Bk[k]);
      // the band this edge sweeps, wound one way so the bands never cancel
      q += poly(area > 0 ? [F[i], F[k], Bk[k], Bk[i]] : [F[i], Bk[i], Bk[k], F[k]]);
    }
    back.setAttribute("d", poly(Bk));
    sides.setAttribute("d", q);
    rim.setAttribute("d", r);
    join.setAttribute("d", j);
    face.setAttribute("d", poly(F));
    edge.setAttribute("d", e);
  }

  const B = register(stage, (dt) => {
    const m = stepS(sYaw, dt) | stepS(sLift, dt);
    draw();
    return !!m;
  });
  bag.add(B.unregister);

  // Hit test on the rest pose, in screen space: the bolt's resting middle never moves.
  const mid = P(0, 0, LIFT0 + BH / 2);
  let lit = null;
  function retarget() {
    let c = 0;
    if (over) {
      const dx = over[0] - mid[0], dy = over[1] - mid[1];
      c = falloff(Math.hypot(dx, dy * 0.5) / reach); // the bolt is tall: reach twice as far up and down
      sYaw.t = YAW + clamp(dx / 90, -1, 1) * SWING * Math.min(1, c * 2);
    } else sYaw.t = YAW;
    sLift.t = lerp(LIFT0, LIFT1, c);
    const on = c > 0.5;
    if (on !== lit) {
      lit = on;
      for (const el of [rim, join, edge]) el.classList.toggle("hi", on);
      coil.classList.toggle("hi", !on);
    }
    read.textContent = on ? "charging" : "rest";
    B.wake();
  }
  retarget();

  bag.add(pointer(stage, {
    move: (p) => { over = p; retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { reach = v; retarget(); }, destroy: bag.dispose };
}

hairline({
  name: "ev",
  means: "A lightning bolt over a charging pad: near the pointer it charges, rising off the pad and turning to face it.",
  rules: [1, 3, 4, 8],
  range: [80, 120, 170],
  tour: [[150, 120], [262, 140], [205, 240], null],
  mount,
});
