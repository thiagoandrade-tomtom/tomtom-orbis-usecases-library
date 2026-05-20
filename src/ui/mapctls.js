/* Map control buttons (zoom in/out, recenter, compass) routed to the provider.
   Recenter re-frames the active use case rather than chasing the user's
   browser geolocation — these are scripted scenarios, not navigation. */

export function bindMapControls(provider) {
  document.getElementById('zoom-in').addEventListener('click', () => provider.zoomIn());
  document.getElementById('zoom-out').addEventListener('click', () => provider.zoomOut());
  document.getElementById('locate-btn')?.addEventListener('click', () => provider.recenter());
  document.getElementById('compass')?.addEventListener('click', () => provider.resetBearing());
}
