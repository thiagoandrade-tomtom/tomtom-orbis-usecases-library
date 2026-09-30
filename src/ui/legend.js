/* Map legend — a "Legend" pill on the bottom row, just left of the zoom
   buttons, that opens a small card upwards. The pill previews up to three of the
   legend's own colours, so it says what it is and that there's something
   behind it without a cryptic icon. Every scene's legend renders the same way: an
   optional title, then one row per item (swatch + label), stacked. No more
   bottom-edge strip that grows into a sausage when a scene has a lot to say.

   Collapsed by default; the open / closed choice is remembered for the
   session so someone who wants it pinned keeps it pinned across cases.
   Scenes don't call this directly — they use ctx.setLegend. */

const KEY = 'legend-open';
// The phone's icon-only button: an "i" reads as "what am I looking at?"
// more readily than the colour dots, which stay on the desktop pill.
const INFO_ICO = '<svg class="legend-toggle-ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.75"/><circle cx="12" cy="7.75" r="1.6" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" d="M12 11.5v5.5"/></svg>';
let btn = null;
let card = null;

function readOpen() {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}
function writeOpen(open) {
  try { sessionStorage.setItem(KEY, open ? '1' : '0'); } catch {}
}

function mount() {
  if (btn) return true;
  const ctls = document.querySelector('.map-ctls');
  card = document.getElementById('map-legend');
  if (!ctls || !card) return false;

  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'legend-toggle';
  btn.id = 'legend-toggle';
  btn.hidden = true;
  btn.title = 'Legend';   // icon-only on phones — the themed tooltip names it
  btn.setAttribute('aria-controls', 'map-legend');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => setOpen(card.hidden));

  // Docked to the control column (absolute, left of it, bottom-aligned) so
  // it rides with the column: lifted above the bottom sheet on phones,
  // inside the map cell in the split shell. On phones it joins the column
  // as a round button at the top instead (map.css).
  const dock = document.createElement('div');
  dock.className = 'legend-dock';
  dock.append(card, btn);
  ctls.appendChild(dock);
  card.classList.add('map-legend--card');
  card.addEventListener('click', (e) => { if (e.target.closest('[data-legend-close]')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) { setOpen(false); btn.focus(); }
  });
  return true;
}

function setOpen(open) {
  if (!btn || !card.innerHTML) return;
  card.hidden = !open;
  btn.classList.toggle('is-active', open);
  btn.setAttribute('aria-expanded', String(open));
  writeOpen(open);
}

function swatchFor(it) {
  if (it.html) return it.html;
  if (it.gradient) {
    const [a, b] = it.gradient;
    return `<span class="map-legend-swatch bar" style="background:linear-gradient(90deg, ${a} 0%, ${b} 100%);color:transparent;"></span>`;
  }
  if (it.color) {
    const shape = it.shape === 'dot' ? 'dot' : it.shape === 'bar' ? 'bar' : '';
    return `<span class="map-legend-swatch ${shape}" style="color:${it.color}"></span>`;
  }
  return '<span class="map-legend-swatch is-empty"></span>';
}

/** Render a legend. Items: { color, shape?: 'dot'|'bar'|'square', label }
    | { gradient: [a, b], label } | { html, label }. Empty items hide it. */
export function renderLegend({ title, items } = {}) {
  if (!mount()) return;
  if (!items || items.length === 0) { clearLegend(); return; }
  card.innerHTML = `
    <div class="map-legend-head">
      <span class="map-legend-title">${title || 'Legend'}</span>
      <button type="button" class="map-legend-x" data-legend-close aria-label="Close legend" title="Close legend"></button>
    </div>
    <ul class="map-legend-list">${items.map(it =>
      `<li class="map-legend-item">${swatchFor(it)}<span>${it.label}</span></li>`).join('')}</ul>`;
  const colors = items.map(it => it.gradient ? `linear-gradient(90deg, ${it.gradient[0]}, ${it.gradient[1]})` : it.color)
    .filter(c => c && c !== 'transparent').slice(0, 3);
  btn.innerHTML = `${colors.length ? `<span class="legend-toggle-dots" aria-hidden="true">${colors
    .map(c => `<span style="background:${c}"></span>`).join('')}</span>` : ''}${INFO_ICO}<span>Legend</span>`;
  btn.hidden = false;
  setOpen(readOpen());
}

export function clearLegend() {
  if (!btn) return;
  card.innerHTML = '';
  card.hidden = true;
  btn.hidden = true;
  btn.classList.remove('is-active');
  btn.setAttribute('aria-expanded', 'false');
}
