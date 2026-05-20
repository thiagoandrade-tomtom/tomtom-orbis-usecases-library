/* Topbar wiring: theme toggle, search input, ⌘K shortcut, mega menu open/close. */
import { state } from '../state.js';
import { renderCaseList, renderCategoryChips } from './list.js';

let _onThemeChange;

export function bindTopbar({ onThemeChange }) {
  _onThemeChange = onThemeChange;

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('orbis-theme', next); } catch {}
    _onThemeChange?.(next);
  });

  const search = document.getElementById('search');
  const menu   = document.getElementById('mega-menu');

  const openMenu = openMegaMenu;

  search.addEventListener('focus', openMenu);
  search.addEventListener('input', () => {
    state.query = search.value;
    renderCaseList();
    openMenu();
  });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      search.focus(); search.select();
    }
    if (e.key === 'Escape') closeMegaMenu();
  });

  // Close on click outside topbar trigger + menu.
  // Also exempt the explore button so its own click handler can do its toggle
  // without us closing the menu out from under it first.
  document.addEventListener('pointerdown', e => {
    if (menu.contains(e.target)) return;
    if (e.target.closest('#mega-trigger')) return;
    if (e.target.closest('#explore-btn')) return;
    closeMegaMenu();
  });

  document.getElementById('explore-btn').addEventListener('click', () => {
    /* Toggle: if menu is open, close it; otherwise focus the search and open. */
    if (menu.classList.contains('is-open')) {
      closeMegaMenu();
      search.blur();
      return;
    }
    search.focus();
    openMenu();
  });

  bindDragScroll(document.getElementById('cat-chips'));

  document.getElementById('empty-reset')?.addEventListener('click', () => {
    state.category = 'all';
    state.query = '';
    search.value = '';
    renderCategoryChips();
    renderCaseList();
  });
}

/* Click-and-drag horizontal scroll for a row of chips/tags.
   Native trackpad scroll already works; this adds mouse-drag support for
   small desktops where the user can't fit all chips in view. Movement is
   gated by a small threshold so taps/clicks on chips still fire. */
function bindDragScroll(el) {
  if (!el) return;
  const THRESHOLD = 5;
  let pointerId = null;
  let startX = 0;
  let startScroll = 0;
  let dragging = false;

  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;     // touch already scrolls natively
    pointerId = e.pointerId;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    dragging = false;
  });

  el.addEventListener('pointermove', e => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!dragging && Math.abs(dx) < THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      try { el.setPointerCapture(pointerId); } catch {}
      el.style.cursor = 'grabbing';
    }
    el.scrollLeft = startScroll - dx;
  });

  function endDrag(e) {
    if (e.pointerId !== pointerId) return;
    if (dragging) {
      try { el.releasePointerCapture(pointerId); } catch {}
      el.style.cursor = '';
      /* Swallow the click that follows a real drag so chips don't activate. */
      const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); el.removeEventListener('click', swallow, true); };
      el.addEventListener('click', swallow, true);
    }
    pointerId = null;
    dragging = false;
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
}

export function openMegaMenu() {
  const menu   = document.getElementById('mega-menu');
  const search = document.getElementById('search');
  menu?.classList.add('is-open');
  menu?.removeAttribute('aria-hidden');
  search?.setAttribute('aria-expanded', 'true');
}

export function closeMegaMenu() {
  const menu   = document.getElementById('mega-menu');
  const search = document.getElementById('search');
  menu?.classList.remove('is-open');
  menu?.setAttribute('aria-hidden', 'true');
  search?.setAttribute('aria-expanded', 'false');
}
