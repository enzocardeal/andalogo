import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loginErrorFor, parseLoginError } from "./login-error.ts";

test("loginErrorFor recognises the hook refusal", () => {
  assert.equal(loginErrorFor("Cadastro permitido apenas para convidados."), "invite");
  assert.equal(loginErrorFor("Error: Cadastro permitido apenas para convidados."), "invite");
});

test("loginErrorFor treats every other failure as a login error", () => {
  assert.equal(loginErrorFor(null), "auth");
  assert.equal(loginErrorFor(""), "auth");
  assert.equal(loginErrorFor("access_denied"), "auth");
});

test("the hook migration returns the message loginErrorFor expects", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/0001_auth_gate.sql", import.meta.url),
    "utf8",
  );
  const message = /'message', '([^']+)'/.exec(sql)?.[1] ?? null;
  assert.equal(loginErrorFor(message), "invite");
});

test("parseLoginError accepts only known values", () => {
  assert.equal(parseLoginError("invite"), "invite");
  assert.equal(parseLoginError("auth"), "auth");
  assert.equal(parseLoginError(undefined), null);
  assert.equal(parseLoginError("other"), null);
  assert.equal(parseLoginError(["invite"]), null);
});
