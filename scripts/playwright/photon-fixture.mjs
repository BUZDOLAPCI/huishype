import { createServer } from 'node:http';

// Hand-authored public-location data in Photon's GeoJSON provider format.
// This simulates only the external provider boundary; the real API transforms
// these responses and the browser still exercises its real location UI.
// Bounds cover deliberate camera/fitBounds targets in integration, flows and
// visual specs, not arbitrary coordinates or a general-purpose geocoder.
const locations = [
  {
    city: 'Amsterdam',
    state: 'Noord-Holland',
    center: [4.8952, 52.3702],
    bounds: [4.88, 52.35, 4.92, 52.39],
    district: 'Centrum',
    locality: 'Burgwallen-Oude Zijde',
  },
  {
    city: 'Waalre',
    state: 'Noord-Brabant',
    center: [5.444, 51.386],
    bounds: [5.43, 51.37, 5.47, 51.4],
  },
  {
    city: 'Nuenen',
    state: 'Noord-Brabant',
    center: [5.56, 51.49],
    bounds: [5.55, 51.48, 5.57, 51.5],
  },
  {
    city: 'Eindhoven',
    state: 'Noord-Brabant',
    center: [5.4697, 51.4416],
    bounds: [5.42, 51.41, 5.54, 51.51],
  },
  {
    city: 'Utrecht',
    state: 'Utrecht',
    center: [5.1214, 52.0907],
    bounds: [5.11, 52.08, 5.14, 52.11],
  },
  {
    city: 'Rotterdam',
    state: 'Zuid-Holland',
    center: [4.4777, 51.9244],
    bounds: [4.46, 51.91, 4.5, 51.94],
  },
  {
    city: 'Den Haag',
    state: 'Zuid-Holland',
    center: [4.3007, 52.0705],
    bounds: [4.29, 52.06, 4.32, 52.09],
  },
  {
    city: 'Oisterwijk',
    state: 'Noord-Brabant',
    center: [5.19, 51.58],
    bounds: [5.18, 51.57, 5.2, 51.59],
  },
];

function coordinate(params, key) {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '' || !Number.isFinite(Number(raw))) {
    throw new Error(`Expected numeric ${key}`);
  }
  return Number(raw);
}

function locationAt(params) {
  const lon = coordinate(params, 'lon');
  const lat = coordinate(params, 'lat');
  const location = locations.find(
    ({ bounds: [west, south, east, north] }) =>
      lon >= west && lon <= east && lat >= south && lat <= north
  );
  if (!location) throw new Error('Coordinate is outside the explicit Photon fixture scenarios');
  return location;
}

function feature(location) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: location.center },
    properties: {
      // Stable synthetic IDs keep real API suggestion identity behavior intact.
      osm_type: 'N',
      osm_id: 900000000001 + locations.indexOf(location),
      name: location.city,
      type: 'city',
      osm_key: 'place',
      osm_value: 'city',
      country: 'Nederland',
      countrycode: 'NL',
      state: location.state,
      city: location.city,
      ...(location.district ? { district: location.district } : {}),
      ...(location.locality ? { locality: location.locality } : {}),
      // Photon extent uses west/north/east/south order.
      extent: [location.bounds[0], location.bounds[3], location.bounds[2], location.bounds[1]],
    },
  };
}

export function photonFixtureResponse(method, requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  if (method !== 'GET') return { status: 405, body: { error: 'Fixture supports GET only' } };
  if (!['/reverse', '/reverse/', '/api', '/api/'].includes(url.pathname)) {
    return { status: 404, body: { error: 'Unknown Photon fixture route' } };
  }
  try {
    const reverse = url.pathname.startsWith('/reverse');
    const allowed = new Set(
      reverse ? ['lon', 'lat', 'lang'] : ['q', 'limit', 'lang', 'countrycode', 'lon', 'lat']
    );
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
        throw new Error(`Unexpected or repeated Photon fixture parameter: ${key}`);
      }
    }
    const lang = url.searchParams.get('lang');
    if (lang !== null && !['nl', 'en'].includes(lang))
      throw new Error('Unsupported fixture language');
    let location;
    if (reverse) {
      location = locationAt(url.searchParams);
    } else {
      const country = url.searchParams.get('countrycode');
      if (country !== null && country.toUpperCase() !== 'NL')
        throw new Error('Unsupported fixture country');
      const limit = url.searchParams.get('limit');
      if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) {
        throw new Error('Invalid fixture limit');
      }
      if (url.searchParams.has('lon') || url.searchParams.has('lat')) locationAt(url.searchParams);
      const query = url.searchParams.get('q')?.trim().toLowerCase();
      location = locations.find((entry) => entry.city.toLowerCase() === query);
      if (!location) throw new Error('Unknown Photon fixture search input');
    }
    return { status: 200, body: { type: 'FeatureCollection', features: [feature(location)] } };
  } catch (error) {
    return { status: 422, body: { error: error.message } };
  }
}

export async function startPlaywrightPhotonFixture(env) {
  if (env.PLAYWRIGHT_PHOTON_FIXTURE !== '1') return null;
  if (!['development', 'test'].includes(env.NODE_ENV ?? 'development')) {
    throw new Error('Playwright Photon fixture requires development or test NODE_ENV');
  }
  const server = createServer((request, response) => {
    const result = photonFixtureResponse(request.method, request.url);
    response.writeHead(result.status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  let closing;
  return {
    url,
    close() {
      closing ??= new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
