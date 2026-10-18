import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import {
  badgeRing,
  drawFavoriteBadge,
  EMPTY_COLLECTION,
  FAVORITE_BADGE_LAYER,
  FAVORITE_IMAGE,
  FAVORITE_LAYER,
  favoriteFilter,
  overlayLayers,
  ROUTE_SOURCE,
  SELECTED_LAYER,
  selectedFilter,
  STOPS_SOURCE,
  stopsSource,
} from "./map-layers.ts";
import { transitStyle, type Scheme } from "./map-style.ts";
import type { MapStop } from "./stops-file.ts";

const BADGE_PIXELS = 36;
const BADGE_PIXEL_RATIO = 2;

export type MapController = {
  setScheme(scheme: Scheme): void;
  setStops(stops: MapStop[] | null): void;
  setSelected(stopId: string | null): void;
  setFavorites(stopIds: Iterable<string>): void;
  setRoute(data: GeoJSON.FeatureCollection): void;
};

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

  function addOverlays() {
    const canvas = document.createElement("canvas");
    canvas.width = BADGE_PIXELS;
    canvas.height = BADGE_PIXELS;
    map.addImage(FAVORITE_IMAGE, drawFavoriteBadge(canvas, badgeRing(current)), { pixelRatio: BADGE_PIXEL_RATIO });
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
    map.setFilter(SELECTED_LAYER, selectedFilter(selected));
    map.setFilter(FAVORITE_LAYER, favoriteFilter(favorites));
    map.setFilter(FAVORITE_BADGE_LAYER, favoriteFilter(favorites));
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
