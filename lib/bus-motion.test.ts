import assert from "node:assert/strict";
import { test } from "node:test";
import { createMotion, glide, passedStops, targetAlong, type LineMotion, type PlacedTrack } from "./bus-motion.ts";
import { measure } from "./eta.ts";

const T0 = Date.parse("2026-10-19T10:00:00-03:00");
const LINE: LineMotion = {
  route: measure([[-23.55, -46.64], [-23.55, -46.6]]),
  offsets: [0, 2000, 4000],
  paces: [0.2, 0.2],
  fallback: 0.2,
};

function track(alongM: number, ageS = 0): PlacedTrack {
  return { p: "1", alongM, lat: 0, lon: 0, ta: new Date(T0 - ageS * 1000).toISOString(), accessible: true };
}

test("targetAlong moves at the line pace for up to 90 s and holds at the terminals", () => {
  assert.equal(targetAlong(LINE, track(1000), T0 + 20_000), 1100);
  assert.equal(targetAlong(LINE, track(1000, 60), T0 + 60_000), 1450);
  assert.equal(targetAlong(LINE, track(200), T0 + 20_000), 200);
  assert.equal(targetAlong(LINE, track(4000), T0 + 20_000), 4000);
  assert.equal(targetAlong(LINE, track(3990), T0 + 20_000), 4000);
});

test("glide follows a target ahead, waits for one behind and jumps over large gaps", () => {
  assert.equal(glide(null, 500, 0.016), 500);
  const step = glide(500, 600, 1);
  assert.ok(step > 600 - 100 / Math.E - 0.001 && step < 600 - 100 / Math.E + 0.001);
  assert.equal(glide(500, 450, 1), 500);
  assert.equal(glide(500, 1600, 0.016), 1600);
  assert.equal(glide(1500, 900, 0.016), 900);
});

test("createMotion keeps each drawn position between frames and drops buses that leave", () => {
  const frame = createMotion();
  const bus = { key: "a", line: LINE, track: track(1000) };
  const first = frame([bus], T0, 0).get("a")!;
  const later = frame([bus], T0 + 10_000, 0.5).get("a")!;
  assert.ok(later.lon > first.lon);
  assert.equal(Math.round(later.bearing), 90);
  assert.equal(frame([], T0 + 11_000, 0.5).size, 0);
  const restart = frame([{ ...bus, track: track(3000) }], T0 + 12_000, 0.016).get("a")!;
  assert.ok(restart.lon > later.lon);
});

test("passedStops counts the stops at least 20 m behind the bus", () => {
  assert.equal(passedStops([0, 2000, 4000], 0), 0);
  assert.equal(passedStops([0, 2000, 4000], 25), 1);
  assert.equal(passedStops([0, 2000, 4000], 2010), 1);
  assert.equal(passedStops([0, 2000, 4000], 2020), 2);
  assert.equal(passedStops([0, 2000, 4000], 9000), 3);
});
