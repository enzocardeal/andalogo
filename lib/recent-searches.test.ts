import assert from "node:assert/strict";
import { test } from "node:test";
import { addRecent, MAX_RECENT, matchRecent, parseRecent, recentKey, type RecentSearch } from "./recent-searches.ts";

const route: RecentSearch = {
  kind: "route",
  route: { id: "sp:856R-10", short_name: "856R-10", long_name: "Lapa - Socorro", mode: "bus", color: null, text_color: null },
};
const stop: RecentSearch = { kind: "stop", stop: { id: "sp:1", name: "Av. Dr. Arnaldo, 1125", mode: "bus" } };
const place: RecentSearch = {
  kind: "place",
  place: {
    id: "W1",
    name: "Edifício Corporate Park",
    detail: "Rua Doutor Renato Paes de Barros, 1017 · Itaim Bibi",
    lat: -23.587,
    lon: -46.672,
  },
};

test("addRecent puts the newest entry first, removes its older copy and keeps at most eight", () => {
  assert.deepEqual(addRecent([route, stop], stop).map(recentKey), [recentKey(stop), recentKey(route)]);
  const many = Array.from({ length: 10 }, (_, index): RecentSearch => ({
    kind: "stop",
    stop: { id: `sp:${index}`, name: `${index}`, mode: "bus" },
  }));
  const list = many.reduce<RecentSearch[]>(addRecent, []);
  assert.equal(list.length, MAX_RECENT);
  assert.equal(recentKey(list[0]), "stop:sp:9");
});

test("matchRecent ignores case and accents and looks at line names and place details", () => {
  assert.deepEqual(matchRecent([route, stop, place], "edificio"), [place]);
  assert.deepEqual(matchRecent([route, stop, place], "SOCORRO"), [route]);
  assert.deepEqual(matchRecent([route, stop, place], "renato"), [place]);
  assert.deepEqual(matchRecent([route, stop, place], "arnaldo"), [stop]);
});

test("parseRecent keeps valid entries and survives broken storage", () => {
  assert.deepEqual(parseRecent(JSON.stringify([route, { kind: "stop" }, { kind: "place", place: { id: "x", name: "y" } }, stop, 7])), [
    route,
    stop,
  ]);
  assert.deepEqual(parseRecent("{not json"), []);
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent(JSON.stringify({ kind: "stop" })), []);
});
