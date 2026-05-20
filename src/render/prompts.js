/* Prompt generators for the Quickstart → Prompt tab.

   Two styles:
   - "agent"  → opinionated, paste-ready for Claude Code / Cursor / other
                tool-using agents. Names TomTom MCP and the Map Chat Agent
                React example so the agent knows which tools to reach for.
   - "plain"  → neutral spec for any LLM; describes what to build and the
                live params, no agent-specific instructions.

   Both pull live values via paramFor so the prompt always matches what
   the user just configured in the Configure panel. */

import { paramFor } from '../state.js';

const MCP_TOOLS_HINT = `
- TomTom MCP server (geocoding, routing, search, traffic, EV) — prefer MCP tools over hand-rolling fetch calls when available
- Map Chat Agent React example: https://docs.tomtom.com/maps-sdk-js/examples/map-chat-agent-react — reuse its agent + tool-calling shape
- Orbis Maps SDK (@tomtom-org/maps-sdk) for rendering on top of MapLibre`;

function paramLines(uc) {
  if (!uc.params?.length) return '';
  return uc.params.map(p => {
    const v = paramFor(uc, p.key);
    const display = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v ?? '');
    return `- ${p.label} (${p.key}): ${display}`;
  }).join('\n');
}

function toolLines(uc) {
  return uc.tools.map(t => `- ${t.name} [${t.type}]`).join('\n');
}

export function agentPrompt(uc) {
  const params = paramLines(uc);
  return `You are helping me build a small TomTom Orbis demo: "${uc.title}".

Goal
${uc.description}

TomTom tooling to use
${MCP_TOOLS_HINT}

APIs & SDKs in scope for this use case
${toolLines(uc)}

${params ? `Live configuration (use these exact values)\n${params}\n\n` : ''}What to do
1. Scaffold a minimal React + Vite app (or extend the one I have open) that initializes the Orbis Maps SDK with style "standardDark", centered on Amsterdam (4.9041, 52.3676) at zoom 11.
2. Implement the "${uc.title}" behaviour using the APIs listed above. Prefer TomTom MCP tools for geocoding/routing/search calls. Don't hand-roll auth.
3. Read the API key from VITE_TOMTOM_API_KEY.
4. Keep the surface area small — one component, no premature abstractions. Render results directly on the map (markers, layers, popups as appropriate).
5. When you're done, give me a one-paragraph recap of what you wired up and any TomTom endpoints you called.

Constraints
- Use the parameter values above verbatim; do not invent alternatives.
- If a tool call fails, surface the error to me rather than silently falling back.
- Match the visual style of the Map Chat Agent React example for any chat/agent UI.`;
}

export function plainPrompt(uc) {
  const params = paramLines(uc);
  return `Build a TomTom Orbis demo: "${uc.title}".

${uc.description}

APIs & SDKs
${toolLines(uc)}

${params ? `Parameters\n${params}\n\n` : ''}Use the Orbis Maps SDK (@tomtom-org/maps-sdk) on top of MapLibre. Initialize with style "standardDark", center on Amsterdam (4.9041, 52.3676), zoom 11. Read the API key from VITE_TOMTOM_API_KEY. Render the result directly on the map (markers, lines, or layers as appropriate). Keep the implementation minimal.`;
}

export function promptFor(uc, style = 'agent') {
  return style === 'plain' ? plainPrompt(uc) : agentPrompt(uc);
}
