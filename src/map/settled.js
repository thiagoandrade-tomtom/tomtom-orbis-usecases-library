/* "Once the map has settled" — what MapLibre's `idle` event means, minus
   the one case where `idle` never comes.

   `idle` fires after a frame with no camera motion, every tile loaded and
   no repaint queued. A layer that animates every frame keeps a repaint
   queued forever — GLSurfaces does (wind on the water, grass and trees),
   so a map showing it never goes idle, and anything waiting on `idle`
   waits for good. This also fires on the first rendered frame where the
   camera is still and the tiles and style are loaded, whichever comes
   first. Returns a function that cancels the wait. */

export function onceSettled(ml, fn) {
  let done = false;
  const settle = () => {
    if (done) return;
    done = true;
    ml.off('idle', settle);
    ml.off('render', onRender);
    fn();
  };
  const onRender = () => {
    if (!ml.isMoving() && ml.isStyleLoaded() && ml.areTilesLoaded()) settle();
  };
  ml.on('idle', settle);
  ml.on('render', onRender);
  // A map that has already settled draws no more frames; ask for one so
  // the wait resolves instead of hanging until the next interaction.
  ml.triggerRepaint();
  return () => {
    done = true;
    ml.off('idle', settle);
    ml.off('render', onRender);
  };
}
