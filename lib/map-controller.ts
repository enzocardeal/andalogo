import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import {
  ARROW_IMAGE,
  arrowColor,
  badgeRing,
  drawFavoriteBadge,
  drawStopArrow,
  drawStopSign,
  EMPTY_COLLECTION,
  FAVORITE_IMAGE,
  overlayLayers,
  ROUTE_SOURCE,
  signStyles,
  stopFilters,
  STOPS_SOURCE,
  stopsSource,
} from "./map-layers.ts";
import { transitStyle, type Scheme } from "./map-style.ts";
import type { MapStop } from "./stops-file.ts";

const PIXEL_RATIO = 2;
const BADGE_PIXELS = 36;
const ARROW_PIXELS = { width: 24, height: 64 };
const SIGN_PIXELS = { width: 36, height: 50 };
const SELECTED_SIGN_PIXELS = { width: 48, height: 64 };

export type MapController = {
  setScheme(scheme: Scheme): void;
  setStops(stops: MapStop[] | null): void;
  setSelected(stopId: string | null): void;
  setFavorites(stopIds: Iterable<string>): void;
  setRoute(data: GeoJSON.FeatureCollection): void;
};

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createMapController(
  map: MapLibreMap,
  base: StyleSpecification,
  scheme: Scheme,
  onReady: () => void,
): MapController {
  let current = scheme;
  let styleLoaded = false;
  let stops: MapStop[] | null | undefined;
  let selected: string | null = null;
  let favorites: string[] = [];
  let route = EMPTY_COLLECTION;

  function addImages() {
    const badge = drawFavoriteBadge(canvasOf(BADGE_PIXELS, BADGE_PIXELS), badgeRing(current));
    map.addImage(FAVORITE_IMAGE, badge, { pixelRatio: PIXEL_RATIO });
    map.addImage(ARROW_IMAGE, drawStopArrow(canvasOf(ARROW_PIXELS.width, ARROW_PIXELS.height), arrowColor(current)), { pixelRatio: PIXEL_RATIO });
    for (const [name, style] of Object.entries(signStyles(current))) {
      const size = style.outlineWidth > 2 ? SELECTED_SIGN_PIXELS : SIGN_PIXELS;
      map.addImage(name, drawStopSign(canvasOf(size.width, size.height), style), { pixelRatio: PIXEL_RATIO });
    }
  }

  function addOverlays() {
    addImages();
    map.addSource(STOPS_SOURCE, stops ? stopsSource(stops) : { type: "geojson", data: EMPTY_COLLECTION });
    map.addSource(ROUTE_SOURCE, { type: "geojson", data: route });
    for (const layer of overlayLayers(current)) {
      map.addLayer(layer);
    }
  }

  function apply() {
    if (!styleLoaded || stops === undefined) {
      return;
    }
    if (!map.getSource(ROUTE_SOURCE)) {
      addOverlays();
      onReady();
    }
    for (const [layer, filter] of Object.entries(stopFilters(selected, favorites))) {
      map.setFilter(layer, filter);
    }
  }

  map.on("style.load", () => {
    styleLoaded = true;
    apply();
  });

  return {
    setScheme(next) {
      if (next === current) {
        return;
      }
      current = next;
      styleLoaded = false;
      map.setStyle(transitStyle(base, next), { diff: false });
    },
    setStops(value) {
      stops = value;
      apply();
    },
    setSelected(stopId) {
      selected = stopId;
      apply();
    },
    setFavorites(stopIds) {
      favorites = [...stopIds];
      apply();
    },
    setRoute(data) {
      route = data;
      map.getSource<GeoJSONSource>(ROUTE_SOURCE)?.setData(data);
    },
  };
}
