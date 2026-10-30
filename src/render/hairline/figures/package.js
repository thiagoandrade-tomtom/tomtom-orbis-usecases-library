/**
 * Package: a house with a gabled roof and a front door, and a short path of
 * three stepping stones running up to it with a taped parcel on the middle one. At rest
 * the door carries the bright edge: where the parcel is going. The pointer's
 * place along the path sets where the parcel is, on a spring, and the parcel
 * takes the bright edge; as it nears the house the door swings open to meet
 * it. The read-out is the minutes left, or `at door`. The slider is how far
 * the door swings, in degrees.
 *
 * The pattern: a position. One spring, a falloff by distance (the door opens
 * only within reach of it), and a hit test on the plane of the parcel's lid,
 * which never moves.
 */
const {
  Cam, clamp, fit, hull, open, poly, proj, rings, prism, facing, ringAt, rrect, run, seg, unproj, rad,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const HX = 64, HY = 56, HH = 38, RH = 64, CX = 32, DX0 = 20, DX1 = 46, DZ = 30, RX = 32, PB = 3;
const PS = 24, PH = 20, YD = 94, YF = 160, YREST = 126, REACH = 32, MINS = 12;
const STONES = [92, 126, 160];

const shift = (ring, dx, dy) => ring.map((q) => ({ ...q, u: q.u + dx, v: q.v + dy }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let swing = value;

  const C = Cam(45, 0.5, 1.6);
  fit(C, [[-3, -3, -PB], [HX + 3, -3, -PB], [-3, HY + 3, -PB], [CX + 20, 176, -PB], [CX - 20, 176, 0], [RX, HY / 2, RH], [HX, HY + 24, DZ + 4]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // The house: walls, a gabled roof with its ridge running back from the door, then the door frame on the front face.
  const [wr, wi] = rings(0, 0, HX, HY, 3, 1.2);
  put(solid(g), prism(P, front, wr, wi, -PB, HH));
  const foot = rrect(-3, -3, HX + 3, HY + 3, 3, 4), ridge = rrect(RX - 2.5, 3, RX + 2.5, HY - 3, 1.5, 4), ridgeIn = rrect(RX - 1.3, 4.2, RX + 1.3, HY - 4.2, 0.8, 4);
  put(solid(g), { sil: poly(hull(ringAt(P, foot, HH).concat(ringAt(P, ridge, RH)))), crease: open(ringAt(P, run(ridgeIn, front), RH)) });
  const onFace = (ring) => ring.map((q) => P(q.u, HY, q.v));
  mk("path", { d: poly(onFace(rrect(DX0 - 1.5, 0, DX1 + 1.5, DZ + 1.5, 2.5, 4))), class: "nf lo" }, g);

  // The stones, then the door leaf, hinged on its right-hand edge and swinging out over the step, then the parcel.
  STONES.forEach((y, i) => {
    const o = (i % 2) * 3 - 1.5, [sr, si] = rings(CX - 20 + o, y - 13, CX + 20 + o, y + 13, 7, 1.4);
    put(solid(g), prism(P, front, sr, si, -PB, 0));
  });
  const leafBack = mk("path", { class: "lo" }, g), leaf = mk("path", { class: "sil" }, g);
  const leafShape = rrect(0, 0.6, DX1 - DX0, DZ, 2, 3);
  const [pr, pi] = rings(-PS / 2, -PS / 2, PS / 2, PS / 2, 3, 1.3);
  const parcel = solid(g), tape = mk("path", { class: "nf lo" }, g);

  const sp = spring(YREST, { eps: 0.05 });
  let drawn = NaN, drawnSwing = NaN, active = false;

  function draw() {
    const y = sp.x;
    if (y !== drawn) {
      drawn = y;
      put(parcel, prism(P, front, shift(pr, CX, y), shift(pi, CX, y), 0, PH));
      tape.setAttribute("d", seg(P(CX, y - PS / 2 + 1.4, PH), P(CX, y + PS / 2 - 1.4, PH)) + seg(P(CX - PS / 2 + 1.4, y, PH), P(CX + PS / 2 - 1.4, y, PH)));
    }
    // The door opens within REACH of the step, eased so it starts slowly and is wide open at the door.
    const t = clamp(1 - (y - YD) / REACH, 0, 1), th = rad(swing * t * t * (3 - 2 * t));
    const key = th;
    if (key === drawnSwing) return;
    drawnSwing = key;
    const at = (s, z, off) => P(DX1 - s * Math.cos(th) - off * Math.sin(th), HY + s * Math.sin(th) - off * Math.cos(th) + 0.3, z);
    leafBack.setAttribute("d", poly(leafShape.map((q) => at(q.u, q.v, -1.6))));
    leaf.setAttribute("d", poly(leafShape.map((q) => at(q.u, q.v, 0))));
  }

  const B = register(stage, (dt) => {
    const m = stepS(sp, dt);
    draw();
    return m;
  });
  bag.add(B.unregister);

  function paint() {
    leaf.classList.toggle("hi", !active);
    parcel.sil.classList.toggle("hi", active);
  }
  paint();

  function readout() {
    if (!active) return "rest";
    const m = Math.ceil(((sp.t - YD) / (YF - YD)) * MINS);
    return m <= 0 ? "at door" : `${m} min`;
  }

  /** On the plane of the parcel's lid: inside the yard, the place along the path, clamped to its ends. */
  function move(p) {
    const [x, y] = unproj(C, p[0], p[1], PH);
    const on = Math.abs(x - CX) < 40 && y > 0 && y < 184;
    if (on) sp.t = clamp(y, YD, YF);
    else sp.t = YREST;
    if (on !== active) { active = on; paint(); }
    read.textContent = readout();
    B.wake();
  }

  bag.add(pointer(stage, { move, leave: () => { active = false; sp.t = YREST; paint(); read.textContent = "rest"; B.wake(); } }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { swing = v; drawnSwing = NaN; B.wake(); }, destroy: bag.dispose };
}

hairline({
  name: "package",
  means: "A parcel on the path to a front door: the pointer sets how far along it is, and the door opens as it arrives.",
  rules: [1, 3, 4, 8],
  range: [50, 80, 110],
  tour: [[108, 208], [181, 171], [167, 179], null],
  mount,
});
