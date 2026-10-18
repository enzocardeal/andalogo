import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeStops, encodeStops, staleStopsFiles, type MapStop } from "./stops-file.ts";

test("encodeStops and decodeStops keep every field, with 5 decimal places", () => {
  const stops: MapStop[] = [
    { id: "sp:18848", name: "Clínicas", lat: -23.5540221, lon: -46.6711089, mode: "metro", color: "#007E5E" },
    { id: "sp:1", name: "Rua A, 10", lat: -23.5, lon: -46.6, mode: "bus", color: null },
  ];
  const decoded = decodeStops(JSON.parse(encodeStops(stops)));
  assert.deepEqual(decoded, [
    { ...stops[0], lat: -23.55402, lon: -46.67111 },
    stops[1],
  ]);
});

test("encodeStops leaves out an empty color", () => {
  const text = encodeStops([{ id: "sp:1", name: "A", lat: 0, lon: 0, mode: "bus", color: null }]);
  assert.equal(text, '{"stops":[["sp:1","A",0,0,0]]}');
});

test("decodeStops refuses a body without stops", () => {
  assert.throws(() => decodeStops(null));
  assert.throws(() => decodeStops({ stops: "x" }));
});

test("staleStopsFiles keeps the current file and the files of other feeds", () => {
  const names = ["sptrans-aaa.json", "sptrans-bbb.json", "artesp-ccc.json", "sptrans-notes.txt"];
  assert.deepEqual(staleStopsFiles(names, "sptrans", "sptrans-bbb.json"), ["sptrans-aaa.json"]);
  assert.deepEqual(staleStopsFiles(names, "artesp", "artesp-ccc.json"), []);
});
