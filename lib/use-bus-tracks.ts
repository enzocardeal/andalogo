import { useEffect, useState } from "react";
import type { LineRef, LineTracks } from "./bus-tracks.ts";

const REFRESH_MS = 15_000;
const NONE: LineTracks[] = [];

export function linesKey(lines: LineRef[]): string {
  return [...new Set(lines.map((line) => `${line.routeId}:${line.directionId}`))].join(",");
}

export function useBusTracks(key: string): LineTracks[] {
  const [result, setResult] = useState<{ key: string; lines: LineTracks[] } | null>(null);

  useEffect(() => {
    if (!key) {
      return;
    }
    let cancelled = false;
    const query = key
      .split(",")
      .map((line) => `line=${encodeURIComponent(line)}`)
      .join("&");
    const load = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      try {
        const response = await fetch(`/api/positions?${query}`, { cache: "no-store" });
        if (response.ok) {
          const { lines } = (await response.json()) as { lines: LineTracks[] };
          if (!cancelled) {
            setResult({ key, lines });
          }
        }
      } catch (error) {
        console.error("positions failed:", error);
      }
    };
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    load();
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [key]);

  return result?.key === key ? result.lines : NONE;
}
