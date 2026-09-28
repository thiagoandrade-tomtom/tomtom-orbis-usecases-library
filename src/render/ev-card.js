/* EV charging station card — shared by "Find an EV charger" and the
   charging stops of "Long-distance EV trip".

   Layout (from the TT Maps concept frame): operator as the title, the
   address on one truncated line, then one row per plug × power level:

     [plug icon]  Type 2        43 kW    1/5 ●

   The count and dot are green while a point of that kind is free, grey
   when none is (or when the park reports no live status). No emoji —
   plug shapes are small inline SVGs that inherit the text colour. */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const PLUG = {
  IEC62196Type2Outlet:        { label: 'Type 2',   icon: 'type2' },
  IEC62196Type2CableAttached: { label: 'Type 2',   icon: 'type2' },
  IEC62196Type2CCS:           { label: 'CCS',      icon: 'ccs' },
  IEC62196Type1CCS:           { label: 'CCS 1',    icon: 'ccs' },
  IEC62196Type1:              { label: 'Type 1',   icon: 'type1' },
  Chademo:                    { label: 'CHAdeMO',  icon: 'chademo' },
  Tesla:                      { label: 'Tesla',    icon: 'tesla' },
  StandardHouseholdCountrySpecific: { label: 'Domestic', icon: 'domestic' },
  IEC60309AC1PhaseBlue:       { label: 'Industrial 1-ph', icon: 'domestic' },
  IEC60309AC3PhaseRed:        { label: 'Industrial 3-ph', icon: 'domestic' },
};
const plugOf = t => PLUG[t] || { label: String(t).replace(/([a-z])([A-Z])/g, '$1 $2'), icon: 'plug' };

/* Plug faces, 20×20, drawn with currentColor: an outline of the socket
   and its pins, so the shape — not a colour — tells them apart. */
const pin = (cx, cy, r = 1.5) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;
const ICON = {
  type2: `<path d="M4.5 5H15.5A7.5 7.5 0 1 1 4.5 5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          ${pin(7.8, 8, 1.3)}${pin(12.2, 8, 1.3)}${pin(6, 11.4, 1.3)}${pin(10, 11.4, 1.3)}${pin(14, 11.4, 1.3)}${pin(8, 14.8, 1.3)}${pin(12, 14.8, 1.3)}`,
  type1: `<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/>
          ${pin(7, 8.5)}${pin(13, 8.5)}${pin(10, 13.5, 1.8)}${pin(7.5, 13)}${pin(12.5, 13)}`,
  ccs:   `<path d="M5.5 2H14.5A5 5 0 1 1 5.5 2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          ${pin(8, 4, 1.1)}${pin(12, 4, 1.1)}${pin(10, 6.9, 1.1)}
          <rect x="4.5" y="12.5" width="11" height="5.5" rx="2.75" fill="none" stroke="currentColor" stroke-width="1.5"/>
          ${pin(7.6, 15.25, 1.4)}${pin(12.4, 15.25, 1.4)}`,
  chademo: `<circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
          ${pin(6.6, 10, 1.9)}${pin(13.4, 10, 1.9)}${pin(10, 6.4, 1.1)}${pin(10, 13.6, 1.1)}`,
  tesla: `<path d="M4 7a6 5 0 0 1 12 0v4a6 6 0 0 1-12 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          ${pin(7.4, 8, 1.6)}${pin(12.6, 8, 1.6)}${pin(10, 13.2, 1.1)}${pin(7.8, 12.6, 0.9)}${pin(12.2, 12.6, 0.9)}`,
  domestic: `<circle cx="10" cy="10" r="7.5" fill="currentColor"/>
          <circle cx="7" cy="10" r="1.6" fill="var(--s0)"/><circle cx="13" cy="10" r="1.6" fill="var(--s0)"/>`,
  plug:  `<path d="M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0Z M10 15v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
};
const iconSvg = k => `<svg class="evc-icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">${ICON[k] || ICON.plug}</svg>`;

const kwLabel = kw => (Number(kw) > 0 ? `${Math.round(Number(kw))} kW` : '— kW');

/* Rows from the Charging Availability response (connectors[] with
   perPowerLevel) — live free / total per plug × power. */
export function rowsFromAvailability(connectors) {
  const rows = [];
  for (const c of connectors || []) {
    const levels = c.availability?.perPowerLevel?.length
      ? c.availability.perPowerLevel
      : [{ powerKW: null, ...(c.availability?.current || {}) }];
    for (const l of levels) {
      const total = (l.available ?? 0) + (l.occupied ?? 0) + (l.reserved ?? 0) + (l.unknown ?? 0) + (l.outOfService ?? 0);
      rows.push({ type: c.type, kw: l.powerKW, free: l.available ?? 0, total: total || c.total || 0 });
    }
  }
  return rows.sort((a, b) => (b.kw || 0) - (a.kw || 0));
}

/* Rows from the static Search inventory ("type|kW|count") — totals only. */
export function rowsFromInventory(conns) {
  return (conns || []).map(c => {
    const [type, kw, n] = c.split('|');
    return { type, kw: Number(kw), free: null, total: Number(n) };
  }).sort((a, b) => (b.kw || 0) - (a.kw || 0));
}

/* rows: [{ type, kw, free (null = no live status), total }]
   meta: optional [label, value] pairs rendered under the connectors
   (charge time, battery … for a route stop). */
export function evStationCard({ title, address, rows = [], meta = [], note, pending = false }) {
  const list = rows.map(r => {
    const p = plugOf(r.type);
    const live = r.free != null;
    const on = live && r.free > 0;
    const count = live ? `${r.free}/${r.total}` : `${r.total}`;
    return `<li class="evc-row${on ? ' is-free' : ''}">
      ${iconSvg(p.icon)}
      <span class="evc-name">${esc(p.label)}</span>
      <span class="evc-kw">${esc(kwLabel(r.kw))}</span>
      <span class="evc-count" title="${live ? 'free / total right now' : 'points · no live status'}">${esc(count)}</span>
      <span class="evc-dot" aria-hidden="true"></span>
    </li>`;
  }).join('');

  const metaHtml = meta.length
    ? `<dl class="evc-meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
    : '';
  const noteHtml = pending
    ? `<div class="evc-note">Checking live status…</div>`
    : note ? `<div class="evc-note">${esc(note)}</div>` : '';

  return `<div class="pop evc">
    <div class="evc-title">${esc(title || 'Charging station')}</div>
    ${address ? `<div class="evc-addr" title="${esc(address)}">${esc(address)}</div>` : ''}
    ${list ? `<ul class="evc-list">${list}</ul>` : ''}
    ${metaHtml}
    ${noteHtml}
  </div>`;
}
