import { distanceMeters, type Point } from "./geo.ts";
import { SAO_PAULO_CENTER } from "./map.ts";
import type { MapStop } from "./stops-file.ts";

export const PHOTON_URL = "https://photon.komoot.io/api/";
export const NEARBY_RADIUS_M = 1000;
export const MIN_PLACE_QUERY = 3;

const MAX_PLACE_QUERY = 100;
const PLACE_LIMIT = 8;
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 600_000;
const MAX_CACHE_ENTRIES = 500;
const WALK_DETOUR = 1.3;
const WALK_M_PER_MIN = 80;
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

export type PlaceQuery = { q: string; lat: number; lon: number };

export type NearbyStop = MapStop & { distanceM: number };

export function toPlaces(features: PhotonFeature[]): Place[] {
  const places: Place[] = [];
  const seen = new Set<string>();
  features.forEach(({ geometry, properties: p }, index) => {
    if (p.osm_key === "public_transport" || TRANSIT_VALUES.has(p.osm_value ?? "")) {
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

export function createPlaceSearch(fetchImpl: typeof fetch = fetch, now = () => Date.now(), baseUrl = PHOTON_URL) {
  const cache = new Map<string, { expires: number; places: Promise<Place[]> }>();
  return function searchPlaces(query: PlaceQuery): Promise<Place[]> {
    const key = `${query.q.toLowerCase()}|${query.lat.toFixed(2)}|${query.lon.toFixed(2)}`;
    const time = now();
    const hit = cache.get(key);
    if (hit && hit.expires > time) {
      return hit.places;
    }
    if (cache.size >= MAX_CACHE_ENTRIES) {
      cache.clear();
    }
    const places = fetchImpl(photonUrl(query, baseUrl), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`photon returned ${response.status}`);
      }
      return toPlaces(((await response.json()) as { features: PhotonFeature[] }).features ?? []);
    });
    cache.set(key, { expires: time + CACHE_TTL_MS, places });
    places.catch(() => cache.delete(key));
    return places;
  };
}
