/* Detail panel — info about the currently selected use case. */
import { accentClass, TOOL_DOCS, etaFor } from '../data/use-cases.js';
import { getSelected, paramFor, state } from '../state.js';
import { snippetFor } from '../render/snippets.js';
import { promptFor } from '../render/prompts.js';
import { showPanel } from './panel.js';

let _onParamChange;
export function bindDetail({ onParamChange } = {}) {
  _onParamChange = onParamChange;
}

// Persisted across selections so the user's preferred tab + prompt style
// don't reset when they jump between use cases.
let _quickTab = 'code';        // 'code' | 'prompt'
let _promptStyle = 'agent';    // 'agent' | 'plain'

const MAP_CHAT_AGENT_URL = 'https://docs.tomtom.com/maps-sdk-js/examples/map-chat-agent-react';

const escAttr = s => String(s).replace(/[&<>"]/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
}[c]));

const escText = s => String(s).replace(/[&<>]/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;'
}[c]));

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
  const tagsHTML = uc.tags.map(t => `<span class="tag">${t}</span>`).join('');
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
        <h2 class="dd-title">${uc.title}</h2>
        <div class="dd-head-top">
          <div class="dd-head-badges">
            <span class="badge accent-${uc.accent}">${uc.category}</span>
            <span class="badge badge-eta">
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m9 8-5 4 5 4M15 8l5 4-5 4"/></svg>
              <span>${eta}</span>
            </span>
          </div>
        </div>
        <p class="dd-desc">${uc.description}</p>
        <div class="dd-tags dd-tags--head">${tagsHTML}</div>
      </div>

      ${configSection(uc)}

      <details class="dd-section dd-collapse" open>
        <summary>
          <h4>Quickstart</h4>
          <svg class="dd-collapse-chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>
        </summary>

        <div class="dd-tabs" role="tablist">
          <button class="dd-tab ${_quickTab === 'code' ? 'is-active' : ''}" data-tab="code" role="tab" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m8 18-6-6 6-6M16 6l6 6-6 6"/></svg>
            Code
          </button>
          <button class="dd-tab ${_quickTab === 'prompt' ? 'is-active' : ''}" data-tab="prompt" role="tab" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 2a4 4 0 0 0-4 4v2H7a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h1v2a4 4 0 0 0 8 0v-2h1a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3h-1V6a4 4 0 0 0-4-4Z"/></svg>
            Prompt
          </button>
        </div>

        <div class="dd-tab-panel ${_quickTab === 'code' ? 'is-active' : ''}" data-tab-panel="code">
          <pre class="dd-snippet"><button class="dd-copy" type="button" data-copy="code">Copy</button><code>${snippetFor(uc)}</code></pre>
        </div>

        <div class="dd-tab-panel ${_quickTab === 'prompt' ? 'is-active' : ''}" data-tab-panel="prompt">
          <div class="dd-prompt-bar">
            <div class="dd-seg" role="tablist">
              <button class="dd-seg-opt ${_promptStyle === 'agent' ? 'is-active' : ''}" data-style="agent" type="button">Agent-ready</button>
              <button class="dd-seg-opt ${_promptStyle === 'plain' ? 'is-active' : ''}" data-style="plain" type="button">Plain spec</button>
            </div>
            <p class="dd-prompt-meta" data-prompt-meta>${_promptStyle === 'agent'
              ? 'Tells the agent to use TomTom MCP + the Map Chat Agent shape. Paste into Claude Code or Cursor.'
              : 'Neutral spec for any LLM. No tool-calling instructions.'}</p>
          </div>
          <pre class="dd-snippet dd-snippet--prompt"><button class="dd-copy" type="button" data-copy="prompt">Copy</button><code data-prompt-body>${escText(promptFor(uc, _promptStyle))}</code></pre>
          <div class="dd-agent-links">
            <button class="btn btn-ghost dd-agent-link" type="button" data-action="open-claude-code">
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 6 2 12l6 6M16 6l6 6-6 6"/></svg>
              Copy for Claude Code
            </button>
            <a class="btn btn-ghost dd-agent-link" href="${MAP_CHAT_AGENT_URL}" target="_blank" rel="noopener">
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M10 14 20 4M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></svg>
              Try Map Chat Agent
            </a>
          </div>
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

  // Copy buttons (Code snippet + Prompt). Each finds the nearest <code>
  // and writes its text to the clipboard.
  root.querySelectorAll('.dd-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.parentElement.querySelector('code');
      const text = code ? code.innerText : '';
      navigator.clipboard?.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('is-copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('is-copied'); }, 1400);
      }).catch(() => {});
    });
  });

  // Code / Prompt tab switching (no full re-render — just toggle classes).
  root.querySelectorAll('.dd-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _quickTab = tab.dataset.tab;
      root.querySelectorAll('.dd-tab').forEach(t =>
        t.classList.toggle('is-active', t.dataset.tab === _quickTab));
      root.querySelectorAll('.dd-tab-panel').forEach(p =>
        p.classList.toggle('is-active', p.dataset.tabPanel === _quickTab));
    });
  });

  // Prompt style toggle — Agent-ready / Plain spec. Regenerates the
  // prompt body in place and updates the meta line.
  const promptBody = root.querySelector('[data-prompt-body]');
  const promptMeta = root.querySelector('[data-prompt-meta]');
  root.querySelectorAll('.dd-seg-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      _promptStyle = opt.dataset.style;
      root.querySelectorAll('.dd-seg-opt').forEach(o =>
        o.classList.toggle('is-active', o.dataset.style === _promptStyle));
      if (promptBody) promptBody.textContent = promptFor(uc, _promptStyle);
      if (promptMeta) promptMeta.textContent = _promptStyle === 'agent'
        ? 'Tells the agent to use TomTom MCP + the Map Chat Agent shape. Paste into Claude Code or Cursor.'
        : 'Neutral spec for any LLM. No tool-calling instructions.';
    });
  });

  // "Copy for Claude Code" — copy prompt, hint the user where to paste.
  root.querySelector('[data-action="open-claude-code"]')?.addEventListener('click', e => {
    const btn = e.currentTarget;
    const text = promptFor(uc, _promptStyle);
    navigator.clipboard?.writeText(text).then(() => {
      const label = btn.querySelector('svg')?.outerHTML || '';
      btn.dataset.orig = btn.dataset.orig || btn.innerHTML;
      btn.innerHTML = `${label} Copied — paste into Claude Code`;
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.innerHTML = btn.dataset.orig;
        btn.classList.remove('is-copied');
      }, 1800);
    }).catch(() => {});
  });

  // When params change, also refresh the prompt body (read-only render).
  const refreshPromptBody = () => {
    if (promptBody) promptBody.textContent = promptFor(uc, _promptStyle);
  };

  // Wire Configure controls. Each writes the typed value into
  // state.sceneParams, refreshes the read-only tokens in the code
  // snippet, and (debounced) re-runs the scene.
  let timer;
  const refreshSnippetTokens = () => {
    root.querySelectorAll('.dd-snip-val').forEach(span => {
      const k = span.dataset.key;
      const v = paramFor(uc, k);
      span.textContent = v === undefined || v === null ? '' : String(v);
    });
    refreshPromptBody();
  };
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
