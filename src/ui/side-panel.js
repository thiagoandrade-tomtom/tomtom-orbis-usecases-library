/* Scene side panel — phone chrome.

   On a phone the side card shares a short strip of map with the controls.
   map.css caps it at the card's head and lets the rest scroll; this adds
   the two bits the CSS can't do on its own:

   - Show / hide. A round list button at the top of the control column
     tucks the whole card away and brings it back. It only exists while a
     scene has a card to show, and the choice is remembered for the
     session (like the legend's) so it carries across selections and
     cases.
   - Scroll cue. The scrollbar is hidden, so `.can-scroll` switches on a
     fade along the bottom edge while there's more content below.

   Desktop and the live view are untouched: the button and the fade are
   gated on the phone breakpoint in map.css, and never shown on air. */

const HIDDEN = 'side-hidden';

function readHidden() {
  try { return sessionStorage.getItem(HIDDEN) === '1'; } catch { return false; }
}
function writeHidden(on) {
  try { sessionStorage.setItem(HIDDEN, on ? '1' : '0'); } catch {}
}

const LIST = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="6" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="5" cy="18" r="2"/></g><path fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" d="M10 6h10M10 12h10M10 18h10"/></svg>';

let toggle = null;

function syncScroll(host) {
  host.classList.toggle('can-scroll', host.scrollTop + host.clientHeight < host.scrollHeight - 2);
}

function sync(host) {
  const hidden = readHidden();
  host.classList.toggle('is-tucked', hidden);
  if (toggle) {
    toggle.hidden = host.hidden;
    const label = hidden ? 'Show panel' : 'Hide panel';
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(!hidden));
  }
  syncScroll(host);
}

/* Mounted once. The button follows the host's `hidden` attribute, so a
   scene clearing its panel (or teardown) hides it too; the scroll cue
   follows scrolling and any change in the card's size. */
function mount(host) {
  if (toggle) return;
  const ctls = document.querySelector('.map-ctls');
  if (!ctls) return;
  toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fab side-toggle';
  toggle.setAttribute('aria-controls', host.id);
  toggle.innerHTML = LIST;
  toggle.addEventListener('click', () => {
    writeHidden(!readHidden());
    sync(host);
  });
  ctls.prepend(toggle);
  new MutationObserver(() => sync(host)).observe(host, { attributes: true, attributeFilter: ['hidden'] });
  new ResizeObserver(() => syncScroll(host)).observe(host);
  host.addEventListener('scroll', () => syncScroll(host), { passive: true });
}

/** Apply the phone show / hide state and scroll cue to freshly rendered
    side-panel HTML. Call after every render. */
export function decorateSidePanel(host) {
  mount(host);
  sync(host);
}
