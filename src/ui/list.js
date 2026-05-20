/* Left rail: category chips + use-case rows. */
import { USE_CASES, etaFor } from '../data/use-cases.js';
import { filteredCases, state } from '../state.js';
import { thumbFor } from '../render/thumbs.js';

let _onSelect;

export function bindList({ onSelect }) {
  _onSelect = onSelect;
  renderCategoryChips();
  renderCaseList();
}

export function renderCaseList() {
  const list  = document.getElementById('case-list');
  const empty = document.getElementById('empty-state');
  const items = filteredCases();
  document.getElementById('case-count').textContent = items.length;

  list.innerHTML = items.map(uc => `
    <li class="case-row ${uc.id === state.selectedId ? 'is-active' : ''}" data-id="${uc.id}" role="option" aria-selected="${uc.id === state.selectedId}">
      <div class="thumb">${thumbFor(uc)}</div>
      <div class="case-meta">
        <div class="case-title">${uc.title}</div>
        <span class="case-cat">${uc.category}</span>
        <div class="case-eta">
          <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z"/></svg>
          <span>${etaFor(uc)}</span>
        </div>
      </div>
      <svg class="case-arrow" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6"/></svg>
    </li>
  `).join('');

  empty.hidden = items.length > 0;
  list.querySelectorAll('.case-row').forEach(row => {
    row.addEventListener('click', () => _onSelect(Number(row.dataset.id)));
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
      state.category = b.dataset.value;
      renderCategoryChips();
      renderCaseList();
    });
  });
}
