/* Popup HTML helpers. Every scene shares the same template so map overlays
   feel like one product. Pass these strings to ctx.addPopup / marker.setPopup. */

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

/** Card popup. All popups across all scenes share this shape.
 *   - eyebrow : tiny uppercase line above the title (e.g. "STOP 1 of 2 · FAST")
 *   - title   : the headline (required)
 *   - subtitle: secondary line under the title — typically an address
 *   - pills   : array of { text, tone?, dot? } chips rendered after the head.
 *               Tones: 'neutral' (default), 'live', 'info', 'success', 'warn', 'danger'.
 *               Pass a CSS colour as `dot` to render a leading status dot.
 *   - rows    : [key, value] pairs rendered as airy dividers-between rows
 *   - footer  : muted attribution line at the bottom
 * The `accent` argument is accepted for API symmetry with markers but is
 * no longer drawn — colour reads from the map pin, the card stays neutral.
 */
export function infoCard({ accent, eyebrow, title, subtitle, pills = [], blocks = [], rows = [], footer }) {
  void accent;
  const eyebrowHtml = eyebrow
    ? `<div class="pop-eyebrow">${esc(eyebrow)}</div>` : '';
  const subtitleHtml = subtitle
    ? `<div class="pop-sub">${esc(subtitle)}</div>` : '';
  const pillsHtml = pills.length
    ? `<div class="pop-pills">${pills.map(p => {
        const tone = p.tone || 'neutral';
        const dot  = p.dot ? `<span class="pop-pill-dot" style="background:${p.dot}"></span>` : '';
        const icon = p.icon ? `<span class="pop-pill-icon">${p.icon}</span>` : '';
        return `<span class="pop-pill pop-pill-${tone}">${dot}${icon}${esc(p.text)}</span>`;
      }).join('')}</div>` : '';
  // Each row is `[key, value]` where value is either a plain string
  // (escaped) or `{ html: '...' }` for callers that need a clickable link
  // or a stacked block — escape the string form so a POI name with a `<`
  // can't break the layout.
  const rowsHtml = rows.map(([k, v]) => {
    const val = v && typeof v === 'object' && 'html' in v ? v.html : esc(v);
    return `<div class="pop-row"><span class="pop-k">${esc(k)}</span><span class="pop-v">${val}</span></div>`;
  }).join('');
  const footerHtml = footer ? `<div class="pop-foot">${esc(footer)}</div>` : '';
  // Free-form HTML blocks render between the pills and the labelled
  // key/value rows — use them for content that doesn't fit the row
  // pattern (an opening-hours week schedule, a chart, an embedded media).
  const blocksHtml = blocks.length
    ? blocks.map(b => `<div class="pop-block">${b}</div>`).join('')
    : '';
  return `
    <div class="pop">
      <div class="pop-head">
        ${eyebrowHtml}
        <div class="pop-title">${esc(title)}</div>
        ${subtitleHtml}
      </div>
      ${pillsHtml}
      ${blocksHtml}
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
        ${eyebrowHtml}
        <div class="pop-title">${esc(title)}</div>
      </div>
      ${taglineHtml}
      ${barsHtml}
      ${statsHtml}
      ${rowsHtml}
      ${footerHtml}
    </div>`;
}
