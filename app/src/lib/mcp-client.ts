/**
 * Typed wrappers over `app.callServerTool({...})` for the iframe-driven path.
 * Each call rides the AppBridge → backend WS → in-process handler → response.
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { LatLng, TravelMode, DirectionsPayload, NearbySearchPayload, Place } from './types';

interface CallToolResult {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class MapsMcpClient {
  constructor(public app: App) {}

  async updateDirections(args: { origin: string; destination: string; mode: TravelMode }): Promise<CallToolResult> {
    return this.app.callServerTool({ name: 'update_directions_app', arguments: args }) as Promise<CallToolResult>;
  }

  async refineSearch(args: { query: string; locationBias?: LatLng; radius?: number; openNow?: boolean; count?: number }): Promise<CallToolResult> {
    return this.app.callServerTool({ name: 'refine_search_app', arguments: args }) as Promise<CallToolResult>;
  }

  async searchInBounds(args: { center: LatLng; radiusM: number; type?: string; openNow?: boolean; count?: number }): Promise<CallToolResult> {
    return this.app.callServerTool({ name: 'search_in_bounds_app', arguments: args }) as Promise<CallToolResult>;
  }

  async getPlace(placeId: string): Promise<CallToolResult> {
    return this.app.callServerTool({ name: 'get_place_app', arguments: { placeId } }) as Promise<CallToolResult>;
  }

  /** Inform the agent (transcript-only) that the user did something in-widget. */
  async informAgent(text: string, structured?: Record<string, unknown>): Promise<unknown> {
    return this.app.updateModelContext({
      content: [{ type: 'text', text }],
      structuredContent: structured,
    });
  }

  /**
   * Ask the host to open a URL in a new tab. Required because the iframe
   * sandbox blocks `target="_blank"` navigations — the host runs in the
   * outer page context where popups are allowed.
   */
  openLink(url: string): Promise<unknown> {
    return this.app.openLink({ url });
  }
}

/** Type guards (the runtime payload comes back as `unknown`). */
export function isDirectionsPayload(p: unknown): p is DirectionsPayload {
  return !!p && typeof p === 'object' && (p as { widget?: string }).widget === 'directions';
}

export function isNearbySearchPayload(p: unknown): p is NearbySearchPayload {
  return !!p && typeof p === 'object' && (p as { widget?: string }).widget === 'nearby-search';
}

export function pickPlaceFromResult(result: CallToolResult): Place | null {
  const sc = result.structuredContent as { place?: Place } | undefined;
  return sc?.place ?? null;
}
