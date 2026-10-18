import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLICKABLE_LAYERS,
  favoriteFilter,
  overlayLayers,
  ROUTE_SOURCE,
  SELECTED_LAYER,
  selectedFilter,
  STOPS_SOURCE,
} from "./map-layers.ts";

test("overlayLayers draws the route under the stops and the selection on top, in both schemes", () => {
  for (const scheme of ["light", "dark"] as const) {
    const ids = overlayLayers(scheme).map((layer) => layer.id);
    assert.deepEqual(ids, [
      "route-line",
      "bus-stops",
      "rail-stations",
      "route-stops",
      "favorite-stops",
      "favorite-badges",
      "rail-labels",
      SELECTED_LAYER,
    ]);
    for (const id of CLICKABLE_LAYERS) {
      assert.ok(ids.includes(id), `${id} is clickable but missing`);
    }
  }
});

test("overlayLayers uses only the stops and route sources", () => {
  const sources = new Set(overlayLayers("light").map((layer) => ("source" in layer ? layer.source : null)));
  assert.deepEqual([...sources].sort(), [ROUTE_SOURCE, STOPS_SOURCE].sort());
});

test("the light and dark schemes use different marker colors", () => {
  const busPaint = (scheme: "light" | "dark") => overlayLayers(scheme).find((layer) => layer.id === "bus-stops")?.paint;
  assert.notDeepEqual(busPaint("light"), busPaint("dark"));
});

test("favoriteFilter and selectedFilter match stop ids", () => {
  assert.deepEqual(favoriteFilter(new Set(["sp:1", "sp:2"])), ["in", ["get", "id"], ["literal", ["sp:1", "sp:2"]]]);
  assert.deepEqual(selectedFilter("sp:1"), ["==", ["get", "id"], "sp:1"]);
  assert.deepEqual(selectedFilter(null), ["==", ["get", "id"], ""]);
});
