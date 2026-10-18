import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePolyline, encodePolyline, type LatLon } from "./polyline.ts";

test("encodePolyline matches the reference example of the format", () => {
  const points: LatLon[] = [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ];
  assert.equal(encodePolyline(points), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), points);
});

test("decodePolyline returns São Paulo points with 5 decimal places", () => {
  const points: LatLon[] = [
    [-23.550503, -46.633308],
    [-23.554022, -46.671108],
  ];
  assert.deepEqual(decodePolyline(encodePolyline(points)), [
    [-23.5505, -46.63331],
    [-23.55402, -46.67111],
  ]);
  assert.deepEqual(decodePolyline(""), []);
});
