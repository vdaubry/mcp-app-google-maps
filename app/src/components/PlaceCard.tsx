/**
 * PlaceCard — modal-style overlay shown when the user clicks a marker / list item.
 * Renders a photo (when available), full opening hours, address, and a Maps deep-link.
 */

import type { Place } from '../lib/types';
import type { MapsMcpClient } from '../lib/mcp-client';
import { priceGlyph } from './Common';

interface Props {
  place: Place;
  apiKey: string | null;
  client: MapsMcpClient | null;
  onClose: () => void;
}

export function PlaceCard({ place, apiKey, client, onClose }: Props) {
  const photoUrl = place.photoRefs?.[0] && apiKey
    ? `https://places.googleapis.com/v1/${place.photoRefs[0]}/media?maxHeightPx=400&maxWidthPx=600&key=${encodeURIComponent(apiKey)}`
    : null;
  const price = priceGlyph(place.priceLevel);

  return (
    <div
      data-testid="place-card"
      role="dialog"
      aria-label={place.name}
      style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10"
      onClick={onClose}
    >
      <div
        style="background:var(--color-bg,#1a1a1a);color:var(--color-text,#e6e6e6);max-width:420px;width:92%;border-radius:10px;overflow:hidden;border:1px solid rgba(127,127,127,0.3);box-shadow:0 12px 36px rgba(0,0,0,0.5)"
        onClick={(e) => e.stopPropagation()}
      >
        {photoUrl && (
          <div style={`width:100%;height:180px;background:#222 url("${photoUrl.replace(/"/g, '%22')}") center/cover no-repeat`}></div>
        )}
        <div style="padding:14px 16px">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <h3 style="margin:0;flex:1 1 auto;font-size:16px">{place.name}</h3>
            <button
              data-testid="place-card-close"
              aria-label="Close"
              onClick={onClose}
              style="background:transparent;border:none;color:#888;font-size:20px;line-height:1;padding:0 4px"
            >×</button>
          </div>

          <div style="display:flex;gap:10px;align-items:center;margin-top:6px;font-size:13px;color:#aaa">
            {place.rating != null && <span>★ {place.rating} {place.userRatingCount ? `(${place.userRatingCount})` : ''}</span>}
            {place.primaryType && <span>· {place.primaryType.replace(/_/g, ' ')}</span>}
            {price && <span>· {price}</span>}
            {place.openingHours && (
              <span style={`color:${place.openingHours.openNow ? '#22c55e' : '#f59e0b'}`}>
                {place.openingHours.openNow ? 'Open now' : 'Closed'}
              </span>
            )}
          </div>

          {place.formattedAddress && (
            <p style="margin:10px 0 4px 0;font-size:13px;color:#bbb">{place.formattedAddress}</p>
          )}

          {place.openingHours?.weekdayDescriptions && place.openingHours.weekdayDescriptions.length > 0 && (
            <ul data-testid="hours-list" style="margin:8px 0;padding:0;list-style:none;font-size:12px;color:#aaa">
              {place.openingHours.weekdayDescriptions.map((d, i) => <li key={i} style="padding:2px 0">{d}</li>)}
            </ul>
          )}

          {place.mapsUrl && (
            <a
              data-testid="place-card-maps-link"
              href={place.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                // Iframe sandbox blocks target="_blank" navigation — delegate
                // to the host via the SEP-1865 openLink capability instead.
                e.preventDefault();
                if (place.mapsUrl) void client?.openLink(place.mapsUrl);
              }}
              style="display:inline-block;margin-top:8px;font-size:13px;color:#3b82f6;text-decoration:none"
            >⤢ Open in Maps</a>
          )}
        </div>
      </div>
    </div>
  );
}
