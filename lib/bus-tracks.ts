import {
  MAX_OFF_ROUTE_M,
  MAX_POSITION_AGE_S,
  measure,
  passOnSide,
  project,
  segmentPaces,
  type PositionIndex,
  type StopPattern,
} from "./eta.ts";
import { decodePolyline } from "./polyline.ts";

export const MAX_LINES = 4;

const LINE_PARAM = /^(sp:[A-Za-z0-9-]{1,16}):([01])$/;

export type LineRef = { routeId: string; directionId: number };

export type LinePattern = Omit<StopPattern, "stop_indexes">;

export type Track = { p: string; alongM: number | null; lat: number; lon: number; ta: string; accessible: boolean };

export type LineTracks = LineRef & {
  polyline: string;
  stopOffsetsM: number[];
  paces: number[];
  fallback: number;
  buses: Track[];
};

export function parseLineParams(values: string[]): LineRef[] | null {
  if (values.length === 0 || values.length > MAX_LINES) {
    return null;
  }
  const lines: LineRef[] = [];
  for (const value of values) {
    const match = LINE_PARAM.exec(value);
    if (!match) {
      return null;
    }
    lines.push({ routeId: match[1], directionId: Number(match[2]) });
  }
  return lines;
}

export function lineTracks(pattern: LinePattern, positions: PositionIndex, now: Date): LineTracks {
  const route = measure(decodePolyline(pattern.polyline));
  const sign = pattern.route_id.replace(/^sp:/, "");
  const sides = pattern.circular ? [1, 2] : [pattern.direction_id + 1];
  const buses: Track[] = [];
  for (const sl of sides) {
    for (const vehicle of positions.get(`${sign}|${sl}`) ?? []) {
      const ageS = (now.getTime() - Date.parse(vehicle.ta)) / 1000;
      if (!(ageS <= MAX_POSITION_AGE_S)) {
        continue;
      }
      const [pass] = passOnSide(project(route, [vehicle.py, vehicle.px], MAX_OFF_ROUTE_M), pattern.circular ? sl : null);
      buses.push({
        p: String(vehicle.p),
        alongM: pass ? Math.round(pass.alongM) : null,
        lat: vehicle.py,
        lon: vehicle.px,
        ta: vehicle.ta,
        accessible: vehicle.a,
      });
    }
  }
  const { paces, fallback } = segmentPaces(pattern);
  return {
    routeId: pattern.route_id,
    directionId: pattern.direction_id,
    polyline: pattern.polyline,
    stopOffsetsM: pattern.stop_offsets_m,
    paces,
    fallback,
    buses,
  };
}
