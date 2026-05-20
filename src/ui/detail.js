/* Detail panel — info about the currently selected use case. */
import { accentClass, TOOL_DOCS, etaFor } from '../data/use-cases.js';
import { getSelected, paramFor, state } from '../state.js';
import { snippetFor } from '../render/snippets.js';
import { promptFor } from '../render/prompts.js';
import { showPanel } from './panel.js';

let _onParamChange;
let _provider;
export function bindDetail({ onParamChange, provider } = {}) {
  _onParamChange = onParamChange;
  _provider = provider;
}

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

function renderQuickBody(uc, mode, view) {
  /* Toolbar sits ABOVE the <pre> as a sibling — not inside it — so
     horizontal scrolling in the code stays contained and the bar
     never drifts. */
  if (mode === 'code') {
    return `<div class="dd-snippet">${snipToolbar('code')}<pre class="dd-snippet-pre"><code>${snippetFor(uc, view)}</code></pre></div>`;
  }
  return `<div class="dd-snippet dd-snippet--prompt">${snipToolbar(mode)}<pre class="dd-snippet-pre"><code data-prompt-body>${escText(promptFor(uc, mode, view))}</code></pre></div>`;
}

/* ---------- Configure controls -------------------------------------- */

function configControl(uc, p) {
  const value = paramFor(uc, p.key);
  const type = p.type || 'text';
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

function configSection(uc) {
  if (!uc.params?.length) return '';
  const controls = uc.params.map(p => configControl(uc, p)).join('');
  return `
    <details class="dd-section dd-collapse" open>
      <summary>
        <h4>Configure</h4>
        <svg class="dd-collapse-chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
      </summary>
      <p class="dd-snippet-hint">Tweak the settings — the map and the code snippet below update together.</p>
      <div class="dd-cfg-grid">${controls}</div>
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

  /* Replace the body subtree when the active mode changes — keeps the
     toggle pill stable while swapping content. The Configure controls
     and Tools list outside this subtree don't need to re-render. */
  const swapQuickBody = () => {
    const slot = root.querySelector('[data-quick-body]');
    if (slot) slot.innerHTML = renderQuickBody(uc, _quickMode, currentView());
  };
  const refreshPromptBody = () => {
    /* Agent/Plain modes render a <code data-prompt-body>; on Code mode
       there's no prompt body to update. */
    const body = root.querySelector('[data-prompt-body]');
    if (body && _quickMode !== 'code') {
      body.textContent = promptFor(uc, _quickMode, currentView());
    }
  };

  root.addEventListener('click', e => {
    /* Mode toggle (Agent-ready / Plain spec / Code) — fixed order, no
       reorder on click. */
    const modeBtn = e.target.closest('.dd-seg-opt[data-mode]');
    if (modeBtn) {
      const next = modeBtn.dataset.mode;
      if (next === _quickMode) return;
      _quickMode = next;
      root.querySelectorAll('.dd-seg--quick .dd-seg-opt').forEach(o =>
        o.classList.toggle('is-active', o.dataset.mode === _quickMode));
      swapQuickBody();
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
      const text = promptFor(uc, _quickMode, currentView());
      navigator.clipboard?.writeText(text)
        .then(() => flashCopy(mcaBtn, 'Copied — opening Map Agent'))
        .catch(() => {});
      window.open(MAP_CHAT_AGENT_URL, '_blank', 'noopener');
      return;
    }
  });

  // Wire Configure controls. Each writes the typed value into
  // state.sceneParams, refreshes the read-only tokens in the code
  // snippet, and (debounced) re-runs the scene.
  let timer;
  const refreshSnippetTokens = () => {
    const view = currentView() || {};
    const liveTokens = {
      __style: view.style,
      __lng:   view.center?.[0],
      __lat:   view.center?.[1],
      __zoom:  view.zoom,
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
  const schedule = (immediate = false) => {
    clearTimeout(timer);
    if (immediate) { _onParamChange?.(uc); return; }
    timer = setTimeout(() => _onParamChange?.(uc), 650);
  };

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
