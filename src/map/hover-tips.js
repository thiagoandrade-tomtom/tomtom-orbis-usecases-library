/* Hover tips — a small card that follows the pointer over map features
   whose meaning isn't obvious from the icon alone: traffic incidents,
   toll roads, closures. Site-wide: ctx.enableTrafficIncidents() wires the
   incident tips for every case, and a scene adds its own layers with
   ctx.hoverTips([...]).

   Every line in a tip is a field of the feature under the pointer —
   descriptions, delay, validity — never a guess. A field that is missing
   is simply left out. */

import { cumulative } from './geo.js';
import { incidentType, incidentBadge } from './incident-types.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtMin = s => `${Math.max(1, Math.round(s / 60))} min`;
const fmtDay = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const words = s => String(s).replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());

/* tip({ eyebrow, icon, title, rows: [[k, v]] }) — the shared card; `icon`
   is trusted badge HTML (incidentBadge in map/incident-types.js). */
export function tipHtml({ eyebrow, icon, title, rows = [] }) {
  const body = rows.filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<div class="hover-tip-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
  return `<div class="hover-tip">
    ${eyebrow ? `<div class="hover-tip-eyebrow">${icon || ''}${esc(eyebrow)}</div>` : ''}
    ${title ? `<div class="hover-tip-title">${esc(title)}</div>` : ''}
    ${body}
  </div>`;
}

/* The basemap's live incidents (SDK TrafficIncidentsModule vector tiles:
   description_0…n, magnitude_of_delay, delay, start / end time). */
// magnitude_of_delay: 0 unknown, 1–3 minor → major, 4 indefinite (closures, no estimate).
const MAGNITUDE = { 1: 'Minor', 2: 'Moderate', 3: 'Major', 4: 'Indefinite' };
export function incidentTip(p, ml) {
  const descriptions = Object.keys(p)
    .filter(k => /^description_\d+$/.test(k))
    .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]))   // numeric: _2 before _10
    .map(k => p[k]).filter(Boolean);
  if (!descriptions.length) return null;
  const until = p.end_time ? fmtDay(p.end_time) : null;
  // icon_category_0 is the incident's type; _1, when the tiles carry it,
  // is a cause layered on top (a jam behind a broken-down vehicle).
  const type = incidentType(p.icon_category_0);
  const cause = incidentType(p.icon_category_1);
  const causeLabel = cause && cause !== type ? cause.label : null;
  // The cause usually comes back as a description too — say it once.
  const norm = t => String(t).toLowerCase().replace(/[^a-z]/g, '');
  const also = descriptions.slice(1).filter(d => !causeLabel || norm(d) !== norm(causeLabel));
  return tipHtml({
    eyebrow: type?.label || 'Traffic incident',
    icon: incidentBadge(ml, type, 'jam-hz jam-hz--legend'),
    title: descriptions[0],
    rows: [
      ['Cause', causeLabel],
      ['Also', also.join(', ') || null],
      ['Delay', Number(p.delay) > 0 ? fmtMin(Number(p.delay)) : MAGNITUDE[p.magnitude_of_delay] || null],
      ['Road', p.road_category ? words(p.road_category) : null],
      ['Until', until],
    ],
  });
}

/* Incident layers of the SDK's TrafficIncidentsModule, as the style names them. */
export const INCIDENT_LAYER = /^TrafficIncidents - /;

/* ---- Routes drawn by the SDK's RoutingModule ----------------------- */

const COUNTRY = {
  NLD: 'Netherlands', BEL: 'Belgium', LUX: 'Luxembourg', FRA: 'France', DEU: 'Germany',
  CHE: 'Switzerland', AUT: 'Austria', ITA: 'Italy', ESP: 'Spain', PRT: 'Portugal',
  GBR: 'United Kingdom', IRL: 'Ireland', DNK: 'Denmark', SWE: 'Sweden', NOR: 'Norway',
  POL: 'Poland', CZE: 'Czechia', SVN: 'Slovenia', HRV: 'Croatia', HUN: 'Hungary',
  BRA: 'Brazil', USA: 'United States', CAN: 'Canada', MEX: 'Mexico',
};
const MAGNITUDE_WORD = { minor: 'Minor', moderate: 'Moderate', major: 'Major', indefinite: 'Unknown' };

// queryRenderedFeatures hands nested properties back as JSON strings.
const parse = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

/* Tips for the toll roads and the traffic on a route shown with
   RoutingModule. `route` is the SDK Route feature that was shown — its
   sections give the stretch's length and the country it's in. The route
   response carries no toll prices, so a toll tip says where one applies,
   not how much. */
export function bindRouteTips(ctx, route) {
  const coords = route.geometry.coordinates;
  const along = cumulative(coords);
  const countries = route.properties.sections?.country || [];
  const countryAt = i => {
    const c = countries.find(s => i >= s.startPointIndex && i <= s.endPointIndex)?.countryCodeISO3;
    return c ? COUNTRY[c] || c : null;
  };
  const km = (a, b) => {
    const m = (along[b] ?? 0) - (along[a] ?? 0);
    return m >= 1000 ? `${Math.round(m / 1000)} km` : `${Math.round(m)} m`;
  };
  ctx.hoverTips([
    {
      layers: /-routeIncident/,
      html: (f) => {
        const p = f.properties || {};
        const cats = parse(p.categories);
        const list = Array.isArray(cats) ? cats.map(words) : [];
        return tipHtml({
          eyebrow: 'Traffic on this route',
          title: list[0] || 'Traffic',
          rows: [
            ['Also', list.slice(1).join(', ') || null],
            // 0 s with magnitude "indefinite" means the delay is unknown, not zero.
            ['Delay', Number(p.delayInSeconds) > 0 ? fmtMin(Number(p.delayInSeconds)) : null],
            ['Speed', p.effectiveSpeedInKmh ? `~${Math.round(p.effectiveSpeedInKmh)} km/h` : null],
            ['Magnitude', MAGNITUDE_WORD[p.magnitudeOfDelay] || null],
            ['Length', p.startPointIndex != null ? km(Number(p.startPointIndex), Number(p.endPointIndex)) : null],
          ],
        });
      },
    },
    {
      layers: /-routeTollRoad(Outline|Symbol)$/,
      html: (f) => {
        const p = f.properties || {};
        const a = Number(p.startPointIndex), b = Number(p.endPointIndex);
        return tipHtml({
          eyebrow: 'Toll road',
          title: 'A toll applies on this stretch',
          rows: [
            ['Length', Number.isFinite(a) ? km(a, b) : null],
            ['Country', Number.isFinite(a) ? countryAt(a) : null],
          ],
        });
      },
    },
  ]);
}
