/**
 * DirectionsWidget — renders a live, zoomable Google Map with a blue polyline
 * from origin to destination. Mode tabs (bike / walk / transit / drive) call
 * `update_directions_app` and swap `structuredContent` without consuming an
 * agent turn.
 *
 * The turn-by-turn step list was removed: users overwhelmingly use this widget
 * to glance at the route shape, not to read instructions step-by-step. The
 * backend still returns `route.steps` so the natural-language `text` summary
 * (used on voice / WhatsApp / SMS) can speak them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AdvancedMarker } from '@vis.gl/react-google-maps';
import type { DirectionsPayload, LatLng, TravelMode, WidgetPayload } from '../lib/types';
import { decodePolyline, toLiteral } from '../lib/geo';
import type { MapsMcpClient } from '../lib/mcp-client';
import { isDirectionsPayload } from '../lib/mcp-client';
import { MapCanvas } from './MapCanvas';
import { ErrorBox, formatDistance, formatDuration } from './Common';

interface Props {
  payload: DirectionsPayload;
  client: MapsMcpClient | null;
  onSwap: (next: WidgetPayload) => void;
}

const MODES: Array<{ mode: TravelMode; label: string; emoji: string }> = [
  { mode: 'bicycling', label: 'Bike', emoji: '🚴' },
  { mode: 'walking', label: 'Walk', emoji: '🚶' },
  { mode: 'transit', label: 'Transit', emoji: '🚇' },
  { mode: 'driving', label: 'Drive', emoji: '🚗' },
];

function buildOpenInMapsUrl(payload: DirectionsPayload): string {
  const { origin, destination } = payload.queryEcho;
  const travelmode = payload.mode === 'bicycling' ? 'bicycling'
    : payload.mode === 'walking' ? 'walking'
    : payload.mode === 'transit' ? 'transit'
    : 'driving';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${travelmode}`;
}

export function DirectionsWidget({ payload, client, onSwap }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  const bounds = payload.route.bounds;

  // Decoded locally (lib/geo): no wait on the `geometry` library, so a route
  // can never stay undrawn because that library failed to load.
  const polylinePath = useMemo<LatLng[] | null>(
    () => (payload.route.polyline ? decodePolyline(payload.route.polyline) : null),
    [payload.route.polyline],
  );

  const start = polylinePath?.[0] ?? null;
  const end = polylinePath ? polylinePath[polylinePath.length - 1] : null;

  // Draw / redraw the route polyline on the map. Called both when the map first
  // becomes ready and whenever `polylinePath` changes (e.g. after a mode swap).
  const drawRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;

    // Clear previous overlay before drawing.
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    if (!polylinePath || polylinePath.length === 0) {
      if (bounds) map.fitBounds(toLiteral(bounds), 32);
      return;
    }

    polylineRef.current = new window.google.maps.Polyline({
      path: polylinePath,
      strokeColor: '#3b82f6',
      strokeOpacity: 0.9,
      strokeWeight: 5,
      clickable: false,
    });
    polylineRef.current.setMap(map);

    // Re-fit bounds to the route on every redraw (mode swap can change the path).
    if (bounds) {
      map.fitBounds(toLiteral(bounds), 32);
    } else {
      const b = new window.google.maps.LatLngBounds();
      for (const p of polylinePath) b.extend(p);
      map.fitBounds(b, 32);
    }
  }, [polylinePath, bounds]);

  // When polylinePath or bounds change, redraw onto the cached map (if ready).
  useEffect(() => { drawRoute(); }, [drawRoute]);

  async function handleModeSwitch(newMode: TravelMode) {
    if (!client || newMode === payload.mode) return;
    setLoading(true);
    setError(null);
    try {
      const result = await client.updateDirections({
        origin: payload.queryEcho.origin,
        destination: payload.queryEcho.destination,
        mode: newMode,
      });
      const sc = result?.structuredContent;
      if (isDirectionsPayload(sc)) {
        onSwap(sc);
      } else if (result?.isError) {
        const text = result.content?.[0]?.text ?? 'Unknown error';
        setError(text);
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const onMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    drawRoute();
  }, [drawRoute]);

  return (
    <div data-widget="directions" data-testid="directions-widget" style="padding:8px 0">
      <header style="display:flex;align-items:center;gap:8px;padding:6px 12px;flex-wrap:wrap">
        <div role="tablist" aria-label="Travel mode" style="display:flex;gap:4px;flex:1 1 auto">
          {MODES.map(m => {
            const isActive = m.mode === payload.mode;
            return (
              <button
                key={m.mode}
                data-testid={`mode-tab-${m.mode}`}
                data-active={isActive ? 'true' : 'false'}
                role="tab"
                aria-selected={isActive}
                disabled={loading || !client}
                onClick={() => handleModeSwitch(m.mode)}
                style={`padding:4px 10px;border-radius:999px;font-size:12px;border:1px solid ${isActive ? '#3b82f6' : 'rgba(127,127,127,0.4)'};background:${isActive ? '#3b82f622' : 'transparent'};color:inherit;cursor:${loading ? 'wait' : 'pointer'}`}
              >
                <span aria-hidden="true">{m.emoji}</span> {m.label}
              </button>
            );
          })}
        </div>
        <a
          data-testid="open-in-maps"
          href={buildOpenInMapsUrl(payload)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            // Iframe sandbox blocks target="_blank" navigation — delegate to
            // the host via the SEP-1865 openLink capability instead.
            e.preventDefault();
            void client?.openLink(buildOpenInMapsUrl(payload));
          }}
          style="font-size:12px;text-decoration:none;color:#3b82f6;padding:4px 8px"
        >
          ⤢ Open in Maps
        </a>
      </header>

      {error && <div style="padding:0 12px"><ErrorBox>{error}</ErrorBox></div>}

      <div style="margin:8px 12px">
        <MapCanvas
          bounds={bounds}
          height={480}
          onMapReady={onMapReady}
        >
          {start && (
            <AdvancedMarker position={start} title="Start">
              <div style="background:#22c55e;border-radius:50%;width:14px;height:14px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.4)"></div>
            </AdvancedMarker>
          )}
          {end && (
            <AdvancedMarker position={end} title="End">
              <div style="background:#ef4444;border-radius:50%;width:14px;height:14px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.4)"></div>
            </AdvancedMarker>
          )}
        </MapCanvas>
      </div>

      <div data-testid="directions-stats" style="padding:6px 12px 12px 12px;font-size:13px;display:flex;gap:14px;flex-wrap:wrap">
        <span>⏱ <strong>{formatDuration(payload.route.duration)}</strong></span>
        <span>📏 <strong>{formatDistance(payload.route.distanceMeters)}</strong></span>
        <span style="color:#888">{payload.queryEcho.origin} → {payload.queryEcho.destination}</span>
      </div>
    </div>
  );
}
