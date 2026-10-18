import { readCsv } from "./zip.ts";

export type TripStops = { stopIds: string[]; departures: number[] };

export function secondsOf(time: string): number {
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return hours * 3600 + minutes * 60 + (seconds || 0);
}

export async function readTripStops(path: string, tripIds: Set<string>): Promise<Map<string, TripStops>> {
  const result = new Map<string, TripStops>();
  const stopIds = new Map<string, string>();
  const seen = new Set<string>();
  let current = "";
  let rows: [number, string, number][] = [];

  const finish = () => {
    if (rows.length === 0) {
      return;
    }
    rows.sort((a, b) => a[0] - b[0]);
    result.set(current, { stopIds: rows.map(([, stopId]) => stopId), departures: rows.map(([, , time]) => time) });
    rows = [];
  };

  for await (const row of readCsv(path, "stop_times.txt")) {
    if (row.trip_id !== current) {
      finish();
      if (seen.has(row.trip_id)) {
        throw new Error(`stop_times.txt is not grouped by trip_id: ${row.trip_id} appears twice`);
      }
      seen.add(row.trip_id);
      current = row.trip_id;
    }
    if (!tripIds.has(row.trip_id)) {
      continue;
    }
    let stopId = stopIds.get(row.stop_id);
    if (stopId === undefined) {
      stopId = row.stop_id;
      stopIds.set(stopId, stopId);
    }
    rows.push([Number(row.stop_sequence), stopId, secondsOf(row.departure_time || row.arrival_time)]);
  }
  finish();
  return result;
}
