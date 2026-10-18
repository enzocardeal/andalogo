import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePolyline } from "../polyline.ts";
import { buildFeed, dayTypesOf, minutesOf, modeOf, type FeedInput } from "./build.ts";
import type { TripStops } from "./trips.ts";

function trip(stopIds: string[], departures: number[] = stopIds.map(() => 0)): TripStops {
  return { stopIds, departures };
}

function service(id: string, days: string): Record<string, string> {
  const names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return { service_id: id, ...Object.fromEntries(names.map((name, i) => [name, days[i]])) };
}

const INPUT: FeedInput = {
  routes: [
    { route_id: "1012-10", route_short_name: "1012-10", route_long_name: "Term. A - B", route_type: "3", route_color: "509e2f", route_text_color: "FFFFFF" },
    { route_id: "METRÔ L1", route_short_name: "METRÔ L1", route_long_name: "TUCURUVI - JABAQUARA", route_type: "1", route_color: "0455A1", route_text_color: "" },
    { route_id: "FUN", route_short_name: "FUN", route_long_name: "Funicular", route_type: "7", route_color: "", route_text_color: "" },
  ],
  trips: [
    { route_id: "1012-10", service_id: "USD", trip_id: "bus-0", trip_headsign: "Jd. B", direction_id: "0", shape_id: "s-bus" },
    { route_id: "1012-10", service_id: "USD", trip_id: "bus-1", trip_headsign: "Term. A", direction_id: "1", shape_id: "" },
    { route_id: "METRÔ L1", service_id: "U__", trip_id: "l1-0", trip_headsign: "Jabaquara", direction_id: "0", shape_id: "s-l1" },
    { route_id: "FUN", service_id: "USD", trip_id: "fun-0", trip_headsign: "Topo", direction_id: "0", shape_id: "" },
    { route_id: "1012-10", service_id: "USD", trip_id: "bus-0-short", trip_headsign: "Sé", direction_id: "0", shape_id: "" },
    { route_id: "1012-10", service_id: "USD", trip_id: "bus-0-late", trip_headsign: "Jd. B", direction_id: "0", shape_id: "" },
    { route_id: "1012-10", service_id: "USD", trip_id: "bus-0-later", trip_headsign: "Jd. B", direction_id: "0", shape_id: "" },
  ],
  stops: [
    { stop_id: "1", stop_name: "Rua A, 10", stop_lat: "-23.5", stop_lon: "-46.6" },
    { stop_id: "2", stop_name: "Sé", stop_lat: "-23.55", stop_lon: "-46.63" },
    { stop_id: "3", stop_name: "Sem linha", stop_lat: "-23.6", stop_lon: "-46.7" },
    { stop_id: "4", stop_name: "Funicular", stop_lat: "-23.7", stop_lon: "-46.8" },
  ],
  tripStops: new Map([
    ["bus-0", trip(["1", "2"], [0, 600])],
    ["bus-1", trip(["1"], [3600])],
    ["l1-0", trip(["2"])],
    ["fun-0", trip(["4"])],
    ["bus-0-short", trip(["2"], [7200])],
    ["bus-0-late", trip(["1", "2"], [36000, 36300])],
    ["bus-0-later", trip(["1", "2"], [39600, 39900])],
  ]),
  frequencies: [
    { trip_id: "bus-0", start_time: "01:00:00", end_time: "01:59:00", headway_secs: "3600" },
    { trip_id: "bus-0", start_time: "00:00:00", end_time: "00:59:00", headway_secs: "1200" },
    { trip_id: "l1-0", start_time: "06:00:00", end_time: "07:00:00", headway_secs: "180" },
    { trip_id: "l1-0", start_time: "07:00:00", end_time: "24:30:00", headway_secs: "240" },
  ],
  calendar: [service("USD", "1111111"), service("U__", "1111100")],
  shapes: new Map([
    ["s-bus", [[-23.5, -46.6], [-23.52, -46.61], [-23.55, -46.63]]],
    ["s-l1", [[-23.55, -46.63]]],
  ]),
};

test("modeOf maps route_type per feed", () => {
  assert.equal(modeOf("sptrans", "1"), "metro");
  assert.equal(modeOf("sptrans", "2"), "cptm");
  assert.equal(modeOf("sptrans", "3"), "bus");
  assert.equal(modeOf("sptrans", "7"), null);
  assert.equal(modeOf("artesp", "3"), "emtu");
  assert.equal(modeOf("artesp", "2"), null);
});

test("minutesOf accepts times after midnight", () => {
  assert.equal(minutesOf("00:00:00"), 0);
  assert.equal(minutesOf("07:30:59"), 450);
  assert.equal(minutesOf("25:10:00"), 1510);
});

test("dayTypesOf reads the calendar flags", () => {
  assert.deepEqual(dayTypesOf(service("USD", "1111111")), ["weekday", "saturday", "sunday"]);
  assert.deepEqual(dayTypesOf(service("_S_", "0000010")), ["saturday"]);
  assert.deepEqual(dayTypesOf(service("x", "0000000")), []);
});

test("buildFeed keeps served stops and gives a station the rail mode and color", () => {
  const tables = buildFeed("sptrans", INPUT);
  assert.deepEqual(
    tables.stops.map(({ id, mode, color }) => ({ id, mode, color })),
    [
      { id: "sp:1", mode: "bus", color: null },
      { id: "sp:2", mode: "metro", color: "#0455A1" },
    ],
  );
  assert.deepEqual(tables.stops[0], {
    id: "sp:1",
    feed: "sptrans",
    gtfs_stop_id: "1",
    name: "Rua A, 10",
    lat: -23.5,
    lon: -46.6,
    mode: "bus",
    color: null,
    bearing: 205,
  });
  assert.deepEqual(
    tables.routes.map(({ id, mode, color, text_color }) => ({ id, mode, color, text_color })),
    [
      { id: "sp:1012-10", mode: "bus", color: "#509E2F", text_color: "#FFFFFF" },
      { id: "sp:METRÔ L1", mode: "metro", color: "#0455A1", text_color: null },
    ],
  );
});

test("buildFeed lists each route and direction once per stop", () => {
  assert.deepEqual(buildFeed("sptrans", INPUT).stopRoutes, [
    { stop_id: "sp:1", route_id: "sp:1012-10", direction_id: 0, headsign: "Jd. B" },
    { stop_id: "sp:2", route_id: "sp:1012-10", direction_id: 0, headsign: "Jd. B" },
    { stop_id: "sp:1", route_id: "sp:1012-10", direction_id: 1, headsign: "Term. A" },
    { stop_id: "sp:2", route_id: "sp:METRÔ L1", direction_id: 0, headsign: "Jabaquara" },
  ]);
});

test("buildFeed turns frequency windows into half-open minute ranges per day type", () => {
  const rows = buildFeed("sptrans", INPUT).headways.map(
    ({ route_id, day_type, start_min, end_min, headway_s }) => `${route_id} ${day_type} ${start_min}-${end_min} ${headway_s}`,
  );
  assert.deepEqual(rows, [
    "sp:1012-10 weekday 0-60 1200",
    "sp:1012-10 saturday 0-60 1200",
    "sp:1012-10 sunday 0-60 1200",
    "sp:1012-10 weekday 60-120 3600",
    "sp:1012-10 saturday 60-120 3600",
    "sp:1012-10 sunday 60-120 3600",
    "sp:METRÔ L1 weekday 360-420 180",
    "sp:METRÔ L1 weekday 420-1471 240",
  ]);
});

test("buildFeed keeps the most common stop sequence per route and direction, with its shape", () => {
  const patterns = buildFeed("sptrans", INPUT).patterns.map((pattern) => ({
    ...pattern,
    polyline: decodePolyline(pattern.polyline),
  }));
  assert.deepEqual(patterns, [
    {
      route_id: "sp:1012-10",
      direction_id: 0,
      headsign: "Jd. B",
      polyline: [[-23.5, -46.6], [-23.52, -46.61], [-23.55, -46.63]],
      stop_ids: ["sp:1", "sp:2"],
      stop_offsets_m: [0, 6364],
      run_time_s: 600,
    },
    { route_id: "sp:1012-10", direction_id: 1, headsign: "Term. A", polyline: [[-23.5, -46.6]], stop_ids: ["sp:1"], stop_offsets_m: [0], run_time_s: 0 },
    { route_id: "sp:METRÔ L1", direction_id: 0, headsign: "Jabaquara", polyline: [[-23.55, -46.63]], stop_ids: ["sp:2"], stop_offsets_m: [0], run_time_s: 0 },
  ]);
});

test("buildFeed stores timetable trips as shared patterns with start times", () => {
  const { timetablePatterns, timetableStops, timetableTrips } = buildFeed("sptrans", INPUT);
  assert.deepEqual(timetablePatterns, [
    { id: "sp:t1", route_id: "sp:1012-10", direction_id: 1, headsign: "Term. A" },
    { id: "sp:t2", route_id: "sp:1012-10", direction_id: 0, headsign: "Sé" },
    { id: "sp:t3", route_id: "sp:1012-10", direction_id: 0, headsign: "Jd. B" },
  ]);
  assert.deepEqual(timetableStops, [
    { pattern_id: "sp:t1", stop_index: 0, stop_id: "sp:1", offset_s: 0 },
    { pattern_id: "sp:t2", stop_index: 0, stop_id: "sp:2", offset_s: 0 },
    { pattern_id: "sp:t3", stop_index: 0, stop_id: "sp:1", offset_s: 0 },
    { pattern_id: "sp:t3", stop_index: 1, stop_id: "sp:2", offset_s: 300 },
  ]);
  assert.deepEqual(
    timetableTrips.filter((row) => row.day_type === "weekday").map((row) => `${row.pattern_id} ${row.start_s}`),
    ["sp:t1 3600", "sp:t2 7200", "sp:t3 36000", "sp:t3 39600"],
  );
  assert.equal(timetableTrips.length, 12);
});
