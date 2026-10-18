import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceMeters, meanBearing } from "./geo.ts";

const SE = { lat: -23.5505, lon: -46.6339 };

test("distanceMeters measures short distances in São Paulo", () => {
  assert.equal(distanceMeters(SE, SE), 0);
  const d = distanceMeters(SE, { lat: SE.lat + 0.001, lon: SE.lon });
  assert.ok(d > 110 && d < 112, `${d}`);
});

test("meanBearing averages directions across north and measures their agreement", () => {
  assert.deepEqual(meanBearing([350, 10]), { bearing: 0, agreement: Math.cos((10 * Math.PI) / 180) });
  assert.equal(meanBearing([132, 134])?.bearing, 133);
  assert.ok(meanBearing([130, 310])!.agreement < 0.01);
  assert.equal(meanBearing([]), null);
});
