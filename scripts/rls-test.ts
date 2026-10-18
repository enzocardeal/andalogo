import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loginErrorFor } from "../lib/login-error.ts";

type Stack = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string };
type User = { id: string; email: string; client: SupabaseClient };
type Result<T> = { data: T; error: null } | { data: unknown; error: { code?: string; message: string } };

const DENIED = /permission denied/;
const INVITE_CAP = 11;

const stack: Stack = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
);
const run = randomUUID().slice(0, 8);
const password = randomUUID();

const admin = newClient(stack.SERVICE_ROLE_KEY);
const anon = newClient(stack.ANON_KEY);

let member: User;

function newClient(key: string): SupabaseClient {
  return createClient(stack.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function emailFor(name: string): string {
  return `${name}-${run}@rls.test`;
}

function ok<T>(result: Result<T>, what: string): T {
  if (result.error) {
    assert.fail(`${what}: ${result.error.code} ${result.error.message}`);
  }
  return result.data;
}

function refused(result: Result<unknown>, code: string, reason: RegExp, what: string): void {
  const got = result.error ? `${result.error.code} ${result.error.message}` : "success";
  assert.equal(result.error?.code, code, `${what} returned ${got}, expected ${code}`);
  assert.match(result.error?.message ?? "", reason, `${what} returned ${got}`);
}

async function signUp(name: string): Promise<User> {
  const email = emailFor(name);
  const client = newClient(stack.ANON_KEY);
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user || !data.session) {
    assert.fail(`sign-up of ${email}: ${error?.message ?? "no session"}`);
  }
  return { id: data.user.id, email, client };
}

async function inviteCount(): Promise<number> {
  const { count, error } = await admin.from("invited_emails").select("email", { count: "exact", head: true });
  if (error || count === null) {
    assert.fail(`count invited_emails: ${error?.message ?? "no count"}`);
  }
  return count;
}

before(async () => {
  ok(await admin.from("invited_emails").insert({ email: emailFor("member") }), "invite");
  member = await signUp("member");
});

after(async () => {
  const { users } = ok(await admin.auth.admin.listUsers({ perPage: 1000 }), "list users");
  for (const user of users.filter((u) => u.email?.endsWith(`-${run}@rls.test`))) {
    ok(await admin.auth.admin.deleteUser(user.id), "delete user");
  }
  ok(await admin.from("invited_emails").delete().like("email", `%-${run}@rls.test`), "delete invites");
});

test("the hook refuses a sign-up from an email without an invite", async () => {
  const email = emailFor("stranger");
  const { data, error } = await newClient(stack.ANON_KEY).auth.signUp({ email, password });
  assert.equal(data.user, null);
  assert.equal(loginErrorFor(error?.message ?? null), "invite", `sign-up error: ${error?.message}`);

  const { users } = ok(await admin.auth.admin.listUsers({ perPage: 1000 }), "list users");
  const emails = new Set(users.map((user) => user.email));
  assert.equal(emails.has(email), false, "the refused sign-up left a row in auth.users");
  assert.ok(emails.has(member.email), "an invited sign-up is missing from auth.users");
});

test("invited_emails accepts 11 rows and refuses the 12th", async () => {
  const free = INVITE_CAP - (await inviteCount());
  assert.ok(free >= 0, `invited_emails already holds more than ${INVITE_CAP} rows`);
  const fill = Array.from({ length: free }, (_, i) => ({ email: emailFor(`fill${i}`) }));
  if (fill.length > 0) {
    ok(await admin.from("invited_emails").insert(fill), "fill invited_emails");
  }
  refused(await admin.from("invited_emails").insert({ email: emailFor("extra") }), "AL001", /limited to 11/, "12th");
  const again = admin.from("invited_emails").upsert({ email: member.email }, { onConflict: "email", ignoreDuplicates: true });
  ok(await again, "a repeated invite at the cap");
});

test("only the service role reads or writes invited_emails", async () => {
  for (const [role, client] of [["anon", anon], ["member", member.client]] as const) {
    const table = () => client.from("invited_emails");
    refused(await table().select("email"), "42501", DENIED, `${role} select`);
    refused(await table().insert({ email: emailFor(role) }), "42501", DENIED, `${role} insert`);
    refused(await table().update({ email: emailFor(role) }).eq("email", member.email), "42501", DENIED, `${role} update`);
    refused(await table().delete().eq("email", member.email), "42501", DENIED, `${role} delete`);
  }
});

test("anon and authenticated cannot execute the hook", async () => {
  const args = { event: { user: { email: emailFor("hook") } } };
  for (const [role, client] of [["anon", anon], ["member", member.client]] as const) {
    refused(await client.rpc("before_user_created_hook", args), "42501", DENIED, `${role} before_user_created_hook`);
  }
});
