"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapSearch } from "@/components/map-search";
import { PlaceSheet } from "@/components/place-sheet";
import { RouteSheet } from "@/components/route-sheet";
import { StopSheet } from "@/components/stop-sheet";
import { nextBuses } from "@/lib/arrivals";
import { lineMotion, type MovingBus } from "@/lib/bus-motion";
import { busLabel, createBusLayer, type BusLayer, type ShownBus } from "@/lib/live-markers";
import { INITIAL_ZOOM, MAP_STYLE_URL, MAP_WORKER_PATH, SAO_PAULO_CENTER } from "@/lib/map";
import { createMapController, type MapController } from "@/lib/map-controller";
import { CLICKABLE_LAYERS, EMPTY_COLLECTION } from "@/lib/map-layers";
import { loadFavoriteIds, loadMapStops } from "@/lib/map-stops";
import { transitStyle } from "@/lib/map-style";
import { DEFAULT_ROUTE_COLOR, mapHref, parseMapView, routeGeoJSON, SHEET_SHARE, type MapView } from "@/lib/map-view";
import { nearbyStops } from "@/lib/places";
import type { MapStop } from "@/lib/stops-file";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { RouteDetails, StopDetails, StopLine } from "@/lib/transit";
import { useArrivals } from "@/lib/use-arrivals";
import { useBusProgress } from "@/lib/use-bus-progress";
import { linesKey, useBusTracks } from "@/lib/use-bus-tracks";
import { useColorScheme } from "@/lib/use-color-scheme";

type MapError = "map" | "stops";

type LoadedRoute = { routeId: string; route: RouteDetails | null; failed: boolean };

const STOP_ZOOM = 16;
const SHEET_ENTRY = "andalogoSheet";
const SEARCH_HEIGHT = 72;
const NEXT_BUSES = 2;

async function loadBaseStyle(): Promise<StyleSpecification> {
  const response = await fetch(MAP_STYLE_URL);
  if (!response.ok) {
    throw new Error(`map style returned ${response.status}`);
  }
  return response.json();
}

function showLocationDot(maplibregl: typeof import("maplibre-gl"), map: MapLibreMap): () => void {
  if (!("geolocation" in navigator)) {
    return () => {};
  }
  const element = document.createElement("div");
  element.className = "maplibregl-user-location-dot";
  const marker = new maplibregl.Marker({ element });
  const watch = navigator.geolocation.watchPosition(
    (position) => marker.setLngLat([position.coords.longitude, position.coords.latitude]).addTo(map),
    (error) => console.warn("location failed:", error.message),
    { enableHighAccuracy: true },
  );
  return () => {
    navigator.geolocation.clearWatch(watch);
    marker.remove();
  };
}

// A move without zoom ends the locate control's follow mode, so later GPS fixes stop recentering the map.
function stopFollowing(map: MapLibreMap): void {
  map.jumpTo({ center: map.getCenter() });
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
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const framedRef = useRef<string | null>(null);
  const placeFramedRef = useRef<string | null>(null);
  const busLayerRef = useRef<BusLayer | null>(null);
  const controllerRef = useRef<MapController | null>(null);
  const stopsRef = useRef(new Map<string, MapStop>());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<MapError | null>(null);
  const [loadedRoute, setLoadedRoute] = useState<LoadedRoute | null>(null);
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set());
  const [stopLines, setStopLines] = useState<{ stopId: string; lines: StopLine[] } | null>(null);
  const [stopCount, setStopCount] = useState(0);

  const selectedStop = ready && view.stop ? stopsRef.current.get(view.stop) : undefined;
  const arrivals = useArrivals(selectedStop?.mode === "bus" && selectedStop.id.startsWith("sp:") ? selectedStop.id : null);
  const route = view.route && loadedRoute?.routeId === view.route ? loadedRoute : null;
  const trackedLines = view.route
    ? route?.route?.mode === "bus" && view.route.startsWith("sp:")
      ? [{ routeId: view.route, directionId: view.dir }]
      : []
    : nextBuses(arrivals, NEXT_BUSES);
  const tracks = useBusTracks(linesKey(trackedLines));
  const nextLineBus =
    view.route && selectedStop ? (nextBuses(arrivals, 1, { routeId: view.route, directionId: view.dir })[0] ?? null) : null;
  const lineTracks = view.route
    ? (tracks.find((line) => line.routeId === view.route && line.directionId === view.dir) ?? null)
    : null;
  const busAlongM = useBusProgress(lineTracks, nextLineBus?.p ?? null);
  const nearLat = view.near?.lat;
  const nearLon = view.near?.lon;
  const nearby = useMemo(
    () =>
      ready && stopCount > 0 && nearLat !== undefined && nearLon !== undefined
        ? nearbyStops(stopsRef.current.values(), { lat: nearLat, lon: nearLon })
        : null,
    [ready, stopCount, nearLat, nearLon],
  );

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
    const startsAtPlace = viewRef.current.stop !== null || viewRef.current.route !== null || Boolean(viewRef.current.near);
    let stopLocationDot = () => {};

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
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: { compact: true },
        });
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
        map.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: false }), "bottom-right");
        const markNorth = () => map.getContainer().classList.toggle("map-north", Math.abs(map.getBearing()) < 0.5);
        map.on("rotate", markNorth);
        markNorth();
        map.once("load", () => {
          map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
          if (!startsAtPlace) {
            geolocate.trigger();
          } else if (!cancelled) {
            stopLocationDot = showLocationDot(maplibregl, map);
            geolocate.once("trackuserlocationstart", () => stopLocationDot());
          }
        });
        stops.then(({ loaded, reason }) => {
          if (loaded) {
            stopsRef.current = new Map(loaded.map((stop) => [stop.id, stop]));
            setStopCount(loaded.length);
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
        maplibreRef.current = maplibregl;
        controllerRef.current = controller;
      })
      .catch((reason: unknown) => {
        console.error("map failed:", reason);
        setError("map");
      });

    return () => {
      cancelled = true;
      stopLocationDot();
      busLayerRef.current?.remove();
      busLayerRef.current = null;
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
    if (!stop || view.route) {
      return;
    }
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const visibleBottom = height * (1 - SHEET_SHARE);
    const { x, y } = map.project([stop.lon, stop.lat]);
    if (map.getZoom() < STOP_ZOOM || x < 0 || x > width || y < SEARCH_HEIGHT || y > visibleBottom) {
      stopFollowing(map);
      map.easeTo({
        center: [stop.lon, stop.lat],
        zoom: Math.max(map.getZoom(), STOP_ZOOM),
        offset: [0, (SEARCH_HEIGHT + visibleBottom) / 2 - height / 2],
      });
    }
  }, [ready, view.stop, view.route]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!view.stop) {
      framedRef.current = null;
    }
    if (!ready || !map || !maplibregl) {
      return;
    }
    const layer = (busLayerRef.current ??= createBusLayer(maplibregl, map));
    const motions = new Map(tracks.map((line) => [`${line.routeId}|${line.directionId}`, { line, motion: lineMotion(line) }]));
    const moving = (routeId: string, directionId: number, p: string): MovingBus | null => {
      const entry = motions.get(`${routeId}|${directionId}`);
      const track = entry?.line.buses.find((bus) => bus.p === p);
      if (!entry || !track || track.alongM === null) {
        return null;
      }
      return { key: `${routeId}|${directionId}|${p}`, line: entry.motion, track: { ...track, alongM: track.alongM } };
    };
    const routeId = view.route;
    const buses = !selectedStop
      ? []
      : routeId
        ? nextBuses(arrivals, 1, { routeId, directionId: view.dir })
        : nextBuses(arrivals, NEXT_BUSES);
    const lines = selectedStop && stopLines?.stopId === selectedStop.id ? stopLines.lines : [];
    const shown: ShownBus[] = routeId
      ? (motions.get(`${routeId}|${view.dir}`)?.line.buses ?? []).map((bus) => ({
          key: `${routeId}|${view.dir}|${bus.p}`,
          label: route?.route?.short_name ?? routeId.replace(/^sp:/, ""),
          color: route?.route?.color ?? DEFAULT_ROUTE_COLOR,
          lat: bus.lat,
          lon: bus.lon,
          moving: moving(routeId, view.dir, bus.p),
        }))
      : buses.map((bus) => {
          const line = lines.find((candidate) => candidate.route_id === bus.routeId && candidate.direction_id === bus.directionId);
          return {
            key: `${bus.routeId}|${bus.directionId}|${bus.p}`,
            label: busLabel(bus, line),
            color: line?.color ?? DEFAULT_ROUTE_COLOR,
            lat: bus.lat,
            lon: bus.lon,
            moving: moving(bus.routeId, bus.directionId, bus.p),
          };
        });
    layer.update(shown);
    if (!selectedStop) {
      return;
    }
    const frameKey = routeId ? `${selectedStop.id}|${routeId}|${view.dir}` : selectedStop.id;
    if (buses.length > 0 && framedRef.current !== frameKey) {
      framedRef.current = frameKey;
      const { clientWidth: width, clientHeight: height } = map.getContainer();
      const visibleBottom = height * (1 - SHEET_SHARE);
      const points = [selectedStop, ...buses].map(({ lon, lat }): [number, number] => [lon, lat]);
      const outside = points.some((point) => {
        const { x, y } = map.project(point);
        return x < 0 || x > width || y < SEARCH_HEIGHT || y > visibleBottom;
      });
      if (outside) {
        stopFollowing(map);
        const lons = points.map(([lon]) => lon);
        const lats = points.map(([, lat]) => lat);
        map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
          padding: { top: SEARCH_HEIGHT + 24, bottom: height - visibleBottom + 60, left: 96, right: 96 },
          maxZoom: STOP_ZOOM,
        });
      }
    }
  }, [ready, arrivals, selectedStop, stopLines, tracks, route, view.stop, view.route, view.dir]);

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
    const map = mapRef.current;
    if (bounds && !view.stop && map) {
      const height = map.getContainer().clientHeight;
      const padding = { top: 80, bottom: Math.round(height * SHEET_SHARE) + 16, left: 40, right: 40 };
      stopFollowing(map);
      map.fitBounds(bounds, { padding, maxZoom: STOP_ZOOM });
    }
  }, [ready, route, view.dir, view.stop]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!ready || !map || !maplibregl || nearLat === undefined || nearLon === undefined) {
      return;
    }
    const element = document.createElement("div");
    element.className = "place-pin";
    element.append(document.createElement("span"));
    const marker = new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([nearLon, nearLat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [ready, nearLat, nearLon]);

  useEffect(() => {
    const map = mapRef.current;
    if (nearLat === undefined || nearLon === undefined) {
      placeFramedRef.current = null;
    }
    if (!ready || !map || !nearby || nearLat === undefined || nearLon === undefined || view.stop || view.route) {
      return;
    }
    const key = `${nearLat},${nearLon}`;
    if (placeFramedRef.current === key) {
      return;
    }
    placeFramedRef.current = key;
    stopFollowing(map);
    const { clientHeight: height } = map.getContainer();
    const visibleBottom = height * (1 - SHEET_SHARE);
    if (nearby.length === 0) {
      map.easeTo({
        center: [nearLon, nearLat],
        zoom: Math.max(map.getZoom(), STOP_ZOOM - 1),
        offset: [0, (SEARCH_HEIGHT + visibleBottom) / 2 - height / 2],
      });
      return;
    }
    const points = [{ lat: nearLat, lon: nearLon }, ...nearby];
    const lons = points.map((point) => point.lon);
    const lats = points.map((point) => point.lat);
    map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
      padding: { top: SEARCH_HEIGHT + 24, bottom: height - visibleBottom + 60, left: 64, right: 64 },
      maxZoom: STOP_ZOOM,
    });
  }, [ready, nearby, nearLat, nearLon, view.stop, view.route]);

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
        onRoute={(id) => navigate({ route: id, dir: 0, stop: null, near: null }, "push")}
        onStop={(id) => navigate({ stop: id, route: null, near: null }, "push")}
        onPlace={(place) => navigate({ near: { lat: place.lat, lon: place.lon, label: place.name }, stop: null, route: null }, "push")}
        bias={() => {
          const center = mapRef.current?.getCenter();
          return center ? { lat: center.lat, lon: center.lng } : null;
        }}
      />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+4.5rem)] rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-200"
        >
          {error === "map" ? strings.map.failed : strings.map.stopsFailed}
        </p>
      )}
      {view.route ? (
        <RouteSheet
          route={route?.route ?? null}
          failed={route?.failed ?? false}
          dir={view.dir}
          selectedStopId={view.stop}
          progress={lineTracks && busAlongM !== null ? { offsets: lineTracks.stopOffsetsM, alongM: busAlongM } : null}
          arrivalMinutes={nextLineBus?.minutes ?? null}
          onDirection={(dir) => navigate({ dir })}
          onStop={(id) => navigate({ stop: id, route: null }, "push")}
          onClose={() => close({ route: null })}
        />
      ) : view.stop ? (
        <StopSheet
          stopId={view.stop}
          arrivals={arrivals}
          onLoaded={(stop: StopDetails | null) => setStopLines(stop ? { stopId: stop.id, lines: stop.lines } : null)}
          onClose={() => close({ stop: null })}
          onRoute={(routeId, dir) => navigate({ route: routeId, dir }, "push")}
          onFavoriteChange={changeFavorite}
        />
      ) : (
        view.near && (
          <PlaceSheet
            label={view.near.label}
            stops={nearby}
            onStop={(id) => navigate({ stop: id }, "push")}
            onClose={() => close({ near: null })}
          />
        )
      )}
    </>
  );
}
