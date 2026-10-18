import { MAX_OFF_ROUTE_M, measure, project, TERMINAL_M, type Route } from "./eta.ts";
import type { DayType } from "./gtfs/build.ts";
import type { Positions } from "./olhovivo.ts";
import { decodePolyline } from "./polyline.ts";

const MAX_STEP_M = 2000;
const MAX_SPEED_M_PER_S = 80 / 3.6;
const MAX_GAP_S = 300;
const MAX_STOPPED_S = 180;
const STOPPED_M = 50;
const BACKWARD_M = 50;
export const MAX_SAMPLES = 50;

const BUCKET_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

export type CalibrationPattern = {
  route_id: string;
  direction_id: number;
  polyline: string;
  stop_offsets_m: number[];
  stops_key: string;
  circular: boolean;
};

export type Bucket = { dayType: DayType; hour: number };

export type Totals = Bucket & { pattern: CalibrationPattern; seconds: number[]; meters: number[] };

export type PaceRow = {
  route_id: string;
  direction_id: number;
  day_type: DayType;
  hour: number;
  stops_key: string;
  pace_s_per_km: number[];
  samples: number[];
};

type Measured = { pattern: CalibrationPattern; route: Route };

type Track = { key: string; alongM: number; time: number };

export function bucketOf(time: Date): Bucket {
  const parts = Object.fromEntries(BUCKET_CLOCK.formatToParts(time).map((part) => [part.type, part.value]));
  const dayType = parts.weekday === "Sat" ? "saturday" : parts.weekday === "Sun" ? "sunday" : "weekday";
  return { dayType, hour: Number(parts.hour) };
}

export function spread(offsets: number[], fromM: number, toM: number, seconds: number, totals: Pick<Totals, "seconds" | "meters">): void {
  if (toM - fromM < 1) {
    const k = offsets.findLastIndex((offset) => offset <= fromM);
    if (k >= 0 && k < offsets.length - 1) {
      totals.seconds[k] += seconds;
    }
    return;
  }
  for (let k = 0; k < offsets.length - 1; k++) {
    const overlap = Math.min(toM, offsets[k + 1]) - Math.max(fromM, offsets[k]);
    if (overlap > 0) {
      totals.seconds[k] += (seconds * overlap) / (toM - fromM);
      totals.meters[k] += overlap;
    }
  }
}

export function createCalibration(patterns: CalibrationPattern[]) {
  const byLine = new Map<string, Measured>();
  for (const pattern of patterns) {
    const measured = { pattern, route: measure(decodePolyline(pattern.polyline)) };
    const sign = pattern.route_id.replace(/^sp:/, "");
    for (const sl of pattern.circular ? [1, 2] : [pattern.direction_id + 1]) {
      byLine.set(`${sign}|${sl}`, measured);
    }
  }
  const tracks = new Map<string, Track>();
  let totals = new Map<string, Totals>();

  function record(pattern: CalibrationPattern, time: number, fromM: number, toM: number, seconds: number): void {
    const bucket = bucketOf(new Date(time));
    const key = `${pattern.route_id}|${pattern.direction_id}|${bucket.dayType}|${bucket.hour}`;
    let entry = totals.get(key);
    if (!entry) {
      const segments = pattern.stop_offsets_m.length - 1;
      entry = { ...bucket, pattern, seconds: Array(segments).fill(0), meters: Array(segments).fill(0) };
      totals.set(key, entry);
    }
    spread(pattern.stop_offsets_m, fromM, toM, seconds, entry);
  }

  function observe(positions: Positions): number {
    let used = 0;
    for (const line of positions.l) {
      const measured = byLine.get(`${line.c}|${line.sl}`);
      if (!measured) {
        continue;
      }
      const { pattern, route } = measured;
      const key = `${pattern.route_id}|${pattern.direction_id}`;
      const offsets = pattern.stop_offsets_m;
      for (const vehicle of line.vs) {
        const time = Date.parse(vehicle.ta);
        const id = String(vehicle.p);
        const previous = tracks.get(id);
        const known = previous?.key === key ? previous : null;
        if (Number.isNaN(time) || (known && known.time >= time)) {
          continue;
        }
        const passes = project(route, [vehicle.py, vehicle.px], MAX_OFF_ROUTE_M);
        const ahead = known
          ? passes.filter((pass) => pass.alongM >= known.alongM - BACKWARD_M && pass.alongM - known.alongM <= MAX_STEP_M)
          : [];
        if (!known || ahead.length === 0) {
          if (passes.length > 0) {
            tracks.set(id, { key, alongM: passes[0].alongM, time });
          } else {
            tracks.delete(id);
          }
          continue;
        }
        const toM = Math.max(known.alongM, ahead[0].alongM);
        const seconds = (time - known.time) / 1000;
        const meters = toM - known.alongM;
        const stopped = meters < STOPPED_M && (seconds > MAX_STOPPED_S || known.alongM >= offsets.at(-1)! - TERMINAL_M);
        if (seconds <= MAX_GAP_S && meters / seconds <= MAX_SPEED_M_PER_S && !stopped && known.alongM - offsets[0] >= TERMINAL_M) {
          record(pattern, time, known.alongM, toM, seconds);
          used++;
        }
        tracks.set(id, { key, alongM: toM, time });
      }
    }
    return used;
  }

  function drain(): Totals[] {
    const drained = [...totals.values()];
    totals = new Map();
    return drained;
  }

  return { observe, drain, tracked: () => tracks.size };
}

export function mergeRow(existing: PaceRow | undefined, totals: Totals): PaceRow {
  const offsets = totals.pattern.stop_offsets_m;
  const lengths = offsets.slice(1).map((offset, k) => offset - offsets[k]);
  const same = existing?.stops_key === totals.pattern.stops_key && existing.samples.length === lengths.length;
  const pace_s_per_km: number[] = [];
  const samples: number[] = [];
  lengths.forEach((length, k) => {
    const oldMeters = same ? existing.samples[k] * length : 0;
    const meters = oldMeters + totals.meters[k];
    const seconds = (same ? (existing.pace_s_per_km[k] / 1000) * oldMeters : 0) + totals.seconds[k];
    const traversals = length > 0 ? meters / length : 0;
    pace_s_per_km.push(meters > 0 ? Math.min(32_767, Math.round((seconds / meters) * 1000)) : 0);
    samples.push(meters > 0 ? Math.round(Math.min(MAX_SAMPLES, traversals) * 100) / 100 : 0);
  });
  return {
    route_id: totals.pattern.route_id,
    direction_id: totals.pattern.direction_id,
    day_type: totals.dayType,
    hour: totals.hour,
    stops_key: totals.pattern.stops_key,
    pace_s_per_km,
    samples,
  };
}
