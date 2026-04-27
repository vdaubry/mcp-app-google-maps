/**
 * Shared types for the Google Maps service + MCP App.
 *
 * `TravelMode` uses the Google Maps JS API spelling (lowercase, full words);
 * the service converts to the Routes API v2 enum (`BICYCLE`, `DRIVING`, …)
 * internally.
 */

export type TravelMode = 'bicycling' | 'walking' | 'transit' | 'driving';

export const TRAVEL_MODES: readonly TravelMode[] = ['bicycling', 'walking', 'transit', 'driving'] as const;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  northeast: LatLng;
  southwest: LatLng;
}

export interface Step {
  /** Human-readable instruction, e.g. "Turn right onto Avenue Jean Médecin". */
  instruction: string;
  distanceMeters: number;
  /** Encoded polyline for this step, or undefined when the API didn't return one. */
  polyline?: string;
  /** The Routes API "maneuver" enum value, e.g. "TURN_LEFT" / "STRAIGHT". */
  maneuver?: string;
}

export interface RouteResult {
  /** Human-readable duration, e.g. "1450s" (Routes API format). */
  duration: string;
  distanceMeters: number;
  /** Encoded polyline (overview). */
  polyline: string;
  /** Optional bounds (viewport) — present when the API includes routes.viewport. */
  bounds?: Bounds;
  steps: Step[];
}

export interface OpeningHours {
  openNow: boolean;
  /** Human-readable strings from the Places API regularOpeningHours.weekdayDescriptions. */
  weekdayDescriptions: string[];
}

export type PriceLevel =
  | 'PRICE_LEVEL_FREE'
  | 'PRICE_LEVEL_INEXPENSIVE'
  | 'PRICE_LEVEL_MODERATE'
  | 'PRICE_LEVEL_EXPENSIVE'
  | 'PRICE_LEVEL_VERY_EXPENSIVE';

export interface Place {
  /** Places API New `id` (e.g. "ChIJN1t_…"). */
  id: string;
  name: string;
  location: LatLng;
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: PriceLevel;
  openingHours?: OpeningHours;
  /** Google Places "primaryType" string, e.g. "cafe", "restaurant". */
  primaryType?: string;
  /** All matching place type tags. */
  types?: string[];
  /** Photo names returned by the Places API, suitable for the photo media URL. */
  photoRefs?: string[];
  /** Direct deep-link to the place on Google Maps. */
  mapsUrl?: string;
}

export interface GeocodeResult {
  formattedAddress: string;
  location: LatLng;
  placeId: string;
}

export class MapsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MapsApiError';
  }
}
