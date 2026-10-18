"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { StopSheet } from "@/components/stop-sheet";
import { INITIAL_ZOOM, MAP_STYLE_URL, MAP_WORKER_PATH, SAO_PAULO_CENTER } from "@/lib/map";
import { loadMapStops, SELECTED_LAYER, STOP_LAYERS, STOPS_SOURCE, stopLayers, stopsSource } from "@/lib/map-stops";
import { strings } from "@/lib/strings";

type MapError = "map" | "stops";

export function TransitMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [error, setError] = useState<MapError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stops = loadMapStops();

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
          geolocate.trigger();
          stops
            .then((loaded) => {
              map.addSource(STOPS_SOURCE, stopsSource(loaded));
              for (const layer of stopLayers()) {
                map.addLayer(layer);
              }
            })
            .catch((reason: unknown) => {
              console.error("stops failed:", reason);
              setError("stops");
            });
        });
        map.on("click", STOP_LAYERS, (event) => {
          const id = event.features?.[0]?.properties.id;
          if (typeof id === "string") {
            setSelected(id);
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
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer(SELECTED_LAYER)) {
      map.setFilter(SELECTED_LAYER, ["==", ["get", "id"], selected ?? ""]);
    }
  }, [selected]);

  return (
    <>
      <div ref={container} aria-label={strings.map.label} className="absolute inset-0" />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+4.5rem)] rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error === "map" ? strings.map.failed : strings.map.stopsFailed}
        </p>
      )}
      {selected && <StopSheet stopId={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
