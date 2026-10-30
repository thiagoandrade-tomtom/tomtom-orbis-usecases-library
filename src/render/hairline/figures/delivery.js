/**
 * Delivery: a depot with a gabled roof and a door, and a belt running out of
 * the door with three crates on it in the order they will be dropped, stop 1
 * at the far end. At rest the crates stand unevenly spaced and stop 1 carries
 * the bright edge. The crate under the pointer lifts off the belt and takes
 * the bright edge; its neighbours slide away from it along the belt,
 * staggered by distance. The slider is the stagger, in ms.
 *
 * The pattern: one of many. Tweens, a stagger by distance, and a hit test on
 * the plane of the crates' rest lids, which never moves.
 */
const {
  Cam, clamp, fit, hull, open, poly, proj, rings, prism, facing, ringAt, rrect, run, unproj,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const DX = 40, DY = 50, DH = 32, RH = 50, BY0 = 11, BY1 = 39, BX1 = 168, BH = 6, PB = 4;
const CS = 24, CH = 18, CY = (BY0 + BY1) / 2, LIFT = 22;
const REST = [68, 108, 147], PART = [0, 12, 7], XLO = DX + CS / 2 + 3, XHI = BX1 - CS / 2 - 3;
const N = REST.length;

const shift = (ring, dx, dy = 0) => ring.map((q) => ({ ...q, u: q.u + dx, v: q.v + dy }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.8);
  fit(C, [[-3, -3, -PB], [BX1, BY1, -PB], [BX1, BY0, 0], [-3, DY + 3, -PB], [DX / 2, CY, RH], [XHI, CY, BH + CH + LIFT]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // The depot: walls, then a gabled roof whose ridge runs along the belt, then the door on the face the belt leaves by.
  const [wr, wi] = rings(0, 0, DX, DY, 3, 1.2);
  put(solid(g), prism(P, front, wr, wi, -PB, DH));
  const foot = rrect(-3, -3, DX + 3, DY + 3, 3, 4), ridge = rrect(3, CY - 2.5, DX - 3, CY + 2.5, 1.5, 4), ridgeIn = rrect(4.2, CY - 1.3, DX - 4.2, CY + 1.3, 0.8, 4);
  put(solid(g), { sil: poly(hull(ringAt(P, foot, DH).concat(ringAt(P, ridge, RH)))), crease: open(ringAt(P, run(ridgeIn, front), RH)) });
  mk("path", { d: poly(rrect(BY0 - 2, BH - 1, BY1 + 2, 26, 2.5, 4).map((q) => P(DX, q.u, q.v))), class: "nf" }, g);

  // The belt.
  const [br, bi] = rings(DX, BY0, BX1, BY1, 7, 1.4);
  put(solid(g), prism(P, front, br, bi, 0, BH));

  // Crates, back to front; a lifted crate is moved to `high`, above the others.
  const [cr, ci] = rings(-CS / 2, -CS / 2, CS / 2, CS / 2, 3.2, 1.2);
  const slots = REST.map(() => mk("g", {}, g)), high = mk("g", {}, g);
  const crates = REST.map((x, i) => {
    const grp = mk("g", {}, slots[i]), el = solid(grp);
    return { i, grp, el, x: tween(x), z: tween(0), drawn: "", up: false };
  });

  function draw(c, x, z) {
    const key = x + "," + z;
    if (key === c.drawn) return;
    c.drawn = key;
    const z0 = BH + z;
    put(c.el, prism(P, front, shift(cr, x, CY), shift(ci, x, CY), z0, z0 + CH));
    const up = z > 2;
    if (up !== c.up) { c.up = up; (up ? high : slots[c.i]).appendChild(c.grp); }
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const c of crates) { draw(c, tval(c.x, now), tval(c.z, now)); if (!tdone(c.x, now) || !tdone(c.z, now)) moving = true; }
    return moving;
  });
  bag.add(B.unregister);

  let act = -1;
  const paint = (a) => crates.forEach((c, i) => c.el.sil.classList.toggle("hi", i === (a < 0 ? N - 1 : a)));
  paint(-1);

  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    crates.forEach((c, i) => {
      const d = Math.abs(i - from), to = a < 0 ? REST[i] : clamp(REST[i] + Math.sign(i - a) * PART[Math.abs(i - a)], XLO, XHI);
      tset(c.x, to, now, d * stag); tset(c.z, i === a ? LIFT : 0, now, d * stag);
    });
    paint(a);
    read.textContent = a < 0 ? "rest" : `stop ${N - a}`;
    B.wake();
  }

  /** On the plane of the crates' rest lids: over the belt, the crate whose rest centre is nearest. */
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], BH + CH);
    if (Math.abs(y - CY) > CS / 2 + 8 || x < DX + 4 || x > BX1 + 4) return -1;
    let best = 0;
    REST.forEach((x0, i) => { if (Math.abs(x0 - x) < Math.abs(REST[best] - x)) best = i; });
    return best;
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { stag = v; }, destroy: bag.dispose };
}

hairline({
  name: "delivery",
  means: "Crates leave a depot along a belt in stop order: the one under the pointer lifts, the others slide apart in turn.",
  rules: [1, 2, 5, 10],
  range: [0, 45, 100],
  tour: [[190, 143], [291, 194], [241, 169], null],
  mount,
});
