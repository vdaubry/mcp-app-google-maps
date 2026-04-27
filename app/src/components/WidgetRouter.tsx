import type { WidgetPayload } from '../lib/types';
import type { MapsMcpClient } from '../lib/mcp-client';
import { DirectionsWidget } from './DirectionsWidget';
import { NearbySearchWidget } from './NearbySearchWidget';
import { EmptyState } from './Common';

interface Props {
  payload: WidgetPayload | null;
  client: MapsMcpClient | null;
  onSwap: (payload: WidgetPayload) => void;
}

export function WidgetRouter({ payload, client, onSwap }: Props) {
  if (!payload) return <EmptyState>Waiting for data…</EmptyState>;

  switch (payload.widget) {
    case 'directions':
      return <DirectionsWidget payload={payload} client={client} onSwap={onSwap} />;
    case 'nearby-search':
      return <NearbySearchWidget payload={payload} client={client} onSwap={onSwap} />;
    case 'geocode':
      // Geocode results are useful as text only — render a minimal one-liner.
      return (
        <div data-widget="geocode" data-testid="geocode-widget" style="padding:12px 16px;font-size:13px">
          {payload.results.length === 0
            ? <span style="color:#888">No matches.</span>
            : payload.results.map(r => (
                <div key={r.placeId} style="margin:2px 0">
                  <strong>{r.formattedAddress}</strong> — {r.location.lat.toFixed(5)}, {r.location.lng.toFixed(5)}
                </div>
              ))}
        </div>
      );
    default:
      return <EmptyState>Unsupported widget</EmptyState>;
  }
}
