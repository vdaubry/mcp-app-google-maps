/**
 * Loads (and caches) the bundled HTML for the Google Maps MCP App iframe.
 *
 * The bundle is built by Vite (`app/`) into `dist/index.html` (single
 * self-contained file with all CSS/JS inlined). Path is resolved relative to
 * `import.meta.url` so it works regardless of where npm installs the package.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

function defaultBundlePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/server.js + dist/index.html → same directory after build.
  return path.resolve(here, 'index.html');
}

export async function loadBundle(bundlePath?: string): Promise<string> {
  if (cached !== null) return cached;
  const target = bundlePath ?? defaultBundlePath();
  try {
    cached = await fs.readFile(target, 'utf8');
    return cached;
  } catch {
    const placeholder = `<!doctype html><html><body><div id="root">Google Maps MCP App bundle not built yet (${target}).</div></body></html>`;
    cached = placeholder;
    return placeholder;
  }
}

/** Test helper — clears the cache so the next load re-reads from disk. */
export function _resetBundleCache(): void {
  cached = null;
}

/** Build the resource read callback that returns the bundled HTML + CSP. */
export function buildResourceReadCallback(uri: string) {
  return async () => ({
    contents: [
      {
        uri,
        mimeType: 'text/html;profile=mcp-app',
        text: await loadBundle(),
        _meta: {
          ui: {
            csp: {
              scriptDomains: ['https://maps.googleapis.com'],
              connectDomains: ['https://maps.googleapis.com', 'https://places.googleapis.com'],
              styleDomains: ['https://fonts.googleapis.com'],
              resourceDomains: [
                'https://maps.gstatic.com',
                'https://maps.googleapis.com',
                'https://places.googleapis.com',
                'https://lh3.googleusercontent.com',
                'https://fonts.gstatic.com',
                'data:',
              ],
              frameDomains: [],
            },
            preferredFrameSize: ['100%', '520px'],
          },
        },
      },
    ],
  });
}
