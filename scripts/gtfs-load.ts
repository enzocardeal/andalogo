import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { buildFeed } from "../lib/gtfs/build.ts";
import { activeSha256, replaceFeed } from "../lib/gtfs/db.ts";
import { readAll } from "../lib/gtfs/zip.ts";
import { encodeStops, STOPS_BUCKET } from "../lib/stops-file.ts";
import { createAdminClient } from "../lib/supabase/admin.ts";

const ONE_YEAR_S = "31536000";

const { values } = parseArgs({
  options: {
    feed: { type: "string" },
    zip: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

const dbUrl = process.env.SUPABASE_DB_URL;
if (values.feed !== "sptrans" || !values.zip || !dbUrl) {
  console.error("usage: SUPABASE_DB_URL=... npm run gtfs:load -- --feed sptrans --zip <feed.zip> [--force]");
  process.exit(2);
}
const feed = values.feed;
const zip = values.zip;

const sha256 = createHash("sha256").update(await readFile(zip)).digest("hex");
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
try {
  if (!values.force && (await activeSha256(sql, feed)) === sha256) {
    console.log(`${feed}: the active version already has sha256 ${sha256}. Use --force to load it again.`);
  } else {
    const tables = buildFeed(feed, {
      stops: await readAll(zip, "stops.txt"),
      routes: await readAll(zip, "routes.txt"),
      trips: await readAll(zip, "trips.txt"),
      stopTimes: await readAll(zip, "stop_times.txt"),
      frequencies: await readAll(zip, "frequencies.txt"),
      calendar: await readAll(zip, "calendar.txt"),
    });
    console.log(
      `${feed}: ${tables.stops.length} stops, ${tables.routes.length} routes, ` +
        `${tables.stopRoutes.length} stop routes, ${tables.headways.length} headways`,
    );

    const storage = createAdminClient().storage;
    if ((await storage.getBucket(STOPS_BUCKET)).error) {
      const { error } = await storage.createBucket(STOPS_BUCKET, { public: true });
      if (error) {
        throw error;
      }
    }
    const stopsFile = `${feed}-${sha256.slice(0, 12)}.json`;
    const body = new Blob([encodeStops(tables.stops)], { type: "application/json" });
    const { error } = await storage
      .from(STOPS_BUCKET)
      .upload(stopsFile, body, { contentType: "application/json", cacheControl: ONE_YEAR_S, upsert: true });
    if (error) {
      throw error;
    }
    console.log(`${feed}: uploaded ${stopsFile} (${(body.size / 1e6).toFixed(2)} MB)`);

    await replaceFeed(sql, feed, tables, { sha256, stopsFile });
    console.log(`${feed}: loaded version ${sha256.slice(0, 12)}`);
  }
} finally {
  await sql.end();
}
