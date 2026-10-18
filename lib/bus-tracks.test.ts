import assert from "node:assert/strict";
import { test } from "node:test";
import { lineTracks, parseLineParams, type LinePattern } from "./bus-tracks.ts";
import { indexPositions, measure, stopOffsets } from "./eta.ts";
import { encodePolyline, type LatLon } from "./polyline.ts";

const NOW = new Date("2026-10-19T10:00:00-03:00");
const A: LatLon = [-23.55, -46.64];
const B: LatLon = [-23.55, -46.63];
const C: LatLon = [-23.54, -46.63];
const D: LatLon = [-23.54, -46.64];
const LOOP = [A, B, C, D, C, B, A];
const NORTH: LatLon = [B[0] + 300 / 111_320, B[1]];

const PATTERN: LinePattern = {
  route_id: "sp:8000-10",
  direction_id: 0,
  polyline: encodePolyline(LOOP),
  stop_offsets_m: stopOffsets(measure(LOOP), LOOP),
  run_time_s: 3000,
  circular: true,
};

function vehicle(p: string, [py, px]: LatLon, ageS = 30) {
  return { p, a: true, ta: new Date(NOW.getTime() - ageS * 1000).toISOString(), py, px };
}

test("parseLineParams accepts up to four SPTrans line directions", () => {
  assert.deepEqual(parseLineParams(["sp:874C-10:0", "sp:N506-11:1"]), [
    { routeId: "sp:874C-10", directionId: 0 },
    { routeId: "sp:N506-11", directionId: 1 },
  ]);
  assert.equal(parseLineParams([]), null);
  assert.equal(parseLineParams(["sp:A:0", "sp:B:0", "sp:C:0", "sp:D:0", "sp:E:0"]), null);
  assert.equal(parseLineParams(["sp:874C-10:2"]), null);
  assert.equal(parseLineParams(["ar:001:0"]), null);
  assert.equal(parseLineParams(["sp:1;drop:0"]), null);
});

test("lineTracks places each fresh bus on its loop half and keeps off-route buses unplaced", () => {
  const positions = indexPositions({
    hr: "10:00",
    l: [
      { c: "8000-10", cl: 1, sl: 1, lt0: "", lt1: "", qv: 2, vs: [vehicle("out", NORTH), vehicle("old", NORTH, 600)] },
      { c: "8000-10", cl: 2, sl: 2, lt0: "", lt1: "", qv: 2, vs: [vehicle("back", NORTH), vehicle("away", [A[0] - 0.01, A[1]])] },
    ],
  });
  const tracks = lineTracks(PATTERN, positions, NOW);
  const offsets = PATTERN.stop_offsets_m;
  assert.deepEqual(
    tracks.buses.map((bus) => [bus.p, bus.alongM]),
    [
      ["out", offsets[1] + 300],
      ["back", offsets[5] - 300],
      ["away", null],
    ],
  );
  assert.deepEqual([tracks.routeId, tracks.directionId, tracks.stopOffsetsM, tracks.paces.length], ["sp:8000-10", 0, offsets, offsets.length - 1]);
});
