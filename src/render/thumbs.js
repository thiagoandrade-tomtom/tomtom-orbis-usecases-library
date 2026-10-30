/* List thumbnails: one hairline figure per use case, keyed by its mapType
   (render/hairline/figures/<mapType>.js). The slot is mounted after the
   list renders — see mountThumbs in render/hairline/thumbs.js. */
import { hasFigure, figureSlot } from './hairline/thumbs.js';

export function thumbFor(uc) {
  return hasFigure(uc.mapType) ? figureSlot(uc.mapType) : '';
}
