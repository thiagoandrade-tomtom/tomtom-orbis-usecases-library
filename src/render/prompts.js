/* Prompt generators for the Quickstart → Prompt tab.

   Sharp differentiation between the two:

   - "agent"  → toolkit, not narrative. Names the MCP server, lists the
                APIs with docs URLs, states the API-key contract. Built
                for Claude Code / Cursor / Map Agent — the LLM has tools
                and follows references on its own; story-time wastes
                tokens. Output expectations are about runtime behaviour
                (errors, summary), not implementation steps.

   - "plain"  → spec doc, no implementation talk. User story, acceptance
                criteria, parameters, scope boundaries. Reads cleanly in
                Jira/Notion or pasted into a generic LLM that has no
                tools. No mention of SDK init code or fetch calls.

   Both pull live values via paramFor so the prompt always matches what
   the user just configured in the Configure panel. */

import { paramFor } from '../state.js';

const MAP_AGENT_DOCS = 'https://docs.tomtom.com/maps-sdk-js/examples/map-chat-agent-react';

function paramRows(uc) {
  if (!uc.params?.length) return null;
  return uc.params.map(p => {
    const v = paramFor(uc, p.key);
    const display = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v ?? '');
    return `- ${p.label} (${p.key}): ${display}`;
  }).join('\n');
}

/* For agent mode: include doc URLs so the LLM can fetch / link out. */
function toolRowsAgent(uc) {
  return uc.tools.map(t => {
    const ref = t.docs ? ` — ${t.docs}` : '';
    return `- ${t.name} [${t.type}]${ref}`;
  }).join('\n');
}

/* For specs mode: just the service names — no implementation hints. */
function toolRowsSpecs(uc) {
  return uc.tools.map(t => `- ${t.name}`).join('\n');
}

function viewLine(view) {
  const v = view || {};
  const style = v.style ?? 'standardDark';
  const lng = v.center?.[0] ?? 4.9041;
  const lat = v.center?.[1] ?? 52.3676;
  const zoom = v.zoom ?? 11;
  return { style, lng, lat, zoom };
}

/* ============================================================ AGENT */

export function agentPrompt(uc, view) {
  const params = paramRows(uc);
  const { style, lng, lat, zoom } = viewLine(view);
  return `# TomTom Orbis · ${uc.title}

## Map state (initialize with these values)
- style: ${style}
- center: [${lng}, ${lat}]
- zoom: ${zoom}

## Parameters (use verbatim, do not invent alternatives)
${params || '(none)'}

## Toolkit
- TomTom MCP server — preferred for geocoding, routing, search, traffic, EV. Call MCP tools instead of hand-rolling fetch when an MCP tool exists for the operation.
- Orbis Maps SDK (\`@tomtom-org/maps-sdk\`) — render on top of MapLibre.
- Map Agent React example — ${MAP_AGENT_DOCS} — reuse its agent + tool-calling shape if you need any chat UI.

## APIs in scope for this use case
${toolRowsAgent(uc)}

## API key
- Read from \`VITE_TOMTOM_API_KEY\`. Never embed.

## Output expectations
- One component, no premature abstractions. Render directly on the map.
- Surface tool-call errors instead of silently falling back to defaults.
- When done, return a single line: the TomTom endpoints / MCP tools you actually called.`;
}

/* ============================================================ SPECS */

export function plainPrompt(uc, view) {
  const params = paramRows(uc);
  const { style, lng, lat, zoom } = viewLine(view);
  return `# ${uc.title}

## Story
${uc.description}

## Acceptance criteria
- Map opens at style \`${style}\`, centered on [${lng}, ${lat}], zoom ${zoom}.
- The behaviour above is rendered directly on the map (markers, lines, layers, or popups as appropriate).
- Changing any parameter below updates the map in place — no full reload.
- The TomTom API key is read from environment configuration, never hard-coded.

## Parameters
${params || '(none)'}

## TomTom services involved
${toolRowsSpecs(uc)}

## Out of scope
- Auth, billing, analytics, error reporting infrastructure.
- Visual polish beyond what's needed to read the result on the map.
- Multi-user / persistence concerns.`;
}

export function promptFor(uc, style = 'agent', view) {
  return style === 'plain' ? plainPrompt(uc, view) : agentPrompt(uc, view);
}
