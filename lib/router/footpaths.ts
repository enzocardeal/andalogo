import type { Point } from "../geo.ts";
import { WALK_DETOUR, WALK_M_PER_MIN } from "../places.ts";
import type { Network } from "./network.ts";

export const TRANSFER_RADIUS_M = 400;
export const ACCESS_RADIUS_M = 1000;

const METERS_PER_DEGREE = 111_320;
const CELL_DEGREES = 0.004;

export type Footpaths = { start: Int32Array; to: Int32Array; seconds: Int32Array };

export type Access = { stop: number; seconds: number };

export function walkSeconds(meters: number): number {
  return Math.round((meters * WALK_DETOUR * 60) / WALK_M_PER_MIN);
}

function planarMeters(latA: number, lonA: number, latB: number, lonB: number): number {
  const scale = Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  return Math.hypot((lonB - lonA) * scale, latB - latA) * METERS_PER_DEGREE;
}

export function buildFootpaths(network: Pick<Network, "lat" | "lon">, radiusM = TRANSFER_RADIUS_M): Footpaths {
  const { lat, lon } = network;
  const cells = new Map<string, number[]>();
  const cellOf = (index: number) => [Math.floor(lat[index] / CELL_DEGREES), Math.floor(lon[index] / CELL_DEGREES)];
  for (let index = 0; index < lat.length; index++) {
    if (Number.isNaN(lat[index])) {
      continue;
    }
    const [row, column] = cellOf(index);
    const key = `${row}|${column}`;
    cells.set(key, [...(cells.get(key) ?? []), index]);
  }
  const start = new Int32Array(lat.length + 1);
  const to: number[] = [];
  const seconds: number[] = [];
  for (let index = 0; index < lat.length; index++) {
    start[index] = to.length;
    if (Number.isNaN(lat[index])) {
      continue;
    }
    const [row, column] = cellOf(index);
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = column - 1; c <= column + 1; c++) {
        for (const other of cells.get(`${r}|${c}`) ?? []) {
          if (other === index) {
            continue;
          }
          const meters = planarMeters(lat[index], lon[index], lat[other], lon[other]);
          if (meters <= radiusM) {
            to.push(other);
            seconds.push(walkSeconds(meters));
          }
        }
      }
    }
  }
  start[lat.length] = to.length;
  return { start, to: Int32Array.from(to), seconds: Int32Array.from(seconds) };
}

export function stopsNear(network: Pick<Network, "lat" | "lon">, point: Point, radiusM = ACCESS_RADIUS_M): Access[] {
  const { lat, lon } = network;
  const latSpan = radiusM / METERS_PER_DEGREE;
  const lonSpan = latSpan / Math.cos((point.lat * Math.PI) / 180);
  const found: Access[] = [];
  for (let index = 0; index < lat.length; index++) {
    if (Math.abs(lat[index] - point.lat) > latSpan || Math.abs(lon[index] - point.lon) > lonSpan) {
      continue;
    }
    const meters = planarMeters(point.lat, point.lon, lat[index], lon[index]);
    if (meters <= radiusM) {
      found.push({ stop: index, seconds: walkSeconds(meters) });
    }
  }
  return found;
}
