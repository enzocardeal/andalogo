import assert from "node:assert/strict";
import { test } from "node:test";
import { liveLineFor, minutesUntil, nextBuses, sortByArrival, stopCode, toArrivals } from "./arrivals.ts";
import type { StopPrediction, Vehicle } from "./olhovivo.ts";

const NOW = new Date("2026-10-19T10:00:30-03:00");
const FRESH = "2026-10-19T12:59:00Z";
const OLD = "2026-10-19T12:40:00Z";

function vehicle(t: string, ta = FRESH, a = true): Vehicle {
  return { p: "11111", t, a, ta, py: -23.55, px: -46.63 };
}

const AT = { lat: -23.55, lon: -46.63 };

function prediction(hr: string, lines: { c: string; sl: number; vs: Vehicle[] }[] | null): StopPrediction {
  return {
    hr,
    p: lines && {
      cp: 18848,
      np: "CLINICAS",
      py: -23.55,
      px: -46.67,
      l: lines.map((line) => ({ ...line, cl: 1, lt0: "A", lt1: "B", qv: line.vs.length })),
    },
  };
}

test("stopCode accepts only SPTrans stop ids", () => {
  assert.equal(stopCode("sp:18848"), "18848");
  assert.equal(stopCode("sp:METRÔ L1"), null);
  assert.equal(stopCode("ar:20102"), null);
  assert.equal(stopCode("sp:1;drop"), null);
  assert.equal(stopCode(null), null);
});

test("minutesUntil handles midnight and late forecasts", () => {
  assert.equal(minutesUntil("10:07", "10:00"), 7);
  assert.equal(minutesUntil("00:05", "23:58"), 7);
  assert.equal(minutesUntil("09:59", "10:00"), 0);
});

test("toArrivals keeps up to three fresh vehicles per line, soonest first", () => {
  const arrivals = toArrivals(
    prediction("10:00", [
      { c: "8000-10", sl: 2, vs: [vehicle("10:20"), vehicle("10:03", FRESH, false), vehicle("10:09"), vehicle("10:12"), vehicle("10:30"), vehicle("10:01", OLD)] },
      { c: "1012-10", sl: 1, vs: [] },
    ]),
    NOW,
  );
  assert.deepEqual(arrivals, {
    state: "live",
    lines: [
      {
        routeId: "sp:8000-10",
        directionId: 1,
        vehicles: [
          { minutes: 3, accessible: false, ...AT },
          { minutes: 9, accessible: true, ...AT },
          { minutes: 12, accessible: true, ...AT },
        ],
      },
      { routeId: "sp:1012-10", directionId: 0, vehicles: [] },
    ],
  });
});

test("toArrivals reports an unknown stop, old positions and an old reference time", () => {
  assert.deepEqual(toArrivals(prediction("10:00", null), NOW), { state: "not_covered", lines: [] });
  assert.deepEqual(toArrivals(prediction("10:00", [{ c: "8000-10", sl: 1, vs: [vehicle("10:05", OLD)] }]), NOW), {
    state: "stale",
    lines: [],
  });
  assert.deepEqual(toArrivals(prediction("09:40", [{ c: "8000-10", sl: 1, vs: [vehicle("09:45")] }]), NOW), {
    state: "stale",
    lines: [],
  });
});

test("toArrivals keeps a stop with lines but no located vehicle live", () => {
  assert.deepEqual(toArrivals(prediction("10:00", [{ c: "8000-10", sl: 1, vs: [] }]), NOW), {
    state: "live",
    lines: [{ routeId: "sp:8000-10", directionId: 0, vehicles: [] }],
  });
});

test("liveLineFor and sortByArrival put lines with the soonest live vehicle first", () => {
  const arrivals = {
    state: "live" as const,
    lines: [
      { routeId: "sp:B", directionId: 0, vehicles: [{ minutes: 9, accessible: true, ...AT }] },
      { routeId: "sp:C", directionId: 1, vehicles: [{ minutes: 2, accessible: true, ...AT }] },
    ],
  };
  const lines = [
    { route_id: "sp:A", direction_id: 0 },
    { route_id: "sp:B", direction_id: 0 },
    { route_id: "sp:C", direction_id: 1 },
    { route_id: "sp:D", direction_id: 0 },
  ];
  assert.deepEqual(sortByArrival(lines, arrivals).map((line) => line.route_id), ["sp:C", "sp:B", "sp:A", "sp:D"]);
  assert.deepEqual(liveLineFor(arrivals, "sp:A", 0), { routeId: "sp:A", directionId: 0, vehicles: [] });
  assert.equal(liveLineFor({ state: "upstream_down", lines: [] }, "sp:B", 0), null);
  assert.deepEqual(sortByArrival(lines, null), lines);
});

test("nextBuses picks the soonest located buses across lines", () => {
  const arrivals = {
    state: "live" as const,
    lines: [
      { routeId: "sp:A", directionId: 0, vehicles: [{ minutes: 9, accessible: true, ...AT }, { minutes: 20, accessible: true, ...AT }] },
      { routeId: "sp:B", directionId: 1, vehicles: [{ minutes: 2, accessible: false, ...AT }] },
    ],
  };
  assert.deepEqual(nextBuses(arrivals, 2).map((bus) => [bus.routeId, bus.minutes]), [["sp:B", 2], ["sp:A", 9]]);
  assert.deepEqual(nextBuses({ state: "stale", lines: [] }, 2), []);
  assert.deepEqual(nextBuses(null, 2), []);
});
