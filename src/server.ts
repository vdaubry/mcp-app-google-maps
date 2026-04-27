#!/usr/bin/env node
/**
 * @vdaubry/mcp-app-google-maps — SEP-1865 MCP App server.
 *
 * Speaks the standard MCP protocol over stdio. Any compliant MCP host
 * (Claude Desktop, ChatGPT, yapa-ai, basic-host) can spawn this process and
 * route tool calls + iframe AppBridge calls to it.
 *
 * Configuration (env-vars only — host passes them when spawning):
 *   GOOGLE_MAPS_API_KEY   (required)  Routes API v2 / Places API New / Geocoding API key
 *   PUBLIC_ORIGIN         (optional)  Sent as `Referer` so HTTP-referrer-restricted keys work
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { MapsService } from './maps-service.js';
import { TOOL_DEFINITIONS, MAPS_RESOURCE_URI } from './handlers/index.js';
import { GOOGLE_MAPS_INSTRUCTIONS } from './instructions.js';
import { buildResourceReadCallback } from './bundle-loader.js';

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  // eslint-disable-next-line no-console
  console.error('[google-maps] GOOGLE_MAPS_API_KEY env var is required');
  process.exit(1);
}
const publicOrigin = process.env.PUBLIC_ORIGIN ?? 'http://localhost';

const mapsService = new MapsService({ apiKey, publicOrigin });

const server = new McpServer(
  { name: 'google-maps', version: '0.1.0' },
  { instructions: GOOGLE_MAPS_INSTRUCTIONS },
);

// ---- Resource (the iframe HTML bundle) ----

registerAppResource(
  server,
  'Google Maps',
  MAPS_RESOURCE_URI,
  {
    description: 'Interactive Google Maps widget (directions, places, geocoding) — SEP-1865.',
    mimeType: RESOURCE_MIME_TYPE,
  },
  buildResourceReadCallback(MAPS_RESOURCE_URI) as never,
);

// ---- Tools ----

// The SDK's tool callback signature requires concrete content shape literals.
// Our generic CallToolResult is structurally identical at runtime but the compiler
// can't prove it through the registry indirection.
const wrapHandler = (fn: (args: Record<string, unknown>) => Promise<unknown>) =>
  (async (args: Record<string, unknown>) => fn(args)) as never;

for (const def of TOOL_DEFINITIONS) {
  const handler = def.makeHandler({ mapsService, apiKey });
  registerAppTool(
    server,
    def.name,
    {
      description: def.spec.description,
      inputSchema: def.spec.inputSchema,
      _meta: def.spec._meta,
    },
    wrapHandler(args => handler(args)),
  );
}

// ---- Connect over stdio ----

const transport = new StdioServerTransport();
await server.connect(transport);

// Close transport cleanly on signals so the host doesn't have to SIGKILL.
const shutdown = async () => {
  try {
    await server.close();
  } catch {
    // ignore
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
