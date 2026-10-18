import { useEffect, useState } from "react";
import { glide, lineMotion, targetAlong } from "./bus-motion.ts";
import type { LineTracks } from "./bus-tracks.ts";

const REFRESH_MS = 2000;

export function useBusProgress(line: LineTracks | null, p: string | null): number | null {
  const [progress, setProgress] = useState<{ key: string; alongM: number } | null>(null);
  const track = line?.buses.find((bus) => bus.p === p) ?? null;
  const key = line && p ? `${line.routeId}|${line.directionId}|${p}` : null;

  useEffect(() => {
    if (!line || !key || !track || track.alongM === null) {
      return;
    }
    const motion = lineMotion(line);
    const placed = { ...track, alongM: track.alongM };
    const update = () => {
      const target = targetAlong(motion, placed, Date.now());
      setProgress((previous) => ({ key, alongM: glide(previous?.key === key ? previous.alongM : null, target, REFRESH_MS / 1000) }));
    };
    update();
    const timer = setInterval(update, REFRESH_MS);
    return () => clearInterval(timer);
  }, [line, track, key]);

  return progress?.key === key ? progress.alongM : null;
}
