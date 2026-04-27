/**
 * Load the Google Maps JavaScript API exactly once per iframe.
 *
 * Flow:
 *   1. Fetch the JS API key via the AppBridge `get_js_key_app` tool. This is the
 *      only path used: a same-origin `fetch('/api/maps/js-key')` would fail in
 *      production (the iframe is on a different origin from the API) and the
 *      iframe's CSP can't whitelist a relative path anyway. The AppBridge path
 *      already routes through postMessage to the host, which holds the JWT.
 *   2. Inject `<script src="https://maps.googleapis.com/maps/api/js?...">`.
 *   3. Resolve once `window.google.maps` is populated.
 *
 * Subsequent calls return the same Promise.
 */

import type { App } from '@modelcontextprotocol/ext-apps';

declare global {
  interface Window {
    google?: {
      maps?: typeof google.maps;
    };
    /** Set by main.tsx so MapCanvas (which doesn't own the App ref) can call back through it. */
    __yapaMapsApp?: App;
  }
}

let loadPromise: Promise<{ apiKey: string; maps: typeof google.maps }> | null = null;

async function fetchJsKeyViaAppBridge(): Promise<string | null> {
  // Wait briefly for the App ref to be set by main.tsx (it sets it synchronously
  // on import, but the maps-loader can be invoked from a deeply-nested useEffect
  // before main.tsx finishes executing in some HMR scenarios).
  for (let i = 0; i < 20; i++) {
    if (window.__yapaMapsApp) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const app = window.__yapaMapsApp;
  if (!app) return null;
  try {
    const result = await app.callServerTool({ name: 'get_js_key_app', arguments: {} }) as {
      structuredContent?: { apiKey?: string };
      isError?: boolean;
    };
    if (result?.isError || !result?.structuredContent?.apiKey) return null;
    return result.structuredContent.apiKey;
  } catch {
    return null;
  }
}

export async function loadMapsApi(): Promise<{ apiKey: string; maps: typeof google.maps }> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const key = await fetchJsKeyViaAppBridge();
    if (!key) {
      throw new Error('Failed to obtain Maps JS API key via AppBridge');
    }

    if (!window.google?.maps) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry,marker,places&loading=async`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Maps JS API script failed to load'));
        document.head.appendChild(script);
      });
    }

    if (!window.google?.maps) throw new Error('window.google.maps unavailable after JS API load');
    return { apiKey: key, maps: window.google.maps };
  })();
  return loadPromise;
}
