import { routeKey, type GtfsStop } from "./gtfs/load.ts";
import type { CorridorStop, StopPrediction } from "./olhovivo.ts";

export const MAX_DISTANCE_M = 50;
export const PASS_RATE = 0.95;

const EARTH_RADIUS_M = 6_371_000;

type Point = { lat: number; lon: number };

export type LineCheck = {
  sign: string;
  sl: number;
  routeKnown: boolean;
  servesStop: boolean;
  directionMatches: boolean;
};

export type StopCheck = { stopId: string; found: boolean; distanceM: number | null; lines: LineCheck[] };

export type CorridorCheck = { cp: number; name: string; inGtfs: boolean; distanceM: number | null };

export type Rate = { name: string; passed: number; total: number; failures: string[]; gate: boolean };

export function distanceMeters(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function checkStop(
  stop: GtfsStop,
  served: Set<string>,
  routes: Set<string>,
  prediction: StopPrediction,
): StopCheck {
  const p = prediction.p;
  if (!p) {
    return { stopId: stop.id, found: false, distanceM: null, lines: [] };
  }
  const servedRoutes = new Set([...served].map((key) => key.split("|")[0]));
  return {
    stopId: stop.id,
    found: true,
    distanceM: distanceMeters(stop, { lat: p.py, lon: p.px }),
    lines: p.l.map((line) => ({
      sign: line.c,
      sl: line.sl,
      routeKnown: routes.has(line.c),
      servesStop: servedRoutes.has(line.c),
      directionMatches: served.has(routeKey(line.c, line.sl - 1)),
    })),
  };
}

export function checkCorridorStop(stop: CorridorStop, stops: Map<string, GtfsStop>): CorridorCheck {
  const match = stops.get(String(stop.cp));
  return {
    cp: stop.cp,
    name: stop.np,
    inGtfs: match !== undefined,
    distanceM: match ? distanceMeters(match, { lat: stop.py, lon: stop.px }) : null,
  };
}

function rate<T>(name: string, items: T[], passed: (item: T) => boolean, label: (item: T) => string, gate = true): Rate {
  const failed = items.filter((item) => !passed(item));
  return { name, passed: items.length - failed.length, total: items.length, failures: failed.map(label), gate };
}

export function summarize(stops: StopCheck[], corridor: CorridorCheck[]): Rate[] {
  const found = stops.filter((stop) => stop.found);
  const lines = found.flatMap((stop) => stop.lines.map((line) => ({ stopId: stop.stopId, ...line })));
  const lineLabel = (line: (typeof lines)[number]) => `stop ${line.stopId} line ${line.sign} sl ${line.sl}`;
  const near = (distanceM: number | null) => distanceM !== null && distanceM <= MAX_DISTANCE_M;
  return [
    rate("Olho Vivo has a forecast for the stop now", stops, (stop) => stop.found, (stop) => stop.stopId, false),
    rate("H1 position within 50 m", found, (stop) => near(stop.distanceM), (stop) => `${stop.stopId} (${Math.round(stop.distanceM ?? 0)} m)`),
    rate("H1 corridor cp found in GTFS", corridor, (stop) => stop.inGtfs, (stop) => `${stop.cp} ${stop.name}`),
    rate("H1 corridor cp within 50 m", corridor.filter((stop) => stop.inGtfs), (stop) => near(stop.distanceM), (stop) => `${stop.cp} (${Math.round(stop.distanceM ?? 0)} m)`),
    rate("H2 sign c is a GTFS route_id", lines, (line) => line.routeKnown, lineLabel),
    rate("H2 route serves the stop in GTFS", lines, (line) => line.servesStop, lineLabel),
    rate("H3 direction_id = sl - 1", lines, (line) => line.directionMatches, lineLabel),
  ];
}

export function passes(result: Rate): boolean {
  return result.total > 0 && result.passed / result.total >= PASS_RATE;
}

export function sample<T>(items: T[], count: number, seed: number): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...items];
  const picked = Math.min(count, copy.length);
  for (let i = 0; i < picked; i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, picked);
}
