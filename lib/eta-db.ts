import type { Sql } from "postgres";
import { mergeRow, type CalibrationPattern, type PaceRow, type Totals } from "./eta-calibration.ts";

const INT2 = 21;
const FLOAT4 = 700;
const CHUNK_ROWS = 500;

export async function loadCalibrationPatterns(sql: Sql): Promise<CalibrationPattern[]> {
  const rows = await sql<CalibrationPattern[]>`
    select
      p.route_id,
      p.direction_id,
      p.polyline,
      p.stop_offsets_m,
      md5(array_to_string(p.stop_ids, ',')) as stops_key,
      not exists (
        select 1 from public.route_patterns o where o.route_id = p.route_id and o.direction_id <> p.direction_id) as circular
    from public.route_patterns p
    join public.routes r on r.id = p.route_id
    where r.feed = 'sptrans' and r.mode = 'bus' and p.stop_offsets_m is not null`;
  return [...rows];
}

export async function savePaces(sql: Sql, drained: Totals[]): Promise<number> {
  const groups = new Map<string, Totals[]>();
  for (const totals of drained) {
    const key = `${totals.dayType}|${totals.hour}`;
    groups.set(key, [...(groups.get(key) ?? []), totals]);
  }
  let written = 0;
  for (const group of groups.values()) {
    const { dayType, hour } = group[0];
    const existing = await sql<PaceRow[]>`
      select route_id, direction_id, day_type, hour, stops_key, pace_s_per_km, samples
      from public.eta_paces
      where day_type = ${dayType} and hour = ${hour}`;
    const byLine = new Map(existing.map((row) => [`${row.route_id}|${row.direction_id}`, row]));
    const rows = group.map((totals) => mergeRow(byLine.get(`${totals.pattern.route_id}|${totals.pattern.direction_id}`), totals));
    for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
      const chunk = rows.slice(i, i + CHUNK_ROWS).map((row) => ({
        ...row,
        pace_s_per_km: sql.array(row.pace_s_per_km, INT2),
        samples: sql.array(row.samples, FLOAT4),
      }));
      await sql`
        insert into public.eta_paces ${sql(chunk)}
        on conflict (route_id, direction_id, day_type, hour) do update
          set stops_key = excluded.stops_key,
              pace_s_per_km = excluded.pace_s_per_km,
              samples = excluded.samples,
              updated_at = now()`;
    }
    written += rows.length;
  }
  return written;
}
