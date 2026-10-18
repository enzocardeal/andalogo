import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCorridorStop, checkStop, distanceMeters, passes, sample, summarize } from "./idmap.ts";
import type { StopPrediction } from "./olhovivo.ts";

const SE = { id: "18848", name: "Praça da Sé", lat: -23.5505, lon: -46.6339 };

function prediction(lines: { c: string; sl: number }[], py = SE.lat, px = SE.lon): StopPrediction {
  return {
    hr: "10:00",
    p: {
      cp: 18848,
      np: "SE",
      py,
      px,
      l: lines.map((line) => ({ ...line, cl: 1, lt0: "A", lt1: "B", qv: 0, vs: [] })),
    },
  };
}

test("distanceMeters measures short distances in São Paulo", () => {
  assert.equal(distanceMeters(SE, SE), 0);
  const d = distanceMeters(SE, { lat: SE.lat + 0.001, lon: SE.lon });
  assert.ok(d > 110 && d < 112, `${d}`);
});

test("checkStop maps sign and direction to GTFS route keys", () => {
  const served = new Set(["8000-10|0", "8000-10|1", "1012-10|0"]);
  const routes = new Set(["8000-10", "1012-10", "9999-10"]);
  const check = checkStop(SE, served, routes, prediction([
    { c: "8000-10", sl: 2 },
    { c: "1012-10", sl: 2 },
    { c: "9999-10", sl: 1 },
    { c: "XXXX-10", sl: 1 },
  ]));

  assert.equal(check.found, true);
  assert.equal(check.distanceM, 0);
  assert.deepEqual(
    check.lines.map(({ routeKnown, servesStop, directionMatches }) => [routeKnown, servesStop, directionMatches]),
    [
      [true, true, true],
      [true, true, false],
      [true, false, false],
      [false, false, false],
    ],
  );
});

test("checkStop reports a stop that Olho Vivo does not know", () => {
  assert.deepEqual(checkStop(SE, new Set(), new Set(), { hr: "10:00", p: null }), {
    stopId: "18848",
    found: false,
    distanceM: null,
    lines: [],
  });
});

test("checkCorridorStop looks up cp as a GTFS stop_id", () => {
  const stops = new Map([["18848", SE]]);
  const corridorStop = { cp: 18848, np: "SE", ed: "", py: SE.lat, px: SE.lon };
  assert.deepEqual(checkCorridorStop(corridorStop, stops), { cp: 18848, name: "SE", inGtfs: true, distanceM: 0 });
  assert.equal(checkCorridorStop({ ...corridorStop, cp: 1 }, stops).inGtfs, false);
});

test("summarize counts lines only for stops that Olho Vivo found", () => {
  const served = new Set(["8000-10|0"]);
  const routes = new Set(["8000-10"]);
  const far = prediction([{ c: "8000-10", sl: 1 }], SE.lat + 0.01);
  const results = summarize(
    [checkStop(SE, served, routes, far), checkStop({ ...SE, id: "2" }, served, routes, { hr: "", p: null })],
    [],
  );
  const byName = new Map(results.map((result) => [result.name, result]));

  assert.deepEqual(byName.get("H1 stop_id found in Olho Vivo"), { name: "H1 stop_id found in Olho Vivo", passed: 1, total: 2, failures: ["2"] });
  assert.equal(byName.get("H1 position within 50 m")?.passed, 0);
  assert.equal(byName.get("H3 direction_id = sl - 1")?.passed, 1);
  assert.equal(byName.get("H1 corridor cp found in GTFS")?.total, 0);
});

test("passes needs 95 % and at least one item", () => {
  assert.equal(passes({ name: "", passed: 19, total: 20, failures: [] }), true);
  assert.equal(passes({ name: "", passed: 18, total: 20, failures: [] }), false);
  assert.equal(passes({ name: "", passed: 0, total: 0, failures: [] }), false);
});

test("sample is repeatable for one seed and picks distinct items", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const first = sample(items, 10, 1);
  assert.deepEqual(sample(items, 10, 1), first);
  assert.equal(new Set(first).size, 10);
  assert.notDeepEqual(sample(items, 10, 2), first);
  assert.equal(sample(items, 80, 1).length, 50);
});
