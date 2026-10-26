import assert from "node:assert/strict";
import { test } from "node:test";
import { createArrivalWatch, errorsOf, score, type Prediction } from "./eta-accuracy.ts";
import { measure, stopOffsets, type PositionIndex, type StopPattern } from "./eta.ts";
import { encodePolyline, type LatLon } from "./polyline.ts";

const A: LatLon = [-23.55, -46.64];
const B: LatLon = [-23.55, -46.63];
const C: LatLon = [-23.54, -46.63];
const LINE = [A, B, C];
const EAST_M = 0.01 * Math.cos((23.55 * Math.PI) / 180) * 111_320;
const T0 = Date.parse("2026-10-26T19:00:00-03:00");

const PATTERN: StopPattern = {
  route_id: "sp:8000-10",
  direction_id: 0,
  polyline: encodePolyline(LINE),
  stop_offsets_m: stopOffsets(measure(LINE), LINE),
  stop_indexes: [1],
  run_time_s: 600,
  circular: false,
};

function east(meters: number): LatLon {
  return [A[0], A[1] + (meters / EAST_M) * 0.01];
}

function north(meters: number): LatLon {
  return [B[0] + meters / 111_320, B[1]];
}

function at([py, px]: LatLon, seconds: number): PositionIndex {
  return new Map([["8000-10|1", [{ p: "11001", a: true, ta: new Date(T0 + seconds * 1000).toISOString(), py, px }]]]);
}

function prediction(minutes: Prediction["minutes"]): Prediction {
  return { capturedAt: T0, stop: "sp:1", routeId: "sp:8000-10", directionId: 0, p: "11001", minutes };
}

test("the watch interpolates the time a bus crosses the stop", () => {
  const watch = createArrivalWatch();
  const predicted = prediction({ sptrans: 1, gps: 0 });
  watch.add(predicted, PATTERN);
  watch.observe(at(east(EAST_M - 120), 0));
  watch.observe(at(north(100), 60));
  assert.ok(Math.abs(predicted.arrivedAt! - (T0 + (120 / 220) * 60_000)) < 1000);
  assert.equal(watch.waiting(), 0);
});

test("the watch waits for a bus that is past the stop until it starts a new trip", () => {
  const watch = createArrivalWatch();
  const predicted = prediction({ sptrans: 5 });
  watch.add(predicted, PATTERN);
  watch.observe(at(north(500), 0));
  watch.observe(at(north(700), 30));
  assert.equal(predicted.arrivedAt, undefined);
  watch.observe(at(east(400), 60));
  watch.observe(at(north(50), 120));
  assert.ok(predicted.arrivedAt! > T0 + 60_000 && predicted.arrivedAt! < T0 + 120_000);
});

test("a later prediction of an arrived bus takes the same arrival", () => {
  const watch = createArrivalWatch();
  const first = prediction({ gps: 1 });
  watch.add(first, PATTERN);
  watch.observe(at(east(EAST_M - 100), 0));
  watch.observe(at(north(100), 60));
  const second = { ...prediction({ gps: 0 }), capturedAt: T0 + 90_000 };
  watch.add(second, PATTERN);
  assert.equal(second.arrivedAt, first.arrivedAt);
});

test("errors are actual minus shown minutes, and paired keeps buses that both sources predicted", () => {
  const both = { ...prediction({ sptrans: 4, gps: 3 }), arrivedAt: T0 + 5 * 60_000 };
  const gpsOnly = { ...prediction({ gps: 2 }), arrivedAt: T0 + 2 * 60_000 };
  assert.deepEqual(errorsOf([both, gpsOnly], "sptrans", [3, 5], true), [1]);
  assert.deepEqual(errorsOf([both, gpsOnly], "gps", [0, 5], false), [2, 0]);
  assert.deepEqual(errorsOf([both, gpsOnly], "gps", [0, 5], true), [2]);
});

test("score reports mean absolute error, bias and the share within one and two minutes", () => {
  assert.deepEqual(score([1, -1, 3, -0.5]), { n: 4, meanAbs: 1.375, bias: 0.625, within1: 0.75, within2: 0.75, p90: 3 });
  assert.equal(score([]), null);
});
