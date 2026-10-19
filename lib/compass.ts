const SMOOTHING = 0.25;

export type OrientationReading = { alpha: number | null; absolute: boolean; webkitCompassHeading?: number };

export function headingFrom(reading: OrientationReading, screenAngle: number): number | null {
  const ios = reading.webkitCompassHeading;
  const base =
    typeof ios === "number" && !Number.isNaN(ios) ? ios : reading.absolute && reading.alpha !== null ? 360 - reading.alpha : null;
  return base === null ? null : (((base + screenAngle) % 360) + 360) % 360;
}

export function smoothHeading(previous: number | null, heading: number): number {
  if (previous === null) {
    return heading;
  }
  const delta = ((((heading - previous) % 360) + 540) % 360) - 180;
  return previous + delta * SMOOTHING;
}

export function watchHeading(onHeading: (heading: number) => void): () => void {
  const type = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
  const listener = (event: Event) => {
    const heading = headingFrom(event as DeviceOrientationEvent & OrientationReading, screen.orientation?.angle ?? 0);
    if (heading !== null) {
      onHeading(heading);
    }
  };
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}

export type CompassAnswer = "granted" | "denied" | "needs-tap";

export async function requestCompass(): Promise<CompassAnswer> {
  const permission = (globalThis.DeviceOrientationEvent as { requestPermission?: () => Promise<string> } | undefined)?.requestPermission;
  if (!permission) {
    return "granted";
  }
  try {
    return (await permission()) === "granted" ? "granted" : "denied";
  } catch {
    return "needs-tap";
  }
}
