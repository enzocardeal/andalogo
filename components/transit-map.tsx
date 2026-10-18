"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapSearch } from "@/components/map-search";
import { RouteSheet } from "@/components/route-sheet";
import { StopSheet } from "@/components/stop-sheet";
import { INITIAL_ZOOM, MAP_STYLE_URL, MAP_WORKER_PATH, SAO_PAULO_CENTER } from "@/lib/map";
import {
  loadMapStops,
  ROUTE_SOURCE,
  ROUTE_STOPS_LAYER,
  routeLayers,
  SELECTED_LAYER,
  STOP_LAYERS,
  STOPS_SOURCE,
  stopLayers,
  stopsSource,
} from "@/lib/map-stops";
import { mapHref, parseMapView, routeGeoJSON, type MapView } from "@/lib/map-view";
import type { MapStop } from "@/lib/stops-file";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { RouteDetails } from "@/lib/transit";

type MapError = "map" | "stops";

type LoadedRoute = { routeId: string; route: RouteDetails | null; failed: boolean };

const STOP_ZOOM = 16;
const ROUTE_PADDING = { top: 80, bottom: 260, left: 40, right: 40 };

export function TransitMap() {
  const router = useRouter();
  const view = parseMapView(useSearchParams());
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stopsRef = useRef(new Map<string, MapStop>());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<MapError | null>(null);
  const [loadedRoute, setLoadedRoute] = useState<LoadedRoute | null>(null);

  const navigate = useCallback(
    (next: Partial<MapView>) => router.replace(mapHref({ ...viewRef.current, ...next }), { scroll: false }),
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    const stops = loadMapStops();
    const startsAtPlace = viewRef.current.stop !== null || viewRef.current.route !== null;

    import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled || !container.current) {
          return;
        }
        maplibregl.setWorkerUrl(`${MAP_WORKER_PATH}?v=${maplibregl.getVersion()}`);
        const map = new maplibregl.Map({
          container: container.current,
          style: MAP_STYLE_URL,
          center: SAO_PAULO_CENTER,
          zoom: INITIAL_ZOOM,
          attributionControl: { compact: true },
        });
        const geolocate = new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        });
        map.addControl(geolocate, "bottom-right");
        map.once("load", () => {
          if (!startsAtPlace) {
            geolocate.trigger();
          }
          stops
            .then((loaded) => {
              stopsRef.current = new Map(loaded.map((stop) => [stop.id, stop]));
              map.addSource(STOPS_SOURCE, stopsSource(loaded));
              for (const layer of stopLayers()) {
                map.addLayer(layer);
              }
            })
            .catch((reason: unknown) => {
              console.error("stops failed:", reason);
              setError("stops");
            })
            .finally(() => {
              map.addSource(ROUTE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
              for (const { layer, before } of routeLayers()) {
                map.addLayer(layer, map.getLayer(before) ? before : undefined);
              }
              if (!cancelled) {
                setReady(true);
              }
            });
        });
        map.on("click", [...STOP_LAYERS, ROUTE_STOPS_LAYER], (event) => {
          const id = event.features?.[0]?.properties.id;
          if (typeof id === "string") {
            navigate({ stop: id });
          }
        });
        map.on("error", (event) => {
          if (!map.isStyleLoaded()) {
            console.error("map failed:", event.error);
            setError("map");
          }
        });
        mapRef.current = map;
      })
      .catch((reason: unknown) => {
        console.error("map failed:", reason);
        setError("map");
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [navigate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) {
      return;
    }
    if (map.getLayer(SELECTED_LAYER)) {
      map.setFilter(SELECTED_LAYER, ["==", ["get", "id"], view.stop ?? ""]);
    }
    const stop = view.stop ? stopsRef.current.get(view.stop) : undefined;
    if (stop && !map.getBounds().contains([stop.lon, stop.lat])) {
      map.easeTo({ center: [stop.lon, stop.lat], zoom: Math.max(map.getZoom(), STOP_ZOOM) });
    }
  }, [ready, view.stop]);

  useEffect(() => {
    if (!view.route) {
      return;
    }
    const routeId = view.route;
    let cancelled = false;
    createClient()
      .rpc("get_route", { p_route_id: routeId })
      .then(({ data, error: rpcError }) => {
        if (rpcError) {
          console.error("get_route failed:", rpcError.message);
        }
        if (!cancelled) {
          setLoadedRoute({ routeId, route: (data as RouteDetails | null) ?? null, failed: rpcError !== null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view.route]);

  const route = view.route && loadedRoute?.routeId === view.route ? loadedRoute : null;

  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>(ROUTE_SOURCE);
    if (!ready || !source) {
      return;
    }
    if (!route?.route) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const { bounds, data } = routeGeoJSON(route.route, view.dir);
    source.setData(data);
    if (bounds) {
      mapRef.current?.fitBounds(bounds, { padding: ROUTE_PADDING, maxZoom: STOP_ZOOM });
    }
  }, [ready, route, view.dir]);

  return (
    <>
      <div ref={container} aria-label={strings.map.label} className="absolute inset-0" />
      <MapSearch onRoute={(id) => navigate({ route: id, dir: 0, stop: null })} onStop={(id) => navigate({ stop: id, route: null })} />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+4.5rem)] rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error === "map" ? strings.map.failed : strings.map.stopsFailed}
        </p>
      )}
      {view.stop ? (
        <StopSheet
          stopId={view.stop}
          onClose={() => navigate({ stop: null })}
          onRoute={(routeId, dir) => navigate({ route: routeId, dir, stop: null })}
        />
      ) : (
        view.route && (
          <RouteSheet
            route={route?.route ?? null}
            failed={route?.failed ?? false}
            dir={view.dir}
            onDirection={(dir) => navigate({ dir })}
            onStop={(id) => navigate({ stop: id })}
            onClose={() => navigate({ route: null })}
          />
        )
      )}
    </>
  );
}
