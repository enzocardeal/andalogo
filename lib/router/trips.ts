import type { Mode } from "../transit.ts";
import type { Network } from "./network.ts";
import type { Journey, Leg } from "./raptor.ts";

export type TripLine = { id: string; short_name: string; color: string | null; text_color: string | null; mode: Mode };

export type TripPlace = { id: string | null; name: string; lat: number; lon: number };

export type TripWalk = { kind: "walk"; from: TripPlace; to: TripPlace; depart: number; arrive: number };

export type TripRide = {
  kind: "ride";
  line: TripLine;
  headsign: string;
  direction: number;
  alternatives: TripLine[];
  from: TripPlace;
  to: TripPlace;
  ready: number;
  depart: number;
  arrive: number;
  path: [number, number][];
  pattern: number;
  boardPosition: number;
  alightPosition: number;
};

export type TripLeg = TripWalk | TripRide;

export type Trip = { legs: TripLeg[]; depart: number; arrive: number; rides: number; walkSeconds: number };

export type Endpoints = { from: TripPlace; to: TripPlace };

export type BoardingChoice = { stop: TripPlace; trip: Trip; current: boolean };

function lineOf(network: Network, route: number): TripLine {
  const info = network.routes[route];
  return { id: info.id, short_name: info.shortName, color: info.color, text_color: info.textColor, mode: info.mode };
}

export function placeOf(network: Network, stop: number): TripPlace {
  return { id: network.stopIds[stop], name: network.names[stop], lat: network.lat[stop], lon: network.lon[stop] };
}

export function toTrip(network: Network, journey: Journey, endpoints: Endpoints, departureMs: number, departureSeconds: number): Trip {
  const at = (seconds: number) => departureMs + (seconds - departureSeconds) * 1000;
  const legs: TripLeg[] = [];
  for (const leg of journey.legs as Leg[]) {
    if (leg.kind === "walk") {
      const from = leg.from === null ? endpoints.from : placeOf(network, leg.from);
      const to = leg.to === null ? endpoints.to : placeOf(network, leg.to);
      const previous = legs.at(-1);
      if (previous?.kind === "walk") {
        legs[legs.length - 1] = { ...previous, to, arrive: at(leg.arrive) };
      } else {
        legs.push({ kind: "walk", from, to, depart: at(leg.depart), arrive: at(leg.arrive) });
      }
      continue;
    }
    const pattern = network.patterns[leg.pattern];
    const stops = Array.from(pattern.stops.subarray(leg.boardPosition, leg.alightPosition + 1));
    legs.push({
      kind: "ride",
      line: lineOf(network, pattern.route),
      headsign: pattern.headsign,
      direction: pattern.direction,
      alternatives: (leg.alternatives ?? []).map((route) => lineOf(network, route)),
      from: placeOf(network, leg.from),
      to: placeOf(network, leg.to),
      ready: at(leg.ready),
      depart: at(leg.depart),
      arrive: at(leg.arrive),
      path: stops.filter((stop) => !Number.isNaN(network.lat[stop])).map((stop) => [network.lon[stop], network.lat[stop]]),
      pattern: leg.pattern,
      boardPosition: leg.boardPosition,
      alightPosition: leg.alightPosition,
    });
  }
  const walkSeconds = legs.reduce((sum, leg) => sum + (leg.kind === "walk" ? (leg.arrive - leg.depart) / 1000 : 0), 0);
  return { legs, depart: departureMs, arrive: at(journey.arrive), rides: journey.rides, walkSeconds: Math.round(walkSeconds) };
}

export function toJourney(network: Network, trip: Trip, departureMs: number, departureSeconds: number): Journey {
  const seconds = (ms: number) => departureSeconds + (ms - departureMs) / 1000;
  const stopOf = (place: TripPlace) => (place.id === null ? null : (network.stopIndex.get(place.id) ?? null));
  const legs = trip.legs.map((leg): Leg => {
    if (leg.kind === "walk") {
      return { kind: "walk", from: stopOf(leg.from), to: stopOf(leg.to), depart: seconds(leg.depart), arrive: seconds(leg.arrive) };
    }
    const { stops } = network.patterns[leg.pattern];
    return {
      kind: "ride",
      pattern: leg.pattern,
      boardPosition: leg.boardPosition,
      alightPosition: leg.alightPosition,
      from: stops[leg.boardPosition],
      to: stops[leg.alightPosition],
      ready: seconds(leg.ready),
      depart: seconds(leg.depart),
      arrive: seconds(leg.arrive),
    };
  });
  return { legs, depart: departureSeconds, arrive: seconds(trip.arrive), rides: trip.rides };
}
