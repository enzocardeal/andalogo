"use client";

import { useEffect, useState } from "react";
import { headwayLabel } from "@/lib/headway";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { Mode } from "@/lib/transit";

type StopLine = {
  route_id: string;
  short_name: string;
  long_name: string;
  mode: Mode;
  color: string | null;
  text_color: string | null;
  direction_id: number;
  headsign: string;
  headway_s: number | null;
};

type Stop = { id: string; name: string; mode: Mode; lines: StopLine[] };

type Loaded = { stopId: string; stop: Stop | null; failed: boolean };

export function StopSheet({ stopId, onClose }: { stopId: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("get_stop", { p_stop_id: stopId })
      .then(({ data, error }) => {
        if (error) {
          console.error("get_stop failed:", error.message);
        }
        if (!cancelled) {
          setLoaded({ stopId, stop: (data as Stop | null) ?? null, failed: error !== null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stopId]);

  const current = loaded?.stopId === stopId ? loaded : null;

  return (
    <section
      aria-live="polite"
      className="absolute inset-x-0 bottom-0 flex max-h-[60dvh] flex-col rounded-t-2xl bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
    >
      <header className="flex items-start justify-between gap-4 px-4 pt-4 pb-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-lg font-semibold">{current?.stop?.name ?? strings.loading}</h2>
          {current?.stop && (
            <p className="text-sm text-neutral-500">
              {strings.modes[current.stop.mode]} · {strings.stop.scheduled}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={strings.stop.close}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-2xl text-neutral-500"
        >
          ×
        </button>
      </header>
      <div className="overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <StopBody loaded={current} />
      </div>
    </section>
  );
}

function StopBody({ loaded }: { loaded: Loaded | null }) {
  if (!loaded) {
    return null;
  }
  if (loaded.failed) {
    return <p role="alert" className="text-sm text-red-700">{strings.stop.failed}</p>;
  }
  if (!loaded.stop) {
    return <p className="text-sm text-neutral-600">{strings.stop.notFound}</p>;
  }
  if (loaded.stop.lines.length === 0) {
    return <p className="text-sm text-neutral-600">{strings.stop.noLines}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-neutral-100">
      {loaded.stop.lines.map((line) => (
        <li key={`${line.route_id}:${line.direction_id}`} className="flex min-h-14 items-center gap-3 py-2">
          <span
            className="shrink-0 rounded px-2 py-1 text-sm font-semibold tabular-nums"
            style={{ backgroundColor: line.color ?? "#334155", color: line.text_color ?? "#ffffff" }}
          >
            {line.short_name}
          </span>
          <span className="min-w-0 flex-1 truncate">{line.headsign || line.long_name}</span>
          <span
            className={`shrink-0 text-sm tabular-nums ${line.headway_s === null ? "text-neutral-400" : "text-neutral-700"}`}
          >
            {headwayLabel(line.headway_s)}
          </span>
        </li>
      ))}
    </ul>
  );
}
