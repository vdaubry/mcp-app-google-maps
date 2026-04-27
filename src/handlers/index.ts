/**
 * Handler functions for the @vdaubry/mcp-app-google-maps MCP server.
 *
 * Each tool returns dual-shape result:
 *   - `content[].text` — natural-language summary (consumed by voice/text channels).
 *   - `structuredContent` — `{ widget, version, refreshedAt, ...payload }` for the iframe.
 *   - `_meta.ui.resourceUri` — the SEP-1865 marker (`ui://google-maps/v1`).
 *
 * Tool list:
 *   Model-callable (4):  get_directions / nearby_places / search_places / geocode
 *   Iframe-only (5):    update_directions_app / refine_search_app /
 *                       search_in_bounds_app / get_place_app / get_js_key_app
 *
 * The 5 iframe-only tools have `_meta.ui.visibility = ["app"]` so MCP hosts can
 * derive a per-server `disallowedTools` list at boot time without hardcoding.
 */

import { z } from 'zod';
import type { MapsService } from '../maps-service.js';
import { MapsApiError, type LatLng, type Place, type RouteResult, type TravelMode, TRAVEL_MODES } from '../types.js';

export const MAPS_RESOURCE_URI = 'ui://google-maps/v1';

let monotonic = 0;
function nextVersion(): number {
  monotonic = Math.max(monotonic + 1, Date.now());
  return monotonic;
}

type WidgetKind = 'directions' | 'nearby-search' | 'geocode';

function buildWidgetPayload(widget: WidgetKind, extra: Record<string, unknown>): Record<string, unknown> {
  return { widget, version: nextVersion(), refreshedAt: new Date().toISOString(), ...extra };
}

export interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

function dualShapeResult(text: string, structuredContent: Record<string, unknown> | undefined): CallToolResult {
  const out: CallToolResult = {
    content: [{ type: 'text', text }],
    isError: false,
    _meta: { ui: { resourceUri: MAPS_RESOURCE_URI } },
  };
  if (structuredContent) out.structuredContent = structuredContent;
  return out;
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    _meta: { ui: { resourceUri: MAPS_RESOURCE_URI } },
  };
}

// ---- Zod shapes ----

const LatLngShape = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const GetDirectionsShape = {
  origin: z.string().min(1),
  destination: z.string().min(1),
  mode: z.enum(TRAVEL_MODES as readonly [TravelMode, ...TravelMode[]]).optional(),
};

export const NearbyPlacesShape = {
  location: LatLngShape,
  radius: z.number().min(1).max(50_000),
  type: z.string().optional(),
  openNow: z.boolean().optional(),
  count: z.number().int().min(1).max(20).optional(),
};

export const SearchPlacesShape = {
  query: z.string().min(1),
  locationBias: LatLngShape.optional(),
  radius: z.number().min(1).max(50_000).optional(),
  openNow: z.boolean().optional(),
  count: z.number().int().min(1).max(20).optional(),
};

export const GeocodeShape = {
  address: z.string().min(1),
};

export const RefineSearchShape = {
  query: z.string().min(1),
  locationBias: LatLngShape.optional(),
  radius: z.number().min(1).max(50_000).optional(),
  openNow: z.boolean().optional(),
  count: z.number().int().min(1).max(20).optional(),
};

export const SearchInBoundsShape = {
  center: LatLngShape,
  radiusM: z.number().min(1).max(50_000),
  type: z.string().optional(),
  openNow: z.boolean().optional(),
  count: z.number().int().min(1).max(20).optional(),
};

export const GetPlaceShape = {
  placeId: z.string().min(1),
};

/** No input — returns the Maps JS API key for the iframe to load the script. */
export const GetJsKeyShape = {};

// Strict parsers for runtime validation.

const GetDirectionsParser = z.object(GetDirectionsShape).strict();
const NearbyPlacesParser = z.object(NearbyPlacesShape).strict();
const SearchPlacesParser = z.object(SearchPlacesShape).strict();
const GeocodeParser = z.object(GeocodeShape).strict();
const RefineSearchParser = z.object(RefineSearchShape).strict();
const SearchInBoundsParser = z.object(SearchInBoundsShape).strict();
const GetPlaceParser = z.object(GetPlaceShape).strict();
const GetJsKeyParser = z.object(GetJsKeyShape).strict();

function parseArgs<T>(parser: z.ZodType<T>, raw: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const result = parser.safeParse(raw ?? {});
  if (!result.success) return { ok: false, error: `Invalid arguments: ${result.error.message}` };
  return { ok: true, value: result.data };
}

// ---- Text fallbacks ----

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatKm(meters: number): string {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function durationSeconds(duration: string): number {
  // Routes API returns "1450s" — strip the trailing s.
  const m = duration.match(/^(\d+(?:\.\d+)?)s$/);
  return m ? parseFloat(m[1]) : 0;
}

function directionsText(route: RouteResult, mode: TravelMode): string {
  const dur = formatDuration(durationSeconds(route.duration));
  const dist = formatKm(route.distanceMeters);
  const top = route.steps.slice(0, 3).map(s => `- ${s.instruction}`).join('\n');
  const tail = route.steps.length > 3 ? `\n…and ${route.steps.length - 3} more steps.` : '';
  return `${dur} · ${dist} (${mode}).\n${top}${tail}`.trim();
}

function placesText(places: Place[]): string {
  if (places.length === 0) return 'No places found.';
  const top = places.slice(0, 5).map((p, i) => {
    const rating = p.rating != null ? ` ★${p.rating}` : '';
    const open = p.openingHours?.openNow === true ? ' (open)' : p.openingHours?.openNow === false ? ' (closed)' : '';
    return `${i + 1}. ${p.name}${rating}${open}`;
  }).join('\n');
  const tail = places.length > 5 ? `\n…and ${places.length - 5} more.` : '';
  return `${places.length} place${places.length === 1 ? '' : 's'}:\n${top}${tail}`;
}

function geocodeText(results: { formattedAddress: string; location: LatLng }[]): string {
  if (results.length === 0) return 'No geocoding match found.';
  const r = results[0];
  return `${r.formattedAddress} → ${r.location.lat},${r.location.lng}`;
}

// ---- Handlers ----

function describeError(e: unknown): string {
  if (e instanceof MapsApiError) return `Maps API error (${e.code}): ${e.message}`;
  return String((e as Error).message ?? e);
}

export type ToolHandler = (raw: unknown) => Promise<CallToolResult>;

export interface MapsHandlerDeps {
  mapsService: MapsService;
  /** Used by `get_js_key_app` to return the Maps JS API key to the iframe. */
  apiKey: string;
}

export function buildMapsAppHandlers(deps: MapsHandlerDeps): Record<string, ToolHandler> {
  const { mapsService, apiKey } = deps;

  async function runDirections(origin: string, destination: string, mode: TravelMode): Promise<CallToolResult> {
    try {
      const route = await mapsService.getDirections({ origin, destination, mode });
      const payload = buildWidgetPayload('directions', {
        route,
        mode,
        queryEcho: { origin, destination },
      });
      return dualShapeResult(directionsText(route, mode), payload);
    } catch (e) {
      return errorResult(describeError(e));
    }
  }

  async function runNearbyOrSearch(
    title: string,
    fn: () => Promise<Place[]>,
    center: LatLng | null,
    queryEcho: Record<string, unknown>,
  ): Promise<CallToolResult> {
    try {
      const places = await fn();
      const payload = buildWidgetPayload('nearby-search', {
        places,
        center,
        queryEcho,
      });
      return dualShapeResult(`${title}\n${placesText(places)}`, payload);
    } catch (e) {
      return errorResult(describeError(e));
    }
  }

  return {
    // ---- model-facing ----
    get_directions: async (raw) => {
      const parsed = parseArgs(GetDirectionsParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      const mode = parsed.value.mode ?? 'bicycling';
      return runDirections(parsed.value.origin, parsed.value.destination, mode);
    },

    nearby_places: async (raw) => {
      const parsed = parseArgs(NearbyPlacesParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      const v = parsed.value;
      return runNearbyOrSearch(
        `Nearby ${v.type ?? 'places'} within ${v.radius}m:`,
        () => mapsService.nearbyPlaces({ location: v.location, radius: v.radius, type: v.type, openNow: v.openNow, count: v.count }),
        v.location,
        { kind: 'nearby', location: v.location, radius: v.radius, type: v.type, openNow: v.openNow },
      );
    },

    search_places: async (raw) => {
      const parsed = parseArgs(SearchPlacesParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      const v = parsed.value;
      return runNearbyOrSearch(
        `Search '${v.query}':`,
        () => mapsService.searchPlaces({ query: v.query, locationBias: v.locationBias, radius: v.radius, openNow: v.openNow, count: v.count }),
        v.locationBias ?? null,
        { kind: 'search', query: v.query, locationBias: v.locationBias, radius: v.radius, openNow: v.openNow },
      );
    },

    geocode: async (raw) => {
      const parsed = parseArgs(GeocodeParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      try {
        const results = await mapsService.geocode({ address: parsed.value.address });
        const payload = buildWidgetPayload('geocode', { results, queryEcho: { address: parsed.value.address } });
        return dualShapeResult(geocodeText(results), payload);
      } catch (e) {
        return errorResult(describeError(e));
      }
    },

    // ---- iframe-only ----
    update_directions_app: async (raw) => {
      const parsed = parseArgs(GetDirectionsParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      const mode = parsed.value.mode ?? 'bicycling';
      return runDirections(parsed.value.origin, parsed.value.destination, mode);
    },

    refine_search_app: async (raw) => {
      const parsed = parseArgs(RefineSearchParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      const v = parsed.value;
      return runNearbyOrSearch(
        `Refine '${v.query}':`,
        () => mapsService.searchPlaces({ query: v.query, locationBias: v.locationBias, radius: v.radius, openNow: v.openNow, count: v.count }),
        v.locationBias ?? null,
        { kind: 'search', query: v.query, locationBias: v.locationBias, radius: v.radius, openNow: v.openNow },
      );
    },

    search_in_bounds_app: async (raw) => {
      const parsed = parseArgs(SearchInBoundsParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      const v = parsed.value;
      return runNearbyOrSearch(
        `Search in current map area:`,
        () => mapsService.nearbyPlaces({ location: v.center, radius: v.radiusM, type: v.type, openNow: v.openNow, count: v.count }),
        v.center,
        { kind: 'nearby', location: v.center, radius: v.radiusM, type: v.type, openNow: v.openNow },
      );
    },

    get_place_app: async (raw) => {
      const parsed = parseArgs(GetPlaceParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      try {
        const place = await mapsService.getPlace(parsed.value.placeId);
        // No widget swap — the iframe consumes the structured payload to populate
        // a place card; we still set widget=nearby-search to keep payload typed.
        const payload = buildWidgetPayload('nearby-search', {
          place,
          queryEcho: { placeId: parsed.value.placeId },
        });
        return dualShapeResult(`Place: ${place.name}`, payload);
      } catch (e) {
        return errorResult(describeError(e));
      }
    },

    /**
     * Returns the Maps JS API key. The iframe calls this via the AppBridge to load
     * the Google Maps JavaScript API. (The iframe runs at a different origin from
     * the host and can't fetch a same-origin shortcut path.)
     */
    get_js_key_app: async (raw) => {
      const parsed = parseArgs(GetJsKeyParser, raw);
      if (!parsed.ok) return errorResult(parsed.error);
      return {
        content: [{ type: 'text', text: 'JS API key' }],
        structuredContent: { apiKey },
        isError: false,
        _meta: { ui: { resourceUri: MAPS_RESOURCE_URI } },
      };
    },
  };
}

// ---- Tool catalog (definitions consumed by server.ts) ----

export interface ToolSpec {
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  _meta: {
    ui: {
      resourceUri: string;
      visibility: readonly string[];
    };
  };
}

export interface ToolDefinition {
  name: string;
  spec: ToolSpec;
  /** Build a handler given the MapsService. */
  makeHandler: (deps: MapsHandlerDeps) => ToolHandler;
}

const meta = { ui: { resourceUri: MAPS_RESOURCE_URI, visibility: ['model', 'app'] as const } };
const appOnlyMeta = { ui: { resourceUri: MAPS_RESOURCE_URI, visibility: ['app'] as const } };

function makeHandlerFn(name: string): (deps: MapsHandlerDeps) => ToolHandler {
  return (deps) => {
    const handlers = buildMapsAppHandlers(deps);
    const fn = handlers[name];
    if (!fn) throw new Error(`No handler for tool ${name}`);
    return fn;
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ---- Model-facing tools ----
  {
    name: 'get_directions',
    spec: {
      description:
        'Compute a route between two locations and render a directions widget on web. ' +
        'Default mode is bicycling — pass `mode: "walking" | "transit" | "driving"` to override. ' +
        'On voice/WhatsApp/SMS the widget is suppressed and the text content is spoken instead.',
      inputSchema: GetDirectionsShape,
      _meta: meta,
    },
    makeHandler: makeHandlerFn('get_directions'),
  },
  {
    name: 'nearby_places',
    spec: {
      description:
        'Find places of a given type within a circular radius. ' +
        'On web the user sees a numbered-marker map with an interactive list and filters; ' +
        'on voice the result is summarized as a short text list.',
      inputSchema: NearbyPlacesShape,
      _meta: meta,
    },
    makeHandler: makeHandlerFn('nearby_places'),
  },
  {
    name: 'search_places',
    spec: {
      description:
        'Text-based place search ("best pizza Nice"). Same widget as nearby_places. ' +
        'Use `locationBias` to bias results toward a center.',
      inputSchema: SearchPlacesShape,
      _meta: meta,
    },
    makeHandler: makeHandlerFn('search_places'),
  },
  {
    name: 'geocode',
    spec: {
      description: 'Convert a free-form address into a lat/lng + canonical formatted address.',
      inputSchema: GeocodeShape,
      _meta: meta,
    },
    makeHandler: makeHandlerFn('geocode'),
  },
  // ---- Iframe-only tools ----
  {
    name: 'update_directions_app',
    spec: {
      description: '[iframe-only] Re-compute directions when the user switches transport mode in the widget.',
      inputSchema: GetDirectionsShape,
      _meta: appOnlyMeta,
    },
    makeHandler: makeHandlerFn('update_directions_app'),
  },
  {
    name: 'refine_search_app',
    spec: {
      description: '[iframe-only] Re-issue a text search from the widget — used when the user changes a server-side filter.',
      inputSchema: RefineSearchShape,
      _meta: appOnlyMeta,
    },
    makeHandler: makeHandlerFn('refine_search_app'),
  },
  {
    name: 'search_in_bounds_app',
    spec: {
      description: '[iframe-only] Re-search after the user pans the map far enough to trigger "Search this area".',
      inputSchema: SearchInBoundsShape,
      _meta: appOnlyMeta,
    },
    makeHandler: makeHandlerFn('search_in_bounds_app'),
  },
  {
    name: 'get_place_app',
    spec: {
      description: '[iframe-only] Fetch full place details for a marker-click overlay.',
      inputSchema: GetPlaceShape,
      _meta: appOnlyMeta,
    },
    makeHandler: makeHandlerFn('get_place_app'),
  },
  {
    name: 'get_js_key_app',
    spec: {
      description: '[iframe-only] Returns the Maps JS API key for the iframe to load the script.',
      inputSchema: GetJsKeyShape,
      _meta: appOnlyMeta,
    },
    makeHandler: makeHandlerFn('get_js_key_app'),
  },
];
