import assert from "node:assert/strict";
import { test } from "node:test";
import { headwayLabel } from "./headway.ts";

test("headwayLabel rounds to whole minutes, at least 1", () => {
  assert.equal(headwayLabel(720), "a cada ~12 min");
  assert.equal(headwayLabel(150), "a cada ~3 min");
  assert.equal(headwayLabel(20), "a cada ~1 min");
});

test("headwayLabel reports a line without service now", () => {
  assert.equal(headwayLabel(null), "Sem serviço agora");
});
