import assert from "node:assert/strict";
import { test } from "node:test";
import { mapHref, parseMapView, routeGeoJSON } from "./map-view.ts";
import { encodePolyline } from "./polyline.ts";
import type { RouteDetails } from "./transit.ts";

const ROUTE: RouteDetails = {
  id: "sp:8000-10",
  short_name: "8000-10",
  long_name: "Lapa - Pça. Ramos",
  mode: "bus",
  color: null,
  text_color: null,
  patterns: [
    {
      direction_id: 1,
      headsign: "Lapa",
      polyline: encodePolyline([
        [-23.55, -46.63],
        [-23.52, -46.7],
      ]),
      stops: [{ id: "sp:1", name: "A", lat: -23.55, lon: -46.63 }],
    },
  ],
};

test("mapHref and parseMapView keep the stop, the route and the direction", () => {
  assert.equal(mapHref({ stop: null, route: null, dir: 0 }), "/");
  assert.equal(mapHref({ stop: "sp:18848", route: null, dir: 1 }), "/?stop=sp%3A18848");
  const href = mapHref({ stop: "sp:1", route: "sp:METRÔ L1", dir: 1 });
  assert.deepEqual(parseMapView(new URL(href, "https://x").searchParams), { stop: "sp:1", route: "sp:METRÔ L1", dir: 1, near: null, trip: null });
  assert.deepEqual(parseMapView(new URLSearchParams("dir=7")), { stop: null, route: null, dir: 0, near: null, trip: null });
});

test("mapHref and parseMapView keep a chosen place", () => {
  const near = { lat: -23.540512, lon: -46.570498, label: "Bráz Pizzaria" };
  const href = mapHref({ stop: "sp:1", route: null, dir: 0, near });
  assert.equal(href, "/?stop=sp%3A1&near=-23.54051%2C-46.57050&label=Br%C3%A1z+Pizzaria");
  assert.deepEqual(parseMapView(new URL(href, "https://x").searchParams).near, { lat: -23.54051, lon: -46.5705, label: "Bráz Pizzaria" });
  assert.equal(parseMapView(new URLSearchParams("near=abc")).near, null);
  assert.deepEqual(parseMapView(new URLSearchParams("near=-23.5,-46.6")).near, { lat: -23.5, lon: -46.6, label: "" });
});

test("routeGeoJSON draws the pattern of the direction, or the first one", () => {
  const { bounds, data } = routeGeoJSON(ROUTE, 0);
  assert.deepEqual(bounds, [-46.7, -23.55, -46.63, -23.52]);
  assert.deepEqual(
    data.features.map((feature) => [feature.geometry.type, feature.properties]),
    [
      ["LineString", { color: "#334155" }],
      ["Point", { id: "sp:1", name: "A", color: "#334155" }],
    ],
  );
});

test("routeGeoJSON returns no bounds for a route without patterns", () => {
  const { bounds, data } = routeGeoJSON({ ...ROUTE, patterns: [] }, 0);
  assert.equal(bounds, null);
  assert.deepEqual(data.features, []);
});

test("mapHref and parseMapView keep a trip with its origin and time", () => {
  const trip = { to: { lat: -23.58736, lon: -46.67222, label: "Destino" }, from: { lat: -23.54193, lon: -46.69797, label: "Rua Araioses" }, at: 1_760_000_000_000 };
  const view = parseMapView(new URL(mapHref({ stop: "sp:1", route: null, dir: 0, trip }), "https://x").searchParams);
  assert.deepEqual([view.stop, view.trip], ["sp:1", trip]);
  const now = parseMapView(new URLSearchParams("to=-23.5,-46.6&toLabel=X")).trip;
  assert.deepEqual(now, { to: { lat: -23.5, lon: -46.6, label: "X" }, from: null, at: null });
  assert.equal(parseMapView(new URLSearchParams("stop=sp:1&to=-23.5,-46.6&toLabel=X"), false).trip, null);
});
