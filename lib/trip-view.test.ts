import assert from "node:assert/strict";
import { test } from "node:test";
import { encodePolyline } from "./polyline.ts";
import type { Trip, TripRide } from "./router/trips.ts";
import type { RouteDetails } from "./transit.ts";
import { rideLine, tripGeoJSON } from "./trip-view.ts";

const place = (name: string, lat: number, lon: number) => ({ id: name, name, lat, lon });

test("tripGeoJSON draws walks, rides in the line color and the boarding and alighting stops", () => {
  const trip: Trip = {
    depart: 0,
    arrive: 1,
    rides: 1,
    walkSeconds: 60,
    legs: [
      { kind: "walk", from: place("origin", -23.55, -46.6), to: place("A", -23.551, -46.601), depart: 0, arrive: 1 },
      {
        kind: "ride",
        line: { id: "sp:1", short_name: "1", color: "#FF0000", text_color: null, mode: "bus" },
        headsign: "C",
        direction: 0,
        alternatives: [],
        from: place("A", -23.551, -46.601),
        to: place("C", -23.53, -46.62),
        ready: 0,
        depart: 0,
        arrive: 1,
        path: [
          [-46.601, -23.551],
          [-46.61, -23.54],
          [-46.62, -23.53],
        ],
        pattern: 0,
        boardPosition: 0,
        alightPosition: 2,
      },
    ],
  };
  const { bounds, data } = tripGeoJSON(trip);
  assert.deepEqual(
    data.features.map((feature) => [feature.geometry.type, feature.properties?.kind, feature.properties?.color ?? null]),
    [
      ["LineString", "walk", null],
      ["LineString", "ride", "#FF0000"],
      ["Point", "stop", "#FF0000"],
      ["Point", "stop", "#FF0000"],
    ],
  );
  assert.deepEqual(bounds, [-46.62, -23.551, -46.6, -23.53]);
});

test("rideLine follows the line shape between the boarding and alighting stops", () => {
  const leg = {
    kind: "ride",
    line: { id: "sp:1", short_name: "1", color: null, text_color: null, mode: "bus" },
    headsign: "D",
    direction: 0,
    from: place("B", -23.5, -46.61),
    to: place("C", -23.5, -46.63),
    path: [
      [-46.61, -23.5],
      [-46.63, -23.5],
    ],
  } as TripRide;
  const stop = (id: string, lon: number) => ({ id, name: id, lat: -23.5, lon });
  const route: RouteDetails = {
    id: "sp:1",
    short_name: "1",
    long_name: "",
    mode: "bus",
    color: null,
    text_color: null,
    patterns: [
      {
        direction_id: 0,
        headsign: "D",
        polyline: encodePolyline([
          [-23.5, -46.6],
          [-23.5, -46.62],
          [-23.49, -46.62],
          [-23.5, -46.62],
          [-23.5, -46.64],
        ]),
        stops: [stop("A", -46.6), stop("B", -46.61), stop("C", -46.63), stop("D", -46.64)],
      },
    ],
  };
  const line = rideLine(leg, route).map(([lon, lat]) => [Number(lon.toFixed(4)), Number(lat.toFixed(4))]);
  assert.deepEqual(line, [
    [-46.61, -23.5],
    [-46.62, -23.5],
    [-46.62, -23.49],
    [-46.62, -23.5],
    [-46.63, -23.5],
  ]);
  assert.deepEqual(rideLine(leg, undefined), leg.path);
  assert.deepEqual(rideLine({ ...leg, to: place("X", -23.5, -46.65) }, route), leg.path);
});
