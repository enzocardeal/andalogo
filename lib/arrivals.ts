import type { StopPrediction } from "./olhovivo.ts";

export type ArrivalState = "live" | "not_covered" | "stale" | "upstream_down" | "auth_failed" | "unavailable";

export type LiveVehicle = { minutes: number; accessible: boolean; lat: number; lon: number };

export type LiveLine = { routeId: string; directionId: number; vehicles: LiveVehicle[] };

export type Arrivals = { state: ArrivalState; lines: LiveLine[] };

export const MAX_VEHICLES = 3;

const STALE_MINUTES = 5;
const MINUTES_PER_DAY = 1440;
const SAO_PAULO_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function stopCode(stopId: string | null): string | null {
  return /^sp:(\d{1,12})$/.exec(stopId ?? "")?.[1] ?? null;
}

function minutesOfDay(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function signedDifference(later: number, earlier: number): number {
  let difference = later - earlier;
  if (difference < -MINUTES_PER_DAY / 2) {
    difference += MINUTES_PER_DAY;
  } else if (difference > MINUTES_PER_DAY / 2) {
    difference -= MINUTES_PER_DAY;
  }
  return difference;
}

export function minutesUntil(arrival: string, reference: string): number {
  return Math.max(0, signedDifference(minutesOfDay(arrival), minutesOfDay(reference)));
}

function isFresh(capturedAt: string | undefined, now: Date): boolean {
  const time = capturedAt ? Date.parse(capturedAt) : NaN;
  return Number.isNaN(time) || now.getTime() - time <= STALE_MINUTES * 60_000;
}

export type EstimatedLine = { routeId: string; directionId: number; vehicles: (LiveVehicle & { p: string })[] };

function predictedLines(
  prediction: StopPrediction,
  now: Date,
  circular: ReadonlyMap<string, number>,
): { state: ArrivalState; lines: EstimatedLine[] } {
  if (!prediction.p) {
    return { state: "not_covered", lines: [] };
  }
  const nowMinutes = minutesOfDay(SAO_PAULO_CLOCK.format(now));
  if (Math.abs(signedDifference(minutesOfDay(prediction.hr), nowMinutes)) > STALE_MINUTES) {
    return { state: "stale", lines: [] };
  }
  const lines = prediction.p.l.map((line) => ({
    routeId: `sp:${line.c}`,
    directionId: circular.get(`sp:${line.c}`) ?? line.sl - 1,
    vehicles: line.vs
      .filter((vehicle) => isFresh(vehicle.ta, now))
      .map((vehicle) => ({
        p: String(vehicle.p),
        minutes: minutesUntil(vehicle.t, prediction.hr),
        accessible: vehicle.a,
        lat: vehicle.py,
        lon: vehicle.px,
      })),
  }));
  const located = prediction.p.l.some((line) => line.vs.length > 0);
  const fresh = lines.some((line) => line.vehicles.length > 0);
  return { state: located && !fresh ? "stale" : "live", lines: located && !fresh ? [] : lines };
}

export function combineArrivals(
  prediction: StopPrediction | null,
  estimated: EstimatedLine[] | null,
  now: Date,
  circular: ReadonlyMap<string, number> = new Map(),
): Arrivals {
  const predicted = prediction ? predictedLines(prediction, now, circular) : { state: "not_covered" as const, lines: [] };
  const extra = (estimated ?? []).filter((line) => line.vehicles.length > 0);
  if (predicted.state !== "live" && extra.length === 0) {
    return { state: predicted.state, lines: [] };
  }
  const merged = new Map<string, EstimatedLine>();
  for (const line of [...predicted.lines, ...extra]) {
    const key = `${line.routeId}|${line.directionId}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...line, vehicles: [...line.vehicles] });
      continue;
    }
    const known = new Set(current.vehicles.map((vehicle) => vehicle.p));
    current.vehicles.push(...line.vehicles.filter((vehicle) => !known.has(vehicle.p)));
  }
  return {
    state: "live",
    lines: [...merged.values()].map((line) => ({
      routeId: line.routeId,
      directionId: line.directionId,
      vehicles: line.vehicles
        .toSorted((a, b) => a.minutes - b.minutes)
        .slice(0, MAX_VEHICLES)
        .map(({ minutes, accessible, lat, lon }) => ({ minutes, accessible, lat, lon })),
    })),
  };
}

export function liveLineFor(arrivals: Arrivals | null, routeId: string, directionId: number): LiveLine | null {
  if (arrivals?.state !== "live") {
    return null;
  }
  return (
    arrivals.lines.find((line) => line.routeId === routeId && line.directionId === directionId) ?? {
      routeId,
      directionId,
      vehicles: [],
    }
  );
}

export function sortByArrival<T extends { route_id: string; direction_id: number }>(lines: T[], arrivals: Arrivals | null): T[] {
  const firstArrival = (line: T) => liveLineFor(arrivals, line.route_id, line.direction_id)?.vehicles[0]?.minutes ?? Infinity;
  return lines.toSorted((a, b) => {
    const [first, second] = [firstArrival(a), firstArrival(b)];
    return first === second ? 0 : first - second;
  });
}

export type NextBus = LiveVehicle & { routeId: string; directionId: number };

export function nextBuses(arrivals: Arrivals | null, count: number, only?: { routeId: string; directionId: number }): NextBus[] {
  if (arrivals?.state !== "live") {
    return [];
  }
  return arrivals.lines
    .filter((line) => !only || (line.routeId === only.routeId && line.directionId === only.directionId))
    .flatMap((line) => line.vehicles.map((vehicle) => ({ ...vehicle, routeId: line.routeId, directionId: line.directionId })))
    .filter((bus) => Number.isFinite(bus.lat) && Number.isFinite(bus.lon))
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, count);
}
