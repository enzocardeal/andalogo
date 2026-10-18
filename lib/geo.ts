const EARTH_RADIUS_M = 6_371_000;

export type Point = { lat: number; lon: number };

export function distanceMeters(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function meanBearing(bearings: number[]): { bearing: number; agreement: number } | null {
  if (bearings.length === 0) {
    return null;
  }
  const rad = Math.PI / 180;
  const x = bearings.reduce((sum, bearing) => sum + Math.sin(bearing * rad), 0) / bearings.length;
  const y = bearings.reduce((sum, bearing) => sum + Math.cos(bearing * rad), 0) / bearings.length;
  return { bearing: (Math.round(Math.atan2(x, y) / rad) + 360) % 360, agreement: Math.hypot(x, y) };
}
