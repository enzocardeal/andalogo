import assert from "node:assert/strict";
import { test } from "node:test";
import { combineArrivals, liveLineFor, minutesUntil, nextBuses, sortByArrival, stopCode } from "./arrivals.ts";
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

test("combineArrivals keeps up to three fresh vehicles per line, soonest first", () => {
  const arrivals = combineArrivals(
    prediction("10:00", [
      { c: "8000-10", sl: 2, vs: [vehicle("10:20"), vehicle("10:03", FRESH, false), vehicle("10:09"), vehicle("10:12"), vehicle("10:30"), vehicle("10:01", OLD)] },
      { c: "1012-10", sl: 1, vs: [] },
    ]),
    null,
    NOW,
  );
  assert.deepEqual(arrivals, {
    state: "live",
    lines: [
      {
        routeId: "sp:8000-10",
        directionId: 1,
        vehicles: [
          { p: "11111", minutes: 3, accessible: false, ...AT },
          { p: "11111", minutes: 9, accessible: true, ...AT },
          { p: "11111", minutes: 12, accessible: true, ...AT },
        ],
      },
      { routeId: "sp:1012-10", directionId: 0, vehicles: [] },
    ],
  });
});

test("combineArrivals reports an unknown stop, old positions and an old reference time", () => {
  assert.deepEqual(combineArrivals(prediction("10:00", null), null, NOW), { state: "not_covered", lines: [] });
  assert.deepEqual(combineArrivals(prediction("10:00", [{ c: "8000-10", sl: 1, vs: [vehicle("10:05", OLD)] }]), null, NOW), {
    state: "stale",
    lines: [],
  });
  assert.deepEqual(combineArrivals(prediction("09:40", [{ c: "8000-10", sl: 1, vs: [vehicle("09:45")] }]), null, NOW), {
    state: "stale",
    lines: [],
  });
});

test("combineArrivals keeps a stop with lines but no located vehicle live", () => {
  assert.deepEqual(combineArrivals(prediction("10:00", [{ c: "8000-10", sl: 1, vs: [] }]), null, NOW), {
    state: "live",
    lines: [{ routeId: "sp:8000-10", directionId: 0, vehicles: [] }],
  });
});

test("combineArrivals adds GPS estimates for buses that SPTrans does not list", () => {
  const gps = (p: string, minutes: number) => ({ p, minutes, accessible: true, ...AT });
  const estimated = [
    { routeId: "sp:8000-10", directionId: 1, vehicles: [gps("11111", 7), gps("22222", 4)] },
    { routeId: "sp:917H-10", directionId: 0, vehicles: [gps("33333", 10)] },
    { routeId: "sp:1012-10", directionId: 0, vehicles: [] },
  ];
  assert.deepEqual(combineArrivals(prediction("10:00", [{ c: "8000-10", sl: 2, vs: [vehicle("10:09")] }]), estimated, NOW), {
    state: "live",
    lines: [
      { routeId: "sp:8000-10", directionId: 1, vehicles: [{ p: "22222", minutes: 4, accessible: true, ...AT }, { p: "11111", minutes: 9, accessible: true, ...AT }] },
      { routeId: "sp:917H-10", directionId: 0, vehicles: [{ p: "33333", minutes: 10, accessible: true, ...AT }] },
    ],
  });
  assert.deepEqual(combineArrivals(prediction("10:00", null), estimated.slice(1), NOW), {
    state: "live",
    lines: [{ routeId: "sp:917H-10", directionId: 0, vehicles: [{ p: "33333", minutes: 10, accessible: true, ...AT }] }],
  });
  assert.deepEqual(combineArrivals(null, estimated.slice(2), NOW), { state: "not_covered", lines: [] });
});

test("combineArrivals maps both sides of a circular line to its one GTFS direction", () => {
  const loop = prediction("10:00", [{ c: "817C-10", sl: 2, vs: [vehicle("10:03")] }]);
  assert.deepEqual(combineArrivals(loop, null, NOW, new Map([["sp:817C-10", 0]])).lines.map((line) => [line.routeId, line.directionId]), [["sp:817C-10", 0]]);
  assert.deepEqual(combineArrivals(loop, null, NOW).lines.map((line) => [line.routeId, line.directionId]), [["sp:817C-10", 1]]);
});

test("liveLineFor and sortByArrival put lines with the soonest live vehicle first", () => {
  const arrivals = {
    state: "live" as const,
    lines: [
      { routeId: "sp:B", directionId: 0, vehicles: [{ p: "1", minutes: 9, accessible: true, ...AT }] },
      { routeId: "sp:C", directionId: 1, vehicles: [{ p: "1", minutes: 2, accessible: true, ...AT }] },
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
      { routeId: "sp:A", directionId: 0, vehicles: [{ p: "1", minutes: 9, accessible: true, ...AT }, { p: "2", minutes: 20, accessible: true, ...AT }] },
      { routeId: "sp:B", directionId: 1, vehicles: [{ p: "3", minutes: 2, accessible: false, ...AT }] },
    ],
  };
  assert.deepEqual(nextBuses(arrivals, 2).map((bus) => [bus.routeId, bus.minutes]), [["sp:B", 2], ["sp:A", 9]]);
  assert.deepEqual(nextBuses(arrivals, 1, { routeId: "sp:A", directionId: 0 }).map((bus) => [bus.routeId, bus.minutes]), [["sp:A", 9]]);
  assert.deepEqual(nextBuses(arrivals, 1, { routeId: "sp:A", directionId: 1 }), []);
  assert.deepEqual(nextBuses({ state: "stale", lines: [] }, 2), []);
  assert.deepEqual(nextBuses(null, 2), []);
});
