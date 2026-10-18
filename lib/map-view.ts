import { decodePolyline } from "./polyline.ts";
import type { RouteDetails } from "./transit.ts";

export type MapView = { stop: string | null; route: string | null; dir: number };

export const DEFAULT_ROUTE_COLOR = "#334155";

export const SHEET_SHARE = 0.5;

export function mapHref(view: MapView): string {
  const params = new URLSearchParams();
  if (view.stop) {
    params.set("stop", view.stop);
  }
  if (view.route) {
    params.set("route", view.route);
    params.set("dir", String(view.dir));
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export function parseMapView(params: { get(name: string): string | null }): MapView {
  return { stop: params.get("stop"), route: params.get("route"), dir: params.get("dir") === "1" ? 1 : 0 };
}

export function patternOf(route: RouteDetails, dir: number) {
  return route.patterns.find((pattern) => pattern.direction_id === dir) ?? route.patterns[0] ?? null;
}

export function routeGeoJSON(route: RouteDetails, dir: number) {
  const pattern = patternOf(route, dir);
  const color = route.color ?? DEFAULT_ROUTE_COLOR;
  const line = pattern ? decodePolyline(pattern.polyline).map(([lat, lon]) => [lon, lat]) : [];
  const bounds = line.reduce(
    ([minLon, minLat, maxLon, maxLat], [lon, lat]) => [
      Math.min(minLon, lon),
      Math.min(minLat, lat),
      Math.max(maxLon, lon),
      Math.max(maxLat, lat),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  ) as [number, number, number, number];
  return {
    bounds: line.length > 0 ? bounds : null,
    data: {
      type: "FeatureCollection" as const,
      features: [
        ...(line.length >= 2
          ? [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: line }, properties: { color } }]
          : []),
        ...(pattern?.stops ?? []).map((stop) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [stop.lon, stop.lat] },
          properties: { id: stop.id, name: stop.name, color },
        })),
      ],
    },
  };
}
