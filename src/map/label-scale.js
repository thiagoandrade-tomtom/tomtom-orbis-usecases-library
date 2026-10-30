/* Scales every symbol layer's text-size AND icon-size by a uniform
   factor — the TomTom-Orbis-style equivalent of MapMaker's "Global
   symbol size" slider. Must be called after the style is fully loaded
   (initial load or post-style-swap).

   Why walk the expression instead of wrapping it:
   TomTom ships sizes as `["interpolate", ["linear"], ["zoom"], z, s, …]`.
   MapLibre's validator only accepts a `zoom` input as a *direct* child
   of `interpolate` / `step`, so wrapping the whole expression with
   `["*", scale, expr]` is rejected — the layer keeps its original size
   and the console fills with "zoom expression may only be used as
   input to a top-level step or interpolate expression" errors. So we
   recurse through the expressions that carry the zoom curve:
     ["interpolate", interp, input, z1, s1, z2, s2, …]
     ["step",        input,   s0, z1, s1, z2, s2, …]
     ["case",  cond, a, cond, b, fallback]
     ["match", input, label, val, label, val, fallback]
     ["coalesce", a, b, …]
     ["let", varName, valueExpr, body]            (rare; we scale the body)

   Below the zoom curve, any expression can be wrapped: a stop's output
   such as POI's `["/", 16.2, ["log10", …]]` (size by name length) or a
   country name's `["-", 17.6, ["get", …]]` becomes `["*", expr, scale]`.
   Multiplying only the numbers we recognised used to leave those at full
   size — every POI label among them. */

/* Whether `["zoom"]` appears anywhere in the expression: only then must
   we recurse instead of wrapping. */
const mentionsZoom = (expr) =>
  Array.isArray(expr) && (expr[0] === 'zoom' || expr.some(mentionsZoom));

function scaleExpression(expr, scale) {
  if (typeof expr === 'number') return expr * scale;
  if (!Array.isArray(expr) || expr.length === 0) return expr;
  if (!mentionsZoom(expr)) return ['*', expr, scale];

  const op = expr[0];

  // ["interpolate", interp, input, z1, s1, z2, s2, …]
  if (op === 'interpolate') {
    const head = expr.slice(0, 3); // op, interp, input
    const stops = expr.slice(3);
    const scaled = [];
    for (let i = 0; i < stops.length; i += 2) {
      scaled.push(stops[i]);                                 // zoom level — untouched
      scaled.push(scaleExpression(stops[i + 1], scale));     // size — recursed (usually a number)
    }
    return [...head, ...scaled];
  }

  // ["step", input, s0, z1, s1, z2, s2, …]
  if (op === 'step') {
    const out = [op, expr[1], scaleExpression(expr[2], scale)];
    for (let i = 3; i < expr.length; i += 2) {
      out.push(expr[i]);                                     // threshold — untouched
      out.push(scaleExpression(expr[i + 1], scale));         // output — recursed
    }
    return out;
  }

  // ["case", cond1, val1, cond2, val2, …, fallback]
  if (op === 'case') {
    const out = [op];
    let i = 1;
    while (i < expr.length - 1) {
      out.push(expr[i]);                                     // condition — untouched
      out.push(scaleExpression(expr[i + 1], scale));         // value — recursed
      i += 2;
    }
    out.push(scaleExpression(expr[i], scale));               // fallback
    return out;
  }

  // ["match", input, label, val, label, val, …, fallback]
  if (op === 'match') {
    const out = [op, expr[1]];
    let i = 2;
    while (i < expr.length - 1) {
      out.push(expr[i]);                                     // label — untouched
      out.push(scaleExpression(expr[i + 1], scale));         // value — recursed
      i += 2;
    }
    out.push(scaleExpression(expr[i], scale));               // fallback
    return out;
  }

  if (op === 'coalesce') {
    return [op, ...expr.slice(1).map(e => scaleExpression(e, scale))];
  }

  if (op === 'let') {
    // ["let", name1, val1, name2, val2, …, body]
    const out = expr.slice(0, -1);
    out.push(scaleExpression(expr[expr.length - 1], scale));
    return out;
  }

  // A zoom expression of a shape we don't know — leave it untouched
  // rather than break the layer.
  return expr;
}

export function applyLabelScale(mapLibreMap, scale) {
  if (!Number.isFinite(scale) || scale === 1) return;
  const style = mapLibreMap.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue;
    const layout = layer.layout || {};

    /* Both text-size and icon-size live on symbol layers. Scaling them
       with the same factor keeps the visual balance — MapMaker's slider
       moves both knobs in lockstep too. */
    for (const prop of ['text-size', 'icon-size']) {
      const value = layout[prop];
      if (value === undefined) continue;
      try {
        mapLibreMap.setLayoutProperty(layer.id, prop, scaleExpression(value, scale));
      } catch (err) {
        /* Surface the offending layer so we can tune the walker if the
           Orbis style introduces an expression shape we don't handle. */
        console.warn(`[label-scale] ${layer.id}.${prop}`, err.message);
      }
    }
  }
}
