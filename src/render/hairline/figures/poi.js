/**
 * POI: one shop on a street corner, a flat-roofed block with a shop window
 * and a door in its long front, an awning over both, and a map pin, a thick
 * teardrop with a hole through its head, hovering over the roof. At rest the
 * awning is rolled in and the pin carries the bright edge. As the pointer
 * comes near, the shop opens: the awning rolls out over the street, the pin
 * lifts higher on its dashed drop, and the awning takes the bright edge with
 * the pin, more the nearer the pointer is. The slider is the reach.
 *
 * The pattern: one place inspected, on one spring. The hit test measures the
 * pointer against the shop's rest middle on screen, which never moves.
 */
const {
  Cam, clamp, fillet, fit, hull, lerp, open, poly, prism, proj, rings, rrect, seg,
  spring, stepS, disposer, mk, pointer, put, register, solid, facing,
} = HL;

const S = 1.95, BW = 110, BD = 54, BH = 54, AZ = 50, AX0 = 6, AX1 = BW - 6;
const EXT0 = 4, EXT1 = 17, DROP = 0.6, VAL = 6, RP = 13, HC = 25, PT = 7, LIFT0 = 8, LIFT1 = 24;

/** The pin's outline in its own upright plane, a across and h up from the tip: a circle and the two tangents to the tip. */
const PIN = (() => {
  const g = Math.acos(RP / HC), pts = [];
  for (let k = 0; k <= 24; k++) { const t = g + ((2 * Math.PI - 2 * g) * k) / 24; pts.push([RP * Math.sin(t), HC - RP * Math.cos(t)]); }
  pts.push([0, 0]);
  return fillet(pts, pts.map((_, i) => (i === pts.length - 1 ? 3 : 0.01)));
})();

/** The share of the shop opened with the pointer u reaches from it: 1 to 40%, .3 at 80%, .06 from 130%. */
const falloff = (u) => (u <= 0.4 ? 1 : u <= 0.8 ? 1 - ((u - 0.4) / 0.4) * 0.7 : u <= 1.3 ? 0.3 - ((u - 0.8) / 0.5) * 0.24 : 0.06);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value, over = null;
  const C = Cam(45, 0.5, S);
  const cx = BW / 2, cy = BD / 2;
  fit(C, [[0, 0, 0], [BW, BD + EXT1, 0], [BW, 0, 0], [0, BD + EXT1, 0], [cx, cy, BH + LIFT1 + HC + RP]], 200, 166);
  const P = proj(C), front = facing(C);
  /** a point of the pin's plane, which faces the camera: a across the screen, h up, w toward the viewer */
  const pinAt = (a, h, w, z) => P(cx + (a + w) / Math.SQRT2, cy + (w - a) / Math.SQRT2, z + h);

  const g = mk("g", {}, svg);
  const [ring, inner] = rings(0, 0, BW, BD, 4, 1.6);
  put(solid(g), prism(P, front, ring, inner, 0, BH));
  const onFront = (u0, v0, u1, v1, r) => poly(rrect(u0, v0, u1, v1, r, 5).map((q) => P(q.u, BD, q.v)));
  mk("path", { class: "nf", d: onFront(10, 8, 62, 33, 3) }, g);
  const door = mk("path", { class: "nf", d: onFront(74, 0.5, 94, 35, 3) }, g);
  mk("path", { class: "nf lo", d: onFront(12.5, 10.5, 59.5, 30.5, 1.5) }, g);

  const under = mk("path", { class: "lo" }, g), awning = mk("path", { class: "sil" }, g), stripes = mk("path", { class: "nf lo" }, g), valance = mk("path", { class: "sil" }, g);
  const drop = mk("path", { class: "dash" }, g);
  const pinSil = mk("path", { class: "sil hi" }, g), pinCrease = mk("path", { class: "nf lo" }, g);
  const hole = mk("ellipse", { rx: RP * 0.42 * S, ry: RP * 0.42 * S * 0.866, class: "nf" }, g);

  const sp = spring(0, { eps: 0.002 });
  let drawn = NaN;
  function draw() {
    const c = sp.x;
    if (c === drawn) return;
    drawn = c;
    // the awning: from the wall at AZ out over the street, falling 0.6 of its reach, then its valance
    const e = lerp(EXT0, EXT1, c), zo = AZ - e * DROP;
    const quad = (z) => fillet([P(AX0, BD, z + AZ - zo), P(AX1, BD, z + AZ - zo), P(AX1, BD + e, z), P(AX0, BD + e, z)], [2, 2, 3, 3]);
    under.setAttribute("d", poly(quad(zo - 2)));
    awning.setAttribute("d", poly(quad(zo)));
    let st = "";
    for (let x = AX0 + 14; x < AX1 - 6; x += 14) st += seg(P(x, BD + 1, AZ - 1), P(x, BD + e - 1, zo + 0.5 - DROP));
    stripes.setAttribute("d", st);
    valance.setAttribute("d", poly(fillet([P(AX0, BD + e, zo), P(AX1, BD + e, zo), P(AX1, BD + e, zo - VAL), P(AX0, BD + e, zo - VAL)], [1, 1, 2, 2])));
    // the pin: its back and front outlines, hulled; the crease is the front's top
    const z = BH + lerp(LIFT0, LIFT1, c);
    const Fp = PIN.map(([a, h]) => pinAt(a, h, PT / 2, z)), Bp = PIN.map(([a, h]) => pinAt(a, h, -PT / 2, z));
    pinSil.setAttribute("d", poly(hull(Fp.concat(Bp))));
    // the crease: the top half of the head, circle samples 6 to 18, five points each after the fillet
    pinCrease.setAttribute("d", open(Fp.slice(30, 95)));
    const [hx, hy] = pinAt(0, HC, PT / 2, z);
    hole.setAttribute("cx", hx);
    hole.setAttribute("cy", hy);
    drop.setAttribute("d", seg(P(cx, cy, BH), pinAt(0, 0, 0, z)));
  }

  const B = register(stage, (dt) => { const m = stepS(sp, dt); draw(); return m; });
  bag.add(B.unregister);

  const mid = P(cx, cy, BH / 2);
  let lit = null;
  function retarget() {
    const c = over ? falloff(Math.hypot(over[0] - mid[0], (over[1] - mid[1]) * 0.7) / reach) : 0;
    sp.t = over ? c : 0;
    const on = c > 0.4;
    if (on !== lit) {
      lit = on;
      for (const el of [awning, valance, door]) el.classList.toggle("hi", on);
    }
    read.textContent = on ? "open" : "rest";
    B.wake();
  }
  retarget();

  bag.add(pointer(stage, {
    move: (p) => { over = p; retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { reach = clamp(v, 40, 400); retarget(); }, destroy: bag.dispose };
}

hairline({
  name: "poi",
  means: "A shop with a pin over its roof: as the pointer comes near, its awning rolls out and the pin lifts.",
  rules: [1, 3, 4, 8],
  range: [80, 120, 170],
  tour: [[305, 215], [212, 150], [110, 130], null],
  mount,
});
