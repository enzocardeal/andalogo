import type { Point } from "../geo.ts";
import { stopsNear, type Footpaths } from "./footpaths.ts";
import type { Network } from "./network.ts";
import { withAlternatives } from "./plan.ts";
import { MIN_TRANSFER_S, reachFrom, rideTimes, type Journey, type Leg, type RideLeg, type ServiceTime } from "./raptor.ts";

export const MAX_EXTRA_S = 20 * 60;

export type BoardingQuery = ServiceTime & { from: Point; departure: number };

export type BoardingOption = { stop: number; journey: Journey; current: boolean };

export function replay(network: Network, legs: Leg[], start: number, time: ServiceTime): Leg[] | null {
  const replayed: Leg[] = [];
  let clock = start;
  for (const leg of legs) {
    if (leg.kind === "walk") {
      replayed.push({ ...leg, depart: clock, arrive: clock + leg.arrive - leg.depart });
      clock += leg.arrive - leg.depart;
      continue;
    }
    const times = rideTimes(network, leg.pattern, leg.boardPosition, leg.alightPosition, clock + MIN_TRANSFER_S, time);
    if (!times) {
      return null;
    }
    replayed.push({ ...leg, ready: clock, ...times });
    clock = times.arrive;
  }
  return replayed;
}

export function boardingOptions(
  network: Network,
  footpaths: Footpaths,
  journey: Journey,
  legIndex: number,
  query: BoardingQuery,
): BoardingOption[] {
  const leg = journey.legs[legIndex];
  if (leg?.kind !== "ride") {
    return [];
  }
  const pattern = network.patterns[leg.pattern];
  const reach = reachFrom(network, footpaths, {
    origins: stopsNear(network, query.from),
    departure: query.departure,
    day: query.day,
    previousDay: query.previousDay,
    factor: query.factor,
    maxRides: journey.legs.slice(0, legIndex).filter((before) => before.kind === "ride").length,
    excluded: new Set([pattern.route]),
  });
  const suffix = journey.legs.slice(legIndex + 1);
  const options: BoardingOption[] = [];
  for (let position = 0; position < leg.alightPosition; position++) {
    const stop = pattern.stops[position];
    if (position === leg.boardPosition) {
      options.push({ stop, journey, current: true });
      continue;
    }
    const ready = reach.arrive(stop);
    if (ready === Infinity) {
      continue;
    }
    const prefix = reach.legsTo(stop);
    const transfer = prefix.some((before) => before.kind === "ride") ? MIN_TRANSFER_S : 0;
    const times = rideTimes(network, leg.pattern, position, leg.alightPosition, ready + transfer, query);
    const rest = times && replay(network, suffix, times.arrive, query);
    if (!times || !rest) {
      continue;
    }
    const ride: RideLeg = { ...leg, boardPosition: position, from: stop, ready, ...times };
    const legs = [...prefix, ride, ...rest];
    const arrive = legs.at(-1)!.arrive;
    if (arrive <= journey.arrive + MAX_EXTRA_S) {
      const rides = legs.filter((each) => each.kind === "ride").length;
      options.push({ stop, current: false, journey: withAlternatives(network, { legs, depart: query.departure, arrive, rides }) });
    }
  }
  return options;
}
