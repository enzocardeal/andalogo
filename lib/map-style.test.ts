import assert from "node:assert/strict";
import { test } from "node:test";
import type { StyleSpecification } from "maplibre-gl";
import { PALETTES, transitStyle } from "./map-style.ts";

const BASE: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: "vector", url: "https://tiles.example/planet" } },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "rgb(242,243,240)" } },
    { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", paint: { "fill-color": "#eee", "fill-opacity": 0.5 } },
    { id: "highway-shield-non-us", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name" },
    { id: "label_city", type: "symbol", source: "openmaptiles", "source-layer": "place", paint: { "text-color": "#000" } },
    { id: "unknown_fill", type: "fill", source: "openmaptiles", "source-layer": "landuse", paint: { "fill-color": "#123" } },
  ],
};

test("transitStyle recolors known layers and keeps their other paint properties", () => {
  const dark = transitStyle(BASE, "dark");
  const byId = new Map(dark.layers.map((layer) => [layer.id, layer]));
  assert.deepEqual(byId.get("background")?.paint, { "background-color": PALETTES.dark.background });
  assert.deepEqual(byId.get("building")?.paint, {
    "fill-color": PALETTES.dark.building,
    "fill-opacity": 0.5,
    "fill-outline-color": PALETTES.dark.buildingOutline,
  });
});

test("transitStyle gives every other label the label colors and drops road shields", () => {
  const dark = transitStyle(BASE, "dark");
  assert.deepEqual(
    dark.layers.map((layer) => layer.id),
    ["background", "building", "label_city", "unknown_fill"],
  );
  assert.deepEqual(dark.layers[2].paint, { "text-color": PALETTES.dark.label, "text-halo-color": PALETTES.dark.labelHalo });
  assert.deepEqual(dark.layers[3], BASE.layers[4]);
});

test("transitStyle leaves the base style unchanged", () => {
  const before = structuredClone(BASE);
  transitStyle(BASE, "light");
  assert.deepEqual(BASE, before);
});
