import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketOf, createCalibration, mergeRow, spread, type CalibrationPattern, type Totals } from "./eta-calibration.ts";
import { measure, stopOffsets } from "./eta.ts";
import type { Positions } from "./olhovivo.ts";
import { encodePolyline, type LatLon } from "./polyline.ts";

const A: LatLon = [-23.55, -46.64];
const B: LatLon = [-23.55, -46.63];
const C: LatLon = [-23.54, -46.63];
const LINE = [A, B, C];
const EAST_M = 0.01 * Math.cos((23.55 * Math.PI) / 180) * 111_320;
const T0 = Date.parse("2026-10-19T10:00:00-03:00");

const PATTERN: CalibrationPattern = {
  route_id: "sp:8000-10",
  direction_id: 0,
  polyline: encodePolyline(LINE),
  stop_offsets_m: stopOffsets(measure(LINE), LINE),
  stops_key: "k1",
  circular: false,
};

function east(meters: number): LatLon {
  return [A[0], A[1] + (meters / EAST_M) * 0.01];
}

function snapshot(sl: number, buses: [string, LatLon, number][]): Positions {
  return {
    hr: "10:00",
    l: [{ c: "8000-10", cl: 1, sl, lt0: "", lt1: "", qv: buses.length, vs: buses.map(([p, [py, px], s]) => ({ p, a: true, ta: new Date(T0 + s * 1000).toISOString(), py, px })) }],
  };
}

test("bucketOf uses the São Paulo day type and hour", () => {
  assert.deepEqual(bucketOf(new Date("2026-10-19T10:30:00-03:00")), { dayType: "weekday", hour: 10 });
  assert.deepEqual(bucketOf(new Date("2026-10-24T23:59:00-03:00")), { dayType: "saturday", hour: 23 });
  assert.deepEqual(bucketOf(new Date("2026-10-25T03:10:00Z")), { dayType: "sunday", hour: 0 });
});

test("spread shares time by distance and keeps stopped time in its segment", () => {
  const totals = { seconds: [0, 0], meters: [0, 0] };
  spread([0, 1000, 2000], 500, 1500, 100, totals);
  assert.deepEqual(totals, { seconds: [50, 50], meters: [500, 500] });
  spread([0, 1000, 2000], 1200, 1200, 30, totals);
  spread([0, 1000, 2000], 2500, 2500, 30, totals);
  assert.deepEqual(totals, { seconds: [50, 80], meters: [500, 500] });
});

test("observe records forward moves and skips the terminal, jumps back and repeated fixes", () => {
  const calibration = createCalibration([PATTERN]);
  assert.equal(calibration.observe(snapshot(1, [["move", east(400), 0], ["start", east(50), 0], ["back", east(800), 0]])), 0);
  assert.equal(calibration.observe(snapshot(1, [["move", east(700), 60], ["start", east(250), 60], ["back", east(300), 60]])), 0 + 1);
  assert.equal(calibration.observe(snapshot(1, [["move", east(700), 60]])), 0);
  assert.equal(calibration.observe(snapshot(2, [["move", east(900), 90]])), 0);
  assert.equal(calibration.tracked(), 3);
  const [totals, ...rest] = calibration.drain();
  assert.equal(rest.length, 0);
  assert.deepEqual([totals.dayType, totals.hour, totals.pattern.stops_key], ["weekday", 10, "k1"]);
  assert.equal(totals.seconds[0], 60);
  assert.equal(Math.round(totals.meters[0]), 300);
  assert.deepEqual(calibration.drain(), []);
});

test("observe maps both sides of a circular line to its pattern", () => {
  const calibration = createCalibration([{ ...PATTERN, circular: true }]);
  calibration.observe(snapshot(2, [["loop", east(400), 0]]));
  assert.equal(calibration.observe(snapshot(2, [["loop", east(700), 60]])), 1);
});

test("mergeRow adds new totals to the stored row and caps the samples", () => {
  const totals: Totals = { pattern: { ...PATTERN, stop_offsets_m: [0, 1000, 2000] }, dayType: "weekday", hour: 10, seconds: [100, 0], meters: [1000, 0] };
  const fresh = mergeRow(undefined, totals);
  assert.deepEqual(fresh, {
    route_id: "sp:8000-10",
    direction_id: 0,
    day_type: "weekday",
    hour: 10,
    stops_key: "k1",
    pace_s_per_km: [100, 0],
    samples: [1, 0],
  });
  const merged = mergeRow({ ...fresh, pace_s_per_km: [200, 150], samples: [3, 2] }, totals);
  assert.deepEqual([merged.pace_s_per_km, merged.samples], [[175, 150], [4, 2]]);
  const capped = mergeRow({ ...fresh, pace_s_per_km: [200, 150], samples: [50, 2] }, totals);
  assert.deepEqual(capped.samples, [50, 2]);
  const changed = mergeRow({ ...fresh, stops_key: "old", pace_s_per_km: [200, 150], samples: [3, 2] }, totals);
  assert.deepEqual([changed.pace_s_per_km, changed.samples], [[100, 0], [1, 0]]);
});
