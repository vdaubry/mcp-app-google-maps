/** Yapa Maps widget payload types — kept in sync with src/maps/types.ts but
 *  duplicated here so the iframe bundle is fully self-contained. */

export type TravelMode = 'bicycling' | 'walking' | 'transit' | 'driving';

export interface LatLng { lat: number; lng: number; }

export interface Bounds {
  northeast: LatLng;
  southwest: LatLng;
}

export interface Step {
  instruction: string;
  distanceMeters: number;
  polyline?: string;
  maneuver?: string;
}

export interface RouteResult {
  duration: string;
  distanceMeters: number;
  polyline: string;
  bounds?: Bounds;
  steps: Step[];
}

export interface OpeningHours {
  openNow: boolean;
  weekdayDescriptions: string[];
}

export type PriceLevel =
  | 'PRICE_LEVEL_FREE'
  | 'PRICE_LEVEL_INEXPENSIVE'
  | 'PRICE_LEVEL_MODERATE'
  | 'PRICE_LEVEL_EXPENSIVE'
  | 'PRICE_LEVEL_VERY_EXPENSIVE';

export interface Place {
  id: string;
  name: string;
  location: LatLng;
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: PriceLevel;
  openingHours?: OpeningHours;
  primaryType?: string;
  types?: string[];
  photoRefs?: string[];
  mapsUrl?: string;
}

export interface GeocodeWidgetResult {
  formattedAddress: string;
  location: LatLng;
  placeId: string;
}

export interface BasePayload {
  widget: 'directions' | 'nearby-search' | 'geocode';
  version: number;
  refreshedAt: string;
}

export interface DirectionsPayload extends BasePayload {
  widget: 'directions';
  route: RouteResult;
  mode: TravelMode;
  queryEcho: { origin: string; destination: string };
}

export interface NearbySearchPayload extends BasePayload {
  widget: 'nearby-search';
  /** Either places (list result) OR place (single get_place_app result). */
  places?: Place[];
  place?: Place;
  center: LatLng | null;
  queryEcho: Record<string, unknown>;
}

export interface GeocodePayload extends BasePayload {
  widget: 'geocode';
  results: GeocodeWidgetResult[];
  queryEcho: { address: string };
}

export type WidgetPayload = DirectionsPayload | NearbySearchPayload | GeocodePayload;
