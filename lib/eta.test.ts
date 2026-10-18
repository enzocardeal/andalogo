import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceMeters,
  averagePace,
  circularDirections,
  estimateLine,
  estimateStop,
  indexPositions,
  measure,
  pointAt,
  project,
  segmentPaces,
  stopOffsets,
  travelSeconds,
  type StopPattern,
} from "./eta.ts";
import { encodePolyline, type LatLon } from "./polyline.ts";

const NOW = new Date("2026-10-19T10:00:00-03:00");
const A: LatLon = [-23.55, -46.64];
const B: LatLon = [-23.55, -46.63];
const C: LatLon = [-23.54, -46.63];
const D: LatLon = [-23.54, -46.64];
const LINE = [A, B, C];
const EAST_M = 0.01 * Math.cos((23.55 * Math.PI) / 180) * 111_320;
const NORTH_M = 0.01 * 111_320;

function east(meters: number): LatLon {
  return [A[0], A[1] + (meters / EAST_M) * 0.01];
}

function vehicle(p: string, [py, px]: LatLon, ageS = 30) {
  return { p, a: true, ta: new Date(NOW.getTime() - ageS * 1000).toISOString(), py, px };
}

function pattern(stopIndex: number): StopPattern {
  const route = measure(LINE);
  return {
    route_id: "sp:8000-10",
    direction_id: 0,
    polyline: encodePolyline(LINE),
    stop_offsets_m: stopOffsets(route, LINE),
    stop_indexes: [stopIndex],
    run_time_s: Math.round(0.5 * (EAST_M + NORTH_M)),
    circular: false,
  };
}

test("project finds the distance along the route and the distance off it", () => {
  const route = measure(LINE);
  assert.equal(Math.round(route.cumulative.at(-1)!), Math.round(EAST_M + NORTH_M));
  const [pass, ...rest] = project(route, [A[0] - 50 / 111_320, east(510)[1]], 150);
  assert.equal(rest.length, 0);
  assert.equal(Math.round(pass.alongM), 510);
  assert.equal(Math.round(pass.offM), 50);
  assert.deepEqual(project(route, [A[0] - 50 / 111_320, east(510)[1]], 40), []);
});

test("project and stopOffsets give one position per pass on a loop", () => {
  const loop = measure([A, B, C, D, A]);
  const length = loop.cumulative.at(-1)!;
  assert.deepEqual(project(loop, A, 150).map((pass) => Math.round(pass.alongM)), [0, Math.round(length)]);
  assert.deepEqual(stopOffsets(loop, [A, B, undefined, C, D, A]), [
    0,
    Math.round(EAST_M),
    Math.round(EAST_M),
    Math.round(EAST_M + NORTH_M),
    Math.round(2 * EAST_M + NORTH_M),
    Math.round(length),
  ]);
});

test("averagePace and travelSeconds use segment paces and fall back to the average", () => {
  assert.equal(averagePace({ stop_offsets_m: [0, 2000], run_time_s: 600 }), 0.3);
  assert.equal(averagePace({ stop_offsets_m: [0, 2000], run_time_s: null }), 0.24);
  assert.equal(averagePace({ stop_offsets_m: [0, 2000], run_time_s: 60 }), 0.06);
  assert.equal(averagePace({ stop_offsets_m: [0, 0], run_time_s: 600 }), 0.24);
  assert.equal(travelSeconds([0, 1000, 2000], [0.1, 0.2], 0.3, 500, 1500), 150);
  assert.equal(travelSeconds([100, 1100, 2100], [0.1, 0.2], 0.3, 0, 600), 80);
});

test("segmentPaces blends calibrated paces with the line mean and the GTFS average", () => {
  const base = { stop_offsets_m: [0, 1000, 2000], run_time_s: 600 };
  assert.deepEqual(segmentPaces(base), { paces: [0.3, 0.3], fallback: 0.3 });
  assert.deepEqual(segmentPaces({ ...base, paces: [120], samples: [50] }), { paces: [0.3, 0.3], fallback: 0.3 });
  const { paces, fallback } = segmentPaces({ ...base, paces: [120, 0], samples: [50, 0] });
  const line = (25 * 0.12 + 3 * 0.3) / 28;
  assert.equal(fallback.toFixed(6), line.toFixed(6));
  assert.deepEqual(paces.map((pace) => pace.toFixed(6)), [((50 * 0.12 + 3 * line) / 53).toFixed(6), line.toFixed(6)]);
});

test("estimateLine keeps fresh buses on the route before the stop", () => {
  const estimates = estimateLine(
    pattern(1),
    [
      vehicle("near", east(600)),
      vehicle("at-stop", east(EAST_M - 20), 60),
      vehicle("passed", [B[0] + 300 / 111_320, B[1]]),
      vehicle("terminal", east(100)),
      vehicle("off-route", [A[0] - 200 / 111_320, east(500)[1]]),
      vehicle("old", east(600), 600),
    ],
    NOW,
  );
  assert.deepEqual(estimates.map((estimate) => estimate.p), ["at-stop", "near"]);
  assert.equal(estimates[0].seconds, 0);
  assert.ok(Math.abs(estimates[1].seconds - ((EAST_M - 600) * 0.5 - 30)) < 2);
});

test("estimateStop matches positions by sign and direction and rounds to minutes", () => {
  const positions = indexPositions({
    hr: "10:00",
    l: [
      { c: "8000-10", cl: 1, sl: 1, lt0: "", lt1: "", qv: 1, vs: [vehicle("1", east(600))] },
      { c: "8000-10", cl: 2, sl: 2, lt0: "", lt1: "", qv: 1, vs: [vehicle("2", east(500))] },
    ],
  });
  const [line] = estimateStop([pattern(1)], positions, NOW);
  assert.equal(line.routeId, "sp:8000-10");
  assert.equal(line.directionId, 0);
  assert.deepEqual(line.vehicles.map((bus) => [bus.p, bus.minutes]), [["1", 3]]);
  const [loop] = estimateStop([{ ...pattern(1), circular: true }], positions, NOW);
  assert.deepEqual(loop.vehicles.map((bus) => bus.p), ["1", "2"]);
  assert.deepEqual(circularDirections([pattern(1), { ...pattern(2), route_id: "sp:817C-10", circular: true }]), new Map([["sp:817C-10", 0]]));
});

test("estimateStop picks the half of an out-and-back loop from the Olho Vivo side", () => {
  const loop = [A, B, C, D, C, B, A];
  const offsets = stopOffsets(measure(loop), loop);
  const length = offsets.at(-1)!;
  const outbound: LatLon = [B[0] + 300 / 111_320, B[1]];
  const positions = indexPositions({
    hr: "10:00",
    l: [
      { c: "8000-10", cl: 1, sl: 1, lt0: "", lt1: "", qv: 1, vs: [vehicle("out", outbound)] },
      { c: "8000-10", cl: 2, sl: 2, lt0: "", lt1: "", qv: 1, vs: [vehicle("back", outbound)] },
    ],
  });
  const circular: StopPattern = {
    route_id: "sp:8000-10",
    direction_id: 0,
    polyline: encodePolyline(loop),
    stop_offsets_m: offsets,
    stop_indexes: [5],
    run_time_s: Math.round(0.5 * length),
    circular: true,
  };
  const [line] = estimateStop([circular], positions, NOW);
  assert.deepEqual(line.vehicles.map((bus) => [bus.p, bus.minutes]), [
    ["back", Math.round((300 * 0.5 - 30) / 60)],
    ["out", Math.round(((2 * EAST_M + 2 * NORTH_M - 300) * 0.5 - 30) / 60)],
  ]);
});

test("advanceMeters walks segment paces and is the inverse of travelSeconds", () => {
  const offsets = [100, 1100, 2100];
  const paces = [0.1, 0.2];
  assert.equal(advanceMeters(offsets, paces, 0.3, 500, 0), 500);
  assert.equal(advanceMeters(offsets, paces, 0.3, 500, 40), 900);
  assert.equal(advanceMeters(offsets, paces, 0.3, 500, 60), 1100);
  assert.equal(advanceMeters(offsets, paces, 0.3, 500, 160), 1600);
  assert.equal(advanceMeters(offsets, paces, 0.3, 500, 10_000), 2100);
  assert.equal(advanceMeters(offsets, paces, 0.3, 0, 30), 100);
  for (const seconds of [7, 55, 123]) {
    const toM = advanceMeters(offsets, paces, 0.3, 300, seconds);
    assert.equal(travelSeconds(offsets, paces, 0.3, 300, toM).toFixed(6), seconds.toFixed(6));
  }
});

test("pointAt gives the position and the bearing along the shape", () => {
  const route = measure(LINE);
  const start = pointAt(route, 0);
  assert.deepEqual([start.lat.toFixed(5), start.lon.toFixed(5), Math.round(start.bearing)], ["-23.55000", "-46.64000", 90]);
  const corner = pointAt(route, EAST_M + 500);
  assert.equal(Math.round(corner.bearing), 0);
  assert.equal(corner.lon.toFixed(5), "-46.63000");
  assert.equal(Math.round((corner.lat - B[0]) * 111_320), 500);
  assert.deepEqual(pointAt(route, 1e9), { ...pointAt(route, route.cumulative.at(-1)!) });
});
