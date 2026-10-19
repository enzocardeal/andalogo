import { distanceMeters, type Point } from "../geo.ts";
import { stopsNear, walkSeconds, type Footpaths } from "./footpaths.ts";
import type { Network } from "./network.ts";
import { raptor, type Journey, type RideLeg } from "./raptor.ts";

export const MAX_RIDES = 5;
export const MAX_JOURNEYS = 8;
const MAX_SEARCHES = 8;
const MAX_WALK_ONLY_M = 2000;
const WEEKDAYS: Record<string, number> = { Sat: 1, Sun: 2 };
const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export type ServiceClock = { day: number; previousDay: number; seconds: number };

export function serviceClock(time: Date): ServiceClock {
  const parts = Object.fromEntries(CLOCK.formatToParts(time).map((part) => [part.type, part.value]));
  const day = WEEKDAYS[parts.weekday] ?? 0;
  const previousDay = parts.weekday === "Mon" ? 2 : parts.weekday === "Sun" ? 1 : 0;
  return { day, previousDay, seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second) };
}

export type PlanQuery = { from: Point; to: Point; departure: Date; factor: number };

export function routesBetween(network: Network, from: number, to: number): number[] {
  const routes = new Set<number>();
  for (const { pattern, position } of network.stopPatterns[from]) {
    if (network.patterns[pattern].stops.indexOf(to, position + 1) >= 0) {
      routes.add(network.patterns[pattern].route);
    }
  }
  return [...routes];
}

export function journeyKey(journey: Journey): string {
  return journey.legs.flatMap((leg) => (leg.kind === "ride" ? [`${leg.from}>${leg.to}`] : [])).join("|");
}

export function withAlternatives(network: Network, journey: Journey): Journey {
  return {
    ...journey,
    legs: journey.legs.map((leg) =>
      leg.kind === "ride"
        ? {
            ...leg,
            alternatives: routesBetween(network, leg.from, leg.to).filter((route) => route !== network.patterns[leg.pattern].route),
          }
        : leg,
    ),
  };
}

export function plan(network: Network, footpaths: Footpaths, query: PlanQuery): Journey[] {
  const clock = serviceClock(query.departure);
  const search = (excluded?: ReadonlySet<number>) =>
    raptor(network, footpaths, {
      origins: stopsNear(network, query.from),
      destinations: stopsNear(network, query.to),
      departure: clock.seconds,
      day: clock.day,
      previousDay: clock.previousDay,
      factor: query.factor,
      maxRides: MAX_RIDES,
      excluded,
    });
  const byStops = new Map<string, Journey>();
  const keep = (found: Journey[]) => {
    for (const journey of found) {
      const key = journeyKey(journey);
      const current = byStops.get(key);
      if (!current || journey.arrive < current.arrive) {
        byStops.set(key, journey);
      }
    }
  };
  const excluded = new Set<number>();
  for (let round = 0; round < MAX_SEARCHES; round++) {
    const found = search(excluded);
    keep(found);
    const fastest = found.toSorted((a, b) => a.arrive - b.arrive)[0];
    const last = fastest?.legs.findLast((leg): leg is RideLeg => leg.kind === "ride");
    if (!last) {
      break;
    }
    for (const route of routesBetween(network, last.from, last.to)) {
      excluded.add(route);
    }
  }
  const journeys = [...byStops.values()].map((journey) => withAlternatives(network, journey));
  const meters = distanceMeters(query.from, query.to);
  if (meters <= MAX_WALK_ONLY_M) {
    const arrive = clock.seconds + walkSeconds(meters);
    journeys.push({
      legs: [{ kind: "walk", from: null, to: null, depart: clock.seconds, arrive }],
      depart: clock.seconds,
      arrive,
      rides: 0,
    });
  }
  return journeys.toSorted((a, b) => a.arrive - b.arrive || a.rides - b.rides).slice(0, MAX_JOURNEYS);
}
