import { describe, it, expect } from 'vitest';
import { boundsCenter, boundsOf, decodePolyline, hasArea, initialView } from '../../app/src/lib/geo';

describe('decodePolyline', () => {
  it('decodes the reference polyline from the Google docs', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('returns an empty path for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('keeps the decoded points of a truncated polyline instead of throwing', () => {
    expect(decodePolyline('_p~iF~ps|U_ulL')).toEqual([{ lat: 38.5, lng: -120.2 }]);
  });
});

describe('boundsOf', () => {
  it('returns null for no points', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('spans every point', () => {
    const b = boundsOf([{ lat: 43.70, lng: 7.27 }, { lat: 43.69, lng: 7.25 }, { lat: 43.71, lng: 7.26 }])!;
    expect(b).toEqual({ northeast: { lat: 43.71, lng: 7.27 }, southwest: { lat: 43.69, lng: 7.25 } });
    expect(hasArea(b)).toBe(true);
  });

  it('collapses to the point itself for a single result', () => {
    const b = boundsOf([{ lat: 43.7009, lng: 7.27139 }])!;
    expect(hasArea(b)).toBe(false);
    expect(boundsCenter(b)).toEqual({ lat: 43.7009, lng: 7.27139 });
  });
});

describe('initialView', () => {
  it('prefers an explicit centre', () => {
    expect(initialView({ lat: 1, lng: 2 }, null, 15)).toEqual({ center: { lat: 1, lng: 2 }, zoom: 15 });
  });

  it('centres on the bounds when the centre is missing', () => {
    // 18/10 repro: search_places with no locationBias → center null, one place in Nice.
    const b = boundsOf([{ lat: 43.7009, lng: 7.27139 }]);
    expect(initialView(null, b, 14)).toEqual({ center: { lat: 43.7009, lng: 7.27139 }, zoom: 14 });
  });

  it('falls back to a world view, never zoom 14 on (0,0)', () => {
    expect(initialView(undefined, undefined, 14)).toEqual({ center: { lat: 0, lng: 0 }, zoom: 2 });
  });
});
