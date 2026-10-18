import { listEntries, readAll as rows, readCsv } from "../lib/gtfs/zip.ts";

type Box = { minLat: number; maxLat: number; minLon: number; maxLon: number };

function isRail(routeType: string): boolean {
  const type = Number(routeType);
  return [0, 1, 2, 12].includes(type) || (type >= 100 && type < 200) || (type >= 400 && type < 500);
}

function count<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function grow(box: Box | undefined, lat: number, lon: number): Box {
  if (!box) {
    return { minLat: lat, maxLat: lat, minLon: lon, maxLon: lon };
  }
  return {
    minLat: Math.min(box.minLat, lat),
    maxLat: Math.max(box.maxLat, lat),
    minLon: Math.min(box.minLon, lon),
    maxLon: Math.max(box.maxLon, lon),
  };
}

function boxText(box: Box | undefined): string {
  if (!box) {
    return "-";
  }
  const f = (n: number) => n.toFixed(3);
  return `lat ${f(box.minLat)}..${f(box.maxLat)}, lon ${f(box.minLon)}..${f(box.maxLon)}`;
}

async function inspect(zip: string): Promise<void> {
  console.log(`\n# ${zip}\n\n## Files`);
  for (const entry of await listEntries(zip)) {
    console.log(`  ${entry.name.padEnd(22)} ${(entry.size / 1e6).toFixed(1).padStart(8)} MB`);
  }

  for (const row of await rows(zip, "feed_info.txt")) {
    console.log(`\n## feed_info\n  ${JSON.stringify(row)}`);
  }

  const calendar = await rows(zip, "calendar.txt");
  const starts = calendar.map((row) => row.start_date).sort();
  const ends = calendar.map((row) => row.end_date).sort();
  console.log(`\n## calendar: ${calendar.length} services, ${starts[0] ?? "-"} to ${ends.at(-1) ?? "-"}`);
  console.log(`  service_ids: ${calendar.slice(0, 12).map((row) => row.service_id).join(", ")}${calendar.length > 12 ? ", …" : ""}`);

  const agencies = await rows(zip, "agency.txt");
  const agencyNames = new Map(agencies.map((row) => [row.agency_id ?? "", row.agency_name]));
  console.log(`\n## agency: ${agencies.length}`);
  for (const row of agencies.slice(0, 40)) {
    console.log(`  ${row.agency_id ?? ""}  ${row.agency_name}`);
  }

  const routes = await rows(zip, "routes.txt");
  const typeCounts = new Map<string, number>();
  const routeAgency = new Map<string, string>();
  for (const route of routes) {
    count(typeCounts, route.route_type);
    routeAgency.set(route.route_id, route.agency_id ?? agencies[0]?.agency_id ?? "");
  }
  console.log(`\n## routes: ${routes.length}`);
  console.log(`  route_type counts: ${[...typeCounts].map(([type, n]) => `${type}=${n}`).join(", ")}`);
  console.log(`  examples: ${routes.slice(0, 5).map((route) => `${route.route_id} "${route.route_short_name}" "${route.route_long_name}"`).join(" | ")}`);
  const rail = routes.filter((route) => isRail(route.route_type));
  console.log(`  rail routes: ${rail.length}`);
  for (const route of rail) {
    console.log(`    ${route.route_id}  type=${route.route_type}  "${route.route_short_name}"  "${route.route_long_name}"  color=${route.route_color ?? ""}`);
  }

  const stops = new Map<string, { lat: number; lon: number }>();
  const locationTypes = new Map<string, number>();
  let allStops: Box | undefined;
  for await (const row of readCsv(zip, "stops.txt")) {
    const lat = Number(row.stop_lat);
    const lon = Number(row.stop_lon);
    stops.set(row.stop_id, { lat, lon });
    count(locationTypes, row.location_type || "0");
    allStops = grow(allStops, lat, lon);
  }
  console.log(`\n## stops: ${stops.size}`);
  console.log(`  location_type counts: ${[...locationTypes].map(([type, n]) => `${type}=${n}`).join(", ")}`);
  console.log(`  bounding box: ${boxText(allStops)}`);

  const tripRoute = new Map<string, string>();
  const directions = new Map<string, number>();
  for await (const row of readCsv(zip, "trips.txt")) {
    tripRoute.set(row.trip_id, row.route_id);
    count(directions, row.direction_id || "(empty)");
  }
  console.log(`\n## trips: ${tripRoute.size}`);
  console.log(`  direction_id counts: ${[...directions].map(([d, n]) => `${d}=${n}`).join(", ")}`);

  const frequencyTrips = new Set<string>();
  let frequencyRows = 0;
  for await (const row of readCsv(zip, "frequencies.txt")) {
    frequencyRows++;
    frequencyTrips.add(row.trip_id);
  }
  console.log(`\n## frequencies: ${frequencyRows} rows, ${frequencyTrips.size} of ${tripRoute.size} trips`);

  let stopTimes = 0;
  let timed = 0;
  const agencyStops = new Map<string, Set<string>>();
  const railStops = new Set<string>();
  const railRoutes = new Set(rail.map((route) => route.route_id));
  for await (const row of readCsv(zip, "stop_times.txt")) {
    stopTimes++;
    if (row.arrival_time) {
      timed++;
    }
    const routeId = tripRoute.get(row.trip_id);
    if (routeId === undefined) {
      continue;
    }
    const agency = routeAgency.get(routeId) ?? "";
    let served = agencyStops.get(agency);
    if (!served) {
      served = new Set();
      agencyStops.set(agency, served);
    }
    served.add(row.stop_id);
    if (railRoutes.has(routeId)) {
      railStops.add(row.stop_id);
    }
  }
  console.log(`\n## stop_times: ${stopTimes} rows, ${timed} with arrival_time`);
  console.log(`  stops served by rail routes: ${railStops.size}`);

  console.log("\n## stops served per agency");
  for (const [agency, served] of [...agencyStops].sort((a, b) => b[1].size - a[1].size)) {
    let box: Box | undefined;
    for (const id of served) {
      const stop = stops.get(id);
      if (stop) {
        box = grow(box, stop.lat, stop.lon);
      }
    }
    console.log(`  ${served.size.toString().padStart(6)}  ${agency} ${agencyNames.get(agency) ?? ""}  ${boxText(box)}`);
  }

  let shapePoints = 0;
  const shapes = new Set<string>();
  for await (const row of readCsv(zip, "shapes.txt")) {
    shapePoints++;
    shapes.add(row.shape_id);
  }
  console.log(`\n## shapes: ${shapes.size} shapes, ${shapePoints} points`);
}

const zips = process.argv.slice(2);
if (zips.length === 0) {
  console.error("usage: npm run gtfs:inspect -- <feed.zip> [<feed.zip> …]");
  process.exit(2);
}
for (const zip of zips) {
  await inspect(zip);
}
