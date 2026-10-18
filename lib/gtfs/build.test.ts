import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFeed, dayTypesOf, minutesOf, modeOf, type FeedInput } from "./build.ts";

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
    { route_id: "1012-10", service_id: "USD", trip_id: "bus-0", trip_headsign: "Jd. B", direction_id: "0" },
    { route_id: "1012-10", service_id: "USD", trip_id: "bus-1", trip_headsign: "Term. A", direction_id: "1" },
    { route_id: "METRÔ L1", service_id: "U__", trip_id: "l1-0", trip_headsign: "Jabaquara", direction_id: "0" },
    { route_id: "FUN", service_id: "USD", trip_id: "fun-0", trip_headsign: "Topo", direction_id: "0" },
  ],
  stops: [
    { stop_id: "1", stop_name: "Rua A, 10", stop_lat: "-23.5", stop_lon: "-46.6" },
    { stop_id: "2", stop_name: "Sé", stop_lat: "-23.55", stop_lon: "-46.63" },
    { stop_id: "3", stop_name: "Sem linha", stop_lat: "-23.6", stop_lon: "-46.7" },
    { stop_id: "4", stop_name: "Funicular", stop_lat: "-23.7", stop_lon: "-46.8" },
  ],
  stopTimes: [
    { trip_id: "bus-0", stop_id: "1" },
    { trip_id: "bus-0", stop_id: "2" },
    { trip_id: "bus-1", stop_id: "1" },
    { trip_id: "l1-0", stop_id: "2" },
    { trip_id: "fun-0", stop_id: "4" },
  ],
  frequencies: [
    { trip_id: "bus-0", start_time: "01:00:00", end_time: "01:59:00", headway_secs: "3600" },
    { trip_id: "bus-0", start_time: "00:00:00", end_time: "00:59:00", headway_secs: "1200" },
    { trip_id: "l1-0", start_time: "06:00:00", end_time: "07:00:00", headway_secs: "180" },
    { trip_id: "l1-0", start_time: "07:00:00", end_time: "24:30:00", headway_secs: "240" },
  ],
  calendar: [service("USD", "1111111"), service("U__", "1111100")],
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
