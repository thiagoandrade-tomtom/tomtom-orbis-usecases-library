/* Detail panel — info about the currently selected use case. */
import { accentClass, TOOL_DOCS, etaFor } from '../data/use-cases.js';
import { getSelected, paramFor, state, onDynamicParams, basemapFor, setBasemapOverride } from '../state.js';
import { filesFor } from '../render/snippets.js';
import { promptFor } from '../render/prompts.js';
import { showPanel } from './panel.js';
import { geocode } from '../map/services.js';

let _onParamChange;
let _onBasemapChange;
let _provider;
export function bindDetail({ onParamChange, onBasemapChange, provider } = {}) {
  _onParamChange = onParamChange;
  _onBasemapChange = onBasemapChange;
  _provider = provider;
}

/* Basemap families exposed in the Configure panel. `hint` annotates
   options with a caveat the user benefits from seeing up front. */
const BASEMAP_OPTIONS = [
  { value: 'standard',  label: 'Standard'  },
  { value: 'driving',   label: 'Driving'   },
  { value: 'mono',      label: 'Mono'      },
  { value: 'satellite', label: 'Satellite', hint: 'no dark' },
];

/** Live snapshot of style/center/zoom — feeds the snippet + prompt so
    "copy & run" matches what the developer is seeing on the map. */
function currentView() {
  return _provider?.getCurrentView?.() || null;
}

/* Set by the most recent renderDetail() so external triggers (theme
   toggle, camera moves) can refresh the snippet's live tokens without
   re-rendering the whole panel. */
let _refreshLiveTokens = null;
export function refreshDetailLiveTokens() {
  _refreshLiveTokens?.();
}

/* Single 3-way toggle replaces the old Prompt/Code tabs. Order is
   fixed; the leftmost option ("agent") is the default — that's the
   recommended entry into Map Agent / Claude Code. Persisted so
   the user's choice survives across use case selections. */
let _quickMode = 'agent';      // 'agent' | 'plain' | 'code'

/* Active file tab within Code mode. Persisted across case selections
   like _quickMode; renderQuickBody falls back to the case's first file
   when this name isn't present in the current case's file set. */
let _quickFile = 'app.js';

const MAP_CHAT_AGENT_URL = 'https://docs.tomtom.com/maps-sdk-js/examples/map-chat-agent-react';

const escAttr = s => String(s).replace(/[&<>"]/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
}[c]));

const escText = s => String(s).replace(/[&<>]/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;'
}[c]));

/* ---------- Quickstart mode toggle ---------------------------------- */

/* One pill, three modes — order fixed; the leftmost is the default.
   Agent-ready and Plain spec render a prompt; Code renders the
   copy-pasteable starter snippet. */
const QUICK_MODES = [
  { key: 'agent', label: 'Agent-ready' },
  { key: 'plain', label: 'Specs'       },
  { key: 'code',  label: 'Code'        },
];
function quickSeg(active) {
  const opts = QUICK_MODES.map(m =>
    `<button class="dd-seg-opt ${m.key === active ? 'is-active' : ''}" data-mode="${m.key}" type="button">${m.label}</button>`
  ).join('');
  return `<div class="dd-seg dd-seg--quick" role="tablist">${opts}</div>`;
}

/* Body content swaps based on which pill is active. Agent-ready and
   Plain spec show the prompt; Code shows the starter snippet. The
   "Open in Map Agent" CTA only appears for prompt modes — opening
   that example with a Code payload would just be confusing. */
/* Action toolbar lives INSIDE the <pre> as a sticky bar at the top of
   the snippet — keeps the actions glued to the content they apply to,
   and on long prompts the bar stays in view while you scroll. */
const SPARKLE_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path fill="currentColor" d="M6.2931 3.60163C6.44574 3.13752 7.10227 3.13752 7.2549 3.60162L8.44816 7.22986C8.49839 7.38259 8.61818 7.50238 8.7709 7.55261L12.3991 8.74586C12.8633 8.8985 12.8633 9.55503 12.3991 9.70767L8.7709 10.9009C8.61818 10.9512 8.49839 11.0709 8.44816 11.2237L7.2549 14.8519C7.10227 15.316 6.44574 15.316 6.2931 14.8519L5.09984 11.2237C5.04961 11.0709 4.92983 10.9512 4.7771 10.9009L1.14886 9.70767C0.684755 9.55503 0.684754 8.8985 1.14886 8.74586L4.7771 7.55261C4.92983 7.50238 5.04961 7.38259 5.09984 7.22986L6.2931 3.60163Z"/>
  <path fill="currentColor" d="M11.8499 1.18996C11.9726 0.669995 12.7127 0.669996 12.8354 1.18996L13.1406 2.48368C13.1847 2.67034 13.3304 2.81608 13.5171 2.86013L14.8108 3.16541C15.3308 3.2881 15.3308 4.02813 14.8108 4.15082L13.5171 4.4561C13.3304 4.50015 13.1847 4.64589 13.1406 4.83255L12.8354 6.12627C12.7127 6.64624 11.9726 6.64623 11.8499 6.12627L11.5447 4.83255C11.5006 4.64589 11.3549 4.50015 11.1682 4.4561L9.8745 4.15082C9.35453 4.02813 9.35453 3.2881 9.8745 3.16541L11.1682 2.86013C11.3549 2.81608 11.5006 2.67034 11.5447 2.48368L11.8499 1.18996Z"/>
</svg>`;
const COPY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 3h9a2 2 0 0 1 2 2v12M7 7h9a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/></svg>`;

function snipToolbar(mode) {
  const copyBtn = `<button class="dd-agent-link" type="button" data-action="copy-current" aria-label="Copy" title="Copy">${COPY_SVG}<span>Copy</span></button>`;
  if (mode === 'code') return `<div class="dd-snip-tools dd-snip-tools--solo">${copyBtn}</div>`;
  return `<div class="dd-snip-tools">
    <button class="dd-agent-link dd-agent-link--main" type="button" data-action="open-map-chat-agent">
      ${SPARKLE_SVG}
      <span>Send to Map Agent</span>
    </button>
    ${copyBtn}
  </div>`;
}

/* File picker for the Code mode toolbar — a dropdown rather than a tab
   strip, so a long file set never needs horizontal scrolling. Changing
   it is handled by the delegated root `change` listener. */
function fileSelect(files, activeName) {
  const opts = files.map(f =>
    `<option value="${escAttr(f.name)}"${f.name === activeName ? ' selected' : ''}>${escAttr(f.name)}</option>`
  ).join('');
  return `<span class="dd-snip-fileselect">
    <select data-file-select aria-label="File">${opts}</select>
    <svg class="dd-cfg-chev" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
  </span>`;
}

function renderQuickBody(uc, mode, view) {
  /* Toolbar sits ABOVE the <pre> as a sibling — not inside it — so
     horizontal scrolling in the code stays contained and the bar
     never drifts. */
  if (mode === 'code') {
    const files = filesFor(uc, view);
    const active = files.find(f => f.name === _quickFile) || files[0];
    const copyBtn = `<button class="dd-agent-link" type="button" data-action="copy-current" aria-label="Copy" title="Copy">${COPY_SVG}<span>Copy</span></button>`;
    const picker = files.length > 1 ? fileSelect(files, active.name) : '';
    return `<div class="dd-snippet">
      <div class="dd-snip-tools dd-snip-tools--code">${picker}${copyBtn}</div>
      <pre class="dd-snippet-pre"><code>${active.html}</code></pre>
    </div>`;
  }
  return `<div class="dd-snippet dd-snippet--prompt">${snipToolbar(mode)}<pre class="dd-snippet-pre"><code data-prompt-body>${escText(promptFor(uc, mode, view))}</code></pre></div>`;
}

/* ---------- Configure controls -------------------------------------- */

/* Order a chip rail so currently-active categories sort first, then the
   rest alphabetically — the list leads with what the map is actually
   showing. Ties break by label. Sort runs at RENDER time only (toggling a
   chip just flips its state in place, it does not re-render), so chips
   never jump around under the user's cursor mid-click. */
function sortChipsActiveFirst(opts, selected) {
  return [...opts].sort((a, b) => {
    const da = selected.has(a.value), db = selected.has(b.value);
    if (da !== db) return da ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

function configControl(uc, p) {
  const value = paramFor(uc, p.key);
  const type = p.type || 'text';
  if (type === 'chips') {
    // Chip rail — options can be either static (declared in use-cases.js)
    // or dynamic (pushed at runtime by the scene via setDynamicOptions,
    // which is what the POI case does once the basemap renders and we
    // know which categories are actually present in view).
    const opts = state.dynamicParams[uc.id]?.[p.key] || p.options || [];
    const selected = Array.isArray(value) ? new Set(value) : new Set(opts.map(o => o.value));
    const chips = sortChipsActiveFirst(opts, selected).map(o => {
      const on = selected.has(o.value);
      const icon = on
        ? `<svg class="dd-cfg-chip-ico" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5L20 7"/></svg>`
        : `<svg class="dd-cfg-chip-ico" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M6 12h12"/></svg>`;
      return `<button type="button" class="dd-cfg-chip${on ? ' is-on' : ''}" data-chip-value="${escAttr(o.value)}">${icon}<span class="dd-cfg-chip-label">${escAttr(o.label)}</span></button>`;
    }).join('');
    return `<div class="dd-cfg-row dd-cfg-row--chips" data-key="${escAttr(p.key)}" data-type="chips">
      <span class="dd-cfg-label">${escAttr(p.label)}</span>
      <div class="dd-cfg-chips" data-chip-rail>${chips || '<span class="dd-cfg-chips-empty">Loading…</span>'}</div>
    </div>`;
  }
  if (type === 'select') {
    const opts = (p.options || []).map(o =>
      `<option value="${escAttr(o.value)}"${o.value === value ? ' selected' : ''}>${escAttr(o.label)}</option>`
    ).join('');
    return `<label class="dd-cfg-row">
      <span class="dd-cfg-label">${escAttr(p.label)}</span>
      <span class="dd-cfg-select">
        <select class="dd-cfg-ctrl" data-key="${escAttr(p.key)}" data-type="select">${opts}</select>
        <svg class="dd-cfg-chev" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
      </span>
    </label>`;
  }
  if (type === 'combobox') {
    // Free-text combobox: shows the param's static `options` when the
    // input is empty, and switches to live geocoded suggestions while
    // typing (when `search: 'city'` is set). The stored value is either
    // a static option's `value` (preset) or the user-picked label
    // verbatim (custom search). Scenes resolve it accordingly.
    const presetLabel = (p.options || []).find(o => o.value === value)?.label;
    const displayValue = presetLabel ?? (value ?? '');
    const placeholder = p.placeholder || 'Search or pick…';
    return `<label class="dd-cfg-row dd-cfg-row--combobox">
      <span class="dd-cfg-label">${escAttr(p.label)}</span>
      <span class="dd-cfg-combobox" data-combo-root>
        <input class="dd-cfg-ctrl dd-cfg-combo-input"
          type="search"
          role="combobox"
          aria-expanded="false"
          autocomplete="off"
          spellcheck="false"
          data-key="${escAttr(p.key)}"
          data-type="combobox"
          data-search="${escAttr(p.search || '')}"
          value="${escAttr(displayValue)}"
          placeholder="${escAttr(placeholder)}" />
        <svg class="dd-cfg-chev" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
        <div class="dd-cfg-combo-pop" data-combo-pop hidden role="listbox"></div>
      </span>
    </label>`;
  }
  if (type === 'toggle') {
    const checked = value === true || value === 'true' ? 'checked' : '';
    return `<label class="dd-cfg-row dd-cfg-row--toggle">
      <span class="dd-cfg-label">${escAttr(p.label)}</span>
      <span class="dd-cfg-switch">
        <input type="checkbox" class="dd-cfg-ctrl" data-key="${escAttr(p.key)}" data-type="toggle" ${checked} />
        <span class="dd-cfg-switch-track"><span class="dd-cfg-switch-thumb"></span></span>
      </span>
    </label>`;
  }
  if (type === 'color') {
    const hex = String(value ?? '#000000');
    return `<label class="dd-cfg-row dd-cfg-row--color">
      <span class="dd-cfg-label">${escAttr(p.label)}</span>
      <span class="dd-cfg-color">
        <input type="color" class="dd-cfg-ctrl dd-cfg-color-input" data-key="${escAttr(p.key)}" data-type="color" value="${escAttr(hex)}" />
        <span class="dd-cfg-color-hex" data-color-hex>${escAttr(hex.toUpperCase())}</span>
      </span>
    </label>`;
  }
  if (type === 'number') {
    return `<label class="dd-cfg-row">
      <span class="dd-cfg-label">${escAttr(p.label)}</span>
      <input type="number" class="dd-cfg-ctrl dd-cfg-input" data-key="${escAttr(p.key)}" data-type="number"
        value="${escAttr(value ?? '')}"
        ${p.min !== undefined ? `min="${p.min}"` : ''}
        ${p.max !== undefined ? `max="${p.max}"` : ''}
        ${p.step !== undefined ? `step="${p.step}"` : ''} />
    </label>`;
  }
  // text (default)
  return `<label class="dd-cfg-row">
    <span class="dd-cfg-label">${escAttr(p.label)}</span>
    <input type="text" class="dd-cfg-ctrl dd-cfg-input" data-key="${escAttr(p.key)}" data-type="text"
      value="${escAttr(value ?? '')}" spellcheck="false" autocomplete="off" />
  </label>`;
}

function basemapRow(uc) {
  const defaultFamily = uc.mapStyle || 'standard';
  const active = basemapFor(uc);
  /* Annotate options inline: the author's pick gets "· default" and
     satellite carries its own "· no dark" caveat. If a row is both
     (case authored on satellite), satellite's hint wins because it's
     the more actionable warning. */
  const opts = BASEMAP_OPTIONS.map(opt => {
    const isDefault = opt.value === defaultFamily;
    const hintText  = opt.hint || (isDefault ? 'default' : '');
    const label     = hintText ? `${opt.label} · ${hintText}` : opt.label;
    return `<option value="${opt.value}"${opt.value === active ? ' selected' : ''}>${label}</option>`;
  }).join('');
  return `
    <label class="dd-cfg-row dd-cfg-row--basemap">
      <span class="dd-cfg-label">Basemap</span>
      <span class="dd-cfg-select">
        <select class="dd-cfg-ctrl" data-basemap-select>${opts}</select>
        <svg class="dd-cfg-chev" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
      </span>
    </label>`;
}

function configSection(uc) {
  const basemap = basemapRow(uc);
  const params  = (uc.params || []).map(p => configControl(uc, p)).join('');
  /* Basemap is universal — every case gets the picker even when it
     declared no tunable params.

     Apply/Reset footer: edits stage into state without touching the
     map. Apply re-runs the scene once; Reset clears every override and
     restores the case author's defaults. Apply starts disabled and
     flips on as soon as something is dirty. */
  return `
    <details class="dd-section dd-collapse" open>
      <summary>
        <h4>Configure</h4>
        <svg class="dd-collapse-chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
      </summary>
      <div class="dd-cfg-grid">${params}${basemap}</div>
      <div class="dd-cfg-actions">
        <button type="button" class="dd-cfg-btn dd-cfg-btn--reset" data-cfg-reset>Reset</button>
        <button type="button" class="dd-cfg-btn dd-cfg-btn--apply" data-cfg-apply disabled>Apply</button>
      </div>
    </details>
  `;
}

/* ---------- Render -------------------------------------------------- */

export function renderDetail() {
  const uc = getSelected();
  if (!uc) return;
  const ax = accentClass(uc.accent);
  /* Tags were removed from the header — the category badge + the
     description already cover scanning needs. The data stays on the
     use case object for the mega-menu search. */
  const toolsHTML = uc.tools.map(t => {
    const href = t.docs || TOOL_DOCS[t.name];
    const inner = `
      <svg class="dd-tool-ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 3h8l5 5v13H6V3z"/>
        <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14 3v5h5"/>
        <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 13h7M9 17h5"/>
      </svg>
      <div class="meta">
        <span class="dd-tool-name">${t.name}</span>
        <span class="dd-tool-type">${t.type}</span>
      </div>
      <svg class="link-ico" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M10 14 20 4M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></svg>`;
    return href
      ? `<a class="dd-tool dd-tool--link" href="${escAttr(href)}" target="_blank" rel="noopener">${inner}</a>`
      : `<div class="dd-tool">${inner}</div>`;
  }).join('');

  const eta = etaFor(uc);

  const handleTitle = document.getElementById('panel-handle-title');
  if (handleTitle) handleTitle.textContent = uc.title;

  const root = document.getElementById('detail-content');
  root.innerHTML = `
    <div class="dd-body">
      <div class="dd-head">
        <div class="dd-head-top">
          <div class="dd-head-badges">
            <span class="badge accent-${uc.accent}">${uc.category}</span>
            <span class="badge badge-eta" tabindex="0"
                  data-tooltip="Estimated implementation time using the agent prompt or starter code below."
                  aria-label="Average time to get this project working: ${eta}">
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m9 8-5 4 5 4M15 8l5 4-5 4"/></svg>
              <span>${eta}</span>
            </span>
          </div>
        </div>
        <p class="dd-desc">${uc.description}</p>
      </div>

      ${configSection(uc)}

      <details class="dd-section dd-collapse" open>
        <summary>
          <h4>Quickstart</h4>
          <svg class="dd-collapse-chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
        </summary>

        ${quickSeg(_quickMode)}
        <div class="dd-quick-body" data-quick-body>
          ${renderQuickBody(uc, _quickMode, currentView())}
        </div>
      </details>

      <details class="dd-section dd-collapse" open>
        <summary>
          <h4>Tools &amp; APIs · ${uc.tools.length}</h4>
          <svg class="dd-collapse-chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
        </summary>
        <div class="dd-tool-list">${toolsHTML}</div>
      </details>
    </div>
  `;

  /* All Quickstart interactions go through one delegated click handler
     on root. The quick-body subtree is replaced wholesale whenever the
     active mode changes, so per-node listeners would leak. */
  const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7"/></svg>';
  const flashCopy = (btn, message) => {
    btn.dataset.orig = btn.dataset.orig || btn.innerHTML;
    btn.innerHTML = `${CHECK_ICON}<span>${message}</span>`;
    btn.classList.add('is-copied');
    setTimeout(() => {
      btn.innerHTML = btn.dataset.orig;
      btn.classList.remove('is-copied');
    }, 1600);
  };

  const refreshPromptBody = () => {
    /* Agent/Plain modes render a <code data-prompt-body>; on Code mode
       there's no prompt body to update. */
    const body = root.querySelector('[data-prompt-body]');
    if (body && _quickMode !== 'code') {
      body.textContent = promptFor(uc, _quickMode, currentView());
    }
  };

  /* One delegated click handler for all Quickstart interactions, bound
     ONCE per #detail-content element. renderDetail() runs on every case
     switch (and on Reset), so binding here unconditionally would stack a
     fresh listener each time — copy would fire N times, the CTA would
     open N tabs. The handler is self-contained: it resolves the current
     case via getSelected() rather than closing over a stale `uc`. */
  if (!root.dataset.quickBound) {
    root.dataset.quickBound = '1';
    root.addEventListener('click', e => {
      const cur = getSelected();
      if (!cur) return;

      /* Mode toggle (Agent-ready / Specs / Code) — fixed order, no
         reorder on click. */
      const modeBtn = e.target.closest('.dd-seg-opt[data-mode]');
      if (modeBtn) {
        const next = modeBtn.dataset.mode;
        if (next === _quickMode) return;
        _quickMode = next;
        root.querySelectorAll('.dd-seg--quick .dd-seg-opt').forEach(o =>
          o.classList.toggle('is-active', o.dataset.mode === _quickMode));
        const slot = root.querySelector('[data-quick-body]');
        if (slot) slot.innerHTML = renderQuickBody(cur, _quickMode, currentView());
        return;
      }

      /* Copy icon inside the snippet's sticky toolbar — copies whatever
         prompt/code is currently rendered. */
      const copyBtn = e.target.closest('[data-action="copy-current"]');
      if (copyBtn) {
        const code = copyBtn.closest('.dd-snippet')?.querySelector('code');
        const text = code ? code.innerText : '';
        navigator.clipboard?.writeText(text)
          .then(() => flashCopy(copyBtn, 'Copied'))
          .catch(() => {});
        return;
      }

      /* Map Agent primary CTA — copy prompt, then open the example
         in a new tab so the developer pastes into a working harness. */
      const mcaBtn = e.target.closest('[data-action="open-map-chat-agent"]');
      if (mcaBtn) {
        const text = promptFor(cur, _quickMode, currentView());
        navigator.clipboard?.writeText(text)
          .then(() => flashCopy(mcaBtn, 'Copied — opening Map Agent'))
          .catch(() => {});
        window.open(MAP_CHAT_AGENT_URL, '_blank', 'noopener');
        return;
      }
    });

    /* File dropdown inside the Code snippet — swap which authored file
       is shown. Delegated `change` so it survives the body re-render. */
    root.addEventListener('change', e => {
      const sel = e.target.closest('[data-file-select]');
      if (!sel) return;
      const cur = getSelected();
      if (!cur || sel.value === _quickFile) return;
      _quickFile = sel.value;
      const slot = root.querySelector('[data-quick-body]');
      if (slot) slot.innerHTML = renderQuickBody(cur, _quickMode, currentView());
    });
  }

  // Wire Configure controls. Each writes the typed value into
  // state.sceneParams and refreshes the read-only tokens in the code
  // snippet — but the map only re-runs when the user clicks Apply.
  // `pendingBasemap` stages the basemap pick the same way; `dirty`
  // tracks whether anything is waiting to be applied.
  let pendingBasemap = basemapFor(uc);
  let dirty = false;
  const applyBtn = () => root.querySelector('[data-cfg-apply]');
  const markDirty = () => {
    dirty = true;
    const btn = applyBtn();
    if (btn) btn.disabled = false;
  };
  const refreshSnippetTokens = () => {
    const view = currentView() || {};
    const lineStyle = paramFor(uc, 'lineStyle') || paramFor(uc, 'strokeStyle') || paramFor(uc, 'geofenceStyle');
    const dasharray =
      lineStyle === 'dashed' ? '[2, 1.5]' :
      lineStyle === 'dotted' ? '[0.1, 1.6]' :
      'null';
    const PALETTES = {
      'amber-red':   { from: '#DBA43A', mid: '#E8842F', warm: '#EE6748', hot: '#EE6748', low: '#DBA43A' },
      'blue-red':    { from: '#3B82F6', mid: '#A78BFA', warm: '#F472B6', hot: '#EF4444', low: '#3B82F6' },
      'green-red':   { from: '#7AC74F', mid: '#E8D24A', warm: '#E8842F', hot: '#E94B3C', low: '#7AC74F' },
      'violet-pink': { from: '#6443A1', mid: '#9333EA', warm: '#DB2777', hot: '#F472B6', low: '#6443A1' },
      'teal-coral':  { from: '#0EA5B7', mid: '#4ECDC4', warm: '#F08A5D', hot: '#EE6748', low: '#0EA5B7' },
    };
    const paletteKey = paramFor(uc, 'palette');
    const pal = (paletteKey && PALETTES[paletteKey]) || PALETTES['amber-red'];
    const liveTokens = {
      __style:        view.style,
      __lng:          view.center?.[0],
      __lat:          view.center?.[1],
      __zoom:         view.zoom,
      __dasharray:    dasharray,
      __paletteFrom:  pal.from,
      __paletteMid:   pal.mid,
      __paletteWarm:  pal.warm,
      __paletteHot:   pal.hot,
      __paletteLow:   pal.low,
    };
    root.querySelectorAll('.dd-snip-val').forEach(span => {
      const k = span.dataset.key;
      const live = liveTokens[k];
      if (live !== undefined && live !== null) {
        span.textContent = String(live);
        return;
      }
      const v = paramFor(uc, k);
      span.textContent = v === undefined || v === null ? '' : String(v);
    });
    refreshPromptBody();
  };
  _refreshLiveTokens = refreshSnippetTokens;
  const writeParam = (key, value) => {
    if (!state.sceneParams[uc.id]) state.sceneParams[uc.id] = {};
    state.sceneParams[uc.id][key] = value;
  };
  /* Staging a change no longer re-runs the scene — it only updates the
     snippet/prompt tokens and flags the panel dirty. The map waits for
     Apply. (`immediate` kept as an accepted arg so the call sites read
     unchanged; both paths now just stage.) */
  const schedule = () => markDirty();

  // Basemap dropdown — single-select. Staged like every other control:
  // the pick is held in `pendingBasemap` and only handed to the
  // provider's setStyleFamily on Apply.
  root.querySelector('[data-basemap-select]')?.addEventListener('change', e => {
    pendingBasemap = e.target.value;
    markDirty();
  });

  // Apply — push the staged params + basemap to the map in one go.
  applyBtn()?.addEventListener('click', () => {
    if (!dirty) return;
    if (pendingBasemap !== basemapFor(uc)) _onBasemapChange?.(uc, pendingBasemap);
    _onParamChange?.(uc);
    dirty = false;
    const btn = applyBtn();
    if (btn) btn.disabled = true;
  });

  // Reset — drop every override for this case and rebuild the panel at
  // the author's defaults, then re-run the scene (and restore the
  // default basemap family) so the map matches.
  root.querySelector('[data-cfg-reset]')?.addEventListener('click', () => {
    delete state.sceneParams[uc.id];
    const defFamily = uc.mapStyle || 'standard';
    const hadBasemapOverride = basemapFor(uc) !== defFamily;
    setBasemapOverride(uc, defFamily);
    renderDetail();                       // recreate controls at defaults
    if (hadBasemapOverride) _onBasemapChange?.(uc, defFamily);
    _onParamChange?.(uc);
  });

  // Chip rails — multi-select, click to toggle a value in/out of the
   // saved array. The scene reruns immediately on each toggle so the
   // filter on the basemap POI layer (case 2) repaints without delay.
  root.querySelectorAll('.dd-cfg-row--chips').forEach(row => {
    const key = row.dataset.key;
    row.addEventListener('click', e => {
      const chip = e.target.closest('.dd-cfg-chip');
      if (!chip) return;
      const value = chip.dataset.chipValue;
      // Dynamic options (e.g. POI categories pushed at runtime) take
      // precedence; otherwise fall back to the static options declared
      // in use-cases.js. Falling back to [] here breaks the "undefined
      // means all on" contract — the first click would treat the param
      // as empty and only the clicked value would get saved, flipping
      // the whole rail's meaning.
      const opts = state.dynamicParams[uc.id]?.[key]
        || (uc.params || []).find(p => p.key === key)?.options
        || [];
      const current = paramFor(uc, key);
      const selected = new Set(Array.isArray(current) ? current : opts.map(o => o.value));
      const nowOn = !selected.has(value);
      if (nowOn) selected.add(value); else selected.delete(value);
      writeParam(key, [...selected]);
      chip.classList.toggle('is-on', nowOn);
      const ico = chip.querySelector('.dd-cfg-chip-ico path');
      if (ico) {
        ico.setAttribute('d', nowOn ? 'm5 12 5 5L20 7' : 'M6 12h12');
        ico.setAttribute('stroke-width', nowOn ? '3.5' : '3');
        ico.setAttribute('stroke-linejoin', nowOn ? 'round' : '');
      }
      schedule(true);
    });
  });

  // Subscribe to scene-pushed option updates (e.g. POI categories
  // populated after the basemap idles). Rerender just the chip rail in
  // place — a full panel rebuild would steal focus from any input the
  // user is editing.
  onDynamicParams((targetUc, key, options) => {
    if (targetUc.id !== uc.id) return;
    const row = root.querySelector(`.dd-cfg-row--chips[data-key="${key}"]`);
    if (!row) return;
    const rail = row.querySelector('[data-chip-rail]');
    const current = paramFor(uc, key);
    const selected = new Set(Array.isArray(current) ? current : options.map(o => o.value));
    rail.innerHTML = options.length
      ? sortChipsActiveFirst(options, selected).map(o => {
          const on = selected.has(o.value);
          const icon = on
            ? `<svg class="dd-cfg-chip-ico" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5L20 7"/></svg>`
            : `<svg class="dd-cfg-chip-ico" width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M6 12h12"/></svg>`;
          return `<button type="button" class="dd-cfg-chip${on ? ' is-on' : ''}" data-chip-value="${escAttr(o.value)}">${icon}<span class="dd-cfg-chip-label">${escAttr(o.label)}</span></button>`;
        }).join('')
      : '<span class="dd-cfg-chips-empty">No categories in view</span>';
  });

  root.querySelectorAll('.dd-cfg-ctrl').forEach(ctrl => {
    const type = ctrl.dataset.type;
    const key = ctrl.dataset.key;
    if (type === 'toggle') {
      ctrl.addEventListener('change', () => {
        writeParam(key, ctrl.checked);
        refreshSnippetTokens();
        schedule(true);
      });
    } else if (type === 'select') {
      ctrl.addEventListener('change', () => {
        writeParam(key, ctrl.value);
        refreshSnippetTokens();
        schedule(true);
      });
    } else if (type === 'color') {
      ctrl.addEventListener('input', () => {
        writeParam(key, ctrl.value);
        const hex = ctrl.closest('.dd-cfg-color')?.querySelector('[data-color-hex]');
        if (hex) hex.textContent = ctrl.value.toUpperCase();
        refreshSnippetTokens();
        schedule();
      });
      ctrl.addEventListener('change', () => schedule(true));
    } else if (type === 'combobox') {
      bindCombobox(uc, ctrl, key, writeParam, refreshSnippetTokens, schedule);
    } else if (type === 'number') {
      ctrl.addEventListener('input', () => {
        const n = ctrl.value === '' ? '' : Number(ctrl.value);
        writeParam(key, n);
        refreshSnippetTokens();
        schedule();
      });
    } else {
      ctrl.addEventListener('input', () => {
        writeParam(key, ctrl.value);
        refreshSnippetTokens();
        schedule();
      });
      ctrl.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); schedule(true); }
      });
    }
  });

  showPanel();
}

/* ────────────────────────────────────────────────────────────────
   Combobox control — a single typeahead that swaps between a static
   preset list (when input is empty) and live geocoded suggestions
   (when the user types). Value semantics:
     - clicking a preset stores the preset's `value` (e.g. 'paris')
     - selecting a search result stores its label verbatim
       (e.g. 'Vienna, Austria') — scenes that don't recognise the
       preset key fall through to geocoding the stored string.
   No fancy framework. Plain DOM, scoped per-input so multiple
   comboboxes in the same panel don't fight over a shared popover.
   ──────────────────────────────────────────────────────────────── */
function bindCombobox(uc, input, key, writeParam, refreshSnippetTokens, schedule) {
  const spec = uc.params?.find(p => p.key === key);
  if (!spec) return;
  const root = input.closest('[data-combo-root]');
  const pop  = root?.querySelector('[data-combo-pop]');
  if (!root || !pop) return;

  const presets = spec.options || [];
  const searchKind = spec.search; // currently only 'city' is wired
  let currentItems = [];
  let activeIdx = -1;
  let debounceTimer = null;
  let lastQuery = '';

  // The geocode endpoint isn't free — debounce, dedupe, and only fire
  // when there's at least 2 chars. The 'Municipality' entity bias makes
  // typing 'Paris' resolve to the city, not a rue Paris in Bordeaux.
  async function fetchSearchResults(query) {
    if (!searchKind || query.length < 2) return [];
    try {
      const hits = await geocode({ query, limit: 5, entityType: 'Municipality' });
      return hits.map(h => ({
        value: h.name || h.address || query,
        label: h.name || h.address || query,
        sub: h.address && h.name !== h.address ? h.address : null,
        custom: true,
      }));
    } catch { return []; }
  }

  function renderList(items) {
    currentItems = items;
    activeIdx = items.length > 0 ? 0 : -1;
    if (!items.length) {
      pop.innerHTML = `<div class="dd-cfg-combo-empty">No matches</div>`;
    } else {
      pop.innerHTML = items.map((it, i) => `
        <div class="dd-cfg-combo-item${i === activeIdx ? ' is-active' : ''}"
             role="option" data-idx="${i}">
          <span class="dd-cfg-combo-item-label">${escAttr(it.label)}</span>
          ${it.sub ? `<span class="dd-cfg-combo-item-sub">${escAttr(it.sub)}</span>` : ''}
        </div>`).join('');
    }
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    activeIdx = -1;
  }

  function commit(item) {
    if (!item) return;
    input.value = item.label;
    writeParam(key, item.value);
    refreshSnippetTokens();
    schedule(true);
    close();
  }

  function paintActive() {
    pop.querySelectorAll('.dd-cfg-combo-item').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIdx);
    });
  }

  // Focus / empty input → show presets immediately so the user sees
  // the same affordance as a dropdown when they haven't typed yet.
  input.addEventListener('focus', () => {
    if (!input.value.trim()) renderList(presets);
  });

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) {
      lastQuery = '';
      renderList(presets);
      return;
    }
    // Local filter on presets first — instant. Async geocode below
    // appends additional results when the query goes past the presets.
    const matched = presets.filter(o =>
      o.label.toLowerCase().includes(q.toLowerCase())
    );
    renderList(matched);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const myQuery = q;
      lastQuery = myQuery;
      const hits = await fetchSearchResults(myQuery);
      // Bail if the user kept typing while the request was in flight.
      if (myQuery !== lastQuery) return;
      // Merge presets that matched + hits, deduping by label.
      const seen = new Set(matched.map(m => m.label.toLowerCase()));
      const merged = [...matched];
      for (const h of hits) {
        const k = h.label.toLowerCase();
        if (!seen.has(k)) { merged.push(h); seen.add(k); }
      }
      renderList(merged);
    }, 250);
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (pop.hidden) renderList(input.value.trim() ? currentItems : presets);
      if (currentItems.length) {
        activeIdx = (activeIdx + 1) % currentItems.length;
        paintActive();
      }
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (currentItems.length) {
        activeIdx = (activeIdx - 1 + currentItems.length) % currentItems.length;
        paintActive();
      }
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (activeIdx >= 0 && currentItems[activeIdx]) {
        commit(currentItems[activeIdx]);
      } else if (input.value.trim()) {
        // No selection but user pressed Enter — commit whatever they typed.
        commit({ value: input.value.trim(), label: input.value.trim() });
      }
    } else if (ev.key === 'Escape') {
      close();
      input.blur();
    }
  });

  pop.addEventListener('mousedown', (ev) => {
    // mousedown not click — beat the blur handler that would close the popover.
    const tile = ev.target.closest('.dd-cfg-combo-item');
    if (!tile) return;
    ev.preventDefault();
    const idx = Number(tile.dataset.idx);
    commit(currentItems[idx]);
  });

  // Outside click closes. The combobox owns root + pop; anything outside
  // is fair game to close on.
  document.addEventListener('mousedown', (ev) => {
    if (!root.contains(ev.target)) close();
  });
}
