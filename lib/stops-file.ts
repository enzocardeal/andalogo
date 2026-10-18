import { MODES, type Mode } from "./transit.ts";

export const STOPS_BUCKET = "gtfs";

export type MapStop = { id: string; name: string; lat: number; lon: number; mode: Mode; color: string | null; bearing?: number | null };

type EncodedStop =
  | [string, string, number, number, number]
  | [string, string, number, number, number, string]
  | [string, string, number, number, number, string, number];

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

export function encodeStops(stops: MapStop[]): string {
  const encoded: EncodedStop[] = stops.map((stop) => {
    const base: [string, string, number, number, number] = [stop.id, stop.name, round5(stop.lat), round5(stop.lon), MODES.indexOf(stop.mode)];
    if (stop.bearing !== null && stop.bearing !== undefined) {
      return [...base, stop.color ?? "", stop.bearing];
    }
    return stop.color ? [...base, stop.color] : base;
  });
  return JSON.stringify({ stops: encoded });
}

export function decodeStops(body: unknown): MapStop[] {
  const stops = (body as { stops?: unknown } | null)?.stops;
  if (!Array.isArray(stops)) {
    throw new Error("the stops file has no stops array");
  }
  return (stops as EncodedStop[]).map(([id, name, lat, lon, mode, color, bearing]) => ({
    id,
    name,
    lat,
    lon,
    mode: MODES[mode],
    color: color || null,
    bearing: bearing ?? null,
  }));
}

export function staleStopsFiles(names: string[], feed: string, current: string): string[] {
  return names.filter((name) => name.startsWith(`${feed}-`) && name.endsWith(".json") && name !== current);
}
