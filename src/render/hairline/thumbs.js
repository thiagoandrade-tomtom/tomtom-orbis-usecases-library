/* Hairline figures as list thumbnails. At rest a figure shows its designed
   rest pose; hovering (or focusing) the row walks the figure's own tour with
   an unseen pointer, since 72px is too small to aim at. The kernel's own
   HL.tour waits ~1.2s before its first stop, which reads as lag on hover,
   so the row drives the figure with synthetic pointer events instead. */
import { FIGURES, HL } from './setup.js';

/* Every figure in ./figures registers itself under its `name`, which is
   the use case's `mapType` and its file name. They are loaded lazily, not
   eagerly: an eager glob's imports are hoisted above setup.js, so a figure
   would run before the `HL` global exists. A mapType with no figure gets
   an empty thumb. */
const SOURCES = import.meta.glob('./figures/*.js');
const NAMES = new Set(Object.keys(SOURCES).map(p => p.slice(10, -3)));
const loaded = Promise.all(Object.values(SOURCES).map(load => load()));

const TRAVEL = 650, DWELL = 900, GAP = 700;
const ease = t => 1 - Math.pow(1 - t, 3);

/* Per-figure holds, ms by tour stop index, where a stop needs other than
   DWELL to tell its part: multistop's car charging at the second stop, and
   sport's runner barely pausing so its lap reads as one loop. */
const HOLD = {
  multistop: { 1: 1600 },
  sport: { 0: 120, 1: 120, 2: 120, 3: 120 },
};

let mounted = [];
let generation = 0;

export const hasFigure = mapType => NAMES.has(mapType);

export function figureSlot(mapType) {
  return `<div class="hl-stage" data-hl-figure="${mapType}"></div>`;
}

/* The stage's own mapping (kernel `pointer`): client px over its rect → 400×320. */
function emit(stage, type, [x, y]) {
  const r = stage.getBoundingClientRect();
  stage.dispatchEvent(new PointerEvent(type, {
    pointerType: 'mouse', pointerId: 1, bubbles: false,
    clientX: r.left + (x / 400) * r.width, clientY: r.top + (y / 320) * r.height,
  }));
}

function driver(stage, stops, hold = {}) {
  let raf = 0, from = null, i = 0, t0 = 0, phase = 'travel';
  const step = now => {
    const stop = stops[i];
    if (phase === 'travel') {
      if (stop === null) { from = null; emit(stage, 'pointerleave', [200, 160]); phase = 'wait'; t0 = now; }
      else {
        const k = from ? ease(Math.min(1, (now - t0) / TRAVEL)) : 1;
        const a = from ?? stop;
        emit(stage, 'pointermove', [a[0] + (stop[0] - a[0]) * k, a[1] + (stop[1] - a[1]) * k]);
        if (k >= 1) { from = stop; phase = 'wait'; t0 = now; }
      }
    } else if (now - t0 >= (stop === null ? GAP : hold[i] ?? DWELL)) {
      i = (i + 1) % stops.length; phase = 'travel'; t0 = now;
    }
    raf = requestAnimationFrame(step);
  };
  return {
    start() {
      if (raf || HL.reducedMotion()) return;
      i = 0; from = null; phase = 'travel'; t0 = performance.now();
      raf = requestAnimationFrame(step);
    },
    stop() {
      if (!raf) return;
      cancelAnimationFrame(raf); raf = 0; from = null;
      emit(stage, 'pointerleave', [200, 160]);
    },
  };
}

/* Mounts every figure slot under `root`, tearing down the previous set
   first — the list re-renders by replacing its innerHTML. The first render
   lands before the figures have loaded; it mounts once they have, unless a
   newer render has replaced it by then. */
export async function mountThumbs(root) {
  mounted.forEach(m => m.destroy());
  mounted = [];
  const mine = ++generation;
  await loaded;
  if (mine !== generation) return;
  HL.inject(document);
  root.querySelectorAll('[data-hl-figure]').forEach(stage => {
    const fig = FIGURES.get(stage.dataset.hlFigure);
    if (!fig) return;
    stage.setAttribute('data-hairline', fig.name);
    stage.setAttribute('aria-hidden', 'true');
    const svg = HL.mk('svg', { viewBox: '0 0 400 320', 'aria-hidden': 'true' }, stage);
    /* A figure that throws leaves an empty thumb, never a broken list. */
    let handle;
    try { handle = fig.mount({ stage, svg, read: { textContent: '' } }, fig.range[1]); }
    catch (err) { console.error(`hairline ${fig.name}:`, err); svg.remove(); return; }
    const drive = driver(stage, fig.tour ?? HL.LAP, HOLD[fig.name]);
    const row = stage.closest('.case-row') ?? stage;
    const on = () => drive.start(), off = () => drive.stop();
    row.addEventListener('pointerenter', on);
    row.addEventListener('pointerleave', off);
    row.addEventListener('focus', on);
    row.addEventListener('blur', off);
    mounted.push({
      destroy() {
        drive.stop();
        row.removeEventListener('pointerenter', on);
        row.removeEventListener('pointerleave', off);
        row.removeEventListener('focus', on);
        row.removeEventListener('blur', off);
        handle.destroy();
      },
    });
  });
}
