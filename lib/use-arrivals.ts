import { useEffect, useState } from "react";
import type { Arrivals } from "./arrivals.ts";

const REFRESH_MS = 15_000;
const FAILED: Arrivals = { state: "upstream_down", lines: [] };

export function useArrivals(stopId: string | null): Arrivals | null {
  const [result, setResult] = useState<{ stopId: string; arrivals: Arrivals } | null>(null);

  useEffect(() => {
    if (!stopId) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
    const load = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      let arrivals = FAILED;
      try {
        const response = await fetch(`/api/arrivals?stop=${encodeURIComponent(stopId)}`, { cache: "no-store" });
        arrivals = response.ok ? ((await response.json()) as Arrivals) : FAILED;
      } catch (error) {
        console.error("arrivals failed:", error);
      }
      if (!cancelled) {
        setResult({ stopId, arrivals });
      }
      if (arrivals.state === "unavailable") {
        stop();
      }
    };
    timer = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    load();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stopId]);

  return result?.stopId === stopId ? result.arrivals : null;
}
