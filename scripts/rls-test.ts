import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { loadCalibrationPatterns, savePaces } from "../lib/eta-db.ts";
import { buildFeed } from "../lib/gtfs/build.ts";
import { activeSha256, replaceFeed } from "../lib/gtfs/db.ts";
import { loginErrorFor } from "../lib/login-error.ts";
import { decodePolyline } from "../lib/polyline.ts";

type Stack = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; DB_URL: string };
type User = { id: string; email: string; client: SupabaseClient };
type Result<T> = { data: T; error: null } | { data: unknown; error: { code?: string; message: string } };

const DENIED = /permission denied/;
const INVITE_CAP = 11;
const INT4 = 23;
const REFERENCE_TABLES: Record<string, string> = {
  feed_versions: "feed",
  routes: "id",
  stops: "id",
  stop_routes: "stop_id",
  headways: "route_id",
  route_patterns: "route_id",
  timetable_patterns: "route_id",
  timetable_stops: "pattern_id",
  timetable_trips: "pattern_id",
  eta_paces: "route_id",
  eta_factors: "day_type",
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
const squareId = `sp:rls-square-${run}`;
const emtuId = `ar:rls-emtu-${run}`;
const timetableId = `ar:rls-t-${run}`;
const emtu2Id = `ar:rls-emtu2-${run}`;
const timetable2Id = `ar:rls-t2-${run}`;

let member: User;
let other: User;

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
  ok(await admin.from("invited_emails").insert([{ email: emailFor("member") }, { email: emailFor("other") }]), "invite");
  member = await signUp("member");
  other = await signUp("other");

  await sql`
    insert into public.routes (id, feed, short_name, long_name, mode, color, text_color) values
      (${busId}, 'sptrans', ${`R${run}`}, 'Term. A - B', 'bus', '#509E2F', '#FFFFFF'),
      (${nightId}, 'sptrans', 'RLS-21', 'Term. A - C', 'bus', null, null)`;
  await sql`
    insert into public.stops (id, feed, gtfs_stop_id, name, lat, lon, mode, color) values
      (${stopId}, 'sptrans', ${`rls-${run}`}, 'Parada RLS', -23.55, -46.63, 'bus', null),
      (${squareId}, 'sptrans', ${`rls-square-${run}`}, ${`Praça da Sé ${run}`}, -23.5505, -46.6333, 'metro', '#EE372F')`;
  await sql`
    insert into public.route_patterns (route_id, direction_id, headsign, polyline, stop_ids, stop_offsets_m, run_time_s)
    values (${busId}, 0, 'Jd. B', '_p~iF~ps|U', ${sql.array([squareId, stopId])}, ${sql.array([0, 500], INT4)}, 120)`;
  await sql`
    insert into public.routes (id, feed, short_name, long_name, mode, color, text_color)
    values (${emtuId}, 'sptrans', '001', 'Cotia - Sao Paulo', 'emtu', '#1D4ED8', '#FFFFFF')`;
  await sql`insert into public.stop_routes (stop_id, route_id, direction_id, headsign) values (${squareId}, ${emtuId}, 0, 'Cotia')`;
  await sql`insert into public.timetable_patterns (id, route_id, direction_id, headsign) values (${timetableId}, ${emtuId}, 0, 'Cotia')`;
  await sql`
    insert into public.timetable_stops (pattern_id, stop_index, stop_id, offset_s) values
      (${timetableId}, 0, ${stopId}, 0),
      (${timetableId}, 1, ${squareId}, 600)`;
  await sql`
    insert into public.timetable_trips (pattern_id, day_type, start_s) values
      (${timetableId}, 'weekday', 43200),
      (${timetableId}, 'weekday', 46800),
      (${timetableId}, 'weekday', 88200)`;
  await sql`
    insert into public.routes (id, feed, short_name, long_name, mode, color, text_color)
    values (${emtu2Id}, 'sptrans', '002', 'Embu - Sao Paulo', 'emtu', '#1D4ED8', '#FFFFFF')`;
  await sql`insert into public.stop_routes (stop_id, route_id, direction_id, headsign) values (${squareId}, ${emtu2Id}, 0, 'Embu')`;
  await sql`insert into public.timetable_patterns (id, route_id, direction_id, headsign) values (${timetable2Id}, ${emtu2Id}, 0, 'Embu')`;
  await sql`insert into public.timetable_stops (pattern_id, stop_index, stop_id, offset_s) values (${timetable2Id}, 0, ${squareId}, 0)`;
  await sql`insert into public.timetable_trips (pattern_id, day_type, start_s) values (${timetable2Id}, 'weekday', 43620)`;
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
  await sql`delete from public.eta_paces where route_id = ${busId}`;
  await sql`delete from public.eta_factors where day_type = 'weekday' and hour = 12`;
  await sql`delete from public.stops where id in ${sql([stopId, squareId])}`;
  await sql`delete from public.routes where id in ${sql([busId, nightId, emtuId, emtu2Id])}`;
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
      trips: [{ route_id: "001", service_id: "WD", trip_id: "t1", trip_headsign: headsign, direction_id: "1", shape_id: "sh1" }],
      stops: [{ stop_id: "9", stop_name: "Rua B, 1", stop_lat: "-23.6", stop_lon: "-46.5" }],
      tripStops: new Map([["t1", { stopIds: ["9"], departures: [18000] }]]),
      frequencies: [{ trip_id: "t1", start_time: "05:00:00", end_time: "22:59:00", headway_secs: "900" }],
      calendar: [{ service_id: "WD", ...week }],
      shapes: new Map([["sh1", [[-23.6, -46.5], [-23.61, -46.51]]]]),
    });

  try {
    await replaceFeed(sql, "artesp", tables("B"), { sha256: "first", stopsFile: "artesp-first.json", routingFile: null });
    await replaceFeed(sql, "artesp", tables("Bairro B"), { sha256: "second", stopsFile: "artesp-second.json", routingFile: "routing-artesp-second.json" });

    assert.equal(await activeSha256(sql, "artesp"), "second");
    const [version] = await sql<{ routing_file: string | null }[]>`select routing_file from public.feed_versions where feed = 'artesp'`;
    assert.equal(version.routing_file, "routing-artesp-second.json");
    const stop = ok(await member.client.rpc("get_stop", { p_stop_id: "ar:9", p_at: "2026-10-19T12:00:00-03:00" }), "get_stop");
    assert.deepEqual(stop, {
      id: "ar:9",
      name: "Rua B, 1",
      mode: "emtu",
      lat: -23.6,
      lon: -46.5,
      favorite: false,
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
          departures: null,
        },
      ],
    });
    const route = ok(await member.client.rpc("get_route", { p_route_id: "ar:001" }), "get_route") as {
      patterns: { direction_id: number; headsign: string; polyline: string; stops: { id: string }[] }[];
    };
    assert.deepEqual(
      route.patterns.map(({ direction_id, headsign, polyline, stops }) => ({
        direction_id,
        headsign,
        polyline: decodePolyline(polyline),
        stops: stops.map((stop) => stop.id),
      })),
      [{ direction_id: 1, headsign: "Bairro B", polyline: [[-23.6, -46.5], [-23.61, -46.51]], stops: ["ar:9"] }],
    );
  } finally {
    await sql`delete from public.stops where feed = 'artesp'`;
    await sql`delete from public.routes where feed = 'artesp'`;
    await sql`delete from public.feed_versions where feed = 'artesp'`;
  }
});

type FavoriteRow = { stop_id: string; stop: { id: string; favorite: boolean } | null };

async function favoritesOf(user: User): Promise<string[]> {
  const rows = ok(await user.client.rpc("get_favorites"), "get_favorites") as FavoriteRow[];
  return rows.map((row) => row.stop_id);
}

test("favorites keep their order and belong only to their user", async () => {
  ok(await member.client.rpc("add_favorite", { p_stop_id: stopId }), "add first");
  ok(await member.client.rpc("add_favorite", { p_stop_id: squareId }), "add second");
  ok(await member.client.rpc("add_favorite", { p_stop_id: stopId }), "add again");
  assert.deepEqual(await favoritesOf(member), [stopId, squareId]);

  const rows = ok(await member.client.rpc("get_favorites"), "get_favorites") as FavoriteRow[];
  assert.deepEqual(rows.map((row) => [row.stop?.id, row.stop?.favorite]), [[stopId, true], [squareId, true]]);

  assert.deepEqual(await favoritesOf(other), []);
  assert.deepEqual(ok(await other.client.from("favorites").select("stop_id"), "other select favorites"), []);
  const seenByOther = ok(await other.client.rpc("get_stop", { p_stop_id: stopId }), "other get_stop") as FavoriteRow["stop"];
  assert.equal(seenByOther?.favorite, false);

  ok(await member.client.rpc("reorder_favorites", { p_stop_ids: [squareId, stopId] }), "reorder");
  assert.deepEqual(await favoritesOf(member), [squareId, stopId]);

  ok(await other.client.rpc("remove_favorite", { p_stop_id: stopId }), "other remove");
  assert.deepEqual(await favoritesOf(member), [squareId, stopId]);
  ok(await member.client.rpc("remove_favorite", { p_stop_id: stopId }), "remove");
  assert.deepEqual(await favoritesOf(member), [squareId]);
});

test("favorite RPCs refuse an unknown stop and an incomplete order", async () => {
  refused(await member.client.rpc("add_favorite", { p_stop_id: "sp:none" }), "AL002", /unknown stop/, "unknown stop");
  const current = await favoritesOf(member);
  refused(await member.client.rpc("reorder_favorites", { p_stop_ids: [] }), "AL004", /every favorite once/, "empty order");
  const doubled = [...current, ...current];
  refused(await member.client.rpc("reorder_favorites", { p_stop_ids: doubled }), "AL004", /every favorite once/, "doubled order");
  assert.deepEqual(await favoritesOf(member), current);
});

test("nobody writes favorites directly", async () => {
  for (const [role, client] of [["anon", anon], ["member", member.client]] as const) {
    const table = () => client.from("favorites");
    refused(await table().insert({ user_id: member.id, stop_id: stopId, position: 9 }), "42501", DENIED, `${role} insert`);
    refused(await table().update({ position: 9 }).eq("user_id", member.id), "42501", DENIED, `${role} update`);
    refused(await table().delete().eq("user_id", member.id), "42501", DENIED, `${role} delete`);
  }
  refused(await anon.from("favorites").select("stop_id"), "42501", DENIED, "anon select");
});

test("get_route returns the pattern stops in order", async () => {
  const route = ok(await member.client.rpc("get_route", { p_route_id: busId }), "get_route") as {
    short_name: string;
    patterns: { headsign: string; stops: { id: string; name: string }[] }[];
  };
  assert.equal(route.short_name, `R${run}`);
  assert.deepEqual(
    route.patterns.map((pattern) => [pattern.headsign, pattern.stops.map((stop) => stop.id)]),
    [["Jd. B", [squareId, stopId]]],
  );
  assert.equal(ok(await member.client.rpc("get_route", { p_route_id: "sp:none" }), "unknown route"), null);
});

test("search finds lines by sign and stops by name, without accents", async () => {
  type Found = { routes: { id: string }[]; stops: { id: string }[] };
  const byLine = ok(await member.client.rpc("search", { p_query: `r${run}` }), "search line") as Found;
  assert.deepEqual(byLine.routes.map((route) => route.id), [busId]);

  const byStop = ok(await member.client.rpc("search", { p_query: `PRACA DA SE ${run}` }), "search stop") as Found;
  assert.deepEqual(byStop.stops.map((stop) => stop.id), [squareId]);

  const short = ok(await member.client.rpc("search", { p_query: "s" }), "short query") as Found;
  assert.deepEqual(short, { routes: [], stops: [] });
  const wildcard = ok(await member.client.rpc("search", { p_query: "%%" }), "wildcard query") as Found;
  assert.deepEqual(wildcard, { routes: [], stops: [] });
});

test("get_stop_eta returns the SPTrans bus patterns that pass the stop", async () => {
  const patterns = ok(await member.client.rpc("get_stop_eta", { p_stop_id: stopId }), "get_stop_eta");
  assert.deepEqual(patterns, [
    { route_id: busId, direction_id: 0, polyline: "_p~iF~ps|U", stop_offsets_m: [0, 500], stop_indexes: [1], run_time_s: 120, circular: true, paces: null, samples: null, factor: null },
  ]);
  assert.deepEqual(ok(await member.client.rpc("get_stop_eta", { p_stop_id: squareId }), "get_stop_eta without stop_routes"), []);
});

test("savePaces merges calibration rows and get_stop_eta returns the paces of the current hour", async () => {
  const [pattern] = (await loadCalibrationPatterns(sql)).filter((row) => row.route_id === busId);
  assert.deepEqual([pattern.stop_offsets_m, pattern.circular], [[0, 500], true]);
  const totals = { pattern, dayType: "weekday" as const, hour: 12, seconds: [150], meters: [500] };
  assert.equal(await savePaces(sql, [totals]), 1);
  assert.equal(await savePaces(sql, [totals]), 1);
  const pacesAt = async (time: string) => {
    const [line] = ok(await member.client.rpc("get_stop_eta", { p_stop_id: stopId, p_at: time }), `get_stop_eta at ${time}`) as {
      paces: number[] | null;
      samples: number[] | null;
    }[];
    return [line.paces, line.samples];
  };
  assert.deepEqual(await pacesAt("2026-10-19T12:30:00-03:00"), [[300], [2]]);
  const [factor] = await sql`select factor, segments from public.eta_factors where day_type = 'weekday' and hour = 12`;
  assert.deepEqual([factor.factor, factor.segments], [1.25, 1]);
  assert.deepEqual(await pacesAt("2026-10-19T13:30:00-03:00"), [null, null]);
  await sql`update public.eta_paces set stops_key = 'old' where route_id = ${busId}`;
  assert.deepEqual(await pacesAt("2026-10-19T12:30:00-03:00"), [null, null]);
});

test("get_line_eta returns the pattern of one SPTrans bus line direction", async () => {
  const line = ok(await member.client.rpc("get_line_eta", { p_route_id: busId, p_direction_id: 0 }), "get_line_eta") as Record<string, unknown>;
  assert.deepEqual([line.route_id, line.direction_id, line.stop_offsets_m, line.run_time_s, line.circular], [busId, 0, [0, 500], 120, true]);
  assert.equal(ok(await member.client.rpc("get_line_eta", { p_route_id: busId, p_direction_id: 1 }), "other direction"), null);
  assert.equal(ok(await member.client.rpc("get_line_eta", { p_route_id: nightId, p_direction_id: 0 }), "line without pattern"), null);
});

test("get_stop_eta and get_line_eta return the factor of the hour, or the median of all hours", async (t) => {
  t.after(() => sql`delete from public.eta_factors where (day_type, hour) in (('sunday', 3), ('sunday', 4))`);
  await sql`insert into public.eta_factors (day_type, hour, factor, segments) values ('sunday', 3, 0.5, 300), ('sunday', 4, 0.7, 100)`;
  const factorAt = async (time: string) => {
    const [line] = ok(await member.client.rpc("get_stop_eta", { p_stop_id: stopId, p_at: time }), `get_stop_eta at ${time}`) as { factor: number | null }[];
    const route = ok(await member.client.rpc("get_line_eta", { p_route_id: busId, p_direction_id: 0, p_at: time }), "get_line_eta") as { factor: number | null };
    assert.equal(route.factor, line.factor);
    return line.factor;
  };
  assert.equal(await factorAt("2026-10-18T03:30:00-03:00"), 0.5);
  assert.equal(await factorAt("2026-10-18T04:30:00-03:00"), 0.5);
});

test("anon cannot execute the favorite, route or search RPCs", async () => {
  const calls: [string, Record<string, unknown>][] = [
    ["add_favorite", { p_stop_id: stopId }],
    ["remove_favorite", { p_stop_id: stopId }],
    ["reorder_favorites", { p_stop_ids: [stopId] }],
    ["get_favorites", {}],
    ["get_route", { p_route_id: busId }],
    ["search", { p_query: "se" }],
    ["get_stop_eta", { p_stop_id: stopId }],
    ["get_line_eta", { p_route_id: busId, p_direction_id: 0 }],
    ["eta_factor", { p_day_type: "weekday", p_hour: 12 }],
  ];
  for (const [fn, args] of calls) {
    refused(await anon.rpc(fn, args), "42501", DENIED, `anon ${fn}`);
  }
});

test("get_stop lists the next four timetable departures and sorts lines by the next one", async () => {
  const departuresAt = async (time: string) => {
    const stop = ok(await member.client.rpc("get_stop", { p_stop_id: squareId, p_at: time }), `get_stop at ${time}`) as {
      lines: { route_id: string; headway_s: number | null; departures: number[] | null }[];
    };
    return stop.lines.map((line) => [line.route_id, line.headway_s, line.departures]);
  };

  assert.deepEqual(await departuresAt("2026-10-19T12:05:00-03:00"), [
    [emtu2Id, null, [120]],
    [emtuId, null, [300, 3900, 45300]],
  ]);
  assert.deepEqual(await departuresAt("2026-10-20T00:35:00-03:00"), [
    [emtuId, null, [300, 41700, 45300, 86700]],
    [emtu2Id, null, [41520]],
  ]);
  assert.deepEqual(await departuresAt("2026-10-18T12:05:00-03:00"), [
    [emtuId, null, []],
    [emtu2Id, null, []],
  ]);

  const frequencyLine = ok(await member.client.rpc("get_stop", { p_stop_id: stopId }), "get_stop of a frequency stop") as {
    lines: { departures: number[] | null }[];
  };
  assert.ok(frequencyLine.lines.every((line) => line.departures === null));
});
