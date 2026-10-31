/**
 * Ask the map — "Ask for Places" from tomtom-docs-illustrations
 * (figures/agentic-search.js), registered under this case's mapType.
 *
 * Agentic Map Search: a map tile with streets on it, and a chat bubble
 * standing on it, its short tail a pin's point set into the street, three
 * typing dots on its face, the AI spark at its corner. Four places lie on the
 * map as dim dots. At rest the spark carries the bright edge. When the
 * pointer comes over the figure the spark turns and swells, the dots type one
 * after the other, then a map pin pops up from each place, nearest the bubble
 * first; last, one of them is chosen: it stands taller, a ring opens on the
 * ground round its foot, and the bright edge goes to it. The slider is the
 * typing's stagger, in ms.
 *
 * The pattern: one answer, told in turn. Tweens with a stagger, the bright
 * edge handed from the spark to the chosen place, and a hit test on the rest
 * pose's box on screen, which never moves.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, open, poly, prism, proj, rings,
  tdone, tset, tval, tween, disposer, flatDot, mk, place, pointer, put, register, solid,
} = HL;

const A = [-26, 22], BT = 7, BW = 36, B0 = 16, B1 = 62, LIFT = 3, TURN = -20, ST = 3, TT = 3, KW = 6;
const TILE = [-66, -60, 76, 54];
const KERBS = [
  [[-62, 22 - KW], [22 - KW, 22 - KW]], [[22 + KW, 22 - KW], [72, 22 - KW]], [[-62, 22 + KW], [22 - KW, 22 + KW]], [[22 + KW, 22 + KW], [72, 22 + KW]],
  [[22 - KW, -56], [22 - KW, 22 - KW]], [[22 - KW, 22 + KW], [22 - KW, 50]], [[22 + KW, -56], [22 + KW, -34 - KW]], [[22 + KW, -34 + KW], [22 + KW, 22 - KW]], [[22 + KW, 22 + KW], [22 + KW, 50]],
  [[22 + KW, -34 - KW], [72, -34 - KW]], [[22 + KW, -34 + KW], [72, -34 + KW]],
];
const SPARKS = [[BW + 2, B1 + 8, 13], [BW + 17, B1 - 6, 6]];
// the places, and which one the agent chooses
const POI = [[2, -44], [50, -14], [60, -50], [48, 38]], PICK = 1;
const PIN_R = 6.5, PIN_H = 20, PIN_T = 3, TALL = 1.4;

const star = (r, th) => fillet(Array.from({ length: 48 }, (_, k) => {
  const u = (k / 48) * Math.PI * 2, x = r * Math.cos(u) ** 3, y = r * Math.sin(u) ** 3;
  return [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
}), Array(48).fill(0.5), 2);
const OUTLINE = fillet(
  [[-BW, B0], [-6, B0], [0, 0], [6, B0], [BW, B0], [BW, B1], [-BW, B1]],
  [12, 4, 1.4, 4, 12, 12, 12], 5,
);
/** A map pin's outline in its own upright plane: a round head tangent down to a point, (t across, s up). */
const PIN = (() => {
  const cy = PIN_H - PIN_R, a0 = Math.acos(PIN_R / cy), pts = [];
  for (let k = 0; k <= 24; k++) { const a = a0 + (k / 24) * (2 * Math.PI - 2 * a0); pts.push([PIN_R * Math.sin(a), cy - PIN_R * Math.cos(a)]); }
  pts.push([0, 0]);
  return fillet(pts, pts.map((_, k) => (k === pts.length - 1 ? 2 : 0.4)), 3);
})();

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;
  const C = Cam(45, 0.5, 1.72);
  const ca = Math.cos((TURN * Math.PI) / 180), sa = Math.sin((TURN * Math.PI) / 180);
  const bw = (t, s, d) => [A[0] + t * ca - d * sa, A[1] + t * sa + d * ca, s];
  fit(C, [[TILE[0], TILE[1], -TT], [TILE[2], TILE[3], -TT], [TILE[2], TILE[1], -TT], [TILE[0], TILE[3], -TT], bw(-BW, B1, 0), bw(BW, B1, 0), bw(BW + 2, B1 + 26, 0), bw(BW + 26, B1 - 6, 0), [POI[2][0], POI[2][1], PIN_H * TALL]], 200, 166);
  const P = proj(C), front = facing(C), at = (t, s, d) => P(...bw(t, s, d));

  const g = mk("g", {}, svg);
  put(solid(g), prism(P, front, ...rings(TILE[0], TILE[1], TILE[2], TILE[3], 8, 2), -TT, 0));
  mk("path", { class: "nf lo", d: KERBS.map((k) => open(k.map((p) => P(p[0], p[1], 0)))).join("") }, g);
  const ringEl = mk("path", { class: "nf hi" }, g);
  POI.forEach((p) => place(flatDot(g, C, 2.8, "dot off"), P(p[0], p[1], 0)));

  // the pins, far to near; the bubble goes in among them where it stands
  const order = POI.map((_, i) => i).sort((a, b) => POI[a][0] + POI[a][1] - POI[b][0] - POI[b][1]);
  const pins = [];
  const pinEls = (i) => { const grp = mk("g", {}, g); pins[i] = { sil: mk("path", { class: "sil" }, grp), face: mk("path", { class: "nf lo" }, grp), hole: mk("path", { class: "nf" }, grp), k: tween(0), drawn: NaN }; };
  order.filter((i) => POI[i][0] + POI[i][1] < A[0] + A[1]).forEach(pinEls);
  mk("path", { class: "lo", d: poly(OUTLINE.map(([t, s]) => at(t, s, -BT))) }, g);
  mk("path", { class: "sil", d: poly(OUTLINE.map(([t, s]) => at(t, s, 0))) }, g);
  const sparks = SPARKS.map(() => ({ back: mk("path", { class: "lo" }, g), face: mk("path", { class: "sil hi" }, g) }));
  const dots = [-13, 0, 13].map((t) => ({ t, el: mk("circle", { r: 3.2, class: "dot off" }, g), k: tween(0), drawn: NaN }));
  order.filter((i) => POI[i][0] + POI[i][1] >= A[0] + A[1]).forEach(pinEls);

  const spin = tween(0), pick = tween(0);
  let sDrawn = NaN;
  function drawSparks(k) {
    if (k === sDrawn) return;
    sDrawn = k;
    const grow = 1 + 0.35 * Math.sin(Math.PI * k);
    SPARKS.forEach(([ct, cs, r], i) => {
      const pts = star(r * (i ? 2 - grow : grow), (k * Math.PI) / 2);
      sparks[i].back.setAttribute("d", poly(pts.map(([x, y]) => at(ct + x, cs + y, -ST))));
      sparks[i].face.setAttribute("d", poly(pts.map(([x, y]) => at(ct + x, cs + y, 0))));
    });
  }
  /** Pin i grown to k, and taller by the pick if it is the chosen one. */
  function drawPin(i, k, pk) {
    const pin = pins[i], key = k + "," + pk;
    if (key === pin.drawn) return;
    pin.drawn = key;
    if (k < 0.02) { for (const n of ["sil", "face", "hole"]) pin[n].setAttribute("d", ""); return; }
    const sz = k * (i === PICK ? 1 + (TALL - 1) * pk : 1), [px, py] = POI[i];
    const w = (t, h, d) => P(px + (t * sz + d) / Math.SQRT2, py + (d - t * sz) / Math.SQRT2, h * sz);
    const fr = PIN.map(([t, h]) => w(t, h, 0));
    pin.sil.setAttribute("d", poly(hull(fr.concat(PIN.map(([t, h]) => w(t, h, -PIN_T))))));
    pin.face.setAttribute("d", poly(fr));
    pin.hole.setAttribute("d", poly(circ(2.4, 20).map((q) => w(q.u, PIN_H - PIN_R + q.v, 0))));
  }

  let lit = null, rDrawn = NaN;
  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const d of dots) {
      const k = tval(d.k, now);
      if (!tdone(d.k, now)) moving = true;
      if (k === d.drawn) continue;
      d.drawn = k;
      place(d.el, at(d.t, (B0 + B1) / 2 + LIFT * k, 0));
      d.el.setAttribute("class", k > 0.5 ? "dot m" : "dot off");
    }
    drawSparks(tval(spin, now));
    const pk = tval(pick, now);
    [spin, pick].forEach((t) => { if (!tdone(t, now)) moving = true; });
    pins.forEach((pin, i) => { drawPin(i, tval(pin.k, now), pk); if (!tdone(pin.k, now)) moving = true; });
    if (pk !== rDrawn) {
      rDrawn = pk;
      const [px, py] = POI[PICK];
      ringEl.setAttribute("d", pk < 0.02 ? "" : poly(circ(4 + 7 * pk, 32).map((q) => P(px + q.u, py + q.v, 0))));
    }
    const on = pk > 0.02;
    if (on !== lit) { lit = on; sparks.forEach((s) => s.face.classList.toggle("hi", !on)); pins[PICK].sil.classList.toggle("hi", on); }
    return moving;
  });
  bag.add(B.unregister);

  // the places pop up nearest the bubble first
  const near = POI.map((_, i) => i).sort((a, b) => Math.hypot(POI[a][0] - A[0], POI[a][1] - A[1]) - Math.hypot(POI[b][0] - A[0], POI[b][1] - A[1]));
  let act = null;
  function setActive(a) {
    if (a === act) return;
    act = a;
    const now = performance.now(), typed = dots.length * stag + 200;
    tset(spin, a ? 1 : 0, now, 0);
    if (a) {
      dots.forEach((d, i) => tset(d.k, 1, now, i * stag));
      near.forEach((i, rank) => tset(pins[i].k, 1, now, typed + rank * 90));
      tset(pick, 1, now, typed + near.length * 90 + 350);
    } else {
      tset(pick, 0, now, 0);
      pins.forEach((pin) => tset(pin.k, 0, now, 0));
      dots.forEach((d, i) => tset(d.k, 0, now, (dots.length - 1 - i) * 40));
    }
    read.textContent = a ? `place ${PICK + 1}` : "rest";
    B.wake();
  }
  setActive(false);

  const box = [P(TILE[0], TILE[3], 0), P(TILE[2], TILE[1], 0), P(TILE[2], TILE[3], 0), at(-BW, B1, 0), at(BW + 2, B1 + 20, 0), at(BW + 24, B1, 0), P(TILE[0], TILE[1], 0)];
  const [x0, x1] = [Math.min(...box.map((p) => p[0])) - 12, Math.max(...box.map((p) => p[0])) + 12];
  const [y0, y1] = [Math.min(...box.map((p) => p[1])) - 12, Math.max(...box.map((p) => p[1])) + 12];
  const hit = ([x, y]) => x > x0 && x < x1 && y > y0 && y < y1;

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(false) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { stag = clamp(v, 60, 260); }, destroy: bag.dispose };
}

hairline({
  name: "agent",
  means: "A chat bubble whose tail is a map pin: its spark turns, the dots type, places pop up as pins, and one is chosen.",
  rules: [1, 2, 4, 5],
  range: [90, 150, 230],
  tour: [[200, 120], [260, 200], null],
  mount,
});
