/* Single source of truth for the TomTom API key and base URLs.
   Vite exposes any var prefixed with VITE_ to client code via import.meta.env.
   Set yours in `.env` at project root (see .env.example). */

import { TomTomConfig } from '@tomtom-org/maps-sdk/core';

export const API_KEY = import.meta.env.VITE_TOMTOM_API_KEY || '';
export const API_BASE = 'https://api.tomtom.com';
export const API_VERSION = 1;

export const hasKey = Boolean(API_KEY);

if (hasKey) {
  TomTomConfig.instance.put({
    apiKey: API_KEY,
    apiVersion: API_VERSION,
    commonBaseURL: API_BASE,
  });
}

/* Map-wide defaults. Center on Amsterdam — every stub scene can override via setView. */
export const DEFAULT_VIEW = {
  center: [4.9041, 52.3676],
  zoom: 11,
};

/* Symbol scale applied to every symbol layer's text-size AND icon-size
   after the style loads — equivalent to MapMaker's "Global symbol size"
   slider. 1.0 = default tile sizes; lower values shrink labels and POI
   glyphs together so dense urban maps read calmly. */
export const MAP_LABEL_SCALE = 0.7;

/* Overlay line widths — applied to anything WE draw on top of the basemap
   (routes, connectors, area outlines, faint previews). Basemap road styling
   is untouched. Doubling these scales every overlay uniformly. */
export const OVERLAY_ROUTE_CASING_WIDTH      = 28;   // wide soft glow behind a solid route
export const OVERLAY_ROUTE_LINE_WIDTH        = 10;   // the solid route line itself
export const OVERLAY_LINK_WIDTH              = 4;    // dashed connector (hub→stop, geofence edge)
export const OVERLAY_AREA_OUTLINE_WIDTH      = 3;    // polygon outline, idle
export const OVERLAY_AREA_OUTLINE_WIDTH_FOCUS = 5;   // polygon outline, selected/focused
export const OVERLAY_PATH_FAINT_WIDTH        = 6;    // per-vehicle faint preview path
