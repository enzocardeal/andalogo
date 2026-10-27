import { MAX_OFF_ROUTE_M, measure, passOnSide, project, type PositionIndex, type Route, type StopPattern } from "./eta.ts";
import { decodePolyline } from "./polyline.ts";

const BACKWARD_M = 50;
const MAX_STEP_M = 5000;
const MAX_GAP_S = 180;
const NEW_TRIP_S = 600;
export const BUCKETS: [number, number][] = [
  [0, 2],
  [3, 5],
  [6, 10],
  [11, 20],
];

export const ACTUAL_BUCKETS: [number, number][] = [
  [0, 5],
  [5, 10],
  [10, 20],
  [20, 40],
];

export const SOURCES = ["sptrans", "gps", "blend", "blend30", "live", "blendLive", "shown"] as const;
export type Source = (typeof SOURCES)[number];

export type Prediction = {
  capturedAt: number;
  stop: string;
  routeId: string;
  directionId: number;
  p: string;
  minutes: Partial<Record<Source, number>>;
  liveFactor?: number | null;
  arrivedAt?: number;
};

type Target = {
  p: string;
  route: Route;
  stopMs: number[];
  sign: string;
  sides: number[];
  circular: boolean;
  stopM: number | null;
  alongM: number;
  time: number;
  predictions: Prediction[];
  arrivedAt?: number;
};

export function createArrivalWatch() {
  const targets = new Map<string, Target>();
  const routes = new Map<string, Route>();
  const predictions: Prediction[] = [];

  function routeOf(pattern: StopPattern): Route {
    const key = `${pattern.route_id}|${pattern.direction_id}`;
    let route = routes.get(key);
    if (!route) {
      route = measure(decodePolyline(pattern.polyline));
      routes.set(key, route);
    }
    return route;
  }

  function add(prediction: Prediction, pattern: StopPattern | undefined): void {
    predictions.push(prediction);
    if (!pattern) {
      return;
    }
    const key = `${prediction.stop}|${prediction.routeId}|${prediction.directionId}|${prediction.p}`;
    let target = targets.get(key);
    if (target?.arrivedAt !== undefined && prediction.capturedAt - target.arrivedAt > NEW_TRIP_S * 1000) {
      target = undefined;
    }
    if (!target) {
      target = {
        p: prediction.p,
        route: routeOf(pattern),
        stopMs: pattern.stop_indexes.map((index) => pattern.stop_offsets_m[index]),
        sign: pattern.route_id.replace(/^sp:/, ""),
        sides: pattern.circular ? [1, 2] : [pattern.direction_id + 1],
        circular: pattern.circular,
        stopM: null,
        alongM: 0,
        time: 0,
        predictions: [],
      };
      targets.set(key, target);
    }
    if (target.arrivedAt !== undefined) {
      prediction.arrivedAt = target.arrivedAt;
    } else {
      target.predictions.push(prediction);
    }
  }

  function arrive(target: Target, at: number): void {
    target.arrivedAt = at;
    for (const prediction of target.predictions) {
      prediction.arrivedAt = at;
    }
    target.predictions = [];
  }

  function observe(positions: PositionIndex): void {
    for (const target of targets.values()) {
      if (target.arrivedAt !== undefined) {
        continue;
      }
      const found = target.sides
        .map((sl) => ({ sl, vehicle: positions.get(`${target.sign}|${sl}`)?.find((vehicle) => String(vehicle.p) === target.p) }))
        .find(({ vehicle }) => vehicle);
      if (!found?.vehicle) {
        continue;
      }
      const { sl, vehicle } = found;
      const time = Date.parse(vehicle.ta);
      if (Number.isNaN(time) || time <= target.time) {
        continue;
      }
      const passes = passOnSide(project(target.route, [vehicle.py, vehicle.px], MAX_OFF_ROUTE_M), target.circular ? sl : null);
      if (target.stopM === null) {
        const start = passes
          .flatMap((pass) => target.stopMs.filter((stopM) => stopM >= pass.alongM).map((stopM) => ({ pass, stopM })))
          .sort((a, b) => a.stopM - a.pass.alongM - (b.stopM - b.pass.alongM))[0];
        if (start) {
          Object.assign(target, { stopM: start.stopM, alongM: start.pass.alongM, time });
        }
        continue;
      }
      const ahead = passes.find((pass) => pass.alongM >= target.alongM - BACKWARD_M && pass.alongM - target.alongM <= MAX_STEP_M);
      if (!ahead) {
        if (passes.length > 0 && passes.every((pass) => pass.alongM < target.alongM - BACKWARD_M)) {
          target.stopM = null;
        }
        continue;
      }
      const gapS = (time - target.time) / 1000;
      if (ahead.alongM >= target.stopM) {
        if (gapS <= MAX_GAP_S) {
          const share = ahead.alongM > target.alongM ? (target.stopM - target.alongM) / (ahead.alongM - target.alongM) : 0;
          arrive(target, target.time + Math.max(0, share) * (time - target.time));
        } else {
          target.stopM = null;
        }
        continue;
      }
      target.alongM = Math.max(target.alongM, ahead.alongM);
      target.time = time;
    }
  }

  return { add, observe, predictions: () => predictions, waiting: () => [...targets.values()].filter((t) => t.arrivedAt === undefined).length };
}

export type Score = { n: number; meanAbs: number; bias: number; within1: number; within2: number; p90: number };

// The error is actual minus shown minutes, so a positive bias means the bus came later than the screen said.
export function score(errors: number[]): Score | null {
  if (errors.length === 0) {
    return null;
  }
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    n: errors.length,
    meanAbs: mean(abs),
    bias: mean(errors),
    within1: abs.filter((value) => value <= 1).length / abs.length,
    within2: abs.filter((value) => value <= 2).length / abs.length,
    p90: abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))],
  };
}

function actualMinutes(prediction: Prediction): number {
  return (prediction.arrivedAt! - prediction.capturedAt) / 60_000;
}

export function errorsOf(
  predictions: Prediction[],
  source: Source,
  [low, high]: [number, number],
  paired: boolean,
  by: "shown" | "actual" = "shown",
): number[] {
  return predictions
    .filter((prediction) => prediction.arrivedAt !== undefined && prediction.minutes[source] !== undefined)
    .filter((prediction) => !paired || (prediction.minutes.sptrans !== undefined && prediction.minutes.gps !== undefined))
    .filter((prediction) => {
      if (by === "actual") {
        const actual = actualMinutes(prediction);
        return actual >= low && actual < high;
      }
      const minutes = prediction.minutes[source]!;
      return minutes >= low && minutes <= high;
    })
    .map((prediction) => actualMinutes(prediction) - prediction.minutes[source]!);
}
