/**
 * NearbySearchWidget — interactive map + list with full marker↔list sync.
 *
 * - Filter toolbar (Sort / Open now / Min ★ / Radius) is purely client-side; no
 *   backend calls fire when filters change.
 * - Hover list ↔ marker cross-highlight via `data-hovered` attribute.
 * - Click marker / list → PlaceCard overlay.
 * - Pan map past 50% of the original radius → "Search this area" pill calls
 *   `search_in_bounds_app` and swaps the payload.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AdvancedMarker } from '@vis.gl/react-google-maps';
import type { LatLng, NearbySearchPayload, Place, WidgetPayload } from '../lib/types';
import type { MapsMcpClient } from '../lib/mcp-client';
import { isNearbySearchPayload } from '../lib/mcp-client';
import { MapCanvas } from './MapCanvas';
import { PlaceCard } from './PlaceCard';
import { ErrorBox, formatDistance, haversineMeters, priceGlyph } from './Common';

interface Props {
  payload: NearbySearchPayload;
  client: MapsMcpClient | null;
  onSwap: (next: WidgetPayload) => void;
}

interface FilterState {
  sort: 'rating' | 'distance';
  openNow: boolean;
  minStars: number;
  radiusM: number;
}

const DEFAULT_FILTERS: FilterState = {
  sort: 'distance',
  openNow: false,
  minStars: 0,
  radiusM: 1000,
};

function defaultRadius(payload: NearbySearchPayload): number {
  const echo = payload.queryEcho as { radius?: number; radiusM?: number };
  return echo.radius ?? echo.radiusM ?? DEFAULT_FILTERS.radiusM;
}

export function NearbySearchWidget({ payload, client, onSwap }: Props) {
  const places: Place[] = payload.places ?? (payload.place ? [payload.place] : []);
  const center: LatLng | null = payload.center;

  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS, radiusM: defaultRadius(payload) });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchingArea, setSearchingArea] = useState(false);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [currentMapCenter, setCurrentMapCenter] = useState<LatLng | null>(null);

  // Reset filters when a new search arrives.
  useEffect(() => {
    setFilters({ ...DEFAULT_FILTERS, radiusM: defaultRadius(payload) });
    setShowSearchArea(false);
    setCurrentMapCenter(null);
  }, [payload.version]);

  // Pull the JS API key from window.google's script tag (set by maps-loader).
  useEffect(() => {
    const script = document.querySelector<HTMLScriptElement>('script[src*="maps.googleapis.com/maps/api/js"]');
    if (script?.src) {
      try {
        const url = new URL(script.src);
        const k = url.searchParams.get('key');
        if (k) setApiKey(k);
      } catch { /* ignore */ }
    }
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onMapCenterChanged(c: LatLng) {
    setCurrentMapCenter(c);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!center) return;
    debounceRef.current = setTimeout(() => {
      const distance = haversineMeters(c, center);
      // Show "Search this area" once the user has panned > 50% of original radius.
      setShowSearchArea(distance > defaultRadius(payload) * 0.5);
    }, 250);
  }

  const visible: Place[] = useMemo(() => {
    let result = [...places];
    if (filters.openNow) result = result.filter(p => p.openingHours?.openNow === true);
    if (filters.minStars > 0) result = result.filter(p => (p.rating ?? 0) >= filters.minStars);
    if (center && filters.radiusM > 0) {
      result = result.filter(p => haversineMeters(p.location, center) <= filters.radiusM);
    }
    if (filters.sort === 'rating') {
      result.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else if (center) {
      result.sort((a, b) => haversineMeters(a.location, center) - haversineMeters(b.location, center));
    }
    return result;
  }, [places, filters, center]);

  async function handleSearchThisArea() {
    if (!client || !currentMapCenter) return;
    setSearchingArea(true);
    setError(null);
    try {
      const echo = payload.queryEcho as { type?: string; openNow?: boolean };
      const result = await client.searchInBounds({
        center: currentMapCenter,
        radiusM: defaultRadius(payload),
        type: echo.type,
        openNow: echo.openNow,
      });
      const sc = result?.structuredContent;
      if (isNearbySearchPayload(sc)) {
        onSwap(sc);
      } else if (result?.isError) {
        setError(result.content?.[0]?.text ?? 'Search failed');
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSearchingArea(false);
    }
  }

  async function openPlace(p: Place) {
    setSelectedPlace(p);
    if (!client) return;
    // Fire-and-forget: refresh the place details for the most up-to-date hours/photos.
    try {
      const result = await client.getPlace(p.id);
      const sc = result?.structuredContent as { place?: Place } | undefined;
      if (sc?.place) setSelectedPlace(sc.place);
    } catch { /* keep the cached place card */ }
  }

  return (
    <div data-widget="nearby-search" data-testid="nearby-search-widget" style="padding:8px 0;position:relative">
      {/* Filter toolbar — purely client-side */}
      <div data-testid="filter-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;padding:6px 12px;font-size:12px;align-items:center">
        <label style="display:flex;align-items:center;gap:4px">
          Sort:
          <select
            data-testid="filter-sort"
            value={filters.sort}
            onChange={(e) => setFilters({ ...filters, sort: (e.currentTarget.value as 'rating' | 'distance') })}
          >
            <option value="distance">Distance</option>
            <option value="rating">Rating</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:4px">
          <input
            data-testid="filter-open-now"
            type="checkbox"
            checked={filters.openNow}
            onChange={(e) => setFilters({ ...filters, openNow: e.currentTarget.checked })}
          />
          Open now
        </label>
        <label style="display:flex;align-items:center;gap:4px">
          Min ★:
          <select
            data-testid="filter-min-stars"
            value={String(filters.minStars)}
            onChange={(e) => setFilters({ ...filters, minStars: parseFloat(e.currentTarget.value) })}
          >
            <option value="0">Any</option>
            <option value="3">3+</option>
            <option value="4">4+</option>
            <option value="4.5">4.5+</option>
            <option value="4.7">4.7+</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:4px">
          Within:
          <select
            data-testid="filter-radius"
            value={String(filters.radiusM)}
            onChange={(e) => setFilters({ ...filters, radiusM: parseInt(e.currentTarget.value, 10) })}
          >
            <option value="200">200 m</option>
            <option value="500">500 m</option>
            <option value="1000">1 km</option>
            <option value="2000">2 km</option>
            <option value="5000">5 km</option>
          </select>
        </label>
      </div>

      {error && <div style="padding:0 12px;margin-top:6px"><ErrorBox>{error}</ErrorBox></div>}

      <div style="position:relative;margin:8px 12px">
        <MapCanvas
          center={center ?? undefined}
          zoom={14}
          height={280}
          onCenterChanged={onMapCenterChanged}
        >
          {visible.map((p, i) => (
            <AdvancedMarker
              key={p.id}
              position={p.location}
              title={p.name}
              onClick={() => openPlace(p)}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div
                data-marker-id={p.id}
                data-hovered={hoveredId === p.id ? 'true' : 'false'}
                style={`background:${hoveredId === p.id ? '#3b82f6' : '#1d4ed8'};color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.4);cursor:pointer;transform:${hoveredId === p.id ? 'scale(1.2)' : 'scale(1)'};transition:transform 120ms`}
              >
                {i + 1}
              </div>
            </AdvancedMarker>
          ))}
        </MapCanvas>

        {showSearchArea && (
          <button
            data-testid="search-this-area"
            onClick={handleSearchThisArea}
            disabled={searchingArea}
            style="position:absolute;top:8px;left:50%;transform:translateX(-50%);background:#1d4ed8;color:white;border:none;border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3)"
          >
            {searchingArea ? 'Searching…' : '🔍 Search this area'}
          </button>
        )}
      </div>

      <ul data-testid="places-list" style="margin:0;padding:0;list-style:none;font-size:13px">
        {visible.length === 0 ? (
          <li style="padding:12px;color:#888;text-align:center">No places match these filters.</li>
        ) : (
          visible.map((p, i) => {
            const distance = center ? haversineMeters(p.location, center) : null;
            const price = priceGlyph(p.priceLevel);
            return (
              <li
                key={p.id}
                data-testid="place-list-item"
                data-list-item={p.id}
                data-hovered={hoveredId === p.id ? 'true' : 'false'}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => openPlace(p)}
                style={`display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-top:1px solid rgba(127,127,127,0.15);cursor:pointer;background:${hoveredId === p.id ? 'rgba(59,130,246,0.08)' : 'transparent'}`}
              >
                <span style="flex:0 0 26px;height:26px;border-radius:50%;background:#1d4ed8;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600">{i + 1}</span>
                <span style="flex:1 1 auto">
                  <div style="font-weight:500">{p.name}</div>
                  <div style="font-size:12px;color:#888;margin-top:2px;display:flex;gap:6px;flex-wrap:wrap">
                    {p.rating != null && <span>★ {p.rating}{p.userRatingCount ? ` (${p.userRatingCount})` : ''}</span>}
                    {distance != null && <span>· {formatDistance(distance)}</span>}
                    {price && <span>· {price}</span>}
                    {p.openingHours && (
                      <span style={`color:${p.openingHours.openNow ? '#22c55e' : '#f59e0b'}`}>
                        · {p.openingHours.openNow ? 'Open' : 'Closed'}
                      </span>
                    )}
                  </div>
                </span>
              </li>
            );
          })
        )}
      </ul>

      {selectedPlace && (
        <PlaceCard
          place={selectedPlace}
          apiKey={apiKey}
          client={client}
          onClose={() => setSelectedPlace(null)}
        />
      )}
    </div>
  );
}
