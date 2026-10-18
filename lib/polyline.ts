export type LatLon = [number, number];

const FACTOR = 1e5;

function encodeValue(value: number): string {
  let rest = value < 0 ? ~(value << 1) : value << 1;
  let text = "";
  while (rest >= 0x20) {
    text += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
    rest >>= 5;
  }
  return text + String.fromCharCode(rest + 63);
}

export function encodePolyline(points: LatLon[]): string {
  let lastLat = 0;
  let lastLon = 0;
  let text = "";
  for (const [lat, lon] of points) {
    const latE5 = Math.round(lat * FACTOR);
    const lonE5 = Math.round(lon * FACTOR);
    text += encodeValue(latE5 - lastLat) + encodeValue(lonE5 - lastLon);
    lastLat = latE5;
    lastLon = lonE5;
  }
  return text;
}

export function decodePolyline(text: string): LatLon[] {
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = text.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) {
    lat += next();
    lon += next();
    points.push([lat / FACTOR, lon / FACTOR]);
  }
  return points;
}
