import { measure, pointAt, stopOffsets } from "./eta.ts";
import { DEFAULT_ROUTE_COLOR, patternOf } from "./map-view.ts";
import { decodePolyline } from "./polyline.ts";
import type { Trip, TripRide } from "./router/trips.ts";
import type { RouteDetails } from "./transit.ts";

type Bounds = [number, number, number, number];

export function rideLine(leg: TripRide, route: RouteDetails | undefined): [number, number][] {
  const pattern = route ? patternOf(route, leg.direction) : null;
  const points = pattern ? decodePolyline(pattern.polyline) : [];
  if (!pattern || points.length < 2) {
    return leg.path;
  }
  const shape = measure(points);
  const offsets = stopOffsets(
    shape,
    pattern.stops.map((stop) => [stop.lat, stop.lon]),
  );
  const board = pattern.stops.findIndex((stop) => stop.id === leg.from.id);
  const alight = pattern.stops.findIndex((stop, index) => index > board && stop.id === leg.to.id);
  if (board < 0 || alight < 0) {
    return leg.path;
  }
  const [start, end] = [offsets[board], offsets[alight]];
  const at = (alongM: number): [number, number] => {
    const { lat, lon } = pointAt(shape, alongM);
    return [lon, lat];
  };
  const inside = points.flatMap(([lat, lon], index): [number, number][] =>
    shape.cumulative[index] > start && shape.cumulative[index] < end ? [[lon, lat]] : [],
  );
  return [at(start), ...inside, at(end)];
}

export function tripGeoJSON(
  trip: Trip,
  routes: ReadonlyMap<string, RouteDetails> = new Map(),
): { bounds: Bounds; data: GeoJSON.FeatureCollection } {
  const features: GeoJSON.Feature[] = [];
  for (const leg of trip.legs) {
    if (leg.kind === "walk") {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [leg.from.lon, leg.from.lat],
            [leg.to.lon, leg.to.lat],
          ],
        },
        properties: { kind: "walk" },
      });
      continue;
    }
    const color = leg.line.color ?? DEFAULT_ROUTE_COLOR;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: rideLine(leg, routes.get(leg.line.id)) },
      properties: { kind: "ride", color },
    });
    for (const place of [leg.from, leg.to]) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [place.lon, place.lat] },
        properties: { kind: "stop", color, id: place.id },
      });
    }
  }
  const points = features.flatMap((feature) =>
    feature.geometry.type === "LineString"
      ? feature.geometry.coordinates
      : feature.geometry.type === "Point"
        ? [feature.geometry.coordinates]
        : [],
  );
  const bounds = points.reduce<Bounds>(
    ([west, south, east, north], [lon, lat]) => [Math.min(west, lon), Math.min(south, lat), Math.max(east, lon), Math.max(north, lat)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  return { bounds, data: { type: "FeatureCollection", features } };
}
