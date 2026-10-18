import assert from "node:assert/strict";
import { test } from "node:test";
import { departureLabel, headwayLabel, lineTimes } from "./headway.ts";

const NOON = new Date("2026-10-19T12:00:00-03:00");

test("headwayLabel rounds to whole minutes, at least 1", () => {
  assert.equal(headwayLabel(720), "a cada ~12 min");
  assert.equal(headwayLabel(150), "a cada ~3 min");
  assert.equal(headwayLabel(20), "a cada ~1 min");
});

test("headwayLabel reports a line without service now", () => {
  assert.equal(headwayLabel(null), "Sem serviço agora");
});

test("departureLabel shows minutes below one hour and the clock time after", () => {
  assert.equal(departureLabel(30, NOON), "agora");
  assert.equal(departureLabel(300, NOON), "5 min");
  assert.equal(departureLabel(3599, NOON), "59 min");
  assert.equal(departureLabel(3600 + 900, NOON), "13:15");
});

test("lineTimes uses the frequency for lines without a timetable", () => {
  assert.deepEqual(lineTimes({ headway_s: 600, departures: null }, NOON), { main: "a cada ~10 min", next: null, muted: false, live: false });
  assert.deepEqual(lineTimes({ headway_s: null, departures: null }, NOON), { main: "Sem serviço agora", next: null, muted: true, live: false });
});

test("lineTimes shows the next departure and the ones after it", () => {
  assert.deepEqual(lineTimes({ headway_s: null, departures: [300, 1200, 2100, 7200] }, NOON), {
    main: "5 min",
    next: "depois 20 min · 35 min · 14:00",
    muted: false,
    live: false,
  });
  assert.deepEqual(lineTimes({ headway_s: null, departures: [300] }, NOON), { main: "5 min", next: null, muted: false, live: false });
  assert.deepEqual(lineTimes({ headway_s: null, departures: [] }, NOON), {
    main: "Sem mais partidas hoje",
    next: null,
    muted: true,
    live: false,
  });
});

test("lineTimes shows live vehicles first, and the schedule when no vehicle is located", () => {
  const line = { headway_s: 600, departures: null };
  assert.deepEqual(lineTimes(line, NOON, { vehicles: [{ minutes: 0 }, { minutes: 7 }, { minutes: 15 }] }), {
    main: "agora",
    next: "depois 7 min · 15 min",
    muted: false,
    live: true,
  });
  assert.deepEqual(lineTimes(line, NOON, { vehicles: [{ minutes: 4 }] }), { main: "4 min", next: null, muted: false, live: true });
  assert.deepEqual(lineTimes(line, NOON, { vehicles: [] }), {
    main: "a cada ~10 min",
    next: "Sem previsão ao vivo",
    muted: false,
    live: false,
  });
});
