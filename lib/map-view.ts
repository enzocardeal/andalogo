import { decodePolyline } from "./polyline.ts";
import type { RouteDetails } from "./transit.ts";

export type NearPlace = { lat: number; lon: number; label: string };

export type TripView = { to: NearPlace; from: NearPlace | null; at: number | null };

export type MapView = { stop: string | null; route: string | null; dir: number; near?: NearPlace | null; trip?: TripView | null };

export const DEFAULT_ROUTE_COLOR = "#334155";

export const SHEET_SHARE = 0.45;

export function mapHref(view: MapView): string {
  const params = new URLSearchParams();
  if (view.stop) {
    params.set("stop", view.stop);
  }
  if (view.route) {
    params.set("route", view.route);
    params.set("dir", String(view.dir));
  }
  if (view.near) {
    params.set("near", `${view.near.lat.toFixed(5)},${view.near.lon.toFixed(5)}`);
    params.set("label", view.near.label);
  }
  if (view.trip) {
    params.set("to", `${view.trip.to.lat.toFixed(5)},${view.trip.to.lon.toFixed(5)}`);
    params.set("toLabel", view.trip.to.label);
    if (view.trip.from) {
      params.set("from", `${view.trip.from.lat.toFixed(5)},${view.trip.from.lon.toFixed(5)}`);
      params.set("fromLabel", view.trip.from.label);
    }
    if (view.trip.at !== null) {
      params.set("at", String(view.trip.at));
    }
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function parseNear(near: string | null, label: string | null): NearPlace | null {
  const [lat, lon] = (near ?? "").split(",").map(Number);
  return near && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, label: label ?? "" } : null;
}

function parseTrip(params: { get(name: string): string | null }): TripView | null {
  const to = parseNear(params.get("to"), params.get("toLabel"));
  if (!to) {
    return null;
  }
  const at = Number(params.get("at"));
  return { to, from: parseNear(params.get("from"), params.get("fromLabel")), at: params.get("at") && Number.isFinite(at) ? at : null };
}

export function parseMapView(params: { get(name: string): string | null }): MapView {
  return {
    stop: params.get("stop"),
    route: params.get("route"),
    dir: params.get("dir") === "1" ? 1 : 0,
    near: parseNear(params.get("near"), params.get("label")),
    trip: parseTrip(params),
  };
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
