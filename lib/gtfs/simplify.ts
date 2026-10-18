import type { LatLon } from "../polyline.ts";

const METERS_PER_DEGREE = 111_320;

export function simplify(points: LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2) {
    return points;
  }
  const cosLat = Math.cos((points[0][0] * Math.PI) / 180);
  const xy = points.map(([lat, lon]) => [lon * cosLat * METERS_PER_DEGREE, lat * METERS_PER_DEGREE]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const ranges: [number, number][] = [[0, points.length - 1]];
  while (ranges.length > 0) {
    const [first, last] = ranges.pop()!;
    const [ax, ay] = xy[first];
    const [bx, by] = xy[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    let farthest = -1;
    let maxDistance = toleranceM;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = xy[i];
      const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      ranges.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
