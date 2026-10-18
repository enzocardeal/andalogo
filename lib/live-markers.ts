import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { NextBus } from "./arrivals.ts";
import { createMotion, type MovingBus } from "./bus-motion.ts";
import { LIVE_ICON_SVG } from "./live-icon.ts";
import type { StopLine } from "./transit.ts";

const BUS_GLYPH =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">' +
  '<rect x="3" y="1.5" width="10" height="11" rx="2"/><rect x="4.5" y="3" width="7" height="4" rx="0.8" fill="var(--glyph-window)"/>' +
  '<rect x="4" y="12" width="2.4" height="2.5" rx="0.8"/><rect x="9.6" y="12" width="2.4" height="2.5" rx="0.8"/></svg>';

const ICON_CENTER_PX = 31;

const ARROW_GLYPH =
  '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M6 1 10.5 10.5 6 8 1.5 10.5z"/></svg>';

export type ShownBus = { key: string; label: string; color: string; lat: number; lon: number; moving: MovingBus | null };

type Shown = { marker: Marker; arrow: HTMLElement; bus: ShownBus };

export function busLabel(bus: Pick<NextBus, "routeId">, line: StopLine | undefined): string {
  return line?.short_name ?? bus.routeId.replace(/^sp:/, "");
}

function busElement(bus: ShownBus): { element: HTMLElement; arrow: HTMLElement } {
  const element = document.createElement("div");
  element.className = "live-bus";
  const arrow = document.createElement("span");
  arrow.className = "live-bus-arrow";
  arrow.innerHTML = ARROW_GLYPH;
  const icon = document.createElement("span");
  icon.className = "live-bus-icon";
  icon.style.backgroundColor = bus.color;
  icon.style.setProperty("--glyph-window", bus.color);
  icon.innerHTML = BUS_GLYPH;
  const live = document.createElement("span");
  live.className = "live-bus-signal";
  live.innerHTML = LIVE_ICON_SVG;
  const label = document.createElement("span");
  label.textContent = bus.label;
  element.append(arrow, icon, live, label);
  return { element, arrow };
}

export type BusLayer = { update(buses: ShownBus[]): void; remove(): void };

export function createBusLayer(maplibregl: typeof import("maplibre-gl"), map: MapLibreMap): BusLayer {
  const shown = new Map<string, Shown>();
  const frame = createMotion();
  let frameId = 0;
  let last = 0;

  function tick(time: number) {
    const dtS = last ? Math.min(1, (time - last) / 1000) : 0;
    last = time;
    const moving = [...shown.values()].flatMap(({ bus }) => (bus.moving ? [bus.moving] : []));
    const points = frame(moving, Date.now(), dtS);
    const mapBearing = map.getBearing();
    for (const { marker, arrow, bus } of shown.values()) {
      const point = points.get(bus.key);
      if (point) {
        marker.setLngLat([point.lon, point.lat]);
        arrow.style.transform = `rotate(${point.bearing - mapBearing}deg)`;
      }
    }
    frameId = moving.length > 0 ? requestAnimationFrame(tick) : 0;
  }

  function update(buses: ShownBus[]) {
    const keys = new Set(buses.map((bus) => bus.key));
    for (const [key, entry] of shown) {
      if (!keys.has(key)) {
        entry.marker.remove();
        shown.delete(key);
      }
    }
    for (const bus of buses) {
      let entry = shown.get(bus.key);
      if (!entry) {
        const { element, arrow } = busElement(bus);
        const marker = new maplibregl.Marker({ element, anchor: "left", offset: [-ICON_CENTER_PX, 0] });
        entry = { marker: marker.setLngLat([bus.lon, bus.lat]).addTo(map), arrow, bus };
        shown.set(bus.key, entry);
      }
      entry.bus = bus;
      entry.arrow.style.visibility = bus.moving ? "visible" : "hidden";
      if (!bus.moving) {
        entry.marker.setLngLat([bus.lon, bus.lat]);
      }
    }
    if (frameId === 0 && buses.some((bus) => bus.moving)) {
      last = 0;
      frameId = requestAnimationFrame(tick);
    }
  }

  function remove() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    shown.forEach((entry) => entry.marker.remove());
    shown.clear();
  }

  return { update, remove };
}
