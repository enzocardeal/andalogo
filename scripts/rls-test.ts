import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { buildFeed } from "../lib/gtfs/build.ts";
import { activeSha256, replaceFeed } from "../lib/gtfs/db.ts";
import { loginErrorFor } from "../lib/login-error.ts";

type Stack = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; DB_URL: string };
type User = { id: string; email: string; client: SupabaseClient };
type Result<T> = { data: T; error: null } | { data: unknown; error: { code?: string; message: string } };

const DENIED = /permission denied/;
const INVITE_CAP = 11;
const REFERENCE_TABLES: Record<string, string> = {
  feed_versions: "feed",
  routes: "id",
  stops: "id",
  stop_routes: "stop_id",
  headways: "route_id",
};

const stack: Stack = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
);
const run = randomUUID().slice(0, 8);
const password = randomUUID();

const admin = newClient(stack.SERVICE_ROLE_KEY);
const anon = newClient(stack.ANON_KEY);
const sql = postgres(stack.DB_URL, { max: 1, onnotice: () => {} });
const stopId = `sp:rls-${run}`;
const busId = `sp:rls-bus-${run}`;
const nightId = `sp:rls-night-${run}`;

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

  await sql`
    insert into public.routes (id, feed, short_name, long_name, mode, color, text_color) values
      (${busId}, 'sptrans', 'RLS-10', 'Term. A - B', 'bus', '#509E2F', '#FFFFFF'),
      (${nightId}, 'sptrans', 'RLS-21', 'Term. A - C', 'bus', null, null)`;
  await sql`
    insert into public.stops (id, feed, gtfs_stop_id, name, lat, lon, mode, color)
    values (${stopId}, 'sptrans', ${`rls-${run}`}, 'Parada RLS', -23.55, -46.63, 'bus', null)`;
  await sql`
    insert into public.stop_routes (stop_id, route_id, direction_id, headsign) values
      (${stopId}, ${busId}, 0, 'Jd. B'),
      (${stopId}, ${nightId}, 0, 'Jd. C')`;
  await sql`
    insert into public.headways (route_id, direction_id, day_type, start_min, end_min, headway_s) values
      (${busId}, 0, 'weekday', 0, 1440, 600),
      (${nightId}, 0, 'weekday', 1440, 1500, 1200)`;
});

after(async () => {
  await sql`delete from public.stops where id = ${stopId}`;
  await sql`delete from public.routes where id in ${sql([busId, nightId])}`;
  await sql.end();
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

test("authenticated reads the GTFS tables, anon reads none", async () => {
  for (const table of Object.keys(REFERENCE_TABLES)) {
    ok(await member.client.from(table).select("*").limit(1), `member select ${table}`);
    refused(await anon.from(table).select("*").limit(1), "42501", DENIED, `anon select ${table}`);
  }
  const stops = ok(await member.client.from("stops").select("id").eq("id", stopId), "member select stop");
  assert.equal(stops.length, 1);
});

test("anon and authenticated cannot write the GTFS tables", async () => {
  const before = ok(await member.client.from("stops").select("*").eq("id", stopId), "stop before");
  for (const [role, client] of [["anon", anon], ["member", member.client]] as const) {
    for (const [table, column] of Object.entries(REFERENCE_TABLES)) {
      const what = `${role} on ${table}`;
      const row = { [column]: "x" };
      refused(await client.from(table).insert(row), "42501", DENIED, `${what}: insert`);
      refused(await client.from(table).update(row).neq(column, "x"), "42501", DENIED, `${what}: update`);
      refused(await client.from(table).delete().neq(column, "x"), "42501", DENIED, `${what}: delete`);
    }
  }
  assert.deepEqual(ok(await member.client.from("stops").select("*").eq("id", stopId), "stop after"), before);
});

test("get_stop returns the lines of a stop with the frequency at the given time", async () => {
  const at = async (time: string) => {
    const stop = ok(await member.client.rpc("get_stop", { p_stop_id: stopId, p_at: time }), `get_stop at ${time}`);
    return (stop as { lines: { route_id: string; headsign: string; headway_s: number | null }[] }).lines.map(
      (line) => [line.route_id, line.headsign, line.headway_s],
    );
  };

  assert.deepEqual(await at("2026-10-19T12:00:00-03:00"), [
    [busId, "Jd. B", 600],
    [nightId, "Jd. C", null],
  ]);
  assert.deepEqual(await at("2026-10-20T00:30:00-03:00"), [
    [busId, "Jd. B", 600],
    [nightId, "Jd. C", 1200],
  ]);
  assert.deepEqual(await at("2026-10-18T12:00:00-03:00"), [
    [busId, "Jd. B", null],
    [nightId, "Jd. C", null],
  ]);
  assert.equal(ok(await member.client.rpc("get_stop", { p_stop_id: "sp:none" }), "get_stop of an unknown stop"), null);
});

test("anon cannot execute get_stop", async () => {
  refused(await anon.rpc("get_stop", { p_stop_id: stopId }), "42501", DENIED, "anon get_stop");
});

test("replaceFeed loads a feed and replaces it on the next load", async (t) => {
  if ((await activeSha256(sql, "artesp")) !== null) {
    t.skip("this stack already holds an artesp feed");
    return;
  }
  const week = { monday: "1", tuesday: "1", wednesday: "1", thursday: "1", friday: "1", saturday: "0", sunday: "0" };
  const tables = (headsign: string) =>
    buildFeed("artesp", {
      routes: [{ route_id: "001", route_short_name: "001", route_long_name: "A - B", route_type: "3" }],
      trips: [{ route_id: "001", service_id: "WD", trip_id: "t1", trip_headsign: headsign, direction_id: "1" }],
      stops: [{ stop_id: "9", stop_name: "Rua B, 1", stop_lat: "-23.6", stop_lon: "-46.5" }],
      stopTimes: [{ trip_id: "t1", stop_id: "9" }],
      frequencies: [{ trip_id: "t1", start_time: "05:00:00", end_time: "22:59:00", headway_secs: "900" }],
      calendar: [{ service_id: "WD", ...week }],
    });

  try {
    await replaceFeed(sql, "artesp", tables("B"), { sha256: "first", stopsFile: "artesp-first.json" });
    await replaceFeed(sql, "artesp", tables("Bairro B"), { sha256: "second", stopsFile: "artesp-second.json" });

    assert.equal(await activeSha256(sql, "artesp"), "second");
    const stop = ok(await member.client.rpc("get_stop", { p_stop_id: "ar:9", p_at: "2026-10-19T12:00:00-03:00" }), "get_stop");
    assert.deepEqual(stop, {
      id: "ar:9",
      name: "Rua B, 1",
      mode: "emtu",
      lat: -23.6,
      lon: -46.5,
      lines: [
        {
          route_id: "ar:001",
          short_name: "001",
          long_name: "A - B",
          mode: "emtu",
          color: null,
          text_color: null,
          direction_id: 1,
          headsign: "Bairro B",
          headway_s: 900,
        },
      ],
    });
  } finally {
    await sql`delete from public.stops where feed = 'artesp'`;
    await sql`delete from public.routes where feed = 'artesp'`;
    await sql`delete from public.feed_versions where feed = 'artesp'`;
  }
});
