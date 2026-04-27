/**
 * MapCanvas — wraps `@vis.gl/react-google-maps` `<APIProvider>` + `<Map>`.
 *
 * The inner iframe loads `window.google.maps` via `loadMapsApi()` at startup
 * (which fetches the JS key via the AppBridge `get_js_key_app` tool and injects
 * the script tag). APIProvider then sees the global google.maps and skips its
 * own loader.
 *
 * Children are typically `<AdvancedMarker>` / `<Polyline>` etc. — passed through.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { APIProvider, Map } from '@vis.gl/react-google-maps';
import { loadMapsApi } from '../lib/maps-loader';
import { Loading, ErrorBox } from './Common';
import type { Bounds, LatLng } from '../lib/types';

interface Props {
  center?: LatLng;
  zoom?: number;
  bounds?: Bounds;
  /** Fired once when the map is created and idle, with the underlying google.maps.Map. */
  onMapReady?: (map: google.maps.Map) => void;
  /** Fired when the user pans/zooms the map. */
  onCenterChanged?: (center: LatLng) => void;
  /** Map style — `transparent` keeps the chat bubble look. */
  height?: number;
  children?: preact.ComponentChildren;
}

export function MapCanvas({
  center,
  zoom,
  bounds,
  onMapReady,
  onCenterChanged,
  height = 320,
  children,
}: Props) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mapReadyFiredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadMapsApi()
      .then(({ apiKey }) => { if (!cancelled) setApiKey(apiKey); })
      .catch(err => { if (!cancelled) setError(String((err as Error).message ?? err)); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <ErrorBox>Map failed to load: {error}</ErrorBox>;
  if (!apiKey) return <Loading>Loading map…</Loading>;

  // Compute initial center/zoom from `bounds` if explicit center is missing.
  const initialCenter = center ?? (bounds
    ? {
        lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
        lng: (bounds.northeast.lng + bounds.southwest.lng) / 2,
      }
    : { lat: 0, lng: 0 });

  return (
    <div style={`width:100%;height:${height}px;border-radius:8px;overflow:hidden`}>
      <APIProvider apiKey={apiKey}>
        <Map
          mapId="yapa-maps-mcp-app"
          defaultCenter={initialCenter}
          defaultZoom={zoom ?? 14}
          gestureHandling="greedy"
          disableDefaultUI={false}
          onIdle={(ev) => {
            // `onIdle` fires after every pan/zoom; we only want to expose the
            // map instance to the parent on the FIRST idle. Subsequent idles
            // would re-trigger the parent's setup (e.g. re-fitting bounds and
            // fighting the user's pan).
            if (mapReadyFiredRef.current) return;
            mapReadyFiredRef.current = true;
            onMapReady?.(ev.map);
          }}
          onCenterChanged={(ev) => {
            const c = ev.detail.center;
            if (c && onCenterChanged) onCenterChanged({ lat: c.lat, lng: c.lng });
          }}
        >
          {children}
        </Map>
      </APIProvider>
    </div>
  );
}
