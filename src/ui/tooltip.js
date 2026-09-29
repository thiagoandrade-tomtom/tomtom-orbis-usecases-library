/* Button tooltips — site-wide. Any button or link with a `title` gets a
   small themed label on hover and keyboard focus, instead of the browser's
   slow grey native one. Nothing to wire per button: set `title` (and an
   `aria-label` for icon-only buttons) and this picks it up, including
   buttons rendered later and titles that change at runtime (the compass).

   Placement: to the left for the right-hand map-control column (above
   would cover the next button up), above everywhere else, flipped below
   when there's no room, and clamped to the viewport. */

const SELECTOR = 'button[title], a[title], [role="button"][title], button[data-tip], a[data-tip], [role="button"][data-tip]';
const SHOW_DELAY = 350;   // first hover
const WARM_MS = 600;      // moving between buttons within this shows at once

let tip = null;
let target = null;
let timer = null;
let lastHide = 0;

function el() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'ui-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

/* Move `title` into data-tip so the native tooltip never doubles up. Code
   that sets `title` again later (live labels) is re-read on next hover. */
function textOf(node) {
  if (node.hasAttribute('title')) {
    const t = node.getAttribute('title');
    if (t) node.dataset.tip = t;
    node.removeAttribute('title');
  }
  return node.dataset.tip || '';
}

function show(node) {
  const text = textOf(node);
  if (!text || node.disabled) return;
  const t = el();
  t.textContent = text;
  t.hidden = false;
  t.classList.remove('is-in');
  const r = node.getBoundingClientRect();
  const w = t.offsetWidth, h = t.offsetHeight, gap = 8, pad = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x, y;
  if (node.closest('.map-ctls')) {
    x = r.left - gap - w;
    y = r.top + (r.height - h) / 2;
  } else {
    x = r.left + (r.width - w) / 2;
    y = r.top - gap - h;
    if (y < pad) y = r.bottom + gap;
  }
  x = Math.min(Math.max(pad, x), vw - w - pad);
  y = Math.min(Math.max(pad, y), vh - h - pad);
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  requestAnimationFrame(() => t.classList.add('is-in'));
}

function hide() {
  clearTimeout(timer); timer = null;
  if (target) lastHide = performance.now();
  target = null;
  if (tip) { tip.hidden = true; tip.classList.remove('is-in'); }
}

function arm(node) {
  if (node === target) return;
  hide();
  target = node;
  const warm = performance.now() - lastHide < WARM_MS;
  timer = setTimeout(() => { if (target === node && node.isConnected) show(node); }, warm ? 0 : SHOW_DELAY);
}

export function initTooltips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const node = e.target.closest?.(SELECTOR);
    if (node) arm(node);
  });
  document.addEventListener('pointerout', (e) => {
    if (target && !target.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const node = e.target.closest?.(SELECTOR);
    if (node && node.matches(':focus-visible')) arm(node);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
}
