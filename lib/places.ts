import { distanceMeters, type Point } from "./geo.ts";
import { SAO_PAULO_CENTER } from "./map.ts";
import type { MapStop } from "./stops-file.ts";

export const PHOTON_URL = "https://photon.komoot.io/api/";
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const NEARBY_RADIUS_M = 1000;
export const MIN_PLACE_QUERY = 3;

const MAX_PLACE_QUERY = 100;
const PLACE_LIMIT = 8;
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 600_000;
const NOMINATIM_SPACING_MS = 1100;
const MAX_CACHE_ENTRIES = 500;
export const WALK_DETOUR = 1.3;
export const WALK_M_PER_MIN = 80;
const USER_AGENT = "andalogo (https://github.com/enzocardeal/andalogo)";
const BOUNDS = { west: -47.2, south: -24.1, east: -45.7, north: -23.1 };
const TRANSIT_VALUES = new Set(["bus_stop", "platform", "station", "stop_position", "halt", "subway_entrance", "tram_stop"]);

export type Place = { id: string; name: string; detail: string; lat: number; lon: number };

export type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
  };
};

export type NominatimResult = {
  osm_type?: string;
  osm_id?: number;
  category?: string;
  type?: string;
  name?: string;
  lat: string;
  lon: string;
  address?: { road?: string; house_number?: string; suburb?: string; city_district?: string; city?: string };
};

export type PlaceQuery = { q: string; lat: number; lon: number };

export type NearbyStop = MapStop & { distanceM: number };

export function toPlaces(features: PhotonFeature[]): Place[] {
  const places: Place[] = [];
  const seen = new Set<string>();
  features.forEach(({ geometry, properties: p }, index) => {
    if (isTransit(p.osm_key, p.osm_value)) {
      return;
    }
    const address = p.street ? `${p.street}${p.housenumber ? `, ${p.housenumber}` : ""}` : null;
    const name = p.name ?? address;
    if (!name) {
      return;
    }
    const detail = [p.name ? address : null, p.district ?? p.city].filter(Boolean).join(" · ");
    const key = `${name}|${detail}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const [lon, lat] = geometry.coordinates;
    places.push({ id: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : `place-${index}`, name, detail, lat, lon });
  });
  return places;
}

function isTransit(key: string | undefined, value: string | undefined): boolean {
  return key === "public_transport" || TRANSIT_VALUES.has(value ?? "");
}

export function nominatimToPlaces(results: NominatimResult[]): Place[] {
  return toPlaces(
    results.map((result) => ({
      geometry: { coordinates: [Number(result.lon), Number(result.lat)] },
      properties: {
        osm_type: result.osm_type?.charAt(0).toUpperCase(),
        osm_id: result.osm_id,
        osm_key: result.category,
        osm_value: result.type,
        name: result.name || undefined,
        street: result.address?.road,
        housenumber: result.address?.house_number,
        district: result.address?.suburb ?? result.address?.city_district,
        city: result.address?.city,
      },
    })),
  );
}

export function mergePlaces(first: Place[], second: Place[]): Place[] {
  const ids = new Set(first.map((place) => place.id));
  const names = new Set(first.map((place) => `${place.name}|${place.detail}`));
  return [...first, ...second.filter((place) => !ids.has(place.id) && !names.has(`${place.name}|${place.detail}`))];
}

export function nearbyStops(stops: Iterable<MapStop>, point: Point): NearbyStop[] {
  const within: NearbyStop[] = [];
  for (const stop of stops) {
    const distanceM = distanceMeters(point, stop);
    if (distanceM <= NEARBY_RADIUS_M) {
      within.push({ ...stop, distanceM });
    }
  }
  within.sort((a, b) => a.distanceM - b.distanceM);
  const buses = within.filter((stop) => stop.mode === "bus" || stop.mode === "emtu").slice(0, 2);
  const rail = within.find((stop) => stop.mode === "metro" || stop.mode === "cptm");
  return [...buses, ...(rail ? [rail] : [])].sort((a, b) => a.distanceM - b.distanceM);
}

export function walkMinutes(meters: number): number {
  return Math.max(1, Math.ceil((meters * WALK_DETOUR) / WALK_M_PER_MIN));
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

function inBounds(lat: number, lon: number): boolean {
  return lat >= BOUNDS.south && lat <= BOUNDS.north && lon >= BOUNDS.west && lon <= BOUNDS.east;
}

export function parsePlaceQuery(params: URLSearchParams): PlaceQuery | null {
  const q = (params.get("q") ?? "").trim();
  if (q.length < MIN_PLACE_QUERY || q.length > MAX_PLACE_QUERY) {
    return null;
  }
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const [centerLon, centerLat] = SAO_PAULO_CENTER;
  return params.has("lat") && params.has("lon") && inBounds(lat, lon) ? { q, lat, lon } : { q, lat: centerLat, lon: centerLon };
}

export function photonUrl({ q, lat, lon }: PlaceQuery, baseUrl = PHOTON_URL): string {
  const params = new URLSearchParams({
    q,
    limit: String(PLACE_LIMIT),
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    bbox: [BOUNDS.west, BOUNDS.south, BOUNDS.east, BOUNDS.north].join(","),
  });
  return `${baseUrl}?${params}`;
}

export function nominatimUrl({ q }: PlaceQuery, baseUrl = NOMINATIM_URL): string {
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: String(PLACE_LIMIT),
    countrycodes: "br",
    viewbox: [BOUNDS.west, BOUNDS.north, BOUNDS.east, BOUNDS.south].join(","),
    bounded: "1",
    addressdetails: "1",
    "accept-language": "pt-BR",
  });
  return `${baseUrl}?${params}`;
}

export type PlaceSearchOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  photonBase?: string;
  nominatimBase?: string;
};

export function createPlaceSearch({
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  photonBase = PHOTON_URL,
  nominatimBase = NOMINATIM_URL,
}: PlaceSearchOptions = {}) {
  const cache = new Map<string, { expires: number; places: Promise<Place[]> }>();
  let nextNominatim = 0;

  function cached(key: string, load: () => Promise<Place[]>): Promise<Place[]> {
    const time = now();
    const hit = cache.get(key);
    if (hit && hit.expires > time) {
      return hit.places;
    }
    if (cache.size >= MAX_CACHE_ENTRIES) {
      cache.clear();
    }
    const places = load();
    cache.set(key, { expires: time + CACHE_TTL_MS, places });
    places.catch(() => cache.delete(key));
    return places;
  }

  async function getJson<T>(url: string, source: string): Promise<T> {
    const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`${source} returned ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async function nominatim(query: PlaceQuery): Promise<Place[]> {
    const wait = Math.max(0, nextNominatim - now());
    nextNominatim = Math.max(now(), nextNominatim) + NOMINATIM_SPACING_MS;
    if (wait > 0) {
      await sleep(wait);
    }
    return nominatimToPlaces(await getJson<NominatimResult[]>(nominatimUrl(query, nominatimBase), "nominatim"));
  }

  function keyOf(query: PlaceQuery): string {
    return `${query.q.toLowerCase()}|${query.lat.toFixed(2)}|${query.lon.toFixed(2)}`;
  }

  function suggest(query: PlaceQuery): Promise<Place[]> {
    return cached(`suggest|${keyOf(query)}`, async () =>
      toPlaces((await getJson<{ features?: PhotonFeature[] }>(photonUrl(query, photonBase), "photon")).features ?? []),
    );
  }

  function full(query: PlaceQuery): Promise<Place[]> {
    return cached(`full|${keyOf(query)}`, async () => {
      const [named, typed] = await Promise.allSettled([nominatim(query), suggest(query)]);
      if (named.status === "rejected" && typed.status === "rejected") {
        throw named.reason;
      }
      return mergePlaces(named.status === "fulfilled" ? named.value : [], typed.status === "fulfilled" ? typed.value : []);
    });
  }

  return { suggest, full };
}
