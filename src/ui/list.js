/* Left rail: category chips + use-case rows. */
import { USE_CASES, primaryToolFor, toolLabel } from '../data/use-cases.js';
import { filteredCases, state } from '../state.js';
import { thumbFor } from '../render/thumbs.js';

let _onSelect;

export function bindList({ onSelect }) {
  _onSelect = onSelect;
  renderCategoryChips();
  renderCaseList();
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/* One list card. Two facts: what you get (`blurb`) and which API it
   advertises (`primaryTool`).

   Build time is deliberately absent. It was here as a clock badge, but
   it read as a duration on the map rather than time-to-implement, and
   spelled out ("Build in ~2 min") it crowded the tag off the line at
   narrow rail widths for a fact that doesn't decide a click. It stays
   in the detail header, where the agent prompt it refers to also lives.

   The category badge deliberately does NOT appear here — it is already
   the filter above the list and the first badge in the detail header,
   and next to a tag like "Routing API" it read as an echo. The tag
   reuses the Tools & APIs name typography from the detail panel so the
   same API looks the same on both surfaces; only the corner radius
   differs, because the card tag is static text while the detail chips
   are links. It never carries a padlock: `primaryToolFor` won't return
   a gated API, so the card always advertises something the reader can
   actually call. */
function caseRow(uc) {
  const active = uc.id === state.selectedId;
  const tool   = primaryToolFor(uc);

  /* Tooltip carries the full name — the pill may show a shortened label. */
  const tag = tool
    ? `<span class="case-tag" title="${esc(tool.name)}"><span class="case-tag-name">${esc(toolLabel(tool.name))}</span></span>`
    : '';

  const blurb = uc.blurb
    ? `<p class="case-blurb" title="${esc(uc.blurb)}">${esc(uc.blurb)}</p>`
    : '';

  return `
    <li class="case-row ${active ? 'is-active' : ''}" data-id="${uc.id}" role="option" tabindex="0" aria-selected="${active}">
      <div class="thumb">${thumbFor(uc)}</div>
      <div class="case-meta">
        <div class="case-title">${esc(uc.title)}</div>
        ${blurb}
        <div class="case-facts">${tag}</div>
      </div>
    </li>
  `;
}

export function renderCaseList() {
  const list  = document.getElementById('case-list');
  const empty = document.getElementById('empty-state');
  const items = filteredCases();
  document.getElementById('case-count').textContent = items.length;

  list.innerHTML = items.map(uc => caseRow(uc)).join('');

  empty.hidden = items.length > 0;
  list.querySelectorAll('.case-row').forEach(row => {
    const activate = () => _onSelect(Number(row.dataset.id));
    row.addEventListener('click', activate);
    /* Keyboard a11y: Tab moves between rows (tabindex=0), Enter/Space
       activates — same vocabulary as a native listbox option. */
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });
}

export function renderCategoryChips() {
  const wrap = document.getElementById('cat-chips');
  const cats = ['all', ...Array.from(new Set(USE_CASES.map(u => u.category)))];
  wrap.innerHTML = cats.map(c =>
    `<button class="chip ${state.category === c ? 'is-active' : ''}" data-value="${c}" type="button">${c === 'all' ? 'All' : c}</button>`
  ).join('');
  wrap.querySelectorAll('.chip').forEach(b => {
    b.addEventListener('click', () => {
      /* Click the already-active chip → fall back to "All". Feels more
         like a toggle and matches what users expect from a filter pill. */
      const next = b.dataset.value === state.category ? 'all' : b.dataset.value;
      state.category = next;
      renderCategoryChips();
      renderCaseList();
    });
  });
}
