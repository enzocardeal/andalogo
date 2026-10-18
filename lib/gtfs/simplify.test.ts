import assert from "node:assert/strict";
import { test } from "node:test";
import type { LatLon } from "../polyline.ts";
import { simplify } from "./simplify.ts";

test("simplify drops points closer to the line than the tolerance", () => {
  const straight: LatLon[] = [
    [-23.55, -46.63],
    [-23.55001, -46.62],
    [-23.55, -46.61],
  ];
  assert.deepEqual(simplify(straight, 5), [straight[0], straight[2]]);
});

test("simplify keeps a corner and the end points", () => {
  const corner: LatLon[] = [
    [-23.55, -46.63],
    [-23.55, -46.62],
    [-23.54, -46.62],
    [-23.53, -46.62],
  ];
  assert.deepEqual(simplify(corner, 5), [corner[0], corner[1], corner[3]]);
});

test("simplify returns short lines unchanged", () => {
  const two: LatLon[] = [
    [-23.55, -46.63],
    [-23.54, -46.62],
  ];
  assert.deepEqual(simplify(two, 5), two);
  assert.deepEqual(simplify([], 5), []);
});
