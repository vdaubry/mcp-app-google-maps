/**
 * MapsService — wraps Google Maps APIs.
 *
 *   - Routes API v2          (directions; `:computeRoutes`)
 *   - Places API New         (`:searchNearby`, `:searchText`, `places/{id}`)
 *   - Geocoding API          (`/maps/api/geocode/json`)
 *
 * All requests carry the `X-Goog-Api-Key` header AND a `Referer` header set to
 * `publicOrigin` so the same HTTP-referrer-restricted key works server-side.
 *
 * Errors from Google's HTTP responses are translated into `MapsApiError`
 * with `retryable: true` for 429 / 5xx and `retryable: false` for 4xx.
 */

import {
  type LatLng,
  type Bounds,
  type Place,
  type RouteResult,
  type Step,
  type GeocodeResult,
  type TravelMode,
  type OpeningHours,
  type PriceLevel,
  MapsApiError,
} from './types.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_GET_URL = 'https://places.googleapis.com/v1/places';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

const ROUTES_FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.viewport',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.polyline.encodedPolyline',
  'routes.legs.steps.navigationInstruction',
].join(',');

const PLACE_FIELDS_BASE = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'googleMapsUri',
  'primaryType',
  'types',
  'priceLevel',
  'photos',
  'regularOpeningHours',
  'currentOpeningHours',
];

const PLACE_LIST_FIELD_MASK = PLACE_FIELDS_BASE.map(f => `places.${f}`).join(',');
const PLACE_GET_FIELD_MASK = PLACE_FIELDS_BASE.join(',');

const TRAVEL_MODE_TO_API: Record<TravelMode, string> = {
  bicycling: 'BICYCLE',
  walking: 'WALK',
  transit: 'TRANSIT',
  driving: 'DRIVE',
};

export interface MapsServiceDeps {
  apiKey: string;
  /** Origin sent as `Referer` on outgoing requests. */
  publicOrigin: string;
  /** Override the global fetch (used by tests). */
  fetchFn?: typeof fetch;
}

export interface DirectionsInput {
  origin: string;
  destination: string;
  mode?: TravelMode;
}

export interface NearbyInput {
  location: LatLng;
  /** Radius in meters. */
  radius: number;
  /** Place type, e.g. "cafe", "restaurant". */
  type?: string;
  openNow?: boolean;
  /** Max results, capped at 20 by the Places API. */
  count?: number;
}

export interface SearchInput {
  query: string;
  /** Optional bias center for the textual search. */
  locationBias?: LatLng;
  /** Bias radius in meters (default 2000 when locationBias is set). */
  radius?: number;
  openNow?: boolean;
  count?: number;
}

export interface GeocodeInput {
  address: string;
}

export class MapsService {
  private readonly apiKey: string;
  private readonly publicOrigin: string;
  private readonly fetchFn: typeof fetch;

  constructor(deps: MapsServiceDeps) {
    if (!deps.apiKey) throw new Error('MapsService: apiKey is required');
    this.apiKey = deps.apiKey;
    this.publicOrigin = deps.publicOrigin;
    this.fetchFn = deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  // ---------------------------------------------------------------------
  // Directions
  // ---------------------------------------------------------------------

  async getDirections(input: DirectionsInput): Promise<RouteResult> {
    const mode: TravelMode = input.mode ?? 'bicycling';
    const apiMode = TRAVEL_MODE_TO_API[mode];
    const body: Record<string, unknown> = {
      origin: parseLocationForRoutes(input.origin),
      destination: parseLocationForRoutes(input.destination),
      travelMode: apiMode,
    };
    if (apiMode === 'DRIVE') {
      body.routingPreference = 'TRAFFIC_AWARE';
    }

    const data = await this.postJson(ROUTES_URL, body, {
      'X-Goog-FieldMask': ROUTES_FIELD_MASK,
    });

    const routes = (data as { routes?: unknown[] }).routes;
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new MapsApiError(404, 'NOT_FOUND', 'No route found.', false);
    }
    return parseRoute(routes[0] as Record<string, unknown>);
  }

  // ---------------------------------------------------------------------
  // Nearby places
  // ---------------------------------------------------------------------

  async nearbyPlaces(input: NearbyInput): Promise<Place[]> {
    const body: Record<string, unknown> = {
      maxResultCount: clampCount(input.count ?? 10),
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: { latitude: input.location.lat, longitude: input.location.lng },
          radius: input.radius,
        },
      },
    };
    if (input.type) body.includedTypes = [input.type];

    const data = await this.postJson(PLACES_NEARBY_URL, body, {
      'X-Goog-FieldMask': PLACE_LIST_FIELD_MASK,
    });
    const list = (data as { places?: unknown[] }).places ?? [];
    let places = list.map(p => parsePlace(p as Record<string, unknown>));
    if (input.openNow) places = places.filter(p => p.openingHours?.openNow === true);
    return places;
  }

  // ---------------------------------------------------------------------
  // Text search
  // ---------------------------------------------------------------------

  async searchPlaces(input: SearchInput): Promise<Place[]> {
    const body: Record<string, unknown> = {
      textQuery: input.query,
      pageSize: clampCount(input.count ?? 10),
    };
    if (input.locationBias) {
      body.locationBias = {
        circle: {
          center: { latitude: input.locationBias.lat, longitude: input.locationBias.lng },
          radius: input.radius ?? 2000,
        },
      };
    }
    if (input.openNow) body.openNow = true;

    const data = await this.postJson(PLACES_SEARCH_URL, body, {
      'X-Goog-FieldMask': PLACE_LIST_FIELD_MASK,
    });
    const list = (data as { places?: unknown[] }).places ?? [];
    return list.map(p => parsePlace(p as Record<string, unknown>));
  }

  // ---------------------------------------------------------------------
  // Place details (for marker-click overlay)
  // ---------------------------------------------------------------------

  async getPlace(placeId: string): Promise<Place> {
    const url = `${PLACES_GET_URL}/${encodeURIComponent(placeId)}`;
    const data = await this.getJson(url, { 'X-Goog-FieldMask': PLACE_GET_FIELD_MASK });
    return parsePlace(data as Record<string, unknown>);
  }

  // ---------------------------------------------------------------------
  // Geocoding
  // ---------------------------------------------------------------------

  async geocode(input: GeocodeInput): Promise<GeocodeResult[]> {
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(input.address)}&key=${encodeURIComponent(this.apiKey)}`;
    const data = await this.getJson(url, {});
    const results = (data as { results?: unknown[]; status?: string }).results ?? [];
    return results.map(r => parseGeocodeResult(r as Record<string, unknown>));
  }

  // ---------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------

  private async postJson(url: string, body: Record<string, unknown>, extraHeaders: Record<string, string>): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': this.apiKey,
      Referer: this.publicOrigin,
      ...extraHeaders,
    };
    const res = await this.fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return this.handleResponse(res, url);
  }

  private async getJson(url: string, extraHeaders: Record<string, string>): Promise<unknown> {
    const headers: Record<string, string> = {
      'X-Goog-Api-Key': this.apiKey,
      Referer: this.publicOrigin,
      ...extraHeaders,
    };
    const res = await this.fetchFn(url, { method: 'GET', headers });
    return this.handleResponse(res, url);
  }

  private async handleResponse(res: Response, url: string): Promise<unknown> {
    let data: unknown = null;
    let parseError: Error | null = null;
    try {
      data = await res.json();
    } catch (e) {
      parseError = e as Error;
    }

    if (!res.ok) {
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      const errBody = (data as { error?: { code?: number; status?: string; message?: string } } | null)?.error;
      const code = errBody?.status ?? `HTTP_${res.status}`;
      const message = errBody?.message ?? `Maps API ${res.status} ${res.statusText}`;
      // eslint-disable-next-line no-console
      console.warn(`[maps-service] ${url} status=${res.status} code=${code} retryable=${retryable}: ${message}`);
      throw new MapsApiError(res.status, code, message, retryable);
    }

    if (parseError) {
      throw new MapsApiError(res.status, 'INVALID_RESPONSE', `Failed to parse Maps API response: ${parseError.message}`, false);
    }

    // Some APIs (Geocoding) signal logical errors via { status: "ZERO_RESULTS" } on a 200.
    const status = (data as { status?: string } | null)?.status;
    if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
      throw new MapsApiError(res.status, status, `Maps API returned status=${status}`, status === 'OVER_QUERY_LIMIT' || status === 'UNKNOWN_ERROR');
    }

    return data;
  }
}

// ---------------------------------------------------------------------------
// Parsers (exported for test reuse)
// ---------------------------------------------------------------------------

/** Parse a `lat,lng` string OR an address into Routes API origin/destination shape. */
export function parseLocationForRoutes(loc: string): Record<string, unknown> {
  const m = loc.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    return { location: { latLng: { latitude: parseFloat(m[1]), longitude: parseFloat(m[2]) } } };
  }
  return { address: loc };
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 20) return 20;
  return Math.floor(n);
}

export function parseRoute(route: Record<string, unknown>): RouteResult {
  const duration = (route.duration as string) ?? '0s';
  const distanceMeters = Number(route.distanceMeters ?? 0);
  const polyline = (route.polyline as { encodedPolyline?: string } | undefined)?.encodedPolyline ?? '';

  const viewport = route.viewport as { high?: { latitude?: number; longitude?: number }; low?: { latitude?: number; longitude?: number } } | undefined;
  let bounds: Bounds | undefined;
  if (viewport?.high && viewport.low &&
      typeof viewport.high.latitude === 'number' && typeof viewport.high.longitude === 'number' &&
      typeof viewport.low.latitude === 'number' && typeof viewport.low.longitude === 'number') {
    bounds = {
      northeast: { lat: viewport.high.latitude, lng: viewport.high.longitude },
      southwest: { lat: viewport.low.latitude, lng: viewport.low.longitude },
    };
  }

  const steps: Step[] = [];
  const legs = (route.legs as Array<Record<string, unknown>> | undefined) ?? [];
  for (const leg of legs) {
    const legSteps = (leg.steps as Array<Record<string, unknown>> | undefined) ?? [];
    for (const s of legSteps) {
      const nav = s.navigationInstruction as { instructions?: string; maneuver?: string } | undefined;
      const stepPoly = (s.polyline as { encodedPolyline?: string } | undefined)?.encodedPolyline;
      const distance = Number(s.distanceMeters ?? 0);
      if (nav?.instructions) {
        const step: Step = {
          instruction: nav.instructions,
          distanceMeters: distance,
        };
        if (stepPoly) step.polyline = stepPoly;
        if (nav.maneuver) step.maneuver = nav.maneuver;
        steps.push(step);
      }
    }
  }

  return { duration, distanceMeters, polyline, bounds, steps };
}

export function parsePlace(p: Record<string, unknown>): Place {
  const id = String(p.id ?? '');
  const displayName = (p.displayName as { text?: string } | undefined)?.text ?? id;
  const loc = p.location as { latitude?: number; longitude?: number } | undefined;
  const place: Place = {
    id,
    name: displayName,
    location: {
      lat: typeof loc?.latitude === 'number' ? loc.latitude : 0,
      lng: typeof loc?.longitude === 'number' ? loc.longitude : 0,
    },
  };

  if (typeof p.formattedAddress === 'string') place.formattedAddress = p.formattedAddress;
  if (typeof p.rating === 'number') place.rating = p.rating;
  if (typeof p.userRatingCount === 'number') place.userRatingCount = p.userRatingCount;
  if (typeof p.priceLevel === 'string') place.priceLevel = p.priceLevel as PriceLevel;
  if (typeof p.primaryType === 'string') place.primaryType = p.primaryType;
  if (Array.isArray(p.types)) place.types = (p.types as string[]).filter(t => typeof t === 'string');

  const photos = p.photos as Array<{ name?: string }> | undefined;
  if (Array.isArray(photos)) {
    const refs = photos.map(ph => ph.name).filter((n): n is string => typeof n === 'string');
    if (refs.length > 0) place.photoRefs = refs;
  }

  // Prefer googleMapsUri if Google supplied one; else compute from placeId.
  if (typeof p.googleMapsUri === 'string') place.mapsUrl = p.googleMapsUri;
  else if (id) place.mapsUrl = `https://www.google.com/maps/place/?q=place_id:${id}`;

  const hours = parseOpeningHours(p);
  if (hours) place.openingHours = hours;

  return place;
}

function parseOpeningHours(p: Record<string, unknown>): OpeningHours | undefined {
  const current = (p.currentOpeningHours as Record<string, unknown> | undefined) ?? {};
  const regular = (p.regularOpeningHours as Record<string, unknown> | undefined) ?? {};
  let openNow: boolean | undefined;
  if (typeof current.openNow === 'boolean') openNow = current.openNow;
  else if (typeof regular.openNow === 'boolean') openNow = regular.openNow;
  const descs = (regular.weekdayDescriptions as string[] | undefined)
    ?? (current.weekdayDescriptions as string[] | undefined)
    ?? [];
  if (openNow === undefined && descs.length === 0) return undefined;
  return {
    openNow: openNow ?? false,
    weekdayDescriptions: descs.filter(d => typeof d === 'string'),
  };
}

export function parseGeocodeResult(r: Record<string, unknown>): GeocodeResult {
  const geometry = r.geometry as { location?: { lat?: number; lng?: number } } | undefined;
  const loc = geometry?.location ?? {};
  return {
    formattedAddress: typeof r.formatted_address === 'string' ? r.formatted_address : '',
    location: {
      lat: typeof loc.lat === 'number' ? loc.lat : 0,
      lng: typeof loc.lng === 'number' ? loc.lng : 0,
    },
    placeId: typeof r.place_id === 'string' ? r.place_id : '',
  };
}
