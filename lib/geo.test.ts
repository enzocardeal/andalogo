import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceMeters } from "./geo.ts";

const SE = { lat: -23.5505, lon: -46.6339 };

test("distanceMeters measures short distances in São Paulo", () => {
  assert.equal(distanceMeters(SE, SE), 0);
  const d = distanceMeters(SE, { lat: SE.lat + 0.001, lon: SE.lon });
  assert.ok(d > 110 && d < 112, `${d}`);
});
