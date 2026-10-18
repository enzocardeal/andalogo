import { readCsv } from "./zip.ts";

export type GtfsStop = { id: string; name: string; lat: number; lon: number };

export type GtfsNetwork = {
  stops: Map<string, GtfsStop>;
  routeTypes: Map<string, string>;
  stopRoutes: Map<string, Set<string>>;
};

export function routeKey(routeId: string, directionId: string | number): string {
  return `${routeId}|${directionId}`;
}

export async function loadNetwork(zipPath: string): Promise<GtfsNetwork> {
  const stops = new Map<string, GtfsStop>();
  for await (const row of readCsv(zipPath, "stops.txt")) {
    stops.set(row.stop_id, { id: row.stop_id, name: row.stop_name, lat: Number(row.stop_lat), lon: Number(row.stop_lon) });
  }

  const routeTypes = new Map<string, string>();
  for await (const row of readCsv(zipPath, "routes.txt")) {
    routeTypes.set(row.route_id, row.route_type);
  }

  const tripRoutes = new Map<string, string>();
  for await (const row of readCsv(zipPath, "trips.txt")) {
    tripRoutes.set(row.trip_id, routeKey(row.route_id, row.direction_id || "0"));
  }

  const stopRoutes = new Map<string, Set<string>>();
  for await (const row of readCsv(zipPath, "stop_times.txt")) {
    const key = tripRoutes.get(row.trip_id);
    if (key === undefined) {
      continue;
    }
    let keys = stopRoutes.get(row.stop_id);
    if (!keys) {
      keys = new Set();
      stopRoutes.set(row.stop_id, keys);
    }
    keys.add(key);
  }

  return { stops, routeTypes, stopRoutes };
}
