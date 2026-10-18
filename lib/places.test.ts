import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPlaceSearch,
  formatDistance,
  nearbyStops,
  parsePlaceQuery,
  photonUrl,
  toPlaces,
  walkMinutes,
  type PhotonFeature,
} from "./places.ts";
import type { MapStop } from "./stops-file.ts";

const BRAZ = { lat: -23.5405, lon: -46.5705 };

function feature(properties: PhotonFeature["properties"], lon = -46.57, lat = -23.54): PhotonFeature {
  return { geometry: { coordinates: [lon, lat] }, properties };
}

function stop(id: string, mode: MapStop["mode"], metersNorth: number): MapStop {
  return { id, name: id, mode, color: null, lat: BRAZ.lat + metersNorth / 111_320, lon: BRAZ.lon };
}

test("toPlaces names places and addresses and drops transit features", () => {
  const places = toPlaces([
    feature({ osm_type: "N", osm_id: 1, osm_value: "restaurant", name: "Bráz Pizzaria", street: "Rua Apucarana", housenumber: "1572", district: "Tatuapé" }),
    feature({ osm_type: "N", osm_id: 2, osm_value: "house_number", street: "Rua Heitor Penteado", housenumber: "1230", district: "Vila Anglo-Brasileira" }),
    feature({ osm_type: "N", osm_id: 3, osm_key: "highway", osm_value: "bus_stop", name: "Parada Hospital das Clinicas" }),
    feature({ osm_type: "N", osm_id: 4, osm_key: "public_transport", osm_value: "platform", name: "Plataforma" }),
    feature({ osm_type: "W", osm_id: 5, osm_value: "mall", name: "Shopping Eldorado", city: "São Paulo" }),
    feature({ osm_type: "W", osm_id: 6, osm_value: "mall", name: "Shopping Eldorado", city: "São Paulo" }),
    feature({ osm_type: "N", osm_id: 7, osm_value: "yes" }),
  ]);
  assert.deepEqual(
    places.map((place) => [place.id, place.name, place.detail]),
    [
      ["N1", "Bráz Pizzaria", "Rua Apucarana, 1572 · Tatuapé"],
      ["N2", "Rua Heitor Penteado, 1230", "Vila Anglo-Brasileira"],
      ["W5", "Shopping Eldorado", "São Paulo"],
    ],
  );
  assert.deepEqual([places[0].lat, places[0].lon], [-23.54, -46.57]);
});

test("nearbyStops keeps the two nearest bus stops and the nearest station within 1 km", () => {
  const stops = [
    stop("bus-far", "bus", 900),
    stop("bus-near", "bus", 100),
    stop("emtu", "emtu", 300),
    stop("metro", "metro", 800),
    stop("cptm-outside", "cptm", 1200),
    stop("bus-outside", "bus", 1500),
  ];
  assert.deepEqual(nearbyStops(stops, BRAZ).map((found) => [found.id, Math.round(found.distanceM / 10) * 10]), [
    ["bus-near", 100],
    ["emtu", 300],
    ["metro", 800],
  ]);
  assert.deepEqual(nearbyStops([stop("cptm-outside", "cptm", 1200)], BRAZ), []);
});

test("walkMinutes and formatDistance describe the walk", () => {
  assert.equal(walkMinutes(0), 1);
  assert.equal(walkMinutes(100), 2);
  assert.equal(walkMinutes(850), 14);
  assert.equal(formatDistance(94), "90 m");
  assert.equal(formatDistance(1000), "1,0 km");
});

test("parsePlaceQuery checks the text and keeps the bias inside Grande São Paulo", () => {
  assert.deepEqual(parsePlaceQuery(new URLSearchParams("q=braz%20pizzaria&lat=-23.54&lon=-46.57")), { q: "braz pizzaria", lat: -23.54, lon: -46.57 });
  assert.deepEqual(parsePlaceQuery(new URLSearchParams("q=braz&lat=48.85&lon=2.35")), { q: "braz", lat: -23.5505, lon: -46.6339 });
  assert.deepEqual(parsePlaceQuery(new URLSearchParams("q=braz")), { q: "braz", lat: -23.5505, lon: -46.6339 });
  assert.equal(parsePlaceQuery(new URLSearchParams("q=%20ab%20")), null);
  assert.equal(parsePlaceQuery(new URLSearchParams(`q=${"a".repeat(101)}`)), null);
});

test("createPlaceSearch asks Photon once per query and area for 10 minutes", async () => {
  let time = 0;
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return Response.json({ features: [feature({ osm_type: "N", osm_id: 1, name: "Bráz Pizzaria" })] });
  }) as typeof fetch;
  const search = createPlaceSearch(fetchImpl, () => time, "https://photon.test/api/");
  const query = { q: "Braz", lat: -23.5401, lon: -46.5702 };
  assert.deepEqual((await search(query)).map((place) => place.name), ["Bráz Pizzaria"]);
  await search({ ...query, q: "braz", lat: -23.5398 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], photonUrl(query, "https://photon.test/api/"));
  time += 600_001;
  await search(query);
  assert.equal(calls.length, 2);

  const failing = createPlaceSearch((async () => new Response("", { status: 503 })) as typeof fetch, () => 0);
  await assert.rejects(failing(query), /photon returned 503/);
});
