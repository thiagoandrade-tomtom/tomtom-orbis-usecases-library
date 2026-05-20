/* Popup HTML helpers. Every scene shares the same template so map overlays
   feel like one product. Pass these strings to ctx.addPopup / marker.setPopup. */

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

/** Card popup: title + accent dot + optional eyebrow + key/value rows + optional footer line. */
export function infoCard({ accent = '#3F72B0', eyebrow, title, rows = [], footer }) {
  const eyebrowHtml = eyebrow
    ? `<div class="pop-eyebrow">${esc(eyebrow)}</div>` : '';
  const rowsHtml = rows.map(([k, v]) =>
    `<div class="pop-row"><span class="pop-k">${esc(k)}</span><span class="pop-v">${esc(v)}</span></div>`
  ).join('');
  const footerHtml = footer ? `<div class="pop-foot">${esc(footer)}</div>` : '';
  return `
    <div class="pop">
      <div class="pop-head">
        <span class="pop-dot" style="background:${accent}"></span>
        <div class="pop-title-wrap">
          ${eyebrowHtml}
          <div class="pop-title">${esc(title)}</div>
        </div>
      </div>
      ${rowsHtml ? `<div class="pop-rows">${rowsHtml}</div>` : ''}
      ${footerHtml}
    </div>`;
}

/** Single-line chip-style popup — used for at-a-glance ETA / distance summaries. */
export function chip({ accent = '#3F72B0', text }) {
  return `<div class="pop-chip" style="--pop-accent:${accent}">${esc(text)}</div>`;
}

/** Status pill (live, scheduled, delayed…) used inline in card footers. */
export function pill(text, tone = 'info') {
  return `<span class="pop-pill pop-pill-${tone}">${esc(text)}</span>`;
}

/** Dashboard-style card. Renders a compact title + tagline + optional
   progress bars + a 3-column stat-tile grid. Designed to keep tall data
   payloads inside the viewport without falling back to a giant key/value
   stack. `bars: [{ label, value, max?=100 }]`, `stats: [{ value, label }]`. */
export function statsCard({ accent = '#3F72B0', eyebrow, title, tagline, bars = [], stats = [], rows = [], footer }) {
  const eyebrowHtml = eyebrow ? `<div class="pop-eyebrow">${esc(eyebrow)}</div>` : '';
  const taglineHtml = tagline ? `<div class="pop-tagline">${esc(tagline)}</div>` : '';
  const barsHtml = bars.length ? `<div class="pop-bars">${bars.map(b => {
    const max = b.max ?? 100;
    const pct = Math.max(0, Math.min(100, (b.value / max) * 100));
    const styleAttr = b.color ? ` style="--pop-bar-color:${b.color}"` : '';
    return `<div class="pop-bar"${styleAttr}>
      <span class="pop-bar-label">${esc(b.label)}</span>
      <span class="pop-bar-track"><span class="pop-bar-fill" style="width:${pct}%"></span></span>
      <span class="pop-bar-value">${esc(String(b.value))}</span>
    </div>`;
  }).join('')}</div>` : '';
  const statsHtml = stats.length ? `<div class="pop-stats-grid">${stats.map(s => `
    <div class="pop-stat">
      <div class="pop-stat-value">${esc(String(s.value))}</div>
      <div class="pop-stat-label">${esc(s.label)}</div>
    </div>`).join('')}</div>` : '';
  const rowsHtml = rows.length ? `<div class="pop-mini-rows">${rows.map(([k, v]) =>
    `<div class="pop-mini-row"><span class="pop-mini-k">${esc(k)}</span><span class="pop-mini-v">${esc(v)}</span></div>`
  ).join('')}</div>` : '';
  const footerHtml = footer ? `<div class="pop-foot">${esc(footer)}</div>` : '';
  return `
    <div class="pop" style="--pop-accent:${accent}">
      <div class="pop-head">
        <span class="pop-dot" style="background:${accent}"></span>
        <div class="pop-title-wrap">
          ${eyebrowHtml}
          <div class="pop-title">${esc(title)}</div>
        </div>
      </div>
      ${taglineHtml}
      ${barsHtml}
      ${statsHtml}
      ${rowsHtml}
      ${footerHtml}
    </div>`;
}
