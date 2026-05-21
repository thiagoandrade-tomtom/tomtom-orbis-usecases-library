/* Explore Areas & POIs — click the base-map POIs themselves.

   Instead of overlaying our own markers (which would duplicate every POI
   the base style already labels), this scene makes the base-style POIs
   interactive: hover changes the cursor, click opens a TomTom-style info
   card with the POI name + category from the vector tile, enriched with
   a real address from the Reverse Geocoding API. */

import maplibregl from 'maplibre-gl';
import { infoCard } from '../../render/popup.js';
import { geocode, reverseGeocode } from '../../map/services.js';
import { paramFor } from '../../state.js';

// True if a queried feature belongs to a base-style POI layer.
function isPoiFeature(f) {
  const layerId = f.layer?.id || '';
  const srcLayer = f.sourceLayer || f.layer?.['source-layer'] || '';
  if (!/poi|place/i.test(layerId) && !/poi|place/i.test(srcLayer)) return false;
  // Need at least something we can display.
  return Boolean(featureName(f));
}

function featureName(f) {
  const p = f.properties || {};
  return p.name || p.name_en || p.name_int || p['name:en'] || p['name:latin'] || null;
}

function featureCategory(f) {
  const p = f.properties || {};
  const raw = p.category || p.subclass || p.class || p.type || '';
  if (!raw) return 'Point of interest';
  return String(raw).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function featurePosition(f, fallback) {
  const g = f.geometry;
  if (g?.type === 'Point') return g.coordinates;
  return fallback;
}

export default async function poi(ctx, uc) {
  const accent = ctx.caseColor(uc);
  const anchorQuery = paramFor(uc, 'anchor');

  /* Global search — anchor can be any address worldwide. */
  const anchorHit = (await geocode({ query: anchorQuery, limit: 1 }))[0];
  if (ctx.cancelled) return;
  const center = anchorHit?.position || [4.8925, 52.3731];

  ctx.setView({ center, zoom: 14.5, animate: true });

  let activePopup = null;
  let lastFeatureKey = null;

  // Hover: pointer cursor when over a POI.
  ctx.on('mousemove', (e) => {
    const hit = ctx.ml.queryRenderedFeatures(e.point).find(isPoiFeature);
    ctx.ml.getCanvas().style.cursor = hit ? 'pointer' : '';
  });

  // Click: open an infoCard at the POI, enriched with reverseGeocode.
  ctx.on('click', async (e) => {
    const hit = ctx.ml.queryRenderedFeatures(e.point).find(isPoiFeature);
    if (!hit) return;

    const lngLat = featurePosition(hit, [e.lngLat.lng, e.lngLat.lat]);
    const key = `${lngLat[0].toFixed(5)}_${lngLat[1].toFixed(5)}_${featureName(hit)}`;
    if (key === lastFeatureKey && activePopup?.isOpen()) return;
    lastFeatureKey = key;

    if (activePopup) { try { activePopup.remove(); } catch {} }

    const name = featureName(hit) || 'Unnamed POI';
    const cat  = featureCategory(hit);

    // Render an immediate "Loading address…" card so click feels responsive,
    // then patch the same popup with the geocoded address.
    const popup = new maplibregl.Popup({ closeButton: true, offset: 18 })
      .setLngLat(lngLat)
      .setHTML(infoCard({
        accent, eyebrow: cat, title: name,
        subtitle: 'Loading address…',
        rows: [
          ['Lat,Lng', `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`],
        ],
        footer: 'Base-map POI · TomTom vector tile',
      }))
      .addTo(ctx.ml);
    activePopup = popup;

    try {
      const rev = await reverseGeocode({ point: lngLat });
      if (ctx.cancelled || !popup.isOpen()) return;
      popup.setHTML(infoCard({
        accent, eyebrow: cat, title: name,
        subtitle: rev?.address || undefined,
        rows: [
          ['Area', rev?.municipalitySubdivision || rev?.municipality || '—'],
          ['Lat,Lng', `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`],
        ],
        footer: 'TomTom Reverse Geocoding · live',
      }));
    } catch {
      if (!popup.isOpen()) return;
      popup.setHTML(infoCard({
        accent, eyebrow: cat, title: name,
        rows: [['Lat,Lng', `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`]],
        footer: 'Base-map POI · address unavailable',
      }));
    }
  });

  // Hint card at the anchor — explains the new interaction.
  ctx.addPopup(
    { offset: 14, anchor: 'bottom', closeButton: true },
    center,
    infoCard({
      accent, eyebrow: 'Tip', title: 'Click any POI on the map',
      subtitle: anchorHit?.address || anchorQuery,
      rows: [
        ['Zoom', '15.5'],
        ['Interaction', 'Hover to highlight · click to inspect'],
      ],
      footer: 'POIs come from the base style — no overlay duplicates',
    })
  );
}
