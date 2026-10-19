import { averagePace } from "../eta.ts";
import type { Access, Footpaths } from "./footpaths.ts";
import type { FrequencyPattern, Network, TimetablePattern } from "./network.ts";

export const MIN_TRANSFER_S = 60;
const DAY_S = 86_400;
const DAY_MIN = 1440;

const NONE = 0;
const ORIGIN = 1;
const RIDE = 2;
const WALK = 3;

export type RaptorQuery = {
  origins: Access[];
  destinations: Access[];
  departure: number;
  day: number;
  previousDay: number;
  factor: number;
  maxRides: number;
  excluded?: ReadonlySet<number>;
};

export type WalkLeg = { kind: "walk"; from: number | null; to: number | null; depart: number; arrive: number };

export type RideLeg = {
  kind: "ride";
  pattern: number;
  boardPosition: number;
  alightPosition: number;
  from: number;
  to: number;
  ready: number;
  depart: number;
  arrive: number;
  alternatives?: number[];
};

export type Leg = WalkLeg | RideLeg;

export type Journey = { legs: Leg[]; depart: number; arrive: number; rides: number };

export function headwayAt(pattern: FrequencyPattern, day: number, previousDay: number, seconds: number): number | null {
  const minute = seconds / 60;
  for (const window of pattern.windows) {
    if (window.day === day && minute >= window.startMin && minute < window.endMin) {
      return window.headwayS;
    }
    if (
      window.day === previousDay &&
      window.startMin >= DAY_MIN &&
      minute >= window.startMin - DAY_MIN &&
      minute < window.endMin - DAY_MIN
    ) {
      return window.headwayS;
    }
  }
  return null;
}

function firstAtOrAfter(starts: Int32Array, value: number): number | null {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (starts[middle] < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low < starts.length ? starts[low] : null;
}

export function earliestTrip(pattern: TimetablePattern, day: number, previousDay: number, start: number): number | null {
  const today = firstAtOrAfter(pattern.starts[day], start);
  const late = firstAtOrAfter(pattern.starts[previousDay], start + DAY_S);
  const yesterday = late !== null ? late - DAY_S : null;
  if (today === null) {
    return yesterday;
  }
  return yesterday === null ? today : Math.min(today, yesterday);
}

export function ridePace(network: Network, pattern: FrequencyPattern, factor: number): number {
  const pace = averagePace({ stop_offsets_m: Array.from(pattern.offsetsM), run_time_s: pattern.runTimeS });
  return network.routes[pattern.route].mode === "bus" ? pace * factor : pace;
}

export function raptor(network: Network, footpaths: Footpaths, query: RaptorQuery): Journey[] {
  const count = network.stopIds.length;
  const rounds = query.maxRides + 1;
  const arrival = Array.from({ length: rounds }, () => new Float64Array(count).fill(Infinity));
  const kind = Array.from({ length: rounds }, () => new Int8Array(count));
  const pattern = Array.from({ length: rounds }, () => new Int32Array(count));
  const boardPosition = Array.from({ length: rounds }, () => new Int32Array(count));
  const boardDepart = Array.from({ length: rounds }, () => new Float64Array(count));
  const boardRound = Array.from({ length: rounds }, () => new Int8Array(count));
  const walkFrom = Array.from({ length: rounds }, () => new Int32Array(count));
  const best = new Float64Array(count).fill(Infinity);
  const reach = new Float64Array(count).fill(Infinity);
  const reachRound = new Int8Array(count);
  const egress = new Map(query.destinations.map((access) => [access.stop, access.seconds]));
  const paces = new Map<number, number>();

  let marked: number[] = [];
  for (const { stop, seconds } of query.origins) {
    const time = query.departure + seconds;
    if (time < arrival[0][stop]) {
      arrival[0][stop] = time;
      kind[0][stop] = ORIGIN;
      best[stop] = time;
      reach[stop] = time;
      marked.push(stop);
    }
  }

  let bestTarget = Infinity;
  const journeys: Journey[] = [];

  for (let round = 1; round < rounds && marked.length > 0; round++) {
    const arr = arrival[round];
    const queue = new Map<number, number>();
    for (const stop of marked) {
      for (const { pattern: index, position } of network.stopPatterns[stop]) {
        if (query.excluded?.has(network.patterns[index].route)) {
          continue;
        }
        const current = queue.get(index);
        if (current === undefined || position < current) {
          queue.set(index, position);
        }
      }
    }
    const improved: number[] = [];
    const isImproved = new Uint8Array(count);

    const update = (stop: number, time: number, index: number, position: number, depart: number, fromRound: number) => {
      if (time < Math.min(best[stop], bestTarget)) {
        arr[stop] = time;
        best[stop] = time;
        kind[round][stop] = RIDE;
        pattern[round][stop] = index;
        boardPosition[round][stop] = position;
        boardDepart[round][stop] = depart;
        boardRound[round][stop] = fromRound;
        if (!isImproved[stop]) {
          isImproved[stop] = 1;
          improved.push(stop);
        }
      }
    };

    for (const [index, startPosition] of queue) {
      const current = network.patterns[index];
      let position = -1;
      let depart = Infinity;
      let fromRound = 0;
      if (current.kind === "frequency") {
        let pace = paces.get(index);
        if (pace === undefined) {
          pace = ridePace(network, current, query.factor);
          paces.set(index, pace);
        }
        const { offsetsM, stops } = current;
        for (let i = startPosition; i < stops.length; i++) {
          const stop = stops[i];
          const onBoard = position >= 0 ? depart + (offsetsM[i] - offsetsM[position]) * pace : Infinity;
          if (position >= 0) {
            update(stop, onBoard, index, position, depart, fromRound);
          }
          if (reach[stop] < Infinity && i < stops.length - 1) {
            const ready = reach[stop] + (reachRound[stop] > 0 ? MIN_TRANSFER_S : 0);
            const headway = headwayAt(current, query.day, query.previousDay, ready);
            if (headway !== null && ready + headway / 2 < onBoard) {
              position = i;
              depart = ready + headway / 2;
              fromRound = reachRound[stop];
            }
          }
        }
      } else {
        const { offsetsS, stops } = current;
        let tripStart = Infinity;
        for (let i = startPosition; i < stops.length; i++) {
          const stop = stops[i];
          if (position >= 0) {
            update(stop, tripStart + offsetsS[i], index, position, tripStart + offsetsS[position], fromRound);
          }
          if (reach[stop] < Infinity && i < stops.length - 1) {
            const ready = reach[stop] + (reachRound[stop] > 0 ? MIN_TRANSFER_S : 0);
            const candidate = earliestTrip(current, query.day, query.previousDay, ready - offsetsS[i]);
            if (candidate !== null && candidate < tripStart) {
              tripStart = candidate;
              position = i;
              fromRound = reachRound[stop];
            }
          }
        }
      }
    }

    const next: number[] = [...improved];
    const nextMarked = new Uint8Array(count);
    for (const stop of improved) {
      nextMarked[stop] = 1;
    }
    for (const stop of improved) {
      if (kind[round][stop] !== RIDE) {
        continue;
      }
      for (let edge = footpaths.start[stop]; edge < footpaths.start[stop + 1]; edge++) {
        const target = footpaths.to[edge];
        const time = arr[stop] + footpaths.seconds[edge];
        if (time < Math.min(best[target], bestTarget)) {
          arr[target] = time;
          best[target] = time;
          kind[round][target] = WALK;
          walkFrom[round][target] = stop;
          if (!nextMarked[target]) {
            nextMarked[target] = 1;
            next.push(target);
          }
        }
      }
    }
    for (const stop of next) {
      if (arr[stop] < reach[stop]) {
        reach[stop] = arr[stop];
        reachRound[stop] = round;
      }
    }

    let target = -1;
    let targetTime = Infinity;
    for (const [stop, seconds] of egress) {
      if (arr[stop] + seconds < targetTime) {
        targetTime = arr[stop] + seconds;
        target = stop;
      }
    }
    if (target >= 0 && targetTime < bestTarget) {
      bestTarget = targetTime;
      journeys.push(rebuild(target, round, targetTime));
    }
    marked = next;
  }
  return journeys;

  function rebuild(target: number, round: number, arrive: number): Journey {
    const legs: Leg[] = [{ kind: "walk", from: target, to: null, depart: arrival[round][target], arrive }];
    let stop = target;
    let current = round;
    for (;;) {
      const type = kind[current][stop];
      if (type === ORIGIN || type === NONE) {
        legs.unshift({ kind: "walk", from: null, to: stop, depart: query.departure, arrive: arrival[current][stop] });
        break;
      }
      if (type === WALK) {
        const from = walkFrom[current][stop];
        legs.unshift({ kind: "walk", from, to: stop, depart: arrival[current][from], arrive: arrival[current][stop] });
        stop = from;
        continue;
      }
      const index = pattern[current][stop];
      const position = boardPosition[current][stop];
      const from = network.patterns[index].stops[position];
      const previous = boardRound[current][stop];
      const alightPosition = network.patterns[index].stops.indexOf(stop, position + 1);
      legs.unshift({
        kind: "ride",
        pattern: index,
        boardPosition: position,
        alightPosition,
        from,
        to: stop,
        ready: arrival[previous][from],
        depart: boardDepart[current][stop],
        arrive: arrival[current][stop],
      });
      stop = from;
      current = previous;
    }
    return { legs, depart: query.departure, arrive, rides: legs.filter((leg) => leg.kind === "ride").length };
  }
}
