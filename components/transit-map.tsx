"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapSearch } from "@/components/map-search";
import { RouteSheet } from "@/components/route-sheet";
import { StopSheet } from "@/components/stop-sheet";
import { INITIAL_ZOOM, MAP_STYLE_URL, MAP_WORKER_PATH, SAO_PAULO_CENTER } from "@/lib/map";
import { createMapController, type MapController } from "@/lib/map-controller";
import { CLICKABLE_LAYERS, EMPTY_COLLECTION } from "@/lib/map-layers";
import { loadFavoriteIds, loadMapStops } from "@/lib/map-stops";
import { transitStyle } from "@/lib/map-style";
import { mapHref, parseMapView, routeGeoJSON, type MapView } from "@/lib/map-view";
import type { MapStop } from "@/lib/stops-file";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { RouteDetails } from "@/lib/transit";
import { useColorScheme } from "@/lib/use-color-scheme";

type MapError = "map" | "stops";

type LoadedRoute = { routeId: string; route: RouteDetails | null; failed: boolean };

const STOP_ZOOM = 16;
const SHEET_ENTRY = "andalogoSheet";
const SHEET_SHARE = 0.6;
const SEARCH_HEIGHT = 72;

async function loadBaseStyle(): Promise<StyleSpecification> {
  const response = await fetch(MAP_STYLE_URL);
  if (!response.ok) {
    throw new Error(`map style returned ${response.status}`);
  }
  return response.json();
}

function isSheetEntry(): boolean {
  return (window.history.state as Record<string, unknown> | null)?.[SHEET_ENTRY] === true;
}

export function TransitMap() {
  const scheme = useColorScheme();
  const view = parseMapView(useSearchParams());
  const viewRef = useRef(view);
  const schemeRef = useRef(scheme);
  useEffect(() => {
    viewRef.current = view;
    schemeRef.current = scheme;
  });

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const controllerRef = useRef<MapController | null>(null);
  const stopsRef = useRef(new Map<string, MapStop>());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<MapError | null>(null);
  const [loadedRoute, setLoadedRoute] = useState<LoadedRoute | null>(null);
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set());

  const navigate = useCallback((next: Partial<MapView>, mode: "push" | "replace" = "replace") => {
    const href = mapHref({ ...viewRef.current, ...next });
    if (mode === "push") {
      window.history.pushState({ [SHEET_ENTRY]: true }, "", href);
    } else {
      window.history.replaceState({ [SHEET_ENTRY]: isSheetEntry() }, "", href);
    }
  }, []);

  const close = useCallback(
    (next: Partial<MapView>) => {
      if (isSheetEntry()) {
        window.history.back();
      } else {
        navigate(next);
      }
    },
    [navigate],
  );

  useEffect(() => {
    let cancelled = false;
    const stops = loadMapStops().then(
      (loaded) => ({ loaded, reason: null }),
      (reason: unknown) => ({ loaded: null, reason }),
    );
    loadFavoriteIds()
      .then((ids) => !cancelled && setFavorites(new Set(ids)))
      .catch((reason: unknown) => console.error("favorites failed:", reason));
    const startsAtPlace = viewRef.current.stop !== null || viewRef.current.route !== null;

    Promise.all([import("maplibre-gl"), loadBaseStyle()])
      .then(([maplibregl, base]) => {
        if (cancelled || !container.current) {
          return;
        }
        maplibregl.setWorkerUrl(`${MAP_WORKER_PATH}?v=${maplibregl.getVersion()}`);
        const map = new maplibregl.Map({
          container: container.current,
          style: transitStyle(base, schemeRef.current),
          center: SAO_PAULO_CENTER,
          zoom: INITIAL_ZOOM,
          maxPitch: 0,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: { compact: true },
        });
        map.touchZoomRotate.disableRotation();
        const controller = createMapController(map, base, schemeRef.current, () => {
          if (!cancelled) {
            setReady(true);
          }
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
        });
        stops.then(({ loaded, reason }) => {
          if (loaded) {
            stopsRef.current = new Map(loaded.map((stop) => [stop.id, stop]));
          } else {
            console.error("stops failed:", reason);
            setError("stops");
          }
          controller.setStops(loaded);
        });
        map.on("click", CLICKABLE_LAYERS, (event) => {
          const id = event.features?.[0]?.properties.id;
          if (typeof id === "string") {
            navigate({ stop: id }, viewRef.current.stop ? "replace" : "push");
          }
        });
        map.on("error", (event) => {
          if (!map.isStyleLoaded()) {
            console.error("map failed:", event.error);
            setError("map");
          }
        });
        mapRef.current = map;
        controllerRef.current = controller;
      })
      .catch((reason: unknown) => {
        console.error("map failed:", reason);
        setError("map");
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      controllerRef.current = null;
      setReady(false);
    };
  }, [navigate]);

  useEffect(() => {
    controllerRef.current?.setScheme(scheme);
  }, [ready, scheme]);

  useEffect(() => {
    controllerRef.current?.setFavorites(favorites);
  }, [ready, favorites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) {
      return;
    }
    controllerRef.current?.setSelected(view.stop);
    const stop = view.stop ? stopsRef.current.get(view.stop) : undefined;
    if (!stop) {
      return;
    }
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const visibleBottom = height * (1 - SHEET_SHARE);
    const { x, y } = map.project([stop.lon, stop.lat]);
    if (map.getZoom() < STOP_ZOOM || x < 0 || x > width || y < SEARCH_HEIGHT || y > visibleBottom) {
      map.easeTo({
        center: [stop.lon, stop.lat],
        zoom: Math.max(map.getZoom(), STOP_ZOOM),
        offset: [0, (SEARCH_HEIGHT + visibleBottom) / 2 - height / 2],
      });
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
    const controller = controllerRef.current;
    if (!ready || !controller) {
      return;
    }
    if (!route?.route) {
      controller.setRoute(EMPTY_COLLECTION);
      return;
    }
    const { bounds, data } = routeGeoJSON(route.route, view.dir);
    controller.setRoute(data);
    if (bounds) {
      const height = mapRef.current?.getContainer().clientHeight ?? 0;
      const padding = { top: 80, bottom: Math.round(height * SHEET_SHARE) + 16, left: 40, right: 40 };
      mapRef.current?.fitBounds(bounds, { padding, maxZoom: STOP_ZOOM });
    }
  }, [ready, route, view.dir]);

  function changeFavorite(stopId: string, favorite: boolean) {
    setFavorites((current) => {
      const next = new Set(current);
      if (favorite) {
        next.add(stopId);
      } else {
        next.delete(stopId);
      }
      return next;
    });
  }

  return (
    <>
      <div className="absolute inset-0">
        <div ref={container} aria-label={strings.map.label} className="h-full w-full" />
      </div>
      <MapSearch
        onRoute={(id) => navigate({ route: id, dir: 0, stop: null }, "push")}
        onStop={(id) => navigate({ stop: id, route: null }, "push")}
      />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+4.5rem)] rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-200"
        >
          {error === "map" ? strings.map.failed : strings.map.stopsFailed}
        </p>
      )}
      {view.stop ? (
        <StopSheet
          stopId={view.stop}
          onClose={() => close({ stop: null })}
          onRoute={(routeId, dir) => navigate({ route: routeId, dir, stop: null }, "push")}
          onFavoriteChange={changeFavorite}
        />
      ) : (
        view.route && (
          <RouteSheet
            route={route?.route ?? null}
            failed={route?.failed ?? false}
            dir={view.dir}
            onDirection={(dir) => navigate({ dir })}
            onStop={(id) => navigate({ stop: id }, "push")}
            onClose={() => close({ route: null })}
          />
        )
      )}
    </>
  );
}
