import type { LineTracks, Track } from "./bus-tracks.ts";
import { advanceMeters, measure, pointAt, TERMINAL_M, type Route, type RoutePoint } from "./eta.ts";
import { decodePolyline } from "./polyline.ts";

const MAX_EXTRAPOLATION_S = 90;
const GLIDE_S = 1;
const JUMP_AHEAD_M = 1000;
const JUMP_BEHIND_M = 500;

export type LineMotion = { route: Route; offsets: number[]; paces: number[]; fallback: number };

export type PlacedTrack = Track & { alongM: number };

export type MovingBus = { key: string; line: LineMotion; track: PlacedTrack };

export function lineMotion(line: LineTracks): LineMotion {
  return { route: measure(decodePolyline(line.polyline)), offsets: line.stopOffsetsM, paces: line.paces, fallback: line.fallback };
}

export function targetAlong(line: LineMotion, track: PlacedTrack, nowMs: number): number {
  const { offsets } = line;
  if (track.alongM - offsets[0] < TERMINAL_M || track.alongM >= offsets.at(-1)!) {
    return track.alongM;
  }
  const seconds = Math.max(0, Math.min(MAX_EXTRAPOLATION_S, (nowMs - Date.parse(track.ta)) / 1000));
  return advanceMeters(offsets, line.paces, line.fallback, track.alongM, seconds);
}

export function glide(drawnM: number | null, targetM: number, dtS: number): number {
  if (drawnM === null || targetM - drawnM > JUMP_AHEAD_M || drawnM - targetM > JUMP_BEHIND_M) {
    return targetM;
  }
  if (targetM <= drawnM) {
    return drawnM;
  }
  return drawnM + (targetM - drawnM) * (1 - Math.exp(-dtS / GLIDE_S));
}

export function createMotion() {
  const drawn = new Map<string, number>();
  return function frame(buses: MovingBus[], nowMs: number, dtS: number): Map<string, RoutePoint> {
    const points = new Map<string, RoutePoint>();
    for (const bus of buses) {
      const alongM = glide(drawn.get(bus.key) ?? null, targetAlong(bus.line, bus.track, nowMs), dtS);
      drawn.set(bus.key, alongM);
      points.set(bus.key, pointAt(bus.line.route, alongM));
    }
    for (const key of drawn.keys()) {
      if (!points.has(key)) {
        drawn.delete(key);
      }
    }
    return points;
  };
}
