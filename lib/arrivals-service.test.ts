import assert from "node:assert/strict";
import { test } from "node:test";
import { createArrivalsService } from "./arrivals-service.ts";

const BASE = "https://olho.test/v2.1";

function clock(start: string) {
  let time = new Date(start).getTime();
  return { now: () => new Date(time), advance: (ms: number) => (time += ms) };
}

function fakeOlhoVivo(prediction: () => Response) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url.replace(BASE, ""));
    if (url.includes("/Login/Autenticar")) {
      return new Response("true", { headers: [["set-cookie", "apiCredentials=abc; path=/"]] });
    }
    return prediction();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const PREDICTION = {
  hr: "10:00",
  p: { cp: 1, np: "A", py: 0, px: 0, l: [{ c: "8000-10", cl: 1, sl: 1, lt0: "", lt1: "", qv: 1, vs: [{ p: "1", t: "10:04", a: true, ta: "2026-10-19T13:00:00Z", py: 0, px: 0 }] }] },
};

test("the service caches a stop for 10 seconds and shares parallel requests", async () => {
  const time = clock("2026-10-19T10:00:10-03:00");
  const fake = fakeOlhoVivo(() => Response.json(PREDICTION));
  const arrivalsFor = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fake.fetchImpl, now: time.now });

  const [first, second] = await Promise.all([arrivalsFor("1"), arrivalsFor("1")]);
  assert.deepEqual(first, { state: "live", lines: [{ routeId: "sp:8000-10", directionId: 0, vehicles: [{ minutes: 4, accessible: true, lat: 0, lon: 0 }] }] });
  assert.equal(second, first);
  time.advance(9_000);
  await arrivalsFor("1");
  assert.deepEqual(fake.calls, ["/Login/Autenticar?token=t", "/Previsao/Parada?codigoParada=1"]);
  time.advance(2_000);
  await arrivalsFor("1");
  assert.equal(fake.calls.length, 3);
});

test("the service reports a missing token without a network call", async () => {
  const fake = fakeOlhoVivo(() => Response.json(PREDICTION));
  const arrivalsFor = createArrivalsService({ token: undefined, baseUrl: BASE, fetchImpl: fake.fetchImpl });
  assert.deepEqual(await arrivalsFor("1"), { state: "unavailable", lines: [] });
  assert.deepEqual(fake.calls, []);
});

test("the service maps failures and caches them for 15 seconds", async () => {
  const time = clock("2026-10-19T10:00:10-03:00");
  const fake = fakeOlhoVivo(() => new Response("", { status: 503 }));
  const arrivalsFor = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fake.fetchImpl, now: time.now });
  assert.deepEqual(await arrivalsFor("1"), { state: "upstream_down", lines: [] });
  time.advance(14_000);
  await arrivalsFor("1");
  assert.equal(fake.calls.length, 2);
  time.advance(2_000);
  await arrivalsFor("1");
  assert.equal(fake.calls.length, 3);

  const refused = (async () => new Response("false")) as typeof fetch;
  const denied = createArrivalsService({ token: "bad", baseUrl: BASE, fetchImpl: refused });
  assert.deepEqual(await denied("1"), { state: "auth_failed", lines: [] });

  const broken = createArrivalsService({ token: "t", baseUrl: BASE, fetchImpl: fakeOlhoVivo(() => Response.json({ hr: "10:00", p: {} })).fetchImpl, now: time.now });
  assert.deepEqual(await broken("1"), { state: "upstream_down", lines: [] });
});
