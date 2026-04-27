import { describe, it, expect, vi } from 'vitest';
import { buildMapsAppHandlers, MAPS_RESOURCE_URI, TOOL_DEFINITIONS } from '../handlers/index.js';
import { MapsApiError, type Place, type RouteResult } from '../types.js';

function fakeRoute(): RouteResult {
  return {
    duration: '1450s',
    distanceMeters: 6800,
    polyline: 'abc',
    bounds: {
      northeast: { lat: 43.71, lng: 7.27 },
      southwest: { lat: 43.65, lng: 7.20 },
    },
    steps: [
      { instruction: 'Head north', distanceMeters: 220 },
      { instruction: 'Turn left', distanceMeters: 1200 },
    ],
  };
}

function fakePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: 'p1',
    name: 'Café du Port',
    location: { lat: 43.71, lng: 7.28 },
    rating: 4.7,
    userRatingCount: 320,
    primaryType: 'cafe',
    openingHours: { openNow: true, weekdayDescriptions: [] },
    ...overrides,
  };
}

function fakeService(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getDirections: vi.fn(async () => fakeRoute()),
    nearbyPlaces: vi.fn(async () => [fakePlace()]),
    searchPlaces: vi.fn(async () => [fakePlace()]),
    geocode: vi.fn(async () => [{ formattedAddress: 'Nice, France', location: { lat: 43.7, lng: 7.27 }, placeId: 'pid' }]),
    getPlace: vi.fn(async () => fakePlace()),
    ...overrides,
  } as unknown as import('../maps-service.js').MapsService;
}

const apiKey = 'AIza-test-key';

describe('TOOL_DEFINITIONS', () => {
  it('lists 9 tools (4 model-callable + 5 iframe-only)', () => {
    expect(TOOL_DEFINITIONS.map(d => d.name).sort()).toEqual([
      'geocode',
      'get_directions',
      'get_js_key_app',
      'get_place_app',
      'nearby_places',
      'refine_search_app',
      'search_in_bounds_app',
      'search_places',
      'update_directions_app',
    ]);
  });

  it('marks model-callable tools with visibility ["model","app"]', () => {
    const modelCallable = ['get_directions', 'nearby_places', 'search_places', 'geocode'];
    for (const name of modelCallable) {
      const def = TOOL_DEFINITIONS.find(d => d.name === name);
      expect(def?.spec._meta.ui.visibility).toEqual(['model', 'app']);
    }
  });

  it('marks iframe-only tools with visibility ["app"]', () => {
    const iframeOnly = ['update_directions_app', 'refine_search_app', 'search_in_bounds_app', 'get_place_app', 'get_js_key_app'];
    for (const name of iframeOnly) {
      const def = TOOL_DEFINITIONS.find(d => d.name === name);
      expect(def?.spec._meta.ui.visibility).toEqual(['app']);
    }
  });
});

describe('buildMapsAppHandlers', () => {
  it('exposes 4 model-callable + 5 iframe-only tools', () => {
    const handlers = buildMapsAppHandlers({ mapsService: fakeService(), apiKey });
    const toolNames = Object.keys(handlers).sort();
    expect(toolNames).toEqual([
      'geocode',
      'get_directions',
      'get_js_key_app',
      'get_place_app',
      'nearby_places',
      'refine_search_app',
      'search_in_bounds_app',
      'search_places',
      'update_directions_app',
    ]);
  });

  it('get_directions defaults to bicycling and returns the directions widget envelope', async () => {
    const svc = fakeService();
    const handlers = buildMapsAppHandlers({ mapsService: svc, apiKey });
    const result = await handlers.get_directions({ origin: 'A', destination: 'B' });

    expect(result.isError).toBe(false);
    expect(result._meta).toEqual({ ui: { resourceUri: MAPS_RESOURCE_URI } });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.widget).toBe('directions');
    expect(sc.mode).toBe('bicycling');
    expect(sc.queryEcho).toEqual({ origin: 'A', destination: 'B' });
    expect(typeof sc.version).toBe('number');
    expect(typeof sc.refreshedAt).toBe('string');
    expect(svc.getDirections).toHaveBeenCalledWith({ origin: 'A', destination: 'B', mode: 'bicycling' });
  });

  it('get_directions with mode=walking is wired through', async () => {
    const svc = fakeService();
    const handlers = buildMapsAppHandlers({ mapsService: svc, apiKey });
    await handlers.get_directions({ origin: 'A', destination: 'B', mode: 'walking' });
    expect(svc.getDirections).toHaveBeenCalledWith({ origin: 'A', destination: 'B', mode: 'walking' });
  });

  it('rejects invalid mode values via Zod', async () => {
    const handlers = buildMapsAppHandlers({ mapsService: fakeService(), apiKey });
    const result = await handlers.get_directions({ origin: 'A', destination: 'B', mode: 'invalid' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid arguments');
  });

  it('nearby_places returns nearby-search widget envelope with center + queryEcho', async () => {
    const svc = fakeService();
    const handlers = buildMapsAppHandlers({ mapsService: svc, apiKey });
    const result = await handlers.nearby_places(
      { location: { lat: 43.7, lng: 7.27 }, radius: 500, type: 'cafe' },
    );
    expect(result.isError).toBe(false);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.widget).toBe('nearby-search');
    expect(sc.center).toEqual({ lat: 43.7, lng: 7.27 });
    expect((sc.queryEcho as Record<string, unknown>).type).toBe('cafe');
    expect(Array.isArray(sc.places)).toBe(true);
  });

  it('search_places returns nearby-search widget envelope using locationBias as center', async () => {
    const handlers = buildMapsAppHandlers({ mapsService: fakeService(), apiKey });
    const result = await handlers.search_places(
      { query: 'pizza', locationBias: { lat: 43.7, lng: 7.27 } },
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.widget).toBe('nearby-search');
    expect(sc.center).toEqual({ lat: 43.7, lng: 7.27 });
  });

  it('geocode returns a geocode widget envelope with results', async () => {
    const handlers = buildMapsAppHandlers({ mapsService: fakeService(), apiKey });
    const result = await handlers.geocode({ address: 'Nice' });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.widget).toBe('geocode');
    expect((sc.results as unknown[]).length).toBe(1);
  });

  it('errors translate to isError:true with descriptive text', async () => {
    const svc = fakeService({
      getDirections: vi.fn(async () => { throw new MapsApiError(429, 'RESOURCE_EXHAUSTED', 'rate limited', true); }),
    });
    const handlers = buildMapsAppHandlers({ mapsService: svc, apiKey });
    const result = await handlers.get_directions({ origin: 'A', destination: 'B' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('RESOURCE_EXHAUSTED');
    // _meta still set on errors so the iframe can render an error overlay.
    expect(result._meta).toEqual({ ui: { resourceUri: MAPS_RESOURCE_URI } });
  });

  it('update_directions_app behaves identically to get_directions (used for mode-switch)', async () => {
    const svc = fakeService();
    const handlers = buildMapsAppHandlers({ mapsService: svc, apiKey });
    const result = await handlers.update_directions_app({ origin: 'A', destination: 'B', mode: 'walking' });
    expect(result.isError).toBe(false);
    expect(svc.getDirections).toHaveBeenCalledWith({ origin: 'A', destination: 'B', mode: 'walking' });
  });

  it('search_in_bounds_app re-runs nearbyPlaces with the new center', async () => {
    const svc = fakeService();
    const handlers = buildMapsAppHandlers({ mapsService: svc, apiKey });
    await handlers.search_in_bounds_app(
      { center: { lat: 1, lng: 2 }, radiusM: 500, type: 'cafe' },
    );
    expect(svc.nearbyPlaces).toHaveBeenCalledWith({
      location: { lat: 1, lng: 2 },
      radius: 500,
      type: 'cafe',
      openNow: undefined,
      count: undefined,
    });
  });

  it('get_place_app returns a place payload', async () => {
    const handlers = buildMapsAppHandlers({ mapsService: fakeService(), apiKey });
    const result = await handlers.get_place_app({ placeId: 'abc' });
    expect(result.isError).toBe(false);
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.place as Record<string, unknown>).name).toBe('Café du Port');
  });

  it('get_js_key_app returns the configured api key', async () => {
    const handlers = buildMapsAppHandlers({ mapsService: fakeService(), apiKey });
    const result = await handlers.get_js_key_app({});
    expect(result.isError).toBe(false);
    expect((result.structuredContent as { apiKey: string }).apiKey).toBe(apiKey);
  });

  it('rejects unknown extra arguments via .strict() parsers', async () => {
    const handlers = buildMapsAppHandlers({ mapsService: fakeService(), apiKey });
    const result = await handlers.get_directions(
      { origin: 'A', destination: 'B', secret: 'x' },
    );
    expect(result.isError).toBe(true);
  });
});
