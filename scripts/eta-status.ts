import postgres from "postgres";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("usage: SUPABASE_DB_URL=... npm run eta:status");
  process.exit(2);
}

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
try {
  const rows = await sql<{ day_type: string; hour: number; lines: number; traversals: number; updated: Date }[]>`
    select
      day_type,
      hour,
      count(*)::int as lines,
      round(sum((select sum(s) from unnest(samples) as s)))::int as traversals,
      max(updated_at) as updated
    from public.eta_paces
    group by day_type, hour
    order by array_position(array['weekday', 'saturday', 'sunday'], day_type), hour`;
  const [{ size }] = await sql<{ size: string }[]>`select pg_size_pretty(pg_total_relation_size('public.eta_paces')) as size`;
  if (rows.length === 0) {
    console.log("eta_paces is empty.");
  }
  for (const row of rows) {
    const hour = String(row.hour).padStart(2, "0");
    console.log(`${row.day_type.padEnd(8)} ${hour}h  ${String(row.lines).padStart(5)} lines  ${String(row.traversals).padStart(7)} segment traversals  last ${row.updated.toISOString()}`);
  }
  console.log(`table size: ${size}`);
} finally {
  await sql.end();
}
