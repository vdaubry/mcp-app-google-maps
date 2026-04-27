/**
 * Agent-facing instructions for the @vdaubry/mcp-app-google-maps MCP server.
 *
 * Returned via the standard MCP `initialize.instructions` field so any MCP host
 * (Claude Desktop, ChatGPT, yapa-ai, basic-host) can pick them up automatically.
 *
 * The server doesn't know whether it's serving an interactive UI or a voice-only
 * channel; channel/voice gating is the host's responsibility (e.g. yapa-ai
 * appends a generic "use the widget when on web" suffix only on web text mode).
 */

export const GOOGLE_MAPS_INSTRUCTIONS = `## Maps & Places

You have access to a Google Maps MCP App with directions, place search, and
geocoding. On hosts that support MCP App UI (SEP-1865), the result of the
following tools renders an interactive map widget directly inside the chat
bubble — describe the result briefly in text, do NOT paraphrase the data the
widget already shows.

### Tools
- \`get_directions\` — origin + destination + optional mode (default: bicycling).
  Renders the directions widget (route line, mode tabs, step-by-step).
- \`nearby_places\` — center coordinates + radius + optional type. Renders the
  nearby-search widget (numbered markers, list, filters).
- \`search_places\` — text query + optional locationBias. Renders the
  nearby-search widget for the same UI.
- \`geocode\` — convert an address to lat/lng. Plain text result (no widget).

### Style
When you call \`get_directions\` / \`nearby_places\` / \`search_places\`, keep
your text reply short — one sentence or a single line. The widget IS the answer.
Don't recap durations, distances, or place names that the widget renders.

When the host suppresses the widget (voice/SMS/non-UI channels), expand your
text reply with the key facts (distance, duration, top result names) so the
user gets a complete answer without the visual.`;
