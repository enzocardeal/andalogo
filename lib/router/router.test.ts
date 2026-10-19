import assert from "node:assert/strict";
import { test } from "node:test";
import type { MapStop } from "../stops-file.ts";
import { boardingOptions, replay } from "./boarding.ts";
import { buildFootpaths, stopsNear, walkSeconds } from "./footpaths.ts";
import { buildNetwork, loadNetwork, type NetworkFile } from "./network.ts";
import { journeyKey, plan, routesBetween, serviceClock } from "./plan.ts";
import { earliestTrip, headwayAt, raptor, ridePace, type Journey } from "./raptor.ts";
import { toJourney, toTrip } from "./trips.ts";

const EIGHT = 8 * 3600;

function stop(id: string, lat: number): MapStop {
  return { id, name: id, lat, lon: -46.6, mode: "bus", color: null };
}

const STOPS = [
  stop("sp:A", -23.55),
  stop("sp:B", -23.54),
  stop("sp:C", -23.53),
  stop("sp:D", -23.52),
  stop("sp:E", -23.51),
  { ...stop("ar:X", -23.5291), mode: "emtu" as const },
];

const SPTRANS: NetworkFile = {
  version: 1,
  feed: "sptrans",
  routes: [
    ["sp:1", "1", null, null, 0],
    ["sp:2", "2", null, null, 0],
    ["sp:4", "4", null, null, 0],
  ],
  stops: ["sp:A", "sp:B", "sp:C", "sp:D", "sp:E"],
  frequency: [
    [0, 0, "C", [0, 1, 2], [0, 1000, 2000], 600, [0, 0, 1440, 600]],
    [1, 0, "D", [2, 3], [0, 1000], 300, [0, 0, 1440, 1200]],
    [2, 0, "E", [0, 4], [0, 9000], 2700, [0, 0, 1440, 600]],
  ],
  timetable: [],
};

const ARTESP: NetworkFile = {
  version: 1,
  feed: "artesp",
  routes: [["ar:3", "3", null, null, 3]],
  stops: ["ar:X", "sp:E"],
  frequency: [],
  timetable: [[0, 0, "E", [0, 1], [0, 900], [[EIGHT, EIGHT + 1800], [], []]]],
};

const network = loadNetwork([SPTRANS, ARTESP], STOPS);
const footpaths = buildFootpaths(network);
const at = (id: string) => network.stopIndex.get(id)!;

function search(from: string, to: string): Journey[] {
  return raptor(network, footpaths, {
    origins: [{ stop: at(from), seconds: 60 }],
    destinations: [{ stop: at(to), seconds: 0 }],
    departure: EIGHT,
    day: 0,
    previousDay: 2,
    factor: 1,
    maxRides: 5,
  });
}

function describe(journey: Journey): string[] {
  return journey.legs.map((leg) =>
    leg.kind === "walk"
      ? `walk ${leg.from === null ? "origin" : network.stopIds[leg.from]}>${leg.to === null ? "destination" : network.stopIds[leg.to]} ${leg.arrive}`
      : `ride ${network.routes[network.patterns[leg.pattern].route].shortName} ${network.stopIds[leg.from]}>${network.stopIds[leg.to]} ${leg.depart}-${leg.arrive}`,
  );
}

test("loadNetwork merges feeds, places stops and indexes the patterns of each stop", () => {
  assert.equal(network.routes.length, 4);
  assert.equal(network.patterns.length, 4);
  assert.deepEqual([network.lat[at("ar:X")], network.names[at("sp:A")]], [-23.5291, "sp:A"]);
  assert.deepEqual(
    network.stopPatterns[at("sp:E")].map(({ pattern, position }) => [pattern, position]),
    [
      [2, 1],
      [3, 1],
    ],
  );
  assert.throws(() => loadNetwork([{ ...SPTRANS, version: 2 }], STOPS), /version 2/);
});

test("buildFootpaths links stops within 400 m and stopsNear finds access stops", () => {
  const fromC = Array.from(footpaths.to.subarray(footpaths.start[at("sp:C")], footpaths.start[at("sp:C") + 1]));
  assert.deepEqual(
    fromC.map((index) => network.stopIds[index]),
    ["ar:X"],
  );
  assert.equal(walkSeconds(100), 98);
  assert.deepEqual(
    stopsNear(network, { lat: -23.5505, lon: -46.6 }).map((access) => network.stopIds[access.stop]),
    ["sp:A"],
  );
});

test("raptor rides one line with an expected wait of half the headway", () => {
  assert.deepEqual(search("sp:A", "sp:C").map(describe), [
    ["walk origin>sp:A 28860", "ride 1 sp:A>sp:C 29160-29760", "walk sp:C>destination 29760"],
  ]);
});

test("raptor changes lines with a minimum transfer time", () => {
  assert.deepEqual(search("sp:A", "sp:D").map(describe), [
    ["walk origin>sp:A 28860", "ride 1 sp:A>sp:C 29160-29760", "ride 2 sp:C>sp:D 30420-30720", "walk sp:D>destination 30720"],
  ]);
});

test("raptor walks to a timetable line and keeps the fastest journey for each number of rides", () => {
  assert.deepEqual(search("sp:A", "sp:E").map(describe), [
    ["walk origin>sp:A 28860", "ride 4 sp:A>sp:E 29160-31860", "walk sp:E>destination 31860"],
    [
      "walk origin>sp:A 28860",
      "ride 1 sp:A>sp:C 29160-29760",
      "walk sp:C>ar:X 29858",
      "ride 3 ar:X>sp:E 30600-31500",
      "walk sp:E>destination 31500",
    ],
  ]);
});

test("headwayAt, earliestTrip and ridePace handle late service, the previous day and the bus factor", () => {
  const frequency = network.patterns[0];
  const timed = network.patterns[3];
  assert.ok(frequency.kind === "frequency" && timed.kind === "timetable");
  assert.equal(headwayAt(frequency, 0, 2, EIGHT), 600);
  assert.equal(headwayAt({ ...frequency, windows: [{ day: 2, startMin: 1440, endMin: 1500, headwayS: 900 }] }, 0, 2, 1800), 900);
  assert.equal(headwayAt(frequency, 1, 0, EIGHT), null);
  assert.equal(earliestTrip(timed, 0, 2, EIGHT + 1), EIGHT + 1800);
  assert.equal(earliestTrip({ ...timed, starts: [new Int32Array(), new Int32Array(), Int32Array.from([86_400 + 600])] }, 0, 2, 0), 600);
  assert.equal(ridePace(network, frequency, 0.5), 0.15);
  const metro = loadNetwork([{ ...SPTRANS, routes: [["sp:L1", "L1", null, null, 1]], frequency: [SPTRANS.frequency[0]] }], STOPS);
  assert.equal(ridePace(metro, metro.patterns[0] as typeof frequency, 0.5), 0.3);
});

test("serviceClock and plan use São Paulo time and add a walk for short trips", () => {
  assert.deepEqual(serviceClock(new Date("2026-10-19T08:00:05-03:00")), { day: 0, previousDay: 2, seconds: EIGHT + 5 });
  assert.deepEqual(serviceClock(new Date("2026-10-18T01:00:00-03:00")), { day: 2, previousDay: 1, seconds: 3600 });
  const journeys = plan(network, footpaths, {
    from: { lat: -23.5505, lon: -46.6 },
    to: { lat: -23.5395, lon: -46.6 },
    departure: new Date("2026-10-19T08:00:00-03:00"),
    factor: 1,
  });
  assert.deepEqual(
    journeys.map((journey) => journey.rides),
    [1, 0],
  );
});

test("buildNetwork keeps frequency patterns with service windows and timetable trips per day type", () => {
  const route = (id: string, mode: "bus" | "emtu") => ({
    id,
    feed: "sptrans" as const,
    short_name: id,
    long_name: "",
    mode,
    color: null,
    text_color: null,
  });
  const file = buildNetwork("sptrans", {
    stops: [],
    routes: [route("sp:1", "bus"), route("sp:9", "bus"), route("ar:3", "emtu")],
    stopRoutes: [],
    headways: [
      { route_id: "sp:1", direction_id: 0, day_type: "weekday", start_min: 300, end_min: 360, headway_s: 600 },
      { route_id: "sp:1", direction_id: 0, day_type: "sunday", start_min: 1440, end_min: 1500, headway_s: 1200 },
    ],
    patterns: [
      {
        route_id: "sp:1",
        direction_id: 0,
        headsign: "C",
        polyline: "",
        stop_ids: ["sp:A", "sp:C"],
        stop_offsets_m: [0, 2000],
        run_time_s: 600,
      },
      { route_id: "sp:9", direction_id: 0, headsign: "Z", polyline: "", stop_ids: ["sp:Z"], stop_offsets_m: [0], run_time_s: 0 },
    ],
    timetablePatterns: [{ id: "ar:t1", route_id: "ar:3", direction_id: 1, headsign: "E" }],
    timetableStops: [
      { pattern_id: "ar:t1", stop_index: 1, stop_id: "sp:E", offset_s: 900 },
      { pattern_id: "ar:t1", stop_index: 0, stop_id: "ar:X", offset_s: 0 },
    ],
    timetableTrips: [
      { pattern_id: "ar:t1", day_type: "saturday", start_s: 30_600 },
      { pattern_id: "ar:t1", day_type: "saturday", start_s: 28_800 },
    ],
  });
  assert.deepEqual(file, {
    version: 1,
    feed: "sptrans",
    routes: [
      ["sp:1", "sp:1", null, null, 0],
      ["sp:9", "sp:9", null, null, 0],
      ["ar:3", "ar:3", null, null, 3],
    ],
    stops: ["sp:A", "sp:C", "ar:X", "sp:E"],
    frequency: [[0, 0, "C", [0, 1], [0, 2000], 600, [0, 300, 360, 600, 2, 1440, 1500, 1200]]],
    timetable: [[2, 1, "E", [2, 3], [0, 900], [[], [28_800, 30_600], []]]],
  });
});

test("plan groups lines that share a leg and searches again without the last leg of the fastest journey", () => {
  assert.deepEqual(
    routesBetween(network, at("sp:A"), at("sp:C")).map((route) => network.routes[route].shortName),
    ["1"],
  );
  assert.deepEqual(routesBetween(network, at("sp:C"), at("sp:A")), []);
  const journeys = plan(network, footpaths, {
    from: { lat: -23.5505, lon: -46.6 },
    to: { lat: -23.5095, lon: -46.6 },
    departure: new Date("2026-10-19T08:00:00-03:00"),
    factor: 1,
  });
  assert.deepEqual(journeys.map(journeyKey), [`${at("sp:A")}>${at("sp:C")}|${at("ar:X")}>${at("sp:E")}`, `${at("sp:A")}>${at("sp:E")}`]);
  assert.deepEqual(
    journeys[0].legs.flatMap((leg) => (leg.kind === "ride" ? [leg.alternatives] : [])),
    [[], []],
  );
});

test("toTrip converts times, merges walks in a row and lists the stops of each ride", () => {
  const [, transfer] = search("sp:A", "sp:E");
  const origin = { id: null, name: "Origem", lat: -23.5505, lon: -46.6 };
  const destination = { id: null, name: "Destino", lat: -23.5095, lon: -46.6 };
  const startMs = Date.parse("2026-10-19T08:00:00-03:00");
  const walkTwice: Journey = {
    ...transfer,
    legs: [
      ...transfer.legs.slice(0, -1),
      { kind: "walk", from: at("sp:E"), to: at("sp:E"), depart: 31_500, arrive: 31_560 },
      transfer.legs.at(-1)!,
    ],
  };
  const trip = toTrip(network, walkTwice, { from: origin, to: destination }, startMs, EIGHT);
  assert.deepEqual(
    trip.legs.map((leg) => [leg.kind, leg.from.name, leg.to.name, (leg.depart - startMs) / 1000, (leg.arrive - startMs) / 1000]),
    [
      ["walk", "Origem", "sp:A", 0, 60],
      ["ride", "sp:A", "sp:C", 360, 960],
      ["walk", "sp:C", "ar:X", 960, 1058],
      ["ride", "ar:X", "sp:E", 1800, 2700],
      ["walk", "sp:E", "Destino", 2700, 2700],
    ],
  );
  const first = trip.legs[1];
  assert.ok(first.kind === "ride");
  assert.deepEqual([first.line.short_name, first.headsign, first.path.length, (first.ready - startMs) / 1000], ["1", "C", 3, 60]);
  assert.deepEqual([trip.rides, trip.walkSeconds, (trip.arrive - startMs) / 1000], [2, 158, 2700]);
  const back = toJourney(network, toTrip(network, transfer, { from: origin, to: destination }, startMs, EIGHT), startMs, EIGHT);
  assert.deepEqual(back, transfer);
});

test("boardingOptions offers every earlier stop of the line, reached by any other line", () => {
  const file: NetworkFile = {
    version: 1,
    feed: "sptrans",
    routes: [
      ["sp:F1", "F1", null, null, 0],
      ["sp:F2", "F2", null, null, 0],
      ["sp:L", "L", null, null, 0],
    ],
    stops: ["sp:O", "sp:P", "sp:Q", "sp:R", "sp:T"],
    frequency: [
      [0, 0, "P", [0, 1], [0, 2200], 600, [0, 0, 1440, 600]],
      [1, 0, "Q", [0, 2], [0, 4400], 900, [0, 0, 1440, 600]],
      [2, 0, "T", [1, 2, 3, 4], [0, 2200, 4400, 8800], 1800, [0, 0, 1440, 1200]],
    ],
    timetable: [],
  };
  const line = loadNetwork(
    [file],
    [stop("sp:O", -23.6), stop("sp:P", -23.58), stop("sp:Q", -23.56), stop("sp:R", -23.54), stop("sp:T", -23.5)],
  );
  const paths = buildFootpaths(line);
  const query = { from: { lat: -23.6, lon: -46.6 }, departure: EIGHT, day: 0, previousDay: 2, factor: 1 };
  const [journey] = raptor(line, paths, {
    ...query,
    origins: stopsNear(line, query.from),
    destinations: stopsNear(line, { lat: -23.5, lon: -46.6 }),
    maxRides: 3,
  });
  const rides = (each: Journey) =>
    each.legs.flatMap((leg) => (leg.kind === "ride" ? [line.routes[line.patterns[leg.pattern].route].shortName] : []));
  const options = boardingOptions(line, paths, journey, 2, query);
  assert.deepEqual(
    options.map((option) => [line.stopIds[option.stop], option.current, rides(option.journey), Math.round(option.journey.arrive - EIGHT)]),
    [
      ["sp:P", false, ["F1", "L"], 3360],
      ["sp:Q", true, ["F2", "L"], 3210],
    ],
  );
  assert.deepEqual(boardingOptions(line, paths, journey, 0, query), []);
  const ride = journey.legs[2];
  assert.ok(ride.kind === "ride");
  assert.deepEqual(
    replay(line, [ride, { kind: "walk", from: ride.to, to: null, depart: 0, arrive: 30 }], EIGHT + 1000, query)?.map((leg) => [
      leg.depart - EIGHT,
      Math.round(leg.arrive - EIGHT),
    ]),
    [
      [1660, 3010],
      [3010, 3040],
    ],
  );
});
