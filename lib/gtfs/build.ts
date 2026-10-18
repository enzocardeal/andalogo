import { encodePolyline, type LatLon } from "../polyline.ts";
import type { MapStop } from "../stops-file.ts";
import { FEED_PREFIX, RAIL_MODES, type Feed, type Mode } from "../transit.ts";
import { simplify } from "./simplify.ts";
import type { Row } from "./zip.ts";

export type DayType = "weekday" | "saturday" | "sunday";

export type StopRow = MapStop & { feed: Feed; gtfs_stop_id: string };

export type RouteRow = {
  id: string;
  feed: Feed;
  short_name: string;
  long_name: string;
  mode: Mode;
  color: string | null;
  text_color: string | null;
};

export type StopRouteRow = { stop_id: string; route_id: string; direction_id: number; headsign: string };

export type HeadwayRow = {
  route_id: string;
  direction_id: number;
  day_type: DayType;
  start_min: number;
  end_min: number;
  headway_s: number;
};

export type RoutePatternRow = {
  route_id: string;
  direction_id: number;
  headsign: string;
  polyline: string;
  stop_ids: string[];
};

export type FeedTables = {
  stops: StopRow[];
  routes: RouteRow[];
  stopRoutes: StopRouteRow[];
  headways: HeadwayRow[];
  patterns: RoutePatternRow[];
};

export type FeedInput = {
  stops: Row[];
  routes: Row[];
  trips: Row[];
  stopTimes: Row[];
  frequencies: Row[];
  calendar: Row[];
  shapes: Map<string, LatLon[]>;
};

type Trip = { routeId: string; directionId: number; headsign: string; serviceId: string; shapeId: string };

const SHAPE_TOLERANCE_M = 5;

const MODE_PRIORITY: readonly Mode[] = ["metro", "cptm", "emtu", "bus"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

export function modeOf(feed: Feed, routeType: string): Mode | null {
  if (feed === "artesp") {
    return routeType === "3" ? "emtu" : null;
  }
  switch (routeType) {
    case "1":
      return "metro";
    case "2":
      return "cptm";
    case "3":
      return "bus";
    default:
      return null;
  }
}

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function dayTypesOf(service: Row): DayType[] {
  const types: DayType[] = [];
  if (WEEKDAYS.some((day) => service[day] === "1")) {
    types.push("weekday");
  }
  if (service.saturday === "1") {
    types.push("saturday");
  }
  if (service.sunday === "1") {
    types.push("sunday");
  }
  return types;
}

function hexColor(value: string | undefined): string | null {
  return value ? `#${value.toUpperCase()}` : null;
}

export function buildFeed(feed: Feed, input: FeedInput): FeedTables {
  const prefix = FEED_PREFIX[feed];
  const idOf = (gtfsId: string) => `${prefix}:${gtfsId}`;

  const routes = new Map<string, RouteRow>();
  for (const row of input.routes) {
    const mode = modeOf(feed, row.route_type);
    if (mode) {
      routes.set(row.route_id, {
        id: idOf(row.route_id),
        feed,
        short_name: row.route_short_name || row.route_id,
        long_name: row.route_long_name ?? "",
        mode,
        color: hexColor(row.route_color),
        text_color: hexColor(row.route_text_color),
      });
    }
  }

  const trips = new Map<string, Trip>();
  for (const row of input.trips) {
    if (routes.has(row.route_id)) {
      trips.set(row.trip_id, {
        routeId: row.route_id,
        directionId: Number(row.direction_id || 0),
        headsign: row.trip_headsign ?? "",
        serviceId: row.service_id,
        shapeId: row.shape_id ?? "",
      });
    }
  }

  const stopRoutes = new Map<string, StopRouteRow>();
  const stopModes = new Map<string, { mode: Mode; color: string | null }>();
  const tripStops = new Map<string, [number, string][]>();
  for (const row of input.stopTimes) {
    const trip = trips.get(row.trip_id);
    if (!trip) {
      continue;
    }
    let sequence = tripStops.get(row.trip_id);
    if (!sequence) {
      sequence = [];
      tripStops.set(row.trip_id, sequence);
    }
    sequence.push([Number(row.stop_sequence), row.stop_id]);
    const route = routes.get(trip.routeId)!;
    const key = `${row.stop_id}|${trip.routeId}|${trip.directionId}`;
    if (!stopRoutes.has(key)) {
      stopRoutes.set(key, {
        stop_id: idOf(row.stop_id),
        route_id: route.id,
        direction_id: trip.directionId,
        headsign: trip.headsign,
      });
    }
    const current = stopModes.get(row.stop_id);
    if (!current || MODE_PRIORITY.indexOf(route.mode) < MODE_PRIORITY.indexOf(current.mode)) {
      stopModes.set(row.stop_id, { mode: route.mode, color: RAIL_MODES.includes(route.mode) ? route.color : null });
    }
  }

  const stops: StopRow[] = [];
  for (const row of input.stops) {
    const served = stopModes.get(row.stop_id);
    if (served) {
      stops.push({
        id: idOf(row.stop_id),
        feed,
        gtfs_stop_id: row.stop_id,
        name: row.stop_name,
        lat: Number(row.stop_lat),
        lon: Number(row.stop_lon),
        mode: served.mode,
        color: served.color,
      });
    }
  }

  const services = new Map(input.calendar.map((row) => [row.service_id, dayTypesOf(row)]));
  const windows = new Map<string, Row[]>();
  for (const row of input.frequencies) {
    if (trips.has(row.trip_id)) {
      windows.set(row.trip_id, [...(windows.get(row.trip_id) ?? []), row]);
    }
  }
  const headways: HeadwayRow[] = [];
  for (const [tripId, rows] of windows) {
    const trip = trips.get(tripId)!;
    const sorted = rows.toSorted((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    sorted.forEach((row, i) => {
      const start = minutesOf(row.start_time);
      // GTFS end times here are inclusive at minute level, so the window ends one minute later or at the next start.
      const next = sorted[i + 1];
      const end = Math.min(minutesOf(row.end_time) + 1, next ? minutesOf(next.start_time) : Infinity);
      if (end <= start) {
        return;
      }
      for (const dayType of services.get(trip.serviceId) ?? []) {
        headways.push({
          route_id: routes.get(trip.routeId)!.id,
          direction_id: trip.directionId,
          day_type: dayType,
          start_min: start,
          end_min: end,
          headway_s: Number(row.headway_secs),
        });
      }
    });
  }

  const coordinates = new Map(stops.map((stop): [string, LatLon] => [stop.gtfs_stop_id, [stop.lat, stop.lon]]));
  const patterns = buildPatterns(trips, tripStops).map(({ tripId, stopIds }): RoutePatternRow => {
    const trip = trips.get(tripId)!;
    const shape = input.shapes.get(trip.shapeId);
    const line = shape && shape.length >= 2 ? shape : stopIds.map((id) => coordinates.get(id)!);
    return {
      route_id: routes.get(trip.routeId)!.id,
      direction_id: trip.directionId,
      headsign: trip.headsign,
      polyline: encodePolyline(simplify(line, SHAPE_TOLERANCE_M)),
      stop_ids: stopIds.map(idOf),
    };
  });

  return { stops, routes: [...routes.values()], stopRoutes: [...stopRoutes.values()], headways, patterns };
}

function buildPatterns(trips: Map<string, Trip>, tripStops: Map<string, [number, string][]>) {
  const candidates = new Map<string, Map<string, { tripId: string; stopIds: string[]; count: number }>>();
  for (const [tripId, sequence] of tripStops) {
    const trip = trips.get(tripId)!;
    const stopIds = sequence.toSorted((a, b) => a[0] - b[0]).map(([, stopId]) => stopId);
    const key = `${trip.routeId}|${trip.directionId}`;
    const signature = stopIds.join(">");
    let byRoute = candidates.get(key);
    if (!byRoute) {
      byRoute = new Map();
      candidates.set(key, byRoute);
    }
    const seen = byRoute.get(signature);
    if (seen) {
      seen.count++;
    } else {
      byRoute.set(signature, { tripId, stopIds, count: 1 });
    }
  }
  return [...candidates.values()].map((byRoute) =>
    [...byRoute.values()].reduce((best, candidate) => (candidate.count > best.count ? candidate : best)),
  );
}
