"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { INITIAL_ZOOM, MAP_STYLE_URL, MAP_WORKER_PATH, SAO_PAULO_CENTER } from "@/lib/map";
import { strings } from "@/lib/strings";

export function TransitMap() {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;

    import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled || !container.current) {
          return;
        }
        maplibregl.setWorkerUrl(`${MAP_WORKER_PATH}?v=${maplibregl.getVersion()}`);
        const loaded = new maplibregl.Map({
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
        loaded.addControl(geolocate, "bottom-right");
        loaded.once("load", () => geolocate.trigger());
        loaded.on("error", (event) => {
          if (!loaded.isStyleLoaded()) {
            console.error("map failed:", event.error);
            setFailed(true);
          }
        });
        map = loaded;
      })
      .catch((error: unknown) => {
        console.error("map failed:", error);
        setFailed(true);
      });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return (
    <>
      <div ref={container} aria-label={strings.map.label} className="absolute inset-0" />
      {failed && (
        <p
          role="alert"
          className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+4.5rem)] rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {strings.map.failed}
        </p>
      )}
    </>
  );
}
