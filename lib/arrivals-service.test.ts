import assert from "node:assert/strict";
import { test } from "node:test";
import { createArrivalsService } from "./arrivals-service.ts";
import type { StopPattern } from "./eta.ts";
import { encodePolyline, type LatLon } from "./polyline.ts";

const BASE = "https://olho.test/v2.1";

function clock(start: string) {
  let time = new Date(start).getTime();
  return { now: () => new Date(time), advance: (ms: number) => (time += ms) };
}

function fakeOlhoVivo(prediction: () => Response, positions: () => Response = () => Response.json({ hr: "10:00", l: [] })) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url.replace(BASE, ""));
    if (url.includes("/Login/Autenticar")) {
      return new Response("true", { headers: [["set-cookie", "apiCredentials=abc; path=/"]] });
    }
    return url.includes("/Posicao") ? positions() : prediction();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const NO_PATTERNS = async (): Promise<StopPattern[]> => [];

const LINE: LatLon[] = [[-23.55, -46.64], [-23.55, -46.63], [-23.54, -46.63]];

const PATTERNS = async (): Promise<StopPattern[]> => [
  { route_id: "sp:917H-10", direction_id: 0, polyline: encodePolyline(LINE), stop_offsets_m: [0, 1020, 2134], stop_indexes: [1], run_time_s: 1067, circular: false },
];

const POSITIONS = {
  hr: "10:00",
  l: [{ c: "917H-10", cl: 3, sl: 1, lt0: "", lt1: "", qv: 1, vs: [{ p: 9, a: false, ta: "2026-10-19T12:59:40Z", py: -23.55, px: -46.6341 }] }],
};

const GPS_ONLY = { state: "live", lines: [{ routeId: "sp:917H-10", directionId: 0, vehicles: [{ p: "9", minutes: 3, accessible: false, lat: -23.55, lon: -46.6341 }] }] };

const PREDICTION = {
  hr: "10:00",
  p: { cp: 1, np: "A", py: 0, px: 0, l: [{ c: "8000-10", cl: 1, sl: 1, lt0: "", lt1: "", qv: 1, vs: [{ p: "1", t: "10:04", a: true, ta: "2026-10-19T13:00:00Z", py: 0, px: 0 }] }] },
};

test("the service caches a stop for 10 seconds and shares parallel requests", async () => {
  const time = clock("2026-10-19T10:00:10-03:00");
  const fake = fakeOlhoVivo(() => Response.json(PREDICTION));
  const { arrivalsFor } = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fake.fetchImpl, now: time.now });

  const [first, second] = await Promise.all([arrivalsFor("1", NO_PATTERNS), arrivalsFor("1", NO_PATTERNS)]);
  assert.deepEqual(first, { state: "live", lines: [{ routeId: "sp:8000-10", directionId: 0, vehicles: [{ p: "1", minutes: 4, accessible: true, lat: 0, lon: 0 }] }] });
  assert.equal(second, first);
  time.advance(9_000);
  await arrivalsFor("1", NO_PATTERNS);
  assert.deepEqual(fake.calls, ["/Login/Autenticar?token=t", "/Previsao/Parada?codigoParada=1"]);
  time.advance(2_000);
  await arrivalsFor("1", NO_PATTERNS);
  assert.equal(fake.calls.length, 3);
});

test("the service reports a missing token without a network call", async () => {
  const fake = fakeOlhoVivo(() => Response.json(PREDICTION));
  const { arrivalsFor } = createArrivalsService({ token: undefined, baseUrl: BASE, fetchImpl: fake.fetchImpl });
  assert.deepEqual(await arrivalsFor("1", NO_PATTERNS), { state: "unavailable", lines: [] });
  assert.deepEqual(fake.calls, []);
});

test("the service maps failures and caches them for 15 seconds", async () => {
  const time = clock("2026-10-19T10:00:10-03:00");
  const fake = fakeOlhoVivo(() => new Response("", { status: 503 }));
  const { arrivalsFor } = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fake.fetchImpl, now: time.now });
  assert.deepEqual(await arrivalsFor("1", NO_PATTERNS), { state: "upstream_down", lines: [] });
  time.advance(14_000);
  await arrivalsFor("1", NO_PATTERNS);
  assert.equal(fake.calls.length, 2);
  time.advance(2_000);
  await arrivalsFor("1", NO_PATTERNS);
  assert.equal(fake.calls.length, 3);

  const refused = (async () => new Response("false")) as typeof fetch;
  const { arrivalsFor: denied } = createArrivalsService({ token: "bad", baseUrl: BASE, fetchImpl: refused });
  assert.deepEqual(await denied("1", NO_PATTERNS), { state: "auth_failed", lines: [] });

  const { arrivalsFor: broken } = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fakeOlhoVivo(() => Response.json({ hr: "10:00", p: {} })).fetchImpl, now: time.now });
  assert.deepEqual(await broken("1", NO_PATTERNS), { state: "upstream_down", lines: [] });
});

test("the service adds GPS estimates and shares one position request between stops", async () => {
  const time = clock("2026-10-19T10:00:10-03:00");
  const fake = fakeOlhoVivo(() => Response.json({ hr: "10:00", p: null }), () => Response.json(POSITIONS));
  const { arrivalsFor } = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fake.fetchImpl, now: time.now });
  assert.deepEqual(await arrivalsFor("1", PATTERNS), GPS_ONLY);
  assert.deepEqual(await arrivalsFor("2", PATTERNS), GPS_ONLY);
  assert.equal(fake.calls.filter((call) => call === "/Posicao").length, 1);
  time.advance(16_000);
  await arrivalsFor("1", PATTERNS);
  assert.equal(fake.calls.filter((call) => call === "/Posicao").length, 2);
});

test("the service shows GPS estimates when the SPTrans forecast fails", async () => {
  const time = clock("2026-10-19T10:00:10-03:00");
  const fake = fakeOlhoVivo(() => new Response("", { status: 503 }), () => Response.json(POSITIONS));
  const { arrivalsFor } = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fake.fetchImpl, now: time.now });
  assert.deepEqual(await arrivalsFor("1", PATTERNS), GPS_ONLY);

  const failing = async (): Promise<StopPattern[]> => {
    throw new Error("database down");
  };
  const { arrivalsFor: offline } = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fake.fetchImpl, now: time.now });
  assert.deepEqual(await offline("1", failing), { state: "upstream_down", lines: [] });
});
