import assert from "node:assert/strict";
import { test } from "node:test";
import { headingFrom, smoothHeading } from "./compass.ts";

test("headingFrom reads the iPhone compass, absolute alpha and the screen angle", () => {
  assert.equal(headingFrom({ alpha: 10, absolute: false, webkitCompassHeading: 45 }, 0), 45);
  assert.equal(headingFrom({ alpha: 270, absolute: true }, 0), 90);
  assert.equal(headingFrom({ alpha: 0, absolute: true }, 0), 0);
  assert.equal(headingFrom({ alpha: 300, absolute: true }, 90), 150);
  assert.equal(headingFrom({ alpha: 10, absolute: false, webkitCompassHeading: 350 }, 90), 80);
  assert.equal(headingFrom({ alpha: 90, absolute: false }, 0), null);
  assert.equal(headingFrom({ alpha: null, absolute: true }, 0), null);
});

test("smoothHeading moves part of the way along the shorter turn", () => {
  assert.equal(smoothHeading(null, 120), 120);
  assert.equal(smoothHeading(0, 40), 10);
  assert.equal(smoothHeading(350, 10), 355);
  assert.equal(smoothHeading(10, 350), 5);
  assert.equal(smoothHeading(720, 0), 720);
});
