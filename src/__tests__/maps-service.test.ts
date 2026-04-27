import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MapsService, parseLocationForRoutes, parseRoute, parsePlace } from '../maps-service.js';
import { MapsApiError } from '../types.js';

interface MockCall {
  url: string;
  init?: RequestInit;
}

function makeFetchMock(responses: Array<{ status?: number; ok?: boolean; body: unknown }>) {
  const calls: MockCall[] = [];
  let i = 0;
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i++] ?? { status: 200, body: {} };
    const status = r.status ?? 200;
    const ok = r.ok ?? (status >= 200 && status < 300);
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => r.body,
    } as unknown as Response;
  });
  return { fn, calls };
}

const apiKey = 'test-key';
const publicOrigin = 'http://localhost:3007';

function svc(fetchFn: typeof fetch) {
  return new MapsService({ apiKey, publicOrigin, fetchFn });
}

describe('parseLocationForRoutes', () => {
  it('parses lat,lng strings', () => {
    expect(parseLocationForRoutes('43.7,7.2')).toEqual({
      location: { latLng: { latitude: 43.7, longitude: 7.2 } },
    });
  });
  it('treats anything else as an address', () => {
    expect(parseLocationForRoutes('Place Garibaldi, Nice')).toEqual({ address: 'Place Garibaldi, Nice' });
  });
  it('handles negative coords with whitespace', () => {
    expect(parseLocationForRoutes('  -33.86 , 151.21 ')).toEqual({
      location: { latLng: { latitude: -33.86, longitude: 151.21 } },
    });
  });
});

describe('MapsService.getDirections', () => {
  let service: MapsService;
  let calls: MockCall[];
  let fetchMock: ReturnType<typeof makeFetchMock>['fn'];

  beforeEach(() => {
    const m = makeFetchMock([{
      body: {
        routes: [{
          duration: '1450s',
          distanceMeters: 6800,
          polyline: { encodedPolyline: 'abcd' },
          viewport: {
            high: { latitude: 43.71, longitude: 7.27 },
            low: { latitude: 43.65, longitude: 7.20 },
          },
          legs: [{
            steps: [
              { distanceMeters: 220, polyline: { encodedPolyline: 'p1' }, navigationInstruction: { instructions: 'Head north', maneuver: 'STRAIGHT' } },
              { distanceMeters: 1200, polyline: { encodedPolyline: 'p2' }, navigationInstruction: { instructions: 'Turn left', maneuver: 'TURN_LEFT' } },
              { distanceMeters: 0 }, // Has no instruction — skipped.
            ],
          }],
        }],
      },
    }]);
    fetchMock = m.fn; calls = m.calls;
    service = svc(fetchMock as unknown as typeof fetch);
  });

  it('defaults to bicycling mode and posts to Routes API with correct headers', async () => {
    const route = await service.getDirections({ origin: 'A', destination: 'B' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = calls[0].init!.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe(apiKey);
    expect(headers['Referer']).toBe(publicOrigin);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Goog-FieldMask']).toContain('routes.duration');
    expect(headers['X-Goog-FieldMask']).toContain('routes.polyline.encodedPolyline');
    expect(headers['X-Goog-FieldMask']).toContain('routes.viewport');

    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.travelMode).toBe('BICYCLE');
    expect(body.origin).toEqual({ address: 'A' });
    expect(body.destination).toEqual({ address: 'B' });
    expect(body.routingPreference).toBeUndefined();

    expect(route.duration).toBe('1450s');
    expect(route.distanceMeters).toBe(6800);
    expect(route.polyline).toBe('abcd');
    expect(route.bounds).toEqual({
      northeast: { lat: 43.71, lng: 7.27 },
      southwest: { lat: 43.65, lng: 7.20 },
    });
    expect(route.steps).toHaveLength(2);
    expect(route.steps[0]).toEqual({ instruction: 'Head north', distanceMeters: 220, polyline: 'p1', maneuver: 'STRAIGHT' });
    expect(route.steps[1]).toEqual({ instruction: 'Turn left', distanceMeters: 1200, polyline: 'p2', maneuver: 'TURN_LEFT' });
  });

  it('adds routingPreference: TRAFFIC_AWARE for driving mode', async () => {
    await service.getDirections({ origin: 'A', destination: 'B', mode: 'driving' });
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_AWARE');
  });

  it('maps walking → WALK', async () => {
    await service.getDirections({ origin: 'A', destination: 'B', mode: 'walking' });
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.travelMode).toBe('WALK');
  });

  it('maps transit → TRANSIT', async () => {
    await service.getDirections({ origin: 'A', destination: 'B', mode: 'transit' });
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.travelMode).toBe('TRANSIT');
  });

  it('throws NOT_FOUND when no routes returned', async () => {
    const m = makeFetchMock([{ body: { routes: [] } }]);
    const s = svc(m.fn as unknown as typeof fetch);
    await expect(s.getDirections({ origin: 'A', destination: 'B' })).rejects.toMatchObject({
      name: 'MapsApiError',
      status: 404,
      code: 'NOT_FOUND',
      retryable: false,
    });
  });

  it('parses lat,lng inputs correctly', async () => {
    await service.getDirections({ origin: '43.7,7.2', destination: 'X' });
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.origin).toEqual({ location: { latLng: { latitude: 43.7, longitude: 7.2 } } });
  });
});

describe('MapsService.nearbyPlaces', () => {
  it('builds the searchNearby request with circle restriction and parses places', async () => {
    const m = makeFetchMock([{
      body: {
        places: [{
          id: 'place-1',
          displayName: { text: 'Café du Port' },
          formattedAddress: '12 rue Cassini, Nice',
          location: { latitude: 43.71, longitude: 7.28 },
          rating: 4.7,
          userRatingCount: 320,
          googleMapsUri: 'https://maps.google.com/?cid=1',
          primaryType: 'cafe',
          types: ['cafe', 'food'],
          regularOpeningHours: {
            openNow: true,
            weekdayDescriptions: ['Mon: 8am-7pm', 'Tue: 8am-7pm'],
          },
          photos: [{ name: 'places/place-1/photos/abc' }],
        }],
      },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    const places = await s.nearbyPlaces({ location: { lat: 43.7, lng: 7.27 }, radius: 500, type: 'cafe', count: 5 });

    expect(m.calls[0].url).toBe('https://places.googleapis.com/v1/places:searchNearby');
    const body = JSON.parse(m.calls[0].init!.body as string);
    expect(body.includedTypes).toEqual(['cafe']);
    expect(body.maxResultCount).toBe(5);
    expect(body.rankPreference).toBe('DISTANCE');
    expect(body.locationRestriction.circle.center).toEqual({ latitude: 43.7, longitude: 7.27 });
    expect(body.locationRestriction.circle.radius).toBe(500);

    expect(places).toHaveLength(1);
    expect(places[0].id).toBe('place-1');
    expect(places[0].name).toBe('Café du Port');
    expect(places[0].location).toEqual({ lat: 43.71, lng: 7.28 });
    expect(places[0].rating).toBe(4.7);
    expect(places[0].userRatingCount).toBe(320);
    expect(places[0].mapsUrl).toBe('https://maps.google.com/?cid=1');
    expect(places[0].primaryType).toBe('cafe');
    expect(places[0].types).toEqual(['cafe', 'food']);
    expect(places[0].photoRefs).toEqual(['places/place-1/photos/abc']);
    expect(places[0].openingHours).toEqual({ openNow: true, weekdayDescriptions: ['Mon: 8am-7pm', 'Tue: 8am-7pm'] });
  });

  it('returns empty array on empty response', async () => {
    const m = makeFetchMock([{ body: {} }]);
    const s = svc(m.fn as unknown as typeof fetch);
    expect(await s.nearbyPlaces({ location: { lat: 0, lng: 0 }, radius: 100 })).toEqual([]);
  });

  it('filters openNow when requested', async () => {
    const m = makeFetchMock([{
      body: { places: [
        { id: 'a', displayName: { text: 'A' }, location: { latitude: 0, longitude: 0 }, regularOpeningHours: { openNow: true, weekdayDescriptions: [] } },
        { id: 'b', displayName: { text: 'B' }, location: { latitude: 0, longitude: 0 }, regularOpeningHours: { openNow: false, weekdayDescriptions: [] } },
      ] },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    const places = await s.nearbyPlaces({ location: { lat: 0, lng: 0 }, radius: 100, openNow: true });
    expect(places).toHaveLength(1);
    expect(places[0].id).toBe('a');
  });

  it('handles places missing optional fields (rating, photos)', async () => {
    const m = makeFetchMock([{
      body: { places: [{ id: 'x', displayName: { text: 'X' }, location: { latitude: 0, longitude: 0 } }] },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    const places = await s.nearbyPlaces({ location: { lat: 0, lng: 0 }, radius: 100 });
    expect(places[0].rating).toBeUndefined();
    expect(places[0].photoRefs).toBeUndefined();
    expect(places[0].mapsUrl).toBe('https://www.google.com/maps/place/?q=place_id:x');
  });

  it('clamps count to 1..20', async () => {
    const m = makeFetchMock([{ body: { places: [] } }, { body: { places: [] } }]);
    const s = svc(m.fn as unknown as typeof fetch);
    await s.nearbyPlaces({ location: { lat: 0, lng: 0 }, radius: 100, count: 50 });
    expect(JSON.parse(m.calls[0].init!.body as string).maxResultCount).toBe(20);
    await s.nearbyPlaces({ location: { lat: 0, lng: 0 }, radius: 100, count: 0 });
    expect(JSON.parse(m.calls[1].init!.body as string).maxResultCount).toBe(1);
  });
});

describe('MapsService.searchPlaces', () => {
  it('builds the searchText request with locationBias and openNow', async () => {
    const m = makeFetchMock([{
      body: {
        places: [
          { id: 'p1', displayName: { text: 'Pizza One' }, location: { latitude: 1, longitude: 2 }, priceLevel: 'PRICE_LEVEL_MODERATE' },
        ],
      },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    const places = await s.searchPlaces({
      query: 'best pizza Nice',
      locationBias: { lat: 43.7, lng: 7.27 },
      radius: 1000,
      openNow: true,
      count: 3,
    });

    expect(m.calls[0].url).toBe('https://places.googleapis.com/v1/places:searchText');
    const body = JSON.parse(m.calls[0].init!.body as string);
    expect(body.textQuery).toBe('best pizza Nice');
    expect(body.pageSize).toBe(3);
    expect(body.openNow).toBe(true);
    expect(body.locationBias.circle.center).toEqual({ latitude: 43.7, longitude: 7.27 });
    expect(body.locationBias.circle.radius).toBe(1000);

    expect(places).toHaveLength(1);
    expect(places[0].priceLevel).toBe('PRICE_LEVEL_MODERATE');
  });
});

describe('MapsService.getPlace', () => {
  it('GETs place details by id', async () => {
    const m = makeFetchMock([{
      body: { id: 'abc', displayName: { text: 'Foo' }, location: { latitude: 1, longitude: 2 }, rating: 4.2 },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    const place = await s.getPlace('abc');
    expect(m.calls[0].url).toBe('https://places.googleapis.com/v1/places/abc');
    expect(m.calls[0].init!.method).toBe('GET');
    expect(place.id).toBe('abc');
    expect(place.rating).toBe(4.2);
  });

  it('URL-encodes the placeId', async () => {
    const m = makeFetchMock([{ body: { id: 'a/b', displayName: { text: 'X' }, location: { latitude: 0, longitude: 0 } } }]);
    const s = svc(m.fn as unknown as typeof fetch);
    await s.getPlace('a/b');
    expect(m.calls[0].url).toBe('https://places.googleapis.com/v1/places/a%2Fb');
  });
});

describe('MapsService.geocode', () => {
  it('GETs the geocode endpoint and parses results', async () => {
    const m = makeFetchMock([{
      body: {
        status: 'OK',
        results: [
          {
            formatted_address: 'Nice, France',
            place_id: 'pid-1',
            geometry: { location: { lat: 43.7, lng: 7.27 } },
          },
        ],
      },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    const results = await s.geocode({ address: 'Nice' });
    expect(m.calls[0].url).toContain('https://maps.googleapis.com/maps/api/geocode/json?address=Nice&key=');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      formattedAddress: 'Nice, France',
      location: { lat: 43.7, lng: 7.27 },
      placeId: 'pid-1',
    });
  });

  it('returns empty list for ZERO_RESULTS', async () => {
    const m = makeFetchMock([{ body: { status: 'ZERO_RESULTS', results: [] } }]);
    const s = svc(m.fn as unknown as typeof fetch);
    expect(await s.geocode({ address: 'nowhere' })).toEqual([]);
  });

  it('throws on a non-OK geocode status (e.g. OVER_QUERY_LIMIT) with retryable=true', async () => {
    const m = makeFetchMock([{ body: { status: 'OVER_QUERY_LIMIT', results: [] } }]);
    const s = svc(m.fn as unknown as typeof fetch);
    await expect(s.geocode({ address: 'X' })).rejects.toMatchObject({
      name: 'MapsApiError',
      code: 'OVER_QUERY_LIMIT',
      retryable: true,
    });
  });
});

describe('MapsService — error translation', () => {
  it('throws non-retryable MapsApiError on 401', async () => {
    const m = makeFetchMock([{
      status: 401,
      body: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'API key invalid' } },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    await expect(s.getDirections({ origin: 'A', destination: 'B' })).rejects.toMatchObject({
      name: 'MapsApiError',
      status: 401,
      code: 'UNAUTHENTICATED',
      retryable: false,
    });
  });

  it('throws retryable MapsApiError on 429', async () => {
    const m = makeFetchMock([{
      status: 429,
      body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Rate limited' } },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    await expect(s.getDirections({ origin: 'A', destination: 'B' })).rejects.toMatchObject({
      name: 'MapsApiError',
      status: 429,
      retryable: true,
    });
  });

  it('throws retryable MapsApiError on 500', async () => {
    const m = makeFetchMock([{
      status: 500,
      body: { error: { code: 500, status: 'INTERNAL', message: 'Internal error' } },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    await expect(s.getDirections({ origin: 'A', destination: 'B' })).rejects.toMatchObject({
      name: 'MapsApiError',
      status: 500,
      retryable: true,
    });
  });

  it('throws non-retryable MapsApiError on 4xx INVALID_ARGUMENT', async () => {
    const m = makeFetchMock([{
      status: 400,
      body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Bad request' } },
    }]);
    const s = svc(m.fn as unknown as typeof fetch);
    await expect(s.getDirections({ origin: 'A', destination: 'B' })).rejects.toMatchObject({
      name: 'MapsApiError',
      status: 400,
      code: 'INVALID_ARGUMENT',
      retryable: false,
    });
  });
});

describe('parsePlace defensive parsing', () => {
  it('falls back when displayName is missing', () => {
    const place = parsePlace({ id: 'abc', location: { latitude: 1, longitude: 2 } });
    expect(place.name).toBe('abc');
  });

  it('returns no openingHours when both are absent', () => {
    const place = parsePlace({ id: 'abc', displayName: { text: 'X' }, location: { latitude: 0, longitude: 0 } });
    expect(place.openingHours).toBeUndefined();
  });
});

describe('parseRoute defensive parsing', () => {
  it('returns empty steps when legs are absent', () => {
    const r = parseRoute({ duration: '0s', distanceMeters: 0, polyline: { encodedPolyline: 'x' } });
    expect(r.steps).toEqual([]);
    expect(r.bounds).toBeUndefined();
  });
});

describe('MapsService — MapsApiError construction', () => {
  it('throws an error from constructor when apiKey is empty', () => {
    expect(() => new MapsService({ apiKey: '', publicOrigin })).toThrow();
  });

  it('MapsApiError carries status / code / retryable', () => {
    const err = new MapsApiError(429, 'RESOURCE_EXHAUSTED', 'rate limited', true);
    expect(err.status).toBe(429);
    expect(err.code).toBe('RESOURCE_EXHAUSTED');
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('rate limited');
  });
});
