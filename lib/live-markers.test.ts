import assert from "node:assert/strict";
import { test } from "node:test";
import { busLabel } from "./live-markers.ts";

const BUS = { p: "1", minutes: 5, accessible: true, lat: -23.5, lon: -46.6, routeId: "sp:7281-10", directionId: 1 };
const LINE = {
  route_id: "sp:7281-10",
  short_name: "7281-10",
  long_name: "Pça. Ramos de Azevedo",
  mode: "bus" as const,
  color: "#FF6600",
  text_color: "#FFFFFF",
  direction_id: 1,
  headsign: "Pça. Ramos",
  headway_s: 1200,
  departures: null,
};

test("busLabel shows the line sign only", () => {
  assert.equal(busLabel(BUS, { ...LINE, short_name: "7281" }), "7281");
  assert.equal(busLabel(BUS, undefined), "7281-10");
});
