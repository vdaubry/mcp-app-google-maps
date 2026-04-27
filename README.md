# @vdaubry/mcp-app-google-maps

A standalone [SEP-1865 MCP App](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
server for Google Maps. Provides directions, place search, and geocoding tools
to any MCP host (Claude Desktop, ChatGPT, yapa-ai, basic-host, etc.) — and on
hosts that support the SEP-1865 UI extension, renders an interactive map widget
inline in the chat.

## Features

- **9 tools** — 4 model-callable + 5 driven by the embedded UI:
  - Model-callable: `get_directions`, `nearby_places`, `search_places`, `geocode`
  - UI-driven: `update_directions_app`, `refine_search_app`, `search_in_bounds_app`, `get_place_app`, `get_js_key_app`
- **Single self-contained iframe bundle** — the entire UI ships as one HTML file
  inlined into the npm package. No additional hosting required.
- **Standard stdio transport** — install with `npx @vdaubry/mcp-app-google-maps`
  and configure like any other reference MCP server.

## Get a Google Maps API key

You need a Google Cloud API key with these APIs enabled:

- **Routes API v2** (directions)
- **Places API New** (nearby & text search, place details)
- **Geocoding API**
- **Maps JavaScript API** (the iframe loads this client-side)

Create the key at <https://console.cloud.google.com/apis/credentials> and
restrict it to your hostnames via an **HTTP-referrer** restriction. The server
sends a `Referer:` header on outgoing API calls so the same restricted key
works server-side.

## Install

### Claude Desktop

Edit your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-maps": {
      "command": "npx",
      "args": ["-y", "@vdaubry/mcp-app-google-maps"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "AIza..."
      }
    }
  }
}
```

Restart Claude Desktop. The agent now has access to the Maps tools and renders
the widget inline when applicable.

### yapa-ai

Add an entry in `yapa.config.json` at the repo root:

```json
{
  "mcpServers": {
    "google-maps": {
      "command": "npx",
      "args": ["-y", "@vdaubry/mcp-app-google-maps"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "${GOOGLE_MAPS_API_KEY}",
        "PUBLIC_ORIGIN": "${PUBLIC_ORIGIN}"
      },
      "app": true
    }
  }
}
```

`${VAR}` placeholders are interpolated from the host process environment.
See `docs/external-mcp-apps.md` in the yapa-ai repo for details.

### basic-host (testing)

Clone <https://github.com/modelcontextprotocol/ext-apps>, then in
`examples/basic-host`:

```bash
GOOGLE_MAPS_API_KEY=AIza... \
  npm run start -- npx -y @vdaubry/mcp-app-google-maps
```

## Configuration

| Env var               | Required | Default          | Purpose |
|-----------------------|----------|------------------|---------|
| `GOOGLE_MAPS_API_KEY` | Yes      | —                | Server-side API calls + JS API key for the iframe |
| `PUBLIC_ORIGIN`       | No       | `http://localhost` | Sent as `Referer:` so HTTP-referrer-restricted keys work |

## Tool reference

### Model-callable (`visibility: ["model","app"]`)

| Tool             | Inputs                                                              | What it does |
|------------------|---------------------------------------------------------------------|--------------|
| `get_directions` | `origin`, `destination`, optional `mode` (`bicycling` default)      | Compute a route + render the directions widget |
| `nearby_places`  | `location` (lat/lng), `radius` (m), optional `type`, `openNow`, `count` | Find places of a type within a circle |
| `search_places`  | `query`, optional `locationBias`, `radius`, `openNow`, `count`      | Free-text place search ("best pizza Nice") |
| `geocode`        | `address`                                                           | Convert address → lat/lng + canonical formatted address |

### UI-driven (`visibility: ["app"]`)

These tools are called only by the embedded iframe via the SEP-1865 AppBridge.
MCP hosts can use the `_meta.ui.visibility` field to derive a `disallowedTools`
list at boot so the model doesn't call them.

| Tool                     | Purpose |
|--------------------------|---------|
| `update_directions_app`  | Re-compute directions when the user switches transport mode |
| `refine_search_app`      | Re-issue a search when the user types in the widget search box |
| `search_in_bounds_app`   | Re-search after the user pans the map ("Search this area") |
| `get_place_app`          | Fetch full place details for a marker-click overlay |
| `get_js_key_app`         | Returns the Maps JS API key for the iframe to load `maps/api/js` |

## Development

```bash
git clone https://github.com/vdaubry/mcp-app-google-maps
cd mcp-app-google-maps
npm install
npm run build       # builds the iframe bundle + the server
npm test
npm run typecheck
```

The build emits both `dist/server.js` (server entry) and `dist/index.html`
(the iframe bundle, single self-contained file).

## Architecture

- **Server** (`src/server.ts`) — `McpServer` with `StdioServerTransport`.
  Registers 9 tools via `registerAppTool` and one resource (`ui://google-maps/v1`)
  via `registerAppResource` from `@modelcontextprotocol/ext-apps/server`.
- **Handlers** (`src/handlers/`) — dual-shape: each tool returns
  `{ content: [{type:"text",...}], structuredContent: {...}, _meta: { ui: { resourceUri }} }`
  so non-UI hosts get a usable text result and SEP-1865 hosts get the widget.
- **Iframe bundle** (`app/`) — Preact + `@vis.gl/react-google-maps`, built to a
  single self-contained HTML file via `vite-plugin-singlefile`. The iframe pulls
  the JS API key via the `get_js_key_app` AppBridge tool.

## License

MIT
