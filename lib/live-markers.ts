import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { NextBus } from "./arrivals.ts";
import { LIVE_ICON_SVG } from "./live-icon.ts";
import { DEFAULT_ROUTE_COLOR } from "./map-view.ts";
import type { StopLine } from "./transit.ts";

const BUS_GLYPH =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">' +
  '<rect x="3" y="1.5" width="10" height="11" rx="2"/><rect x="4.5" y="3" width="7" height="4" rx="0.8" fill="var(--glyph-window)"/>' +
  '<rect x="4" y="12" width="2.4" height="2.5" rx="0.8"/><rect x="9.6" y="12" width="2.4" height="2.5" rx="0.8"/></svg>';

export function busLabel(bus: NextBus, line: StopLine | undefined): string {
  return line?.short_name ?? bus.routeId.replace(/^sp:/, "");
}

function busElement(bus: NextBus, line: StopLine | undefined): HTMLElement {
  const color = line?.color ?? DEFAULT_ROUTE_COLOR;
  const element = document.createElement("div");
  element.className = "live-bus";
  const icon = document.createElement("span");
  icon.className = "live-bus-icon";
  icon.style.backgroundColor = color;
  icon.style.setProperty("--glyph-window", color);
  icon.innerHTML = BUS_GLYPH;
  const live = document.createElement("span");
  live.className = "live-bus-signal";
  live.innerHTML = LIVE_ICON_SVG;
  const label = document.createElement("span");
  label.textContent = busLabel(bus, line);
  element.append(icon, live, label);
  return element;
}

export function showLiveMarkers(
  maplibregl: typeof import("maplibre-gl"),
  map: MapLibreMap,
  buses: NextBus[],
  lines: StopLine[],
): () => void {
  const markers: Marker[] = [];
  for (const bus of buses) {
    const line = lines.find((candidate) => candidate.route_id === bus.routeId && candidate.direction_id === bus.directionId);
    markers.push(new maplibregl.Marker({ element: busElement(bus, line) }).setLngLat([bus.lon, bus.lat]).addTo(map));
  }
  return () => markers.forEach((marker) => marker.remove());
}
