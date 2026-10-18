import assert from "node:assert/strict";
import { test } from "node:test";
import { codeMatches, parseInvite } from "./invite.ts";

test("parseInvite trims and lowercases the email", () => {
  assert.deepEqual(parseInvite({ code: "abc", email: "  Ana.Souza@Gmail.COM " }), {
    code: "abc",
    email: "ana.souza@gmail.com",
  });
});

test("parseInvite accepts any valid email domain", () => {
  assert.deepEqual(parseInvite({ code: "abc", email: "bruno@empresa.com.br" }), {
    code: "abc",
    email: "bruno@empresa.com.br",
  });
});

test("parseInvite rejects malformed bodies", () => {
  const cases: unknown[] = [
    null,
    "abc",
    [],
    {},
    { code: "abc" },
    { email: "ana@gmail.com" },
    { code: 123, email: "ana@gmail.com" },
    { code: "abc", email: 123 },
    { code: "", email: "ana@gmail.com" },
    { code: "x".repeat(201), email: "ana@gmail.com" },
    { code: "abc", email: "" },
    { code: "abc", email: "ana" },
    { code: "abc", email: "ana@gmail" },
    { code: "abc", email: "ana souza@gmail.com" },
    { code: "abc", email: "ana@@gmail.com" },
    { code: "abc", email: `${"a".repeat(250)}@x.com` },
  ];
  for (const body of cases) {
    assert.equal(parseInvite(body), null, JSON.stringify(body));
  }
});

test("codeMatches compares the whole code", () => {
  const expected = "k3Jd9sQ2mZp7Vx1Lr8Tn4Bw6";
  assert.equal(codeMatches(expected, expected), true);
  assert.equal(codeMatches(expected.slice(0, -1), expected), false);
  assert.equal(codeMatches(`${expected}x`, expected), false);
  assert.equal(codeMatches(expected.toLowerCase(), expected), false);
  assert.equal(codeMatches("", expected), false);
});
