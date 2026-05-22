/* Floating detail panel.
   - Phone (≤720px): drag the handle vertically to RESIZE the bottom drawer.
   - Desktop:        drag the handle to MOVE the floating card.
   Both modes use Pointer Events so mouse + touch share one code path. */

const PHONE_QUERY = '(max-width: 720px)';
const MIN_HEIGHT = 56;             // matches `.panel-detail.is-minimized` max-height
const MAX_HEIGHT_RATIO = 0.9;      // never larger than 90% of the viewport
const MINIMIZE_THRESHOLD = 120;    // drag below this height → snap to minimized

export function bindPanel({ onDismiss } = {}) {
  const panel  = document.getElementById('panel-detail');
  const handle = document.getElementById('panel-handle');

  let active = false;
  let mode = null;                 // 'resize' | 'move'
  let pointerId = null;
  let startX = 0, startY = 0;
  let startHeight = 0;
  let startLeft = 0, startTop = 0;

  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('.panel-btn')) return;
    active = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    mode = window.matchMedia(PHONE_QUERY).matches ? 'resize' : 'move';
    const r = panel.getBoundingClientRect();
    if (mode === 'resize') {
      startHeight = r.height;
      panel.classList.remove('is-minimized');     // dragging up should also restore
    } else {
      startLeft = r.left;
      startTop  = r.top;
    }
    try { handle.setPointerCapture(pointerId); } catch {}
    e.preventDefault();
  });

  handle.addEventListener('pointermove', e => {
    if (!active) return;
    if (mode === 'resize') {
      const dy = startY - e.clientY;                          // drag up = positive
      const maxH = window.innerHeight * MAX_HEIGHT_RATIO;
      const next = Math.max(MIN_HEIGHT, Math.min(maxH, startHeight + dy));
      panel.style.height = next + 'px';
      document.documentElement.style.setProperty('--panel-h', next + 'px');
    } else {
      /* Move mode — clamp inside the viewport so the panel can't be lost off-screen. */
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const x = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  startLeft + dx));
      const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop  + dy));
      panel.style.left = x + 'px';
      panel.style.top  = y + 'px';
      /* When minimized, the body is hidden and the dynamic max-height
         constraint is unnecessary — applying it here would set
         `--panel-top` to a large value and collapse the panel's
         max-height to 0, making the whole panel disappear mid-drag. */
      if (!panel.classList.contains('is-minimized')) {
        document.documentElement.style.setProperty('--panel-top', y + 'px');
      }
    }
  });

  function endDrag() {
    if (!active) return;
    active = false;
    try { handle.releasePointerCapture(pointerId); } catch {}
    pointerId = null;

    /* Resize-only: tiny final height → treat as a minimize. */
    if (mode === 'resize') {
      const h = panel.getBoundingClientRect().height;
      if (h <= MINIMIZE_THRESHOLD) {
        panel.style.height = '';        // CSS .is-minimized rule takes over
        panel.classList.add('is-minimized');
      }
    }
    mode = null;
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  document.getElementById('panel-minimize').addEventListener('click', () => {
    panel.style.height = '';
    document.documentElement.style.removeProperty('--panel-h');
    panel.classList.toggle('is-minimized');
  });

  document.getElementById('panel-dismiss').addEventListener('click', () => {
    panel.style.height = '';
    document.documentElement.style.removeProperty('--panel-h');
    panel.classList.remove('is-visible', 'is-minimized');
    onDismiss?.();
  });

  /* Crossing the mobile↔desktop breakpoint invalidates whatever inline
     geometry was set by the drag handler — mobile sets `height`+`--panel-h`,
     desktop sets `left`+`top`. If we don't clear them, the panel stays
     stuck at its previous size/position after the resize and the user
     has to minimize/maximize to recover. */
  const mql = window.matchMedia(PHONE_QUERY);
  const resetGeometry = () => {
    panel.style.height = '';
    panel.style.left = '';
    panel.style.top = '';
    document.documentElement.style.removeProperty('--panel-h');
    document.documentElement.style.removeProperty('--panel-top');
  };
  if (mql.addEventListener) mql.addEventListener('change', resetGeometry);
  else if (mql.addListener) mql.addListener(resetGeometry); // older Safari

  /* Belt-and-suspenders breakpoint detector + reclamp on resize.
     `mql.change` should fire on its own, but in some browsers (and the
     interactive DevTools responsive mode) the order vs. window.resize
     is non-deterministic, leaving the panel briefly in a half-state
     (e.g. inline desktop coords applied while CSS expects mobile drawer
     layout). Tracking the previous match state lets us guarantee one
     clean reset whenever the breakpoint flips, regardless of event
     ordering. */
  let wasMobile = mql.matches;
  window.addEventListener('resize', () => {
    const isMobile = window.matchMedia(PHONE_QUERY).matches;
    if (isMobile !== wasMobile) {
      resetGeometry();
      wasMobile = isMobile;
      return;
    }
    if (isMobile) return;                                    // mobile uses resize-mode
    if (!panel.classList.contains('is-visible')) return;
    if (!panel.style.left && !panel.style.top) return;       // still at CSS default
    /* Clear the var first so max-height recomputes against the natural
       top (88px fallback) and the panel reports its real intrinsic
       height — otherwise a stale `--panel-top` from a pre-resize
       position collapses it before we measure. */
    document.documentElement.style.removeProperty('--panel-top');
    const r = panel.getBoundingClientRect();
    const x = Math.max(0, Math.min(window.innerWidth  - r.width,  r.left));
    const y = Math.max(0, Math.min(window.innerHeight - r.height, r.top));
    panel.style.left = x + 'px';
    panel.style.top  = y + 'px';
    document.documentElement.style.setProperty('--panel-top', y + 'px');
  });
}

export function showPanel() {
  const panel = document.getElementById('panel-detail');
  if (!panel) return;
  panel.style.height = '';                /* fresh open → use CSS default height */
  document.documentElement.style.removeProperty('--panel-h');
  document.documentElement.style.removeProperty('--panel-top');
  panel.classList.add('is-visible');
  panel.classList.remove('is-minimized');
  /* Reset scroll so each new case starts at the top, not wherever the
     previous case was scrolled to. */
  panel.querySelector('.panel-body')?.scrollTo(0, 0);
}
