/**
 * Pure geometry helpers for the widget — no `google.maps` dependency, so they
 * work before the Maps JS API has loaded and are unit-testable in node.
 */

import type { Bounds, LatLng } from './types';

/**
 * Decode a Google encoded polyline (the Routes API `encodedPolyline` format).
 *
 * Done locally instead of through `google.maps.geometry.encoding.decodePath`,
 * which only exists once the `geometry` library has loaded. Waiting for it with
 * an uncapped retry loop meant a route that never drew if that library failed.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= encoded.length) return points; // truncated input: keep what decoded
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Smallest bounds containing every point, or null for an empty list. */
export function boundsOf(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let north = -Infinity, south = Infinity, east = -Infinity, west = Infinity;
  for (const p of points) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  return { northeast: { lat: north, lng: east }, southwest: { lat: south, lng: west } };
}

export function boundsCenter(bounds: Bounds): LatLng {
  return {
    lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
    lng: (bounds.northeast.lng + bounds.southwest.lng) / 2,
  };
}

/** True when the bounds cover an area (fitBounds on a single point zooms to max). */
export function hasArea(bounds: Bounds): boolean {
  return bounds.northeast.lat !== bounds.southwest.lat || bounds.northeast.lng !== bounds.southwest.lng;
}

/**
 * Initial camera for a map: an explicit centre wins, then the middle of the
 * bounds. With neither, show the whole world (zoom 2) — never zoom 14 on
 * (0,0), which put a "Little Hanoi, Nice" card in the Gulf of Guinea.
 */
export function initialView(
  center: LatLng | null | undefined,
  bounds: Bounds | null | undefined,
  zoom: number | undefined,
): { center: LatLng; zoom: number } {
  if (center) return { center, zoom: zoom ?? 14 };
  if (bounds) return { center: boundsCenter(bounds), zoom: zoom ?? 14 };
  return { center: { lat: 0, lng: 0 }, zoom: 2 };
}

export function toLiteral(bounds: Bounds): google.maps.LatLngBoundsLiteral {
  return {
    north: bounds.northeast.lat,
    east: bounds.northeast.lng,
    south: bounds.southwest.lat,
    west: bounds.southwest.lng,
  };
}
