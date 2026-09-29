/* Map status — the ONE place loading and error states show up.

   A single pill, always at the bottom-centre of the screen — never
   anywhere else, and never nudged sideways by panels; on phones it only
   rises above the bottom sheet. Nothing else lives on that edge (the
   legend is a card off the control column), so the pill has it to
   itself. Everything that waits or fails reports here instead of
   inventing its own spinner, popup or card:

     - the provider (whole map loading → pairs with the skeleton veil)
     - every scene, through ctx.beginLoading / ctx.endLoading / ctx.showError

   Several owners can hold an entry at once (the map is still loading its
   style while a scene already fetches data). Errors win over loading; among
   the same kind the most recent entry wins, and clearing it reveals the one
   underneath. Loading entries are delayed so fast or cached loads never
   flash the pill.

   API:
     setLoading(owner, label, { progress, delay })   progress: 0–1, optional
     setError(owner, message, { detail, onRetry })
     clearStatus(owner, kind?)                       kind: 'loading' | 'error' */

const LOADING_DELAY = 280;

const entries = new Map();   // owner → { loading?: {...}, error?: {...} }
let seq = 0;
let el = null;
let dueTimer = null;
let watching = false;
const observers = [];

function host() {
  if (el) return el;
  const stage = document.getElementById('stage');
  if (!stage) return null;
  el = document.createElement('div');
  el.className = 'map-status';
  el.id = 'map-status';
  el.hidden = true;
  el.innerHTML = `
    <span class="map-status-ico" aria-hidden="true"></span>
    <span class="map-status-text" role="status" aria-live="polite"></span>
    <span class="map-status-actions"></span>
    <span class="map-status-bar" aria-hidden="true"><span></span></span>`;
  el.addEventListener('click', onClick);
  stage.appendChild(el);
  return el;
}

function pick() {
  const now = performance.now();
  let best = null;
  for (const e of entries.values()) {
    for (const s of [e.error, e.loading]) {
      if (!s || s.dueAt > now) continue;
      const rank = (s.kind === 'error' ? 1e9 : 0) + s.seq;
      if (!best || rank > best.rank) best = { ...s, rank };
    }
  }
  return best;
}

function nextDue() {
  const now = performance.now();
  let t = Infinity;
  for (const e of entries.values()) if (e.loading && e.loading.dueAt > now) t = Math.min(t, e.loading.dueAt);
  return t;
}

let shown = null;   // the entry currently rendered

function render() {
  if (dueTimer) { clearTimeout(dueTimer); dueTimer = null; }
  const due = nextDue();
  if (due !== Infinity) dueTimer = setTimeout(render, Math.max(0, due - performance.now()) + 4);

  const node = host();
  if (!node) return;
  const s = pick();
  shown = s;
  if (!s) {
    node.classList.remove('is-in');
    node.hidden = true;
    unwatch();
    return;
  }

  node.classList.toggle('is-error', s.kind === 'error');
  node.classList.toggle('is-loading', s.kind === 'loading');
  const text = node.querySelector('.map-status-text');
  text.setAttribute('role', s.kind === 'error' ? 'alert' : 'status');
  text.innerHTML = `<span class="map-status-msg">${esc(s.message)}</span>`
    + (s.detail ? `<span class="map-status-detail">${esc(s.detail)}</span>` : '');
  node.querySelector('.map-status-actions').innerHTML = s.kind === 'error'
    ? `${s.onRetry ? '<button type="button" class="map-status-btn" data-status="retry">Try again</button>' : ''}
       <button type="button" class="map-status-x" data-status="dismiss" aria-label="Dismiss" title="Dismiss"></button>`
    : '';
  const bar = node.querySelector('.map-status-bar');
  const hasProgress = s.kind === 'loading' && typeof s.progress === 'number';
  bar.classList.toggle('is-determinate', hasProgress);
  bar.firstElementChild.style.width = hasProgress ? `${Math.round(Math.min(1, Math.max(0, s.progress)) * 100)}%` : '';

  if (node.hidden) {
    node.hidden = false;
    place();
    requestAnimationFrame(() => node.classList.add('is-in'));
  } else {
    place();
  }
  watch();
}

function onClick(e) {
  const btn = e.target.closest('[data-status]');
  if (!btn || !shown || shown.kind !== 'error') return;
  const { owner, onRetry } = shown;
  clearStatus(owner, 'error');
  if (btn.dataset.status === 'retry') onRetry?.();
}

/* Dead centre of the map horizontally — the same spot whatever panels
   are open. Symmetric side insets clear the control column on the right
   (and the logo on the left) without shifting the centre. Only the
   height moves: on phones the pill stacks above the bottom control row,
   and above the bottom sheet or the docked side card. Measured live — the sheet drags and resizes. */
function place() {
  if (!el || el.hidden) return;
  const stage = el.parentElement.getBoundingClientRect();
  let bottom = 16;
  if (window.innerWidth <= 720) {
    /* A phone's bottom row (logo, legend pill, zoom) spans the width, so
       the pill stacks one row above it — above the sheet too, where that
       row rides. */
    const ROW = 48;
    bottom += ROW;
    const visible = (node) => node && !node.hidden && node.getClientRects().length > 0 && getComputedStyle(node).display !== 'none';
    const panel = document.getElementById('panel-detail');
    const panelOn = panel?.classList.contains('is-visible') && !panel.classList.contains('is-minimized');
    const side = document.getElementById('map-side');
    for (const node of [panelOn && panel, visible(side) && side]) {
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.top < stage.bottom && r.bottom > stage.top) bottom = Math.max(bottom, Math.round(stage.bottom - r.top) + 12 + ROW);
    }
    if (panel?.classList.contains('is-visible') && panel.classList.contains('is-minimized')) bottom = Math.max(bottom, 68 + ROW);
  }
  el.style.setProperty('--status-b', `${bottom}px`);
}

function watch() {
  if (watching) return;
  watching = true;
  window.addEventListener('resize', place);
  const targets = ['panel-detail', 'map-side'].map(id => document.getElementById(id)).filter(Boolean);
  const ro = new ResizeObserver(() => place());
  const mo = new MutationObserver(() => place());
  for (const t of targets) {
    ro.observe(t);
    mo.observe(t, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  }
  observers.push(ro, mo);
}

function unwatch() {
  if (!watching) return;
  watching = false;
  window.removeEventListener('resize', place);
  for (const o of observers) o.disconnect();
  observers.length = 0;
}

function slot(owner) {
  let e = entries.get(owner);
  if (!e) { e = {}; entries.set(owner, e); }
  return e;
}

/** Show (or update) a loading state. Calling again for the same owner
    updates the label / progress in place without restarting the delay. */
export function setLoading(owner, label = 'Loading…', { progress, delay = LOADING_DELAY } = {}) {
  const e = slot(owner);
  if (e.loading) {
    Object.assign(e.loading, { message: label, progress });
  } else {
    e.loading = { kind: 'loading', owner, message: label, progress, seq: ++seq, dueAt: performance.now() + delay };
  }
  render();
}

/** Show an error. `onRetry` adds a "Try again" button; every error can be
    dismissed. An error replaces the same owner's loading state. */
export function setError(owner, message, { detail, onRetry } = {}) {
  const e = slot(owner);
  delete e.loading;
  e.error = { kind: 'error', owner, message, detail, onRetry, seq: ++seq, dueAt: 0 };
  render();
}

/** Drop an owner's loading and/or error entry. */
export function clearStatus(owner, kind) {
  const e = entries.get(owner);
  if (!e) return;
  if (!kind || kind === 'loading') delete e.loading;
  if (!kind || kind === 'error') delete e.error;
  if (!e.loading && !e.error) entries.delete(owner);
  render();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
