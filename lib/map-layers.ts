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
export const BUS_STOPS_LAYER = "bus-stops";
export const SELECTED_LAYER = "selected-stop";
export const SELECTED_SIGN_LAYER = "selected-sign";
export const FAVORITE_LAYER = "favorite-stops";
export const FAVORITE_SIGN_LAYER = "favorite-signs";
export const FAVORITE_BADGE_LAYER = "favorite-badges";
export const FAVORITE_IMAGE = "favorite-star";
export const CLICKABLE_LAYERS = [
  "rail-stations",
  BUS_STOPS_LAYER,
  "route-stops",
  FAVORITE_LAYER,
  FAVORITE_SIGN_LAYER,
  FAVORITE_BADGE_LAYER,
];

export const SIGN_IMAGES = {
  bus: "stop-sign-bus",
  emtu: "stop-sign-emtu",
  busSelected: "stop-sign-bus-selected",
  emtuSelected: "stop-sign-emtu-selected",
};

export const SIGN_COLORS = { bus: "#43a047", emtu: "#1d4ed8" };

export const FAVORITE_BADGE_COLOR = "#f97316";

const IS_RAIL: ExpressionSpecification = ["in", ["get", "mode"], ["literal", ["metro", "cptm"]]];
const IS_SIGN: ExpressionSpecification = ["!", IS_RAIL];
const FAVORITE_MIN_ZOOM = 11;
const BUS_MIN_ZOOM = 15;

type Colors = {
  railFallback: string;
  railStroke: string;
  pole: string;
  label: string;
  labelHalo: string;
  selected: string;
  routeStopFill: string;
  badgeRing: string;
};

const COLORS: Record<Scheme, Colors> = {
  light: {
    railFallback: "#334155",
    railStroke: "#ffffff",
    pole: "#64748b",
    label: "#0f172a",
    labelHalo: "#ffffff",
    selected: "#0f172a",
    routeStopFill: "#ffffff",
    badgeRing: "#ffffff",
  },
  dark: {
    railFallback: "#cbd5e1",
    railStroke: "#0f172a",
    pole: "#94a3b8",
    label: "#e2e8f0",
    labelHalo: "#0f172a",
    selected: "#f8fafc",
    routeStopFill: "#1e293b",
    badgeRing: "#1e293b",
  },
};

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

function idIs(stopId: string | null): ExpressionSpecification {
  return ["==", ["get", "id"], stopId ?? ""];
}

function idIn(stopIds: Iterable<string>): ExpressionSpecification {
  return ["in", ["get", "id"], ["literal", [...stopIds]]];
}

export function stopFilters(selected: string | null, favorites: Iterable<string>): Record<string, FilterSpecification> {
  const ids = idIn(favorites);
  const notSelected: ExpressionSpecification = ["!", idIs(selected)];
  return {
    [BUS_STOPS_LAYER]: ["all", IS_SIGN, notSelected],
    [FAVORITE_LAYER]: ["all", ids, IS_RAIL],
    [FAVORITE_SIGN_LAYER]: ["all", ids, IS_SIGN, notSelected],
    [FAVORITE_BADGE_LAYER]: ids,
    [SELECTED_LAYER]: ["all", idIs(selected), IS_RAIL],
    [SELECTED_SIGN_LAYER]: ["all", idIs(selected), IS_SIGN],
  };
}

function signImage(selected: boolean): ExpressionSpecification {
  return [
    "match",
    ["get", "mode"],
    "emtu",
    selected ? SIGN_IMAGES.emtuSelected : SIGN_IMAGES.emtu,
    selected ? SIGN_IMAGES.busSelected : SIGN_IMAGES.bus,
  ];
}

export function overlayLayers(scheme: Scheme): LayerSpecification[] {
  const colors = COLORS[scheme];
  const railPaint = {
    "circle-color": ["coalesce", ["get", "color"], colors.railFallback] as ExpressionSpecification,
    "circle-stroke-width": 2,
    "circle-stroke-color": colors.railStroke,
  };
  const signLayout = {
    "icon-image": signImage(false),
    "icon-anchor": "bottom" as const,
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };
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
      id: "rail-stations",
      type: "circle",
      source: STOPS_SOURCE,
      minzoom: 10,
      filter: IS_RAIL,
      paint: { ...railPaint, "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 8] },
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
      id: BUS_STOPS_LAYER,
      type: "symbol",
      source: STOPS_SOURCE,
      minzoom: BUS_MIN_ZOOM,
      filter: stopFilters(null, [])[BUS_STOPS_LAYER],
      layout: { ...signLayout, "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.75, 18, 1] },
    },
    {
      id: FAVORITE_LAYER,
      type: "circle",
      source: STOPS_SOURCE,
      minzoom: FAVORITE_MIN_ZOOM,
      filter: stopFilters(null, [])[FAVORITE_LAYER],
      paint: { ...railPaint, "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 15, 8] },
    },
    {
      id: FAVORITE_SIGN_LAYER,
      type: "symbol",
      source: STOPS_SOURCE,
      minzoom: FAVORITE_MIN_ZOOM,
      filter: stopFilters(null, [])[FAVORITE_SIGN_LAYER],
      layout: signLayout,
    },
    {
      id: FAVORITE_BADGE_LAYER,
      type: "symbol",
      source: STOPS_SOURCE,
      minzoom: FAVORITE_MIN_ZOOM,
      filter: stopFilters(null, [])[FAVORITE_BADGE_LAYER],
      layout: {
        "icon-image": FAVORITE_IMAGE,
        "icon-anchor": "bottom-left",
        "icon-offset": ["case", IS_RAIL, ["literal", [2, -2]], ["literal", [4, -18]]],
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
      filter: stopFilters(null, [])[SELECTED_LAYER],
      paint: {
        "circle-radius": 11,
        "circle-opacity": 0,
        "circle-stroke-width": 3,
        "circle-stroke-color": colors.selected,
      },
    },
    {
      id: SELECTED_SIGN_LAYER,
      type: "symbol",
      source: STOPS_SOURCE,
      filter: stopFilters(null, [])[SELECTED_SIGN_LAYER],
      layout: { ...signLayout, "icon-image": signImage(true) },
    },
  ];
}

type SignStyle = { fill: string; pole: string; outline: string; outlineWidth: number };

export function drawStopSign(canvas: HTMLCanvasElement, style: SignStyle): ImageData {
  const { width, height } = canvas;
  const context = canvas.getContext("2d")!;
  const side = width - style.outlineWidth * 2;
  const top = style.outlineWidth;
  const left = style.outlineWidth;
  const poleWidth = width * 0.12;
  context.clearRect(0, 0, width, height);
  context.fillStyle = style.pole;
  context.fillRect((width - poleWidth) / 2, top + side - 2, poleWidth, height - top - side + 2);
  context.beginPath();
  context.roundRect(left, top, side, side, side * 0.2);
  context.fillStyle = style.fill;
  context.fill();
  context.lineWidth = style.outlineWidth;
  context.strokeStyle = style.outline;
  context.stroke();
  const unit = side / 16;
  const glyph = (x: number, y: number, w: number, h: number, r: number) => {
    context.beginPath();
    context.roundRect(left + x * unit, top + y * unit, w * unit, h * unit, r * unit);
    context.fill();
  };
  context.fillStyle = "#ffffff";
  glyph(4, 3, 8, 9, 1.5);
  glyph(4.6, 11.5, 2, 2, 0.6);
  glyph(9.4, 11.5, 2, 2, 0.6);
  context.fillStyle = style.fill;
  glyph(5, 4.2, 6, 3.6, 0.6);
  return context.getImageData(0, 0, width, height);
}

export function signStyles(scheme: Scheme): Record<string, SignStyle> {
  const { pole, selected } = COLORS[scheme];
  return {
    [SIGN_IMAGES.bus]: { fill: SIGN_COLORS.bus, pole, outline: "#ffffff", outlineWidth: 2 },
    [SIGN_IMAGES.emtu]: { fill: SIGN_COLORS.emtu, pole, outline: "#ffffff", outlineWidth: 2 },
    [SIGN_IMAGES.busSelected]: { fill: SIGN_COLORS.bus, pole, outline: selected, outlineWidth: 4 },
    [SIGN_IMAGES.emtuSelected]: { fill: SIGN_COLORS.emtu, pole, outline: selected, outlineWidth: 4 },
  };
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
  return COLORS[scheme].badgeRing;
}
