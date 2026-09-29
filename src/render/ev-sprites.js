/* EV charger marker images, composed from the style's own sprites —
   shared by "Find an EV charger" and the charging stops of
   "Long-distance EV trip", so a charger reads the same in both cases.

     ev-round-<state>  TomTom's round charging icon, with the status dot
     ev-pin-<state>    the SDK's charging pin, glyph on its head

   <state> is none | available | occupied: no live feed, a point free
   right now, all points busy. Nothing hand-made — the dot is lifted out
   of the style's own "-available" / "-occupied" pins. */

const SPRITE = {
  round:    'poi-charging_location',                         // 48×48 @2x
  pin:      'search-poi-charging_location-big',              // 112×140 @2x, blank head
  pinAvail: 'search-poi-charging_location-big-available',    // same + status dot
  pinBusy:  'search-poi-charging_location-big-occupied',
};
export const EV_STATES = ['none', 'available', 'occupied'];

/* Live counts → marker state. */
export const evStateOf = live => !live ? 'none' : live.free > 0 ? 'available' : 'occupied';

/* A style image as a canvas — null when the style doesn't have it. */
export function spriteCanvas(ml, id) {
  const im = ml.getImage(id);
  if (!im) return null;
  const { width, height, data } = im.data;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return c;
}

/* The status dot is whatever the "-available" pin adds over the blank one.
   Lifting it out as a pixel diff reuses TomTom's exact dot — fill, rim and
   size — on the round icon too, so both states read as one family. */
function liftDot(blank, marked) {
  const w = blank.width, h = blank.height;
  const a = blank.getContext('2d').getImageData(0, 0, w, h).data;
  const bImg = marked.getContext('2d').getImageData(0, 0, w, h);
  const b = bImg.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < a.length; i += 4) {
    const same = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]) < 24;
    if (same) { b[i + 3] = 0; continue; }
    const p = i / 4, x = p % w, y = (p / w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  const full = document.createElement('canvas');
  full.width = w; full.height = h;
  full.getContext('2d').putImageData(bImg, 0, 0);
  out.getContext('2d').drawImage(full, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* The white charging glyph alone, without the round icon's disc and rim —
   on the pin's head the disc would read as a white ring inside the pin. */
function liftGlyph(round) {
  const w = round.width, h = round.height, r = w * 0.36;
  const img = round.getContext('2d').getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const light = d[i] > 190 && d[i + 1] > 190 && d[i + 2] > 190;
      if (!light || Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > r) d[i + 3] = 0;
    }
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').putImageData(img, 0, 0);
  return out;
}

/* Top-centre of the pin's round head — where the category glyph sits. */
function pinHead(pin) {
  const w = pin.width, h = pin.height;
  const d = pin.getContext('2d').getImageData(0, 0, w, h).data;
  let top = -1, left = w, right = -1;
  for (let y = 0; y < h * 0.7; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] < 200) continue;
      if (top < 0) top = y;
      if (x < left) left = x; if (x > right) right = x;
    }
  }
  const dia = right - left + 1;
  return { cx: left + dia / 2, cy: top + dia / 2, dia };
}

function putImage(ml, id, canvas) {
  const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  if (ml.hasImage(id)) ml.removeImage(id);
  ml.addImage(id, img, { pixelRatio: 2 });
}

/* Colour at the centre of a lifted dot — so the legend swatch matches the
   dot on the map exactly, whatever the style's sprite uses. */
function dotColor(dot) {
  if (!dot) return null;
  const [r, g, b] = dot.getContext('2d').getImageData(dot.width >> 1, dot.height >> 1, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/* Adds ev-round-<state> and ev-pin-<state> to the map. Returns null when
   the style has no charging sprites (a custom basemap), otherwise the
   status-dot colours for the legend. */
export function buildEvMarkerImages(ml) {
  const round = spriteCanvas(ml, SPRITE.round);
  const pins = { none: spriteCanvas(ml, SPRITE.pin), available: spriteCanvas(ml, SPRITE.pinAvail), occupied: spriteCanvas(ml, SPRITE.pinBusy) };
  if (!round || !pins.none) return null;
  const dots = {
    available: pins.available && liftDot(pins.none, pins.available),
    occupied:  pins.occupied  && liftDot(pins.none, pins.occupied),
  };
  const head = pinHead(pins.none);
  const glyphImg = liftGlyph(round);
  const glyph = head.dia * 1.05;              // glyph fills ~60% of its icon box

  // Pad the round icon so the dot can hang off its top-right like on the pin.
  const pad = 10;
  for (const st of EV_STATES) {
    const c = document.createElement('canvas');
    c.width = round.width + pad; c.height = round.height + pad;
    const g = c.getContext('2d');
    g.drawImage(round, pad / 2, pad / 2);
    const dot = dots[st];
    if (dot) {
      const s = round.width * 0.42 / dot.width;
      g.drawImage(dot, c.width - dot.width * s, 0, dot.width * s, dot.height * s);
    }
    putImage(ml, `ev-round-${st}`, c);

    const p = document.createElement('canvas');
    p.width = pins.none.width; p.height = pins.none.height;
    const pg = p.getContext('2d');
    pg.drawImage(pins[st] || pins.none, 0, 0);
    pg.drawImage(glyphImg, head.cx - glyph / 2, head.cy - glyph / 2, glyph, glyph);
    putImage(ml, `ev-pin-${st}`, p);
  }
  return { available: dotColor(dots.available), occupied: dotColor(dots.occupied) };
}
