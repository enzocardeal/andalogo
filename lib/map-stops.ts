import type { ExpressionSpecification, GeoJSONSourceSpecification, LayerSpecification } from "maplibre-gl";
import { decodeStops, STOPS_BUCKET, type MapStop } from "./stops-file.ts";
import { createClient } from "./supabase/client.ts";
import { supabaseEnv } from "./supabase/env.ts";

export const STOPS_SOURCE = "stops";
export const STOP_LAYERS = ["rail-stations", "bus-stops"];
export const SELECTED_LAYER = "selected-stop";

const IS_RAIL: ExpressionSpecification = ["in", ["get", "mode"], ["literal", ["metro", "cptm"]]];

export async function loadMapStops(): Promise<MapStop[]> {
  const { data, error } = await createClient().from("feed_versions").select("stops_file");
  if (error) {
    throw error;
  }
  const { url } = supabaseEnv();
  const files = await Promise.all(
    data.map(async ({ stops_file }: { stops_file: string }) => {
      const response = await fetch(`${url}/storage/v1/object/public/${STOPS_BUCKET}/${stops_file}`);
      if (!response.ok) {
        throw new Error(`${stops_file} returned ${response.status}`);
      }
      return decodeStops(await response.json());
    }),
  );
  return files.flat();
}

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

export function stopLayers(): LayerSpecification[] {
  return [
    {
      id: "bus-stops",
      type: "circle",
      source: STOPS_SOURCE,
      minzoom: 15,
      filter: ["!", IS_RAIL],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 4, 18, 8],
        "circle-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-color": ["match", ["get", "mode"], "emtu", "#c2410c", "#334155"],
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
        "circle-color": ["coalesce", ["get", "color"], "#334155"],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
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
      paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    },
    {
      id: SELECTED_LAYER,
      type: "circle",
      source: STOPS_SOURCE,
      filter: ["==", ["get", "id"], ""],
      paint: {
        "circle-radius": 11,
        "circle-opacity": 0,
        "circle-stroke-width": 3,
        "circle-stroke-color": "#0f172a",
      },
    },
  ];
}

export const ROUTE_SOURCE = "route";
export const ROUTE_STOPS_LAYER = "route-stops";

export function routeLayers(): { layer: LayerSpecification; before: string }[] {
  return [
    {
      before: "bus-stops",
      layer: {
        id: "route-line",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.85 },
      },
    },
    {
      before: SELECTED_LAYER,
      layer: {
        id: ROUTE_STOPS_LAYER,
        type: "circle",
        source: ROUTE_SOURCE,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
          "circle-color": "#ffffff",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["get", "color"],
        },
      },
    },
  ];
}
