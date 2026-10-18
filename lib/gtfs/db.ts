import type { Sql, TransactionSql } from "postgres";
import type { Feed } from "../transit.ts";
import type { FeedTables } from "./build.ts";

const CHUNK_ROWS = 1000;
const INT4 = 23;

export type FeedVersion = { sha256: string; stopsFile: string };

export async function activeSha256(sql: Sql, feed: Feed): Promise<string | null> {
  const [row] = await sql<{ sha256: string }[]>`select sha256 from public.feed_versions where feed = ${feed}`;
  return row?.sha256 ?? null;
}

async function insertAll(tx: TransactionSql, table: string, rows: readonly object[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const chunk = rows.slice(i, i + CHUNK_ROWS) as Record<string, unknown>[];
    await tx`insert into ${tx(`public.${table}`)} ${tx(chunk)}`;
  }
}

export async function replaceFeed(sql: Sql, feed: Feed, tables: FeedTables, version: FeedVersion): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`delete from public.stops where feed = ${feed}`;
    await tx`delete from public.routes where feed = ${feed}`;
    await insertAll(tx, "routes", tables.routes);
    await insertAll(tx, "stops", tables.stops);
    await insertAll(tx, "stop_routes", tables.stopRoutes);
    await insertAll(tx, "headways", tables.headways);
    await insertAll(
      tx,
      "route_patterns",
      tables.patterns.map((pattern) => ({ ...pattern, stop_offsets_m: tx.array(pattern.stop_offsets_m, INT4) })),
    );
    await insertAll(tx, "timetable_patterns", tables.timetablePatterns);
    await insertAll(tx, "timetable_stops", tables.timetableStops);
    await insertAll(tx, "timetable_trips", tables.timetableTrips);
    await tx`
      insert into public.feed_versions (feed, sha256, stops_file)
      values (${feed}, ${version.sha256}, ${version.stopsFile})
      on conflict (feed) do update
        set sha256 = excluded.sha256, stops_file = excluded.stops_file, loaded_at = now()`;
  });
}
