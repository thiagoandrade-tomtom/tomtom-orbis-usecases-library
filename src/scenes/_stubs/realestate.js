/* Where to stay — category-density heatmap.

   Static city view. The detail panel exposes two selects: City and Lens.
   The map renders a heatmap of POIs for the chosen lens — bright red
   where the category clusters, fading to green where it doesn't.

   Changing the Lens re-runs the scene (paramFor → onParamChange wiring
   in main.js), so there's no in-scene toggle UI to maintain. One anchor,
   one lens at a time. */

import { poiSearch, nearbySearch } from '../../map/services.js';
import { paramFor } from '../../state.js';

const CITY_ANCHORS = {
  amsterdam: { center: [4.8975, 52.3700], zoom: 12.8 },
  paris:     { center: [2.3522,  48.8566], zoom: 12.4 },
  berlin:    { center: [13.4050, 52.5200], zoom: 11.8 },
  barcelona: { center: [2.1734,  41.3851], zoom: 12.4 },
};

const CATEGORIES = {
  dining:    { label: 'Dining',    verb: 'eat',       probe: { query: 'restaurant' } },
  sights:    { label: 'Sights',    verb: 'sightsee',  probe: { query: 'museum' } },
  shopping:  { label: 'Shopping',  verb: 'shop',      probe: { query: 'shopping' } },
  nightlife: { label: 'Nightlife', verb: 'go out',    probe: { query: 'bar' } },
  transit:   { label: 'Transit',   verb: 'commute',   probe: { categorySet: 9942 } },
};

const POI_RADIUS = 3500;
const POI_LIMIT  = 100;

export default async function realestate(ctx, uc) {
  const cityKey = (paramFor(uc, 'city') || 'amsterdam').toLowerCase();
  const catKey  = (paramFor(uc, 'category') || 'dining').toLowerCase();
  const anchor  = CITY_ANCHORS[cityKey] || CITY_ANCHORS.amsterdam;
  const cat     = CATEGORIES[catKey] || CATEGORIES.dining;

  ctx.setView({ center: anchor.center, zoom: anchor.zoom, animate: true });

  // Loading-state legend keeps the UI feeling responsive while the POI
  // call is in flight.
  ctx.setLegend({
    title: `Where to ${cat.verb}`,
    items: [
      { gradient: ['#7AC74F', '#E94B3C'], label: 'Low → High density' },
      { color: 'transparent', shape: 'dot', label: 'Loading…' },
    ],
  });

  const results = await (cat.probe.query
    ? poiSearch({ query: cat.probe.query, center: anchor.center, radius: POI_RADIUS, limit: POI_LIMIT })
    : nearbySearch({ center: anchor.center, radius: POI_RADIUS, categorySet: cat.probe.categorySet, limit: POI_LIMIT })
  ).catch(() => []);
  if (ctx.cancelled) return;

  const features = results.map(r => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: r.position },
    properties: { name: r.name || cat.label },
  }));

  ctx.addSource('wts-pts', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  ctx.addLayer({
    id: 'wts-heat', type: 'heatmap', source: 'wts-pts',
    paint: {
      'heatmap-weight':    1,
      'heatmap-radius':    34,
      'heatmap-intensity': 1.1,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.2,  '#7AC74F',   // green
        0.45, '#E8D24A',   // yellow
        0.7,  '#E8842F',   // orange
        1.0,  '#E94B3C',   // red
      ],
      'heatmap-opacity': 0.85,
    },
  });

  ctx.setLegend({
    title: `Where to ${cat.verb}`,
    items: [
      { gradient: ['#7AC74F', '#E94B3C'], label: 'Low → High density' },
      { color: 'transparent', shape: 'dot', label: `${features.length} ${cat.label.toLowerCase()} POIs` },
    ],
  });
}
