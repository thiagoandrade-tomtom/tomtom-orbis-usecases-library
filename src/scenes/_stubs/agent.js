/* Ask the map — a conversational map agent on the Orbis Maps SDK.

   The SDK's agent-toolkit plugin (createMapAgent) gives a language model
   tool-based control of the shared TomTomMap: locate, search, route,
   traffic, restyling and sandboxed data analysis. The plugin has no UI, so
   this scene is the chat: a side panel with the conversation, and under
   every answer the trace of tools the agent chained to get there — that
   trace is the point of the case.

   No AI model and no third-party key ship with this case. By default it
   runs in demo mode: a replay (agent-replays.js) stands in for the model —
   a scripted plan, run on the real tools and live TomTom data. Only if a
   TomTom-run model gateway is configured (VITE_AGENT_GATEWAY_URL, the kind
   of endpoint TomTom's own SDK agent examples use) do free questions open
   up; the viewer never brings a key.

   One conversation outlives scene replays: a theme or basemap swap, or a
   Configure change, tears the scene down and runs it again in the same
   tick, so teardown only parks the session and a microtask destroys it if
   nothing picked it up — i.e. the case was really closed. */

import { z } from 'zod';
import { paramFor } from '../../state.js';
import { applyLabelScale } from '../../map/label-scale.js';
import { StylingFoundationsModule, resetKnob, stylingFoundationsKnobCatalogue, stylingFoundationsKnobIds } from '@tomtom-org/maps-sdk/map';
import { MAP_LABEL_SCALE, idleView } from '../../map/config.js';
import { cssVar, city3DLook } from '../_shared.js';
import { icon, ICO_ARROW_UP, ICO_STOP, ICO_RESET, ICO_CHEV_DOWN, ICO_EXT, ICO_SPARKLES } from '../../ui/icons.js';
import { REPLAYS, ENTRY, SHOWN } from './agent-replays.js';

const GATEWAY_URL = import.meta.env.VITE_AGENT_GATEWAY_URL || '';
const GATEWAY_MODEL = import.meta.env.VITE_AGENT_GATEWAY_MODEL || 'gpt-4.1';
/* Where a visitor takes their own questions without a model here: the
   TomTom Maps MCP Server brings the same TomTom tools to their AI assistant. */
const MCP_SETUP = 'https://docs.tomtom.com/tomtom-maps-mcp/documentation/quick-setup';

const PROMPT_SUFFIX = [
  'You are the map assistant in a TomTom Orbis Maps demo.',
  'Reply in the language the user writes in.',
  'Do the work on the map rather than describing it, then answer in two to four short sentences or a short list, with the numbers that matter (distance, time, delay, count).',
  // Accuracy: every number comes from a tool result, and a gap is said out loud.
  'State only facts and numbers that a tool returned in this conversation; never estimate or fill in from memory. If a tool failed or returned nothing, say so plainly instead of guessing.',
  'Live data (traffic, charger availability, opening hours) is a snapshot: say it is current as of now.',
  'Use metric units unless asked otherwise. Use only TomTom data and services.',
  // Scope: a map assistant, not a general chatbot, and nothing personal.
  'Only help with places, routes, traffic and the map itself; politely decline anything else.',
  'Never ask for personal data such as home address, name or phone number; if the user shares some, use it only for the map task at hand.',
].join(' ');

/* A session is a demo, not a workday: past this many turns, start over. */
const MAX_TURNS = 20;

/* The data tools write and run code — worth a little more thinking. */
const CODE_TOOLS = new Set(['analyseData', 'processData', 'monitorAnalysis', 'createTracker', 'clusterIncidents']);

/* Tool → what it does, in the user's words. The code name rides along in
   the trace so a developer sees which SDK tool ran. */
const TOOL_LABEL = {
  locatePlace: 'Find a place', reverseGeocode: 'Read the address', discoverPlaces: 'Search places',
  getPOICategoryCodes: 'Look up categories', getViewport: 'Read the view',
  setRoute: 'Calculate the route', addWaypointsToRoute: 'Add stops', removeWaypointsFromRoute: 'Remove stops',
  replaceWaypointInRoute: 'Change a stop', getCurrentWaypoints: 'Read the stops',
  startRouteMonitor: 'Keep the route live', stopRouteMonitor: 'Stop the route monitor',
  findReachableAreas: 'Map the reachable area',
  getTrafficIncidents: 'Fetch traffic incidents', setTrafficIncidentsMonitor: 'Keep incidents live',
  clusterIncidents: 'Find hotspots', focusIncidents: 'Highlight incidents', getTrafficAreaAnalytics: 'Read area analytics',
  analyseData: 'Analyse the data', processData: 'Transform the data', monitorAnalysis: 'Keep the analysis live',
  createTracker: 'Set up an alert', getTrackers: 'Read alerts', getTrackerHistory: 'Read alert history', clearTracker: 'Remove an alert',
  updatePlacesDisplay: 'Style the places', updateRoutesDisplay: 'Show the routes', updateWaypointsDisplay: 'Show the stops',
  updateTrafficAreaAnalyticsDisplay: 'Show the analytics', clearMap: 'Clear the map',
  flyTo: 'Move the camera', zoomInOrOut: 'Zoom', setPitchBearing: 'Tilt the camera',
  getStandardMapStyles: 'List map styles', setMapStandardStyle: 'Switch the map style', setLanguage: 'Set the language',
  setGeopoliticalView: 'Set the political view', setMapStyling: 'Restyle the map',
  getMapStyleLayers: 'Read the style layers', setLayerProperties: 'Edit style layers',
  recallState: 'Recall earlier results', resetState: 'Start over', showCity3D: 'Show the city in 3D',
};
const labelFor = name => TOOL_LABEL[name] || name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

/** A copy in random order (Fisher–Yates). */
function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Just enough Markdown for an agent's short answers: paragraphs, bullet
   and numbered lists, bold, inline code. Escaped first, so nothing the
   model writes becomes markup. */
function md(text) {
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return text.trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-*•]\s+/.test(l))) {
      return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) {
      return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

/* The one input worth showing next to a tool: the first short string in
   its arguments (a query, a place, a style name). */
function inputHint(input, depth = 0) {
  if (typeof input === 'string') return input.length <= 64 && !input.startsWith('#') ? input : '';
  if (!input || typeof input !== 'object' || depth > 2) return '';
  for (const [k, v] of Object.entries(input)) {
    // Code and internal dataset / place ids mean nothing to a reader.
    if (k === 'code' || /id$|ids$/i.test(k)) continue;
    const hit = inputHint(v, depth + 1);
    if (hit) return hit;
  }
  return '';
}

/* The SDK plugin, the model providers and Chart.js are only needed here —
   loaded when the case opens, not with the app. */
let libs = null;
const loadLibs = () => libs ||= Promise.all([
  import('@tomtom-org/maps-sdk-plugin-agent-toolkit'),
  import('chart.js'),
  GATEWAY_URL ? import('@ai-sdk/azure') : null,
]).then(([toolkit, chart, azure]) => {
  chart.Chart.register(...chart.registerables);
  return { toolkit, Chart: chart.Chart, azure };
}).catch(err => { libs = null; throw err; });

/* The live model, if this build has one: { main, fast, name, options }. */
function liveModel(lib) {
  if (GATEWAY_URL && lib.azure) {
    // Auth is the gateway's job (origin, captcha, quotas) — no key ships here.
    const gw = lib.azure.createAzure({ baseURL: GATEWAY_URL, apiKey: 'gateway' });
    return { main: gw(GATEWAY_MODEL), fast: gw(GATEWAY_MODEL), name: 'TomTom AI gateway' };
  }
  return null;
}

/* ---------------------------------------------------------------- replay

   A LanguageModelV4 that reads its next move from the active replay
   instead of a model: tool calls while the replay has steps, then the
   answer, streamed in small chunks so it reads like a model typing. The
   toolkit can't tell the difference — its tools run for real. */

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** Tool results since the last user message, in call order. */
function turnResults(prompt) {
  const start = prompt.findLastIndex(m => m.role === 'user');
  const results = [];
  for (const m of prompt.slice(start + 1)) {
    if (m.role !== 'tool') continue;
    for (const part of m.content) {
      if (part.type !== 'tool-result') continue;
      const o = part.output;
      results.push({ name: part.toolName, out: o?.type === 'json' ? o.value : o?.type === 'text' ? o.value : o?.value ?? o });
    }
  }
  return results;
}

/** Resolves once the map stops moving (or after `cap` ms). */
/** The camera as a setView target: what recenter and a re-run go back to. */
function cameraOf(ml) {
  const c = ml.getCenter();
  return { center: [c.lng, c.lat], zoom: ml.getZoom(), pitch: ml.getPitch(), bearing: ml.getBearing() };
}

function cameraSettled(ml, cap = 10000) {
  if (!ml?.isMoving?.()) return Promise.resolve();
  return new Promise(done => {
    const t = setTimeout(finish, cap);
    function finish() { clearTimeout(t); ml.off('moveend', finish); done(); }
    ml.on('moveend', finish);
  });
}

function replayModel(s) {
  const streamOf = parts => new ReadableStream({
    async start(c) {
      for (const p of parts) {
        if (p.pause) { await wait(p.pause); continue; }
        c.enqueue(p);
      }
      c.close();
    },
  });
  return {
    specificationVersion: 'v4', provider: 'replay', modelId: 'replay', supportedUrls: {},
    async doGenerate() { throw new Error('Replays only stream.'); },
    async doStream({ prompt }) {
      // A model takes a moment between steps; a replay waits for the camera
      // instead, so one move never cuts the last one short.
      await cameraSettled(s.ctx.ml);
      const replay = REPLAYS[s.replay];
      const results = turnResults(prompt);
      if (import.meta.env.DEV) console.debug('[replay]', s.replay, results);
      const stepIndex = prompt.slice(prompt.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'assistant').length;
      const step = replay?.steps[stepIndex]?.(results, s.memo) || { text: 'Done.' };
      const think = reducedMotion() ? 0 : 450;
      const parts = [{ type: 'stream-start', warnings: [] }, { pause: think }];
      if (step.calls) {
        step.calls.forEach(([toolName, input], i) => parts.push({
          type: 'tool-call', toolCallId: `replay-${Date.now()}-${stepIndex}-${i}`, toolName, input: JSON.stringify(input),
        }));
        parts.push({ type: 'finish', usage: USAGE, finishReason: { unified: 'tool-calls', raw: 'tool_use' } });
      } else {
        parts.push({ type: 'text-start', id: 't' });
        for (const chunk of step.text.match(/\S+\s*/g) || []) {
          parts.push({ type: 'text-delta', id: 't', delta: chunk });
          if (!reducedMotion()) parts.push({ pause: 18 });
        }
        parts.push({ type: 'text-end', id: 't' }, { type: 'finish', usage: USAGE, finishReason: { unified: 'stop', raw: 'end_turn' } });
      }
      return { stream: streamOf(parts) };
    },
  };
}

/* One agent, two brains: a replay turn reads the script, any other turn
   the live model. Both share the agent's state, so a typed follow-up can
   build on what a replay put on the map. */
function routerModel(s) {
  const pick = () => (s.replay ? s.replayModel : s.live.main);
  return {
    specificationVersion: 'v4', provider: 'ask-the-map', modelId: 'router', supportedUrls: {},
    doGenerate: o => pick().doGenerate(o),
    doStream: o => pick().doStream(o),
  };
}

/* ---------------------------------------------------------------- session */

let session = null;

function destroySession() {
  if (!session) return;
  session.abort?.abort();
  for (const c of session.charts) { try { c.destroy(); } catch {} }
  try { session.agent?.destroy(); } catch {}
  session = null;
}

export default async function agent(ctx, uc) {
  const revived = !!session?.parked;
  if (session && !revived) destroySession();
  session ||= {
    turns: [], history: [], charts: [], shownAnalyses: new Set(),
    agent: null, abort: null, busy: false, replay: null, more: false, memo: {},
    order: shuffled(ENTRY),
  };
  const s = session;
  s.parked = false;
  s.ctx = ctx;

  // Apply or a theme swap re-runs the scene: with a chat on screen, the map
  // stays where the answers left it instead of flying home.
  if (revived && s.turns.length && s.camera) { ctx.ml.jumpTo(s.camera); ctx.markHome(s.camera); }
  // Opens on the app's own home globe (tilted, horizon showing, sized for
  // the viewport); each prompt flies to its city, and MapLibre flattens the
  // globe into Mercator as it zooms in.
  else {
    // `globe: true` on the case keeps the home globe as it is; coming from
    // another case, put the globe back and fly home.
    const home = idleView();
    const c = ctx.ml.getCenter();
    const atHome = Math.abs(ctx.ml.getZoom() - home.zoom) < 0.3
      && Math.abs(c.lng - home.center[0]) < 2 && Math.abs(c.lat - home.center[1]) < 2;
    ctx.ml.setProjection({ type: 'globe' });
    // Already there: record it for recenter, move nothing.
    if (atHome) ctx.markHome(home);
    else ctx.setView(home);
  }
  frameAroundPanels(ctx);
  smoothCamera(ctx, s);
  // The SDK re-applies the agent's colours over every new style, so a
  // light/dark or basemap switch only half happened. The switch wins: drop
  // the colours the agent set; the rest of its work (3D, hidden POIs) stays.
  const look = `${document.documentElement.getAttribute('data-theme')}|${document.documentElement.getAttribute('data-map-family')}`;
  if (revived && s.recoloured && s.look !== look) { s.recoloured = false; resetAgentColours(ctx.map); }
  s.look = look;
  // The agent restyles the map through the SDK, which rewrites label sizes
  // from the style's own: keep the library's 0.7 scale after every change.
  let relabel = 0;
  ctx.on('styledata', () => {
    clearTimeout(relabel);
    relabel = setTimeout(() => { if (!ctx.cancelled) applyLabelScale(ctx.ml, MAP_LABEL_SCALE); }, 120);
  });
  ctx.onTeardown(() => clearTimeout(relabel));
  s.sdkNames = paramFor(uc, 'steps') === 'sdk';
  // The agent turned it on this session: a replay tore it down with the old ctx.
  if (s.city3d) ctx.enableCity3D(city3DLook(s.city3dLook));
  ctx.onTeardown(() => {
    const ml = ctx.ml;
    s.camera = cameraOf(ml);
    s.parked = true;
    queueMicrotask(() => { if (s === session && s.parked) destroySession(); });
  });

  mountPanel(s);

  try {
    const lib = await loadLibs();
    if (ctx.cancelled) return;
    s.lib = lib;
  } catch (err) {
    console.error('[agent] load', err);
    ctx.showError("Agent didn't load", { detail: 'Check your connection.' });
    return;
  }

  const live = liveModel(s.lib);
  if (s.agent && s.live?.name !== live?.name) { try { s.agent.destroy(); } catch {} s.agent = null; }
  s.live = live;
  render(s);
}

/* The toolkit frames its own results straight on MapLibre, which knows
   nothing of the detail panel or the chat: routes and pins landed under
   them. While the case is open, every fitBounds keeps clear of both — and
   a city-block result (a few cafés, one stop) is framed tilted, so the 3D
   buildings and landmarks around it show. Routes and regions stay flat. */
const TILT_UNDER_M = 3000;
const TILT = 55;

/** Diagonal of a bounds in metres, whatever shape it came in. */
function spanMeters(b) {
  const [w, s, e, n] = Array.isArray(b) ? (b.length === 4 ? b : [...b[0], ...b[1]])
    : [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const k = 111320;
  const dx = (e - w) * k * Math.cos(((s + n) / 2) * Math.PI / 180);
  return Math.hypot(dx, (n - s) * k);
}

/** The map's free area as padding: clear of the panels, topbar and
    controls. Both panels open on a narrow window can leave no room at all,
    and MapLibre then skips the move — so keep at least ~35% of it free. */
function freeArea(ctx) {
  const pad = { ...ctx.safePadding() };
  const { width, height } = ctx.ml.getContainer().getBoundingClientRect();
  const squeeze = (a, b, size) => {
    const k = Math.min(1, (size * 0.65) / (pad[a] + pad[b]));
    pad[a] = Math.round(pad[a] * k); pad[b] = Math.round(pad[b] * k);
  };
  // A panel mid-drag or tucked away can report no box: never hand MapLibre a
  // NaN or negative inset, it rejects the whole move.
  for (const k of ['top', 'right', 'bottom', 'left']) pad[k] = Number.isFinite(pad[k]) ? Math.max(0, pad[k]) : 0;
  if (!(width > 0 && height > 0)) return pad;
  squeeze('left', 'right', width);
  squeeze('top', 'bottom', height);
  return pad;
}

// The palette a theme sets: the map colours and the sky over them.
const COLOUR_KNOBS = stylingFoundationsKnobIds.filter(id => id.startsWith('colors.') || id.startsWith('view.sky.'));

async function resetAgentColours(map) {
  try {
    const styling = await StylingFoundationsModule.get(map);
    for (const id of COLOUR_KNOBS) { try { resetKnob(styling, stylingFoundationsKnobCatalogue, id); } catch {} }
  } catch (err) {
    console.warn('[agent] reset colours', err?.message || err);
  }
}

function frameAroundPanels(ctx) {
  const ml = ctx.ml;
  const own = ml.fitBounds;
  const shadowed = Object.hasOwn(ml, 'fitBounds');
  ml.fitBounds = function (bounds, opts = {}) {
    const pad = freeArea(ctx);
    let pitch = 0;
    try { pitch = spanMeters(bounds) < TILT_UNDER_M ? TILT : 0; } catch {}
    // absolutePadding: setView leaves its own padding on the map, and the two would add up.
    try {
      return own.call(this, bounds, { ...opts, pitch, padding: pad, absolutePadding: true });
    } catch (err) {
      // Never let framing fail a tool: fall back to the caller's own move.
      console.warn('[agent] framing', err?.message || err);
      return own.call(this, bounds, opts);
    }
  };
  ctx.onTeardown(() => { if (shadowed) ml.fitBounds = own; else delete ml.fitBounds; });
}

/* The toolkit's camera tools take no duration, so the agent's moves snap
   by in half a second — too fast to follow. While a turn runs, every move
   it makes is eased out over a couple of seconds (a flight a little
   slower); the viewer's own drags and zooms between turns are untouched. */
const EASE_MS = 2200;
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function smoothCamera(ctx, s) {
  const ml = ctx.ml;
  const own = { easeTo: ml.easeTo, flyTo: ml.flyTo, jumpTo: ml.jumpTo };
  const shadowed = Object.fromEntries(Object.keys(own).map(k => [k, Object.hasOwn(ml, k)]));
  const agentMove = () => s.busy && !reducedMotion();
  ml.easeTo = function (opts = {}, data) {
    if (!agentMove()) return own.easeTo.call(this, opts, data);
    return own.easeTo.call(this, { easing: easeInOut, ...opts, duration: Math.max(opts.duration ?? 0, EASE_MS) }, data);
  };
  ml.flyTo = function (opts = {}, data) {
    if (!agentMove()) return own.flyTo.call(this, opts, data);
    // Land the target in the free area, not behind the chat.
    return own.flyTo.call(this, { padding: freeArea(ctx), ...opts, speed: Math.min(opts.speed ?? 1.2, 0.6), duration: undefined, maxDuration: 9000 }, data);
  };
  ml.jumpTo = function (opts = {}, data) {
    if (!agentMove()) return own.jumpTo.call(this, opts, data);
    return ml.easeTo({ ...opts }, data);
  };
  ctx.onTeardown(() => {
    for (const k of Object.keys(own)) { if (shadowed[k]) ml[k] = own[k]; else delete ml[k]; }
  });
}

/* This case's own tool, next to the toolkit's defaults: the agent can turn
   the city into full 3D (the Discover places look). A custom ToolEntry is
   how an app hands the agent its own capabilities. */
function showCity3DTool(s) {
  return {
    description: 'Show the city in full 3D: lit, textured buildings with shadows, animated water and 3D trees. `look: "dusk"` lights it with a low, warm sun and lit windows. Use for "show it in 3D", city tours, landmarks, a time of day. Then flyTo zoom 16+ and setPitchBearing pitch 55-65.',
    classificationPrompt: 'The user wants to see buildings, a landmark or a city in 3D, or a city tour.',
    inputSchema: z.object({ look: z.enum(['day', 'dusk']).optional().describe('Lighting: day (default) or dusk') }),
    tags: ['map'],
    relatedTools: ['flyTo', 'setPitchBearing'],
    execute: async ({ look = 'day' } = {}) => {
      if (!s.city3d || s.city3dLook !== look) s.ctx.enableCity3D(city3DLook(look));
      s.city3d = true;
      s.city3dLook = look;
      return { shown: true, look };
    },
  };
}

function buildAgent(s) {
  const { createMapAgent, createDefaultClassifier } = s.lib.toolkit;
  s.replayModel = replayModel(s);
  const liveClassifier = s.live ? createDefaultClassifier({ model: s.live.fast }) : null;
  s.agent = createMapAgent(s.ctx.map, {
    model: s.live ? routerModel(s) : s.replayModel,
    // Picking the tools for a turn is a small job for the cheaper model; a
    // replay already knows its tools.
    classifier: liveClassifier ? (c => (s.replay ? Promise.resolve(null) : liveClassifier(c))) : false,
    systemPromptSuffix: PROMPT_SUFFIX,
    ...(s.live?.options && {
      providerOptions: s.live.options,
      stepProviderOptions: ({ activeTools }) =>
        !s.replay && activeTools?.some(t => CODE_TOOLS.has(t)) ? s.live.codeOptions : undefined,
    }),
    // No customer GeoJSON from URLs, and no precise GPS fix sent to the model.
    datasets: { byod: { enabled: false } },
    tools: { getCurrentLocation: false, showCity3D: showCity3DTool(s) },
    // Generated analysis code runs isolated or not at all — never in this page.
    codeExecution: { allowMainThreadFallback: false, timeoutMs: 8000 },
    maxSteps: 12,
  });
}

async function ask(s, text, replayId = null) {
  text = text.trim();
  if (!text || s.busy || s.turns.length >= MAX_TURNS) return;
  if (!replayId && !s.live) return;
  if (!s.agent) buildAgent(s);

  const turn = { text, items: [], charts: [], state: 'run', replay: replayId, t0: performance.now() };
  s.turns.push(turn);
  s.history.push({ role: 'user', content: text });
  s.busy = true;
  s.replay = replayId;
  s.abort = new AbortController();
  s.ctx.beginLoading('Thinking…');
  render(s);

  const lastText = () => {
    const last = turn.items.at(-1);
    if (last?.kind === 'text') return last;
    const item = { kind: 'text', text: '' };
    turn.items.push(item);
    return item;
  };
  const toolById = new Map();
  let frame = 0;
  const paint = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderTurn(s, turn); }); };

  try {
    const result = await s.agent.stream({ messages: s.history, abortSignal: s.abort.signal });
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          lastText().text += part.text;
          paint();
          break;
        case 'tool-call': {
          const step = { kind: 'tool', id: part.toolCallId, name: part.toolName,
            hint: inputHint(part.input), state: 'run', t0: performance.now() };
          toolById.set(step.id, step);
          turn.items.push(step);
          s.ctx.beginLoading(`${labelFor(step.name)}…`);
          paint();
          break;
        }
        case 'tool-result':
        case 'tool-error': {
          const step = toolById.get(part.toolCallId);
          if (!step) break;
          const failed = part.type === 'tool-error' || (part.output && typeof part.output === 'object' && 'error' in part.output);
          step.state = failed ? 'error' : 'done';
          step.ms = performance.now() - step.t0;
          if (failed) step.error = String(part.error?.message || part.output?.error || 'failed').slice(0, 140);
          s.ctx.beginLoading('Thinking…');
          if (step.name === 'analyseData') collectCharts(s, turn);
          if (step.name === 'setMapStyling' && !failed) s.recoloured = true;
          paint();
          break;
        }
        case 'error':
          throw part.error;
      }
    }
    s.history.push(...await result.responseMessages);
    turn.state = 'done';
    turn.ms = performance.now() - turn.t0;
  } catch (err) {
    // A failed turn leaves no half answer in the history the model sees next.
    s.history.splice(s.history.findLastIndex(m => m.role === 'user' && m.content === text));
    if (s.abort?.signal.aborted) {
      turn.state = 'stopped';
    } else {
      turn.state = 'error';
      console.error('[agent]', err);
      const status = err?.statusCode ?? err?.lastError?.statusCode;
      s.ctx.showError('No answer', {
        detail: status === 429 ? 'Model busy. Try again.'
          : status === 401 || status === 403 ? 'Model gateway refused this page.'
          : 'Model or TomTom service failed.',
        retry: () => { s.turns.splice(s.turns.indexOf(turn), 1); ask(s, text, replayId); },
      });
    }
  } finally {
    cancelAnimationFrame(frame);
    // Recenter goes back to the latest answer, not to the opening globe.
    if (turn.state === 'done') cameraSettled(s.ctx.ml).then(() => { if (!s.ctx.cancelled) s.ctx.markHome(cameraOf(s.ctx.ml)); });
    for (const step of toolById.values()) if (step.state === 'run') step.state = 'stopped';
    s.busy = false;
    s.replay = null;
    s.abort = null;
    s.ctx.endLoading();
    collectCharts(s, turn);
    render(s);
  }
}

/* Charts come back as Chart.js configs on the analyses registry, not in
   the tool result: pick up every one this session hasn't drawn yet. */
function collectCharts(s, turn) {
  for (const rec of s.agent?.state?.analyses?.all?.() || []) {
    const latest = rec.history.at(-1);
    const id = `${rec.analysisId}@${latest?.timestamp}`;
    if (rec.outputFormat !== 'chart' || !latest || s.shownAnalyses.has(id)) continue;
    s.shownAnalyses.add(id);
    turn.charts.push({ title: rec.description || rec.name, config: latest.data });
  }
}

/* ---------------------------------------------------------------- panel */

function mountPanel(s) {
  s.ctx.setSidePanel(`<div class="trip-card ask-card">
    <div class="ask-head">
      <span class="trip-eyebrow ask-source"></span>
      <button type="button" class="dsp-btn ask-reset" data-act="reset" title="Clear the chat and pick another prompt">${icon(ICO_RESET, 12)}Other prompts</button>
    </div>
    <div class="ask-log" aria-live="polite"></div>
    <div class="ask-dock"></div>
  </div>`);
  const host = document.getElementById('map-side');
  if (!host) return;
  s.host = host;
  const card = host.querySelector('.ask-card');
  card.addEventListener('click', e => onClick(s, e));
  card.addEventListener('submit', e => onSubmit(s, e));
  card.addEventListener('keydown', e => {
    if (e.target.matches('.ask-input') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });
  card.addEventListener('input', e => {
    if (e.target.matches('.ask-input')) grow(e.target);
  });
}

/* "Build it": the detail panel's Prompt tab already writes this case up
   for a coding agent. Its tab click also expands a minimized panel. */
function openPromptTab() {
  document.querySelector('#panel-detail .dd-tab[data-tab="prompt"]')?.click();
}

function grow(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

function onClick(s, e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'stop') s.abort?.abort();
  else if (act === 'more') { s.more = true; render(s); }
  else if (act === 'build') openPromptTab();
  else if (act === 'reset') {
    if (s.busy) s.abort?.abort();
    for (const c of s.charts) { try { c.destroy(); } catch {} }
    s.charts = [];
    s.turns = [];
    s.history = [];
    s.more = false;
    s.memo = {};
    s.ctx.markHome(idleView());
    try { s.agent?.destroy(); } catch {}
    s.agent = null;
    render(s);
  } else if (act === 'replay') {
    const r = REPLAYS[btn.dataset.id];
    // With a live model, a suggestion is just a question; without one, its replay answers.
    if (r) ask(s, r.prompt, s.live ? null : btn.dataset.id);
  }
}

function onSubmit(s, e) {
  e.preventDefault();
  const input = e.target.elements.q;
  if (!input || !s.live) return;
  const text = input.value;
  input.value = '';
  grow(input);
  ask(s, text);
}

function render(s) {
  const host = s.host;
  if (!host || !host.querySelector('.ask-log')) return;
  const log = host.querySelector('.ask-log');
  host.querySelector('.ask-head [data-act="reset"]')?.toggleAttribute('hidden', !s.turns.length);
  const src = host.querySelector('.ask-source');
  if (src) {
    src.textContent = s.live ? `AI · ${s.live.name}` : 'Agent demo';
    src.title = s.live ? 'Answers from a live AI model' : 'Each prompt replays a set agent plan: the real agent tools, on live TomTom data.';
  }
  for (const c of s.charts) { try { c.destroy(); } catch {} }
  s.charts = [];
  log.innerHTML = s.turns.length ? s.turns.map((t, i) => `<div class="ask-turn" data-turn="${i}">${turnHtml(s, t)}</div>`).join('') : introHtml(s);
  s.turns.forEach((t, i) => drawCharts(s, t, log.querySelector(`[data-turn="${i}"] .ask-charts`)));
  renderDock(s);
  host.scrollTop = s.turns.length ? host.scrollHeight : 0;
}

function renderTurn(s, turn) {
  const i = s.turns.indexOf(turn);
  const el = s.host?.querySelector(`[data-turn="${i}"]`);
  if (!el) return render(s);
  const atBottom = s.host.scrollTop + s.host.clientHeight >= s.host.scrollHeight - 24;
  el.innerHTML = turnHtml(s, turn);
  drawCharts(s, turn, el.querySelector('.ask-charts'));
  if (atBottom) s.host.scrollTop = s.host.scrollHeight;
}

const SPARK = icon(ICO_SPARKLES, 12, 'ask-spark');
const promptBtn = id => `<button type="button" class="ask-prompt" data-act="replay" data-id="${id}">${SPARK}<span>${esc(REPLAYS[id].prompt)}</span></button>`;

/* Empty state, like the SDK's own agent examples: what it does, then
   prompts to pick — nobody has to think of a first question. */
function introHtml(s) {
  // Demo mode has no input, so it asks for a pick, not for words.
  return `<p class="ask-intro">${s.live ? 'Ask in plain words, or pick a prompt.' : 'Pick a prompt and watch the agent work the map.'}</p>
    <div class="ask-pick">
      ${s.order.slice(0, SHOWN).map(promptBtn).join('')}
      ${s.more ? s.order.slice(SHOWN).map(promptBtn).join('') : `<button type="button" class="dsp-btn ask-more" data-act="more">More ${icon(ICO_CHEV_DOWN, 12)}</button>`}
    </div>`;
}

/* A reply reads top to bottom: the question, one row with every tool the
   agent called (details on hover), then the answer and any chart. */
/* What to ask next, under the latest answer: its follow-up first (it leans
   on what the agent remembers), then prompts not tried yet. */
function nextPrompts(s, t) {
  if (s.busy || t !== s.turns.at(-1) || t.state !== 'done') return [];
  const follow = Object.values(REPLAYS).find(r => r.prompt === t.text)?.follow;
  const fresh = s.order.filter(id => !s.turns.some(x => x.text === REPLAYS[id].prompt));
  return [follow, ...fresh].filter(Boolean).slice(0, 2);
}

function turnHtml(s, t) {
  const steps = t.items.filter(i => i.kind === 'tool');
  const text = t.items.filter(i => i.kind === 'text').map(i => i.text).join('\n\n').trim();
  const trace = steps.length ? `<div class="ask-trace">${steps.map(st => stepHtml(st, s.sdkNames)).join('')}${
    t.state === 'done' && t.ms ? `<span class="ask-time" title="Time to answer">${(t.ms / 1000).toFixed(1)} s</span>` : ''}</div>` : '';
  const tail = t.state === 'stopped' ? '<p class="ask-meta">Stopped.</p>'
    : t.state === 'error' ? '<p class="ask-meta is-error">No answer.</p>' : '';
  return `<div class="ask-user">${esc(t.text)}</div>
    <div class="ask-agent"><span class="ask-avatar" aria-hidden="true">${icon(ICO_SPARKLES)}</span><div class="ask-agent-body">${trace}${text ? `<div class="ask-answer">${md(text)}</div>` : t.state === 'run' && !steps.length ? '<p class="ask-meta">Thinking…</p>' : ''}<div class="ask-charts"></div>${tail}</div></div>${
    (ids => ids.length ? `<div class="ask-next">${ids.map(promptBtn).join('')}</div>` : '')(nextPrompts(s, t))}`;
}

function stepHtml(step, sdk) {
  const time = step.ms >= 100 ? ` · ${(step.ms / 1000).toFixed(1)} s` : '';
  const tip = step.error ? `${step.name} failed: ${step.error}` : `${step.name}${step.hint ? ` · ${step.hint}` : ''}${time}`;
  return `<span class="ask-tool is-${step.state}${sdk ? ' is-code' : ''}" title="${esc(tip)}">${esc(sdk ? step.name : labelFor(step.name))}</span>`;
}

function drawCharts(s, turn, slot) {
  if (!slot || !turn.charts.length || !s.lib) return;
  const { Chart } = s.lib;
  Chart.defaults.color = cssVar('--t-med', '#666');
  Chart.defaults.borderColor = cssVar('--b-lo', '#ddd');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const ink2 = cssVar('--c-neutral', '#3C5C98');
  for (const { title, config } of turn.charts) {
    const fig = document.createElement('figure');
    fig.className = 'ask-chart';
    fig.innerHTML = `<figcaption>${esc(title)}</figcaption><div class="ask-chart-box"><canvas></canvas></div>`;
    slot.append(fig);
    try {
      const cfg = structuredClone(config);
      cfg.options = { ...cfg.options, responsive: true, maintainAspectRatio: false, animation: false };
      // The model rarely picks colours, and Chart.js's grey vanishes on dark:
      // fill what it left blank with the map's own data colour.
      const sets = cfg.data?.datasets || [];
      sets.forEach(d => { d.backgroundColor ??= ink2; d.borderColor ??= ink2; });
      // One series: the caption already names it.
      cfg.options.plugins = { ...cfg.options.plugins, legend: { display: sets.length > 1, ...cfg.options.plugins?.legend } };
      // Street names run long in a 320px panel.
      if (Array.isArray(cfg.data?.labels)) cfg.data.labels = cfg.data.labels.map(l => (typeof l === 'string' && l.length > 18 ? `${l.slice(0, 17)}…` : l));
      s.charts.push(new Chart(fig.querySelector('canvas'), cfg));
    } catch (err) {
      console.warn('[agent] chart', err);
      fig.remove();
    }
  }
}

/* Under a live composer: how far to trust the answers and where the
   questions go. Demo mode says its part in the panel head. */
function disclosure(s) {
  return s.live
    ? `<p class="ask-fine">AI can be wrong; check the steps. Questions go to ${esc(s.live.name)}. No personal data.</p>`
    : ''; // The head says it: "Agent demo", details on hover.
}

function renderDock(s) {
  const dock = s.host.querySelector('.ask-dock');
  if (!dock) return;
  if (s.turns.length >= MAX_TURNS && !s.busy) {
    dock.innerHTML = `<p class="ask-meta">Demo limit reached.</p>
      <button type="button" class="dsp-btn" data-act="reset">New chat</button>${disclosure(s)}`;
    return;
  }
  const draftEl = dock.querySelector('.ask-input');
  const draft = draftEl?.value || '';
  const focused = document.activeElement === draftEl;
  dock.innerHTML = `${s.live ? `<form class="ask-form">
      <textarea name="q" class="ask-input" rows="1" aria-label="Ask the map"
        placeholder="Ask about places, routes, traffic"${s.busy ? ' disabled' : ''}>${esc(draft)}</textarea>
      ${s.busy
        ? `<button type="button" class="ask-send is-stop" data-act="stop" title="Stop" aria-label="Stop">${icon(ICO_STOP)}</button>`
        : `<button type="submit" class="ask-send" title="Send" aria-label="Send">${icon(ICO_ARROW_UP)}</button>`}
    </form>` : s.busy ? `<div class="ask-own"><button type="button" class="dsp-btn" data-act="stop">Stop</button></div>`
      // No model here: no fake input. Two real ways to ask your own questions.
      : `<div class="ask-own">
      <span class="ask-own-label">Want to ask your own?</span>
      <button type="button" class="dsp-btn" data-act="build" title="Prompt for your coding agent to build this">Build it</button>
      <a class="dsp-btn ask-own-link" href="${MCP_SETUP}" target="_blank" rel="noopener" title="Add TomTom tools to Claude, Copilot or Cursor">In your AI assistant ${icon(ICO_EXT, 12)}</a>
    </div>`}
    ${disclosure(s)}`;
  const input = dock.querySelector('.ask-input');
  if (!input) return;
  grow(input);
  if (s.live && (focused || (!s.busy && s.turns.length))) input.focus({ preventScroll: true });
}
