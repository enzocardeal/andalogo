import assert from "node:assert/strict";
import { test } from "node:test";
import { moveItem } from "./favorites.ts";

test("moveItem swaps a favorite with its neighbour", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
});

test("moveItem refuses moves past the ends and unknown ids", () => {
  assert.equal(moveItem(["a", "b"], "a", -1), null);
  assert.equal(moveItem(["a", "b"], "b", 1), null);
  assert.equal(moveItem(["a", "b"], "x", 1), null);
});
