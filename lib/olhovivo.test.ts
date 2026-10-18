import assert from "node:assert/strict";
import { test } from "node:test";
import { cookieHeader, createOlhoVivo, OLHO_VIVO_URL, OlhoVivoError } from "./olhovivo.ts";

type Call = { url: string; cookie: string | null };

function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), cookie: new Headers(init?.headers).get("cookie") });
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected call to ${String(input)}`);
    }
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function loginResponse(body = "true", cookie = "apiCredentials=abc; path=/; HttpOnly") {
  return new Response(body, { headers: [["set-cookie", cookie]] });
}

test("cookieHeader keeps only the name and value of each cookie", () => {
  assert.equal(cookieHeader(["a=1; path=/; HttpOnly", "b=2"]), "a=1; b=2");
  assert.equal(cookieHeader([]), "");
  assert.equal(cookieHeader(["broken; path=/"]), "");
});

test("get logs in once and sends the session cookie on every call", async () => {
  const { calls, fetchImpl } = fakeFetch([loginResponse(), Response.json({ hr: "10:00" }), Response.json([])]);
  const client = createOlhoVivo("token 1", fetchImpl);

  assert.deepEqual(await client.get("/Previsao/Parada", { codigoParada: 18848 }), { hr: "10:00" });
  assert.deepEqual(await client.get("/Corredor"), []);

  assert.deepEqual(calls, [
    { url: `${OLHO_VIVO_URL}/Login/Autenticar?token=token%201`, cookie: null },
    { url: `${OLHO_VIVO_URL}/Previsao/Parada?codigoParada=18848`, cookie: "apiCredentials=abc" },
    { url: `${OLHO_VIVO_URL}/Corredor`, cookie: "apiCredentials=abc" },
  ]);
});

test("get logs in again after a 401 and retries one time", async () => {
  const { calls, fetchImpl } = fakeFetch([
    loginResponse(),
    new Response("", { status: 401 }),
    loginResponse("true", "apiCredentials=new"),
    Response.json({ ok: true }),
  ]);

  assert.deepEqual(await createOlhoVivo("t", fetchImpl).get("/Corredor"), { ok: true });
  assert.equal(calls[3].cookie, "apiCredentials=new");
});

test("get reports a second 401 and other errors as upstream failures", async () => {
  const { fetchImpl } = fakeFetch([
    loginResponse(),
    new Response("", { status: 401 }),
    loginResponse(),
    new Response("", { status: 401 }),
  ]);
  await assert.rejects(createOlhoVivo("t", fetchImpl).get("/Corredor"), { kind: "upstream" });

  const failing = fakeFetch([loginResponse(), new Response("", { status: 503 })]);
  await assert.rejects(createOlhoVivo("t", failing.fetchImpl).get("/Corredor"), OlhoVivoError);
});

test("get reports a refused login as auth_failed", async () => {
  const { fetchImpl } = fakeFetch([loginResponse("false")]);
  await assert.rejects(createOlhoVivo("bad", fetchImpl).get("/Corredor"), { kind: "auth_failed" });

  const noCookie = fakeFetch([new Response("true")]);
  await assert.rejects(createOlhoVivo("t", noCookie.fetchImpl).get("/Corredor"), { kind: "auth_failed" });
});
