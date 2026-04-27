/** Shared visual primitives — kept inline for the single-file bundle. */

export function EmptyState({ children }: { children: preact.ComponentChildren }) {
  return (
    <div data-testid="empty-state" style="padding:24px 16px;text-align:center;color:var(--color-text-muted,#888);font-size:13px">
      {children}
    </div>
  );
}

export function Loading({ children }: { children?: preact.ComponentChildren }) {
  return (
    <div data-testid="loading" style="padding:16px;color:var(--color-text-muted,#888);font-size:13px">
      {children ?? 'Loading…'}
    </div>
  );
}

export function ErrorBox({ children }: { children: preact.ComponentChildren }) {
  return (
    <div data-testid="error-box" style="padding:8px 12px;border:1px solid #f88;border-radius:6px;background:#3a1f1f;color:#f88;font-size:13px">
      {children}
    </div>
  );
}

const PRICE_TO_GLYPH: Record<string, string> = {
  PRICE_LEVEL_FREE: 'free',
  PRICE_LEVEL_INEXPENSIVE: '€',
  PRICE_LEVEL_MODERATE: '€€',
  PRICE_LEVEL_EXPENSIVE: '€€€',
  PRICE_LEVEL_VERY_EXPENSIVE: '€€€€',
};

export function priceGlyph(level?: string): string | null {
  if (!level) return null;
  return PRICE_TO_GLYPH[level] ?? null;
}

export function formatDuration(durationStr: string): string {
  const m = durationStr.match(/^(\d+(?:\.\d+)?)s$/);
  if (!m) return durationStr;
  const sec = parseFloat(m[1]);
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min - h * 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Haversine distance in meters between two lat/lng points. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371_000; // earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
