import type { EstimatedLine } from "./arrivals.ts";
import type { PositionLine, Positions } from "./olhovivo.ts";
import { decodePolyline, type LatLon } from "./polyline.ts";

const METERS_PER_DEGREE = 111_320;
export const MAX_OFF_ROUTE_M = 150;
const STOP_MAX_OFF_ROUTE_M = 200;
const STOP_NEAR_M = 40;
export const TERMINAL_M = 300;
const PRIOR_SAMPLES = 3;
export const MAX_POSITION_AGE_S = 300;
const PASSED_S = 60;
const MAX_ESTIMATE_S = 5400;
const DEFAULT_PACE_S_PER_M = 0.24;
const MIN_PACE_S_PER_M = 0.06;
const MAX_PACE_S_PER_M = 0.72;

export type Route = { xy: [number, number][]; cumulative: number[]; scale: number };

export type Projection = { alongM: number; offM: number };

export type StopPattern = {
  route_id: string;
  direction_id: number;
  polyline: string;
  stop_offsets_m: number[];
  stop_indexes: number[];
  run_time_s: number | null;
  circular: boolean;
  paces?: number[] | null;
  samples?: number[] | null;
  factor?: number | null;
};

export type PositionIndex = Map<string, PositionLine["vs"]>;

export function measure(points: LatLon[]): Route {
  const scale = Math.cos(((points[0]?.[0] ?? 0) * Math.PI) / 180) * METERS_PER_DEGREE;
  const xy = points.map(([lat, lon]): [number, number] => [lon * scale, lat * METERS_PER_DEGREE]);
  const cumulative = [0];
  for (let i = 1; i < xy.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  return { xy, cumulative, scale };
}

// One projection per stretch of the route that passes within maxOffM, so a loop yields one per pass.
export function project(route: Route, [lat, lon]: LatLon, maxOffM: number): Projection[] {
  const x = lon * route.scale;
  const y = lat * METERS_PER_DEGREE;
  const passes: Projection[] = [];
  let best: Projection | null = null;
  for (let i = 0; i < route.xy.length - 1; i++) {
    const [ax, ay] = route.xy[i];
    const [bx, by] = route.xy[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
    const offM = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (offM > maxOffM) {
      if (best) {
        passes.push(best);
        best = null;
      }
      continue;
    }
    if (!best || offM < best.offM) {
      best = { alongM: route.cumulative[i] + t * Math.sqrt(lengthSq), offM };
    }
  }
  if (best) {
    passes.push(best);
  }
  return passes;
}

export function stopOffsets(route: Route, stops: (LatLon | undefined)[]): number[] {
  let previous = 0;
  return stops.map((stop) => {
    const ahead = stop ? project(route, stop, STOP_MAX_OFF_ROUTE_M).filter((pass) => pass.alongM >= previous) : [];
    const pass =
      ahead.find((candidate) => candidate.offM <= STOP_NEAR_M) ??
      ahead.reduce<Projection | null>((nearest, candidate) => (!nearest || candidate.offM < nearest.offM ? candidate : nearest), null);
    previous = Math.max(previous, pass?.alongM ?? previous);
    return Math.round(previous);
  });
}

export function averagePace(pattern: Pick<StopPattern, "stop_offsets_m" | "run_time_s">): number {
  const offsets = pattern.stop_offsets_m;
  const length = offsets.at(-1)! - offsets[0];
  if (!pattern.run_time_s || length <= 0) {
    return DEFAULT_PACE_S_PER_M;
  }
  return clampPace(pattern.run_time_s / length);
}

function clampPace(pace: number): number {
  return Math.max(MIN_PACE_S_PER_M, Math.min(MAX_PACE_S_PER_M, pace));
}

// Each calibrated pace leans toward the line mean, and the line mean toward the GTFS average, until samples add up.
export function segmentPaces(pattern: Omit<StopPattern, "route_id" | "direction_id" | "polyline" | "stop_indexes" | "circular">): {
  paces: number[];
  fallback: number;
} {
  const offsets = pattern.stop_offsets_m;
  const lengths = offsets.slice(1).map((offset, k) => offset - offsets[k]);
  const gtfs = pattern.factor ? clampPace(averagePace(pattern) * pattern.factor) : averagePace(pattern);
  const { paces, samples } = pattern;
  if (!paces || !samples || paces.length !== lengths.length || samples.length !== lengths.length) {
    return { paces: lengths.map(() => gtfs), fallback: gtfs };
  }
  const meters = lengths.reduce((sum, length, k) => sum + samples[k] * length, 0);
  const seconds = lengths.reduce((sum, length, k) => sum + samples[k] * length * (paces[k] / 1000), 0);
  const total = offsets.at(-1)! - offsets[0];
  const weight = total > 0 ? meters / total : 0;
  const line = meters > 0 ? clampPace((weight * (seconds / meters) + PRIOR_SAMPLES * gtfs) / (weight + PRIOR_SAMPLES)) : gtfs;
  return {
    paces: lengths.map((_, k) => clampPace((samples[k] * (paces[k] / 1000) + PRIOR_SAMPLES * line) / (samples[k] + PRIOR_SAMPLES))),
    fallback: line,
  };
}

export function travelSeconds(offsets: number[], paces: number[], fallback: number, fromM: number, toM: number): number {
  let seconds = Math.max(0, Math.min(toM, offsets[0]) - fromM) * fallback;
  for (let k = 0; k < offsets.length - 1; k++) {
    seconds += Math.max(0, Math.min(toM, offsets[k + 1]) - Math.max(fromM, offsets[k])) * paces[k];
  }
  return seconds;
}

export function advanceMeters(offsets: number[], paces: number[], fallback: number, fromM: number, seconds: number): number {
  const segments: [number, number, number][] = [
    [-Infinity, offsets[0], fallback],
    ...offsets.slice(1).map((offset, k): [number, number, number] => [offsets[k], offset, paces[k]]),
  ];
  let atM = fromM;
  let left = seconds;
  for (const [start, end, pace] of segments) {
    if (atM >= end) {
      continue;
    }
    atM = Math.max(atM, start);
    const needed = (end - atM) * pace;
    if (needed >= left) {
      return atM + left / pace;
    }
    left -= needed;
    atM = end;
  }
  return atM;
}

export type RoutePoint = { lat: number; lon: number; bearing: number };

export function pointAt(route: Route, alongM: number): RoutePoint {
  const { xy, cumulative, scale } = route;
  if (xy.length < 2) {
    const [x, y] = xy[0] ?? [0, 0];
    return { lat: y / METERS_PER_DEGREE, lon: x / scale, bearing: 0 };
  }
  const target = Math.max(0, Math.min(cumulative.at(-1)!, alongM));
  let low = 0;
  let high = xy.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (cumulative[middle] <= target) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  let i = low;
  while (i < xy.length - 2 && cumulative[i + 1] === cumulative[i]) {
    i++;
  }
  const length = cumulative[i + 1] - cumulative[i];
  const t = length > 0 ? (target - cumulative[i]) / length : 0;
  const [ax, ay] = xy[i];
  const [bx, by] = xy[i + 1];
  const x = ax + t * (bx - ax);
  const y = ay + t * (by - ay);
  const bearing = ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;
  return { lat: y / METERS_PER_DEGREE, lon: x / scale, bearing };
}

export function indexPositions(positions: Positions): PositionIndex {
  return new Map(positions.l.map((line) => [`${line.c}|${line.sl}`, line.vs]));
}

export type Estimate = { p: string; seconds: number; accessible: boolean; lat: number; lon: number };

// On a circular line, Olho Vivo side 1 runs the first half of the GTFS loop and side 2 the second half.
export function passOnSide(passes: Projection[], side: number | null): Projection[] {
  if (side === null || passes.length < 2) {
    return passes;
  }
  return side === 1 ? passes.slice(0, 1) : passes.slice(-1);
}

export function estimateLine(pattern: StopPattern, vehicles: PositionLine["vs"], now: Date, side: number | null = null): Estimate[] {
  const route = measure(decodePolyline(pattern.polyline));
  const offsets = pattern.stop_offsets_m;
  const { paces, fallback: pace } = segmentPaces(pattern);
  const estimates: Estimate[] = [];
  for (const vehicle of vehicles) {
    const ageS = (now.getTime() - Date.parse(vehicle.ta)) / 1000;
    if (!(ageS <= MAX_POSITION_AGE_S)) {
      continue;
    }
    const passes = passOnSide(project(route, [vehicle.py, vehicle.px], MAX_OFF_ROUTE_M), side);
    let best: number | null = null;
    for (const index of pattern.stop_indexes) {
      const stopM = offsets[index];
      const before = passes.filter((pass) => pass.alongM <= stopM && pass.alongM - offsets[0] >= TERMINAL_M);
      if (before.length === 0) {
        continue;
      }
      const fromM = Math.max(...before.map((pass) => pass.alongM));
      const seconds = travelSeconds(offsets, paces, pace, fromM, stopM) - Math.max(0, ageS);
      if (seconds >= -PASSED_S && seconds <= MAX_ESTIMATE_S && (best === null || seconds < best)) {
        best = seconds;
      }
    }
    if (best !== null) {
      estimates.push({ p: String(vehicle.p), seconds: Math.max(0, best), accessible: vehicle.a, lat: vehicle.py, lon: vehicle.px });
    }
  }
  return estimates.sort((a, b) => a.seconds - b.seconds);
}

export function estimateStop(patterns: StopPattern[], positions: PositionIndex, now: Date): EstimatedLine[] {
  return patterns.map((pattern) => {
    const sign = pattern.route_id.replace(/^sp:/, "");
    const sides = pattern.circular ? [1, 2] : [pattern.direction_id + 1];
    const estimates = sides
      .flatMap((sl) => estimateLine(pattern, positions.get(`${sign}|${sl}`) ?? [], now, pattern.circular ? sl : null))
      .sort((a, b) => a.seconds - b.seconds);
    return {
      routeId: pattern.route_id,
      directionId: pattern.direction_id,
      vehicles: estimates.map(({ p, seconds, accessible, lat, lon }) => ({
        p,
        minutes: Math.round(seconds / 60),
        accessible,
        lat,
        lon,
      })),
    };
  });
}

export function circularDirections(patterns: StopPattern[]): Map<string, number> {
  return new Map(patterns.filter((pattern) => pattern.circular).map((pattern) => [pattern.route_id, pattern.direction_id]));
}
