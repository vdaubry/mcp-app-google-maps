/**
 * Yapa Maps MCP App entry — single-file iframe runtime.
 *
 * Lifecycle (per SEP-1865):
 *   1. Construct `App` from ext-apps.
 *   2. Wire callbacks (ontoolinput, ontoolresult, onteardown).
 *   3. Call `app.connect()` which sends `ui/initialize` to the host.
 *   4. Render Preact tree; widget swaps as new tool-result pushes arrive.
 */

import { render } from 'preact';
import { signal } from '@preact/signals';
import { App as ExtApp } from '@modelcontextprotocol/ext-apps';
import { MapsMcpClient } from './lib/mcp-client';
import { WidgetRouter } from './components/WidgetRouter';
import type { WidgetPayload } from './lib/types';

const payload = signal<WidgetPayload | null>(null);

const app = new ExtApp({ name: 'Yapa Maps', version: '1.0.0' });
const client = new MapsMcpClient(app);

// Expose the App ref so maps-loader.ts can fetch the Maps JS API key via the
// AppBridge `get_js_key_app` tool. The iframe is at a different origin from the
// API host (mcp-sandbox.itenregalia.cloud vs fumanchu.itenregalia.cloud), and
// its CSP can't whitelist a relative path, so AppBridge is the only viable path.
(window as unknown as { __yapaMapsApp: typeof app }).__yapaMapsApp = app;

(app as unknown as { ontoolresult: (r: { structuredContent?: unknown }) => void }).ontoolresult = (result) => {
  if (result?.structuredContent) {
    payload.value = result.structuredContent as WidgetPayload;
  }
};

(app as unknown as { ontoolinput: (a: unknown) => void }).ontoolinput = (_args) => {
  // input is informational; the structuredContent on the result drives our render.
};

(app as unknown as { onteardown: () => unknown }).onteardown = () => ({});

// Fire-and-forget connect — the host replies asynchronously.
try { app.connect(); }
catch (err) { console.warn('[mcp-app-maps] App connect failed', err); }

function Root() {
  return (
    <div style="padding:0;margin:0">
      <WidgetRouter
        payload={payload.value}
        client={client}
        onSwap={(p) => { payload.value = p; }}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(<Root />, root);
