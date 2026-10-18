import type { LatLon } from "../polyline.ts";
import { readCsv } from "./zip.ts";

export async function readShapes(path: string, wanted: Set<string>): Promise<Map<string, LatLon[]>> {
  const points = new Map<string, [number, number, number][]>();
  for await (const row of readCsv(path, "shapes.txt")) {
    if (!wanted.has(row.shape_id)) {
      continue;
    }
    let shape = points.get(row.shape_id);
    if (!shape) {
      shape = [];
      points.set(row.shape_id, shape);
    }
    shape.push([Number(row.shape_pt_sequence), Number(row.shape_pt_lat), Number(row.shape_pt_lon)]);
  }
  return new Map(
    [...points].map(([id, shape]) => [id, shape.sort((a, b) => a[0] - b[0]).map(([, lat, lon]): LatLon => [lat, lon])]),
  );
}
