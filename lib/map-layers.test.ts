import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLICKABLE_LAYERS,
  overlayLayers,
  ROUTE_SOURCE,
  SELECTED_LAYER,
  SELECTED_SIGN_LAYER,
  SIGN_IMAGES,
  signStyles,
  stopFilters,
  STOPS_SOURCE,
} from "./map-layers.ts";

test("overlayLayers draws the route under the stops and the selection on top, in both schemes", () => {
  for (const scheme of ["light", "dark"] as const) {
    const ids = overlayLayers(scheme).map((layer) => layer.id);
    assert.deepEqual(ids, [
      "route-line",
      "rail-stations",
      "route-stops",
      "bus-stops",
      "favorite-stops",
      "favorite-signs",
      "favorite-badges",
      "rail-labels",
      SELECTED_LAYER,
      SELECTED_SIGN_LAYER,
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

test("every sign image has a style in both schemes, with a stronger outline when selected", () => {
  for (const scheme of ["light", "dark"] as const) {
    const styles = signStyles(scheme);
    assert.deepEqual(Object.keys(styles).sort(), Object.values(SIGN_IMAGES).sort());
    assert.ok(styles[SIGN_IMAGES.busSelected].outlineWidth > styles[SIGN_IMAGES.bus].outlineWidth);
  }
  assert.notDeepEqual(signStyles("light")[SIGN_IMAGES.bus], signStyles("dark")[SIGN_IMAGES.bus]);
});

test("stopFilters hides the selected stop from the normal sign layers and splits stations from signs", () => {
  const isRail = ["in", ["get", "mode"], ["literal", ["metro", "cptm"]]];
  const isSign = ["!", isRail];
  const ids = ["in", ["get", "id"], ["literal", ["sp:1", "sp:2"]]];
  const notSelected = ["!", ["==", ["get", "id"], "sp:1"]];
  assert.deepEqual(stopFilters("sp:1", new Set(["sp:1", "sp:2"])), {
    "bus-stops": ["all", isSign, notSelected],
    "favorite-stops": ["all", ids, isRail],
    "favorite-signs": ["all", ids, isSign, notSelected],
    "favorite-badges": ids,
    [SELECTED_LAYER]: ["all", ["==", ["get", "id"], "sp:1"], isRail],
    [SELECTED_SIGN_LAYER]: ["all", ["==", ["get", "id"], "sp:1"], isSign],
  });
});
