import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
} from "maplibre-gl";
import type { Scheme } from "./map-style.ts";
import type { MapStop } from "./stops-file.ts";

export const STOPS_SOURCE = "stops";
export const ROUTE_SOURCE = "route";
export const SELECTED_LAYER = "selected-stop";
export const FAVORITE_LAYER = "favorite-stops";
export const FAVORITE_BADGE_LAYER = "favorite-badges";
export const FAVORITE_IMAGE = "favorite-star";
export const CLICKABLE_LAYERS = ["rail-stations", "bus-stops", "route-stops", FAVORITE_LAYER, FAVORITE_BADGE_LAYER];

const IS_RAIL: ExpressionSpecification = ["in", ["get", "mode"], ["literal", ["metro", "cptm"]]];
const FAVORITE_MIN_ZOOM = 11;
const BUS_MIN_ZOOM = 15;

type Colors = {
  busFill: string;
  busStroke: string;
  emtuStroke: string;
  railStroke: string;
  label: string;
  labelHalo: string;
  selected: string;
  routeStopFill: string;
};

const COLORS: Record<Scheme, Colors> = {
  light: {
    busFill: "#ffffff",
    busStroke: "#334155",
    emtuStroke: "#1d4ed8",
    railStroke: "#ffffff",
    label: "#0f172a",
    labelHalo: "#ffffff",
    selected: "#0f172a",
    routeStopFill: "#ffffff",
  },
  dark: {
    busFill: "#1e293b",
    busStroke: "#cbd5e1",
    emtuStroke: "#60a5fa",
    railStroke: "#0f172a",
    label: "#e2e8f0",
    labelHalo: "#0f172a",
    selected: "#f8fafc",
    routeStopFill: "#1e293b",
  },
};

export const FAVORITE_BADGE_COLOR = "#f97316";

export const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function stopsSource(stops: MapStop[]): GeoJSONSourceSpecification {
  return {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: stops.map((stop) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
        properties: { id: stop.id, name: stop.name, mode: stop.mode, color: stop.color },
      })),
    },
  };
}

export function selectedFilter(stopId: string | null): FilterSpecification {
  return ["==", ["get", "id"], stopId ?? ""];
}

export function favoriteFilter(stopIds: Iterable<string>): FilterSpecification {
  return ["in", ["get", "id"], ["literal", [...stopIds]]];
}

export function overlayLayers(scheme: Scheme): LayerSpecification[] {
  const colors = COLORS[scheme];
  const markerColor: ExpressionSpecification = ["case", IS_RAIL, ["coalesce", ["get", "color"], colors.busStroke], colors.busFill];
  const markerStroke: ExpressionSpecification = [
    "case",
    IS_RAIL,
    colors.railStroke,
    ["match", ["get", "mode"], "emtu", colors.emtuStroke, colors.busStroke],
  ];
  return [
    {
      id: "route-line",
      type: "line",
      source: ROUTE_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.85 },
    },
    {
      id: "bus-stops",
      type: "circle",
      source: STOPS_SOURCE,
      minzoom: BUS_MIN_ZOOM,
      filter: ["!", IS_RAIL],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 4, 18, 8],
        "circle-color": markerColor,
        "circle-stroke-width": 2,
        "circle-stroke-color": markerStroke,
      },
    },
    {
      id: "rail-stations",
      type: "circle",
      source: STOPS_SOURCE,
      minzoom: 10,
      filter: IS_RAIL,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 8],
        "circle-color": markerColor,
        "circle-stroke-width": 2,
        "circle-stroke-color": markerStroke,
      },
    },
    {
      id: "route-stops",
      type: "circle",
      source: ROUTE_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
        "circle-color": colors.routeStopFill,
        "circle-stroke-width": 2.5,
        "circle-stroke-color": ["get", "color"],
      },
    },
    {
      id: FAVORITE_LAYER,
      type: "circle",
      source: STOPS_SOURCE,
      minzoom: FAVORITE_MIN_ZOOM,
      filter: favoriteFilter([]),
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 15, 7, 18, 9],
        "circle-color": markerColor,
        "circle-stroke-width": 2,
        "circle-stroke-color": markerStroke,
      },
    },
    {
      id: FAVORITE_BADGE_LAYER,
      type: "symbol",
      source: STOPS_SOURCE,
      minzoom: FAVORITE_MIN_ZOOM,
      filter: favoriteFilter([]),
      layout: {
        "icon-image": FAVORITE_IMAGE,
        "icon-anchor": "bottom-left",
        "icon-offset": [2, -2],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      id: "rail-labels",
      type: "symbol",
      source: STOPS_SOURCE,
      minzoom: 13,
      filter: IS_RAIL,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
      },
      paint: { "text-color": colors.label, "text-halo-color": colors.labelHalo, "text-halo-width": 1.5 },
    },
    {
      id: SELECTED_LAYER,
      type: "circle",
      source: STOPS_SOURCE,
      filter: selectedFilter(null),
      paint: {
        "circle-radius": 11,
        "circle-opacity": 0,
        "circle-stroke-width": 3,
        "circle-stroke-color": colors.selected,
      },
    },
  ];
}

export function drawFavoriteBadge(canvas: HTMLCanvasElement, ring: string): ImageData {
  const size = canvas.width;
  const context = canvas.getContext("2d")!;
  const center = size / 2;
  context.clearRect(0, 0, size, size);
  context.beginPath();
  context.arc(center, center, center - 1, 0, Math.PI * 2);
  context.fillStyle = ring;
  context.fill();
  context.beginPath();
  context.arc(center, center, center - size * 0.1, 0, Math.PI * 2);
  context.fillStyle = FAVORITE_BADGE_COLOR;
  context.fill();
  context.beginPath();
  const outer = size * 0.3;
  const inner = outer * 0.45;
  for (let point = 0; point < 10; point++) {
    const radius = point % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (point * Math.PI) / 5;
    context.lineTo(center + radius * Math.cos(angle), center + radius * Math.sin(angle));
  }
  context.closePath();
  context.fillStyle = "#ffffff";
  context.fill();
  return context.getImageData(0, 0, size, size);
}

export function badgeRing(scheme: Scheme): string {
  return COLORS[scheme].busFill;
}
