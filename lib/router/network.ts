import type { DayType, FeedTables } from "../gtfs/build.ts";
import type { MapStop } from "../stops-file.ts";
import { MODES, type Feed, type Mode } from "../transit.ts";

export const NETWORK_VERSION = 1;
export const DAY_TYPES: readonly DayType[] = ["weekday", "saturday", "sunday"];

export type NetworkRoute = [id: string, shortName: string, color: string | null, textColor: string | null, mode: number];

export type FrequencyEntry = [
  route: number,
  direction: number,
  headsign: string,
  stops: number[],
  offsetsM: number[],
  runTimeS: number,
  windows: number[],
];

export type TimetableEntry = [
  route: number,
  direction: number,
  headsign: string,
  stops: number[],
  offsetsS: number[],
  starts: [number[], number[], number[]],
];

export type NetworkFile = {
  version: number;
  feed: Feed;
  routes: NetworkRoute[];
  stops: string[];
  frequency: FrequencyEntry[];
  timetable: TimetableEntry[];
};

export type RouteInfo = { id: string; shortName: string; color: string | null; textColor: string | null; mode: Mode };

export type Window = { day: number; startMin: number; endMin: number; headwayS: number };

type PatternBase = { route: number; direction: number; headsign: string; stops: Int32Array };

export type FrequencyPattern = PatternBase & { kind: "frequency"; offsetsM: Float64Array; runTimeS: number; windows: Window[] };

export type TimetablePattern = PatternBase & { kind: "timetable"; offsetsS: Int32Array; starts: Int32Array[] };

export type Pattern = FrequencyPattern | TimetablePattern;

export type Network = {
  stopIds: string[];
  stopIndex: Map<string, number>;
  names: string[];
  lat: Float64Array;
  lon: Float64Array;
  routes: RouteInfo[];
  patterns: Pattern[];
  stopPatterns: { pattern: number; position: number }[][];
};

export function buildNetwork(feed: Feed, tables: FeedTables): NetworkFile {
  const routeIndex = new Map(tables.routes.map((route, index) => [route.id, index]));
  const stops: string[] = [];
  const stopIndex = new Map<string, number>();
  const indexOf = (id: string) => {
    let index = stopIndex.get(id);
    if (index === undefined) {
      index = stops.length;
      stops.push(id);
      stopIndex.set(id, index);
    }
    return index;
  };

  const windows = new Map<string, number[]>();
  for (const row of tables.headways) {
    const key = `${row.route_id}|${row.direction_id}`;
    windows.set(key, [...(windows.get(key) ?? []), DAY_TYPES.indexOf(row.day_type), row.start_min, row.end_min, row.headway_s]);
  }
  const frequency: FrequencyEntry[] = tables.patterns
    .filter((pattern) => windows.has(`${pattern.route_id}|${pattern.direction_id}`))
    .map((pattern) => [
      routeIndex.get(pattern.route_id)!,
      pattern.direction_id,
      pattern.headsign,
      pattern.stop_ids.map(indexOf),
      pattern.stop_offsets_m,
      pattern.run_time_s,
      windows.get(`${pattern.route_id}|${pattern.direction_id}`)!,
    ]);

  const timetableStops = new Map<string, { index: number; stop: string; offset: number }[]>();
  for (const row of tables.timetableStops) {
    timetableStops.set(row.pattern_id, [
      ...(timetableStops.get(row.pattern_id) ?? []),
      { index: row.stop_index, stop: row.stop_id, offset: row.offset_s },
    ]);
  }
  const starts = new Map<string, [number[], number[], number[]]>();
  for (const row of tables.timetableTrips) {
    const lists = starts.get(row.pattern_id) ?? [[], [], []];
    lists[DAY_TYPES.indexOf(row.day_type)].push(row.start_s);
    starts.set(row.pattern_id, lists);
  }
  const timetable: TimetableEntry[] = tables.timetablePatterns.map((pattern) => {
    const sequence = (timetableStops.get(pattern.id) ?? []).toSorted((a, b) => a.index - b.index);
    const lists = starts.get(pattern.id) ?? [[], [], []];
    return [
      routeIndex.get(pattern.route_id)!,
      pattern.direction_id,
      pattern.headsign,
      sequence.map((entry) => indexOf(entry.stop)),
      sequence.map((entry) => entry.offset),
      [lists[0].toSorted((a, b) => a - b), lists[1].toSorted((a, b) => a - b), lists[2].toSorted((a, b) => a - b)],
    ];
  });

  return {
    version: NETWORK_VERSION,
    feed,
    routes: tables.routes.map((route) => [route.id, route.short_name, route.color, route.text_color, MODES.indexOf(route.mode)]),
    stops,
    frequency,
    timetable,
  };
}

export function loadNetwork(files: NetworkFile[], mapStops: MapStop[]): Network {
  const stopIds: string[] = [];
  const stopIndex = new Map<string, number>();
  const names: string[] = [];
  const lats: number[] = [];
  const lons: number[] = [];
  const add = (id: string, name: string, lat: number, lon: number) => {
    let index = stopIndex.get(id);
    if (index === undefined) {
      index = stopIds.length;
      stopIds.push(id);
      stopIndex.set(id, index);
      names.push(name);
      lats.push(lat);
      lons.push(lon);
    }
    return index;
  };
  for (const stop of mapStops) {
    add(stop.id, stop.name, stop.lat, stop.lon);
  }

  const routes: RouteInfo[] = [];
  const patterns: Pattern[] = [];
  for (const file of files) {
    if (file.version !== NETWORK_VERSION) {
      throw new Error(`routing file version ${file.version} is not ${NETWORK_VERSION}`);
    }
    const routeOffset = routes.length;
    routes.push(...file.routes.map(([id, shortName, color, textColor, mode]) => ({ id, shortName, color, textColor, mode: MODES[mode] })));
    const globalStops = file.stops.map((id) => add(id, id, NaN, NaN));
    for (const [route, direction, headsign, stops, offsetsM, runTimeS, flat] of file.frequency) {
      const windows: Window[] = [];
      for (let i = 0; i < flat.length; i += 4) {
        windows.push({ day: flat[i], startMin: flat[i + 1], endMin: flat[i + 2], headwayS: flat[i + 3] });
      }
      patterns.push({
        kind: "frequency",
        route: routeOffset + route,
        direction,
        headsign,
        stops: Int32Array.from(stops, (stop) => globalStops[stop]),
        offsetsM: Float64Array.from(offsetsM),
        runTimeS,
        windows,
      });
    }
    for (const [route, direction, headsign, stops, offsetsS, starts] of file.timetable) {
      patterns.push({
        kind: "timetable",
        route: routeOffset + route,
        direction,
        headsign,
        stops: Int32Array.from(stops, (stop) => globalStops[stop]),
        offsetsS: Int32Array.from(offsetsS),
        starts: starts.map((list) => Int32Array.from(list)),
      });
    }
  }

  const stopPatterns: { pattern: number; position: number }[][] = stopIds.map(() => []);
  patterns.forEach((pattern, index) => {
    pattern.stops.forEach((stop, position) => stopPatterns[stop].push({ pattern: index, position }));
  });

  return { stopIds, stopIndex, names, lat: Float64Array.from(lats), lon: Float64Array.from(lons), routes, patterns, stopPatterns };
}
