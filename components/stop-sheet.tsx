"use client";

import { useEffect, useState, type ReactNode } from "react";
import { StarIcon } from "@/components/bottom-nav";
import { LineBadge } from "@/components/line-badge";
import { headwayLabel } from "@/lib/headway";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { StopDetails } from "@/lib/transit";

type Loaded = { stopId: string; stop: StopDetails | null; failed: boolean };

type StopSheetProps = {
  stopId: string;
  onClose: () => void;
  onRoute: (routeId: string, dir: number) => void;
};

export function StopSheet({ stopId, onClose, onRoute }: StopSheetProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [favoriteFailed, setFavoriteFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("get_stop", { p_stop_id: stopId })
      .then(({ data, error }) => {
        if (error) {
          console.error("get_stop failed:", error.message);
        }
        if (!cancelled) {
          setLoaded({ stopId, stop: (data as StopDetails | null) ?? null, failed: error !== null });
          setFavoriteFailed(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stopId]);

  const current = loaded?.stopId === stopId ? loaded : null;
  const stop = current?.stop ?? null;

  async function toggleFavorite() {
    if (!stop) {
      return;
    }
    const favorite = !stop.favorite;
    setLoaded({ stopId, stop: { ...stop, favorite }, failed: false });
    setFavoriteFailed(false);
    const { error } = await createClient().rpc(favorite ? "add_favorite" : "remove_favorite", {
      p_stop_id: stop.id,
    });
    if (error) {
      console.error("favorite failed:", error.message);
      setLoaded({ stopId, stop, failed: false });
      setFavoriteFailed(true);
    }
  }

  return (
    <Sheet>
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-lg font-semibold">{stop?.name ?? strings.loading}</h2>
          {stop && (
            <p className="text-sm text-neutral-500">
              {strings.modes[stop.mode]} · {strings.stop.scheduled}
            </p>
          )}
        </div>
        <div className="flex shrink-0">
          {stop && (
            <button
              type="button"
              onClick={toggleFavorite}
              aria-pressed={stop.favorite}
              aria-label={stop.favorite ? strings.stop.removeFavorite : strings.stop.addFavorite}
              className={`flex size-11 items-center justify-center rounded-full ${
                stop.favorite ? "text-amber-500" : "text-neutral-500"
              }`}
            >
              <StarIcon filled={stop.favorite} />
            </button>
          )}
          <CloseButton label={strings.stop.close} onClick={onClose} />
        </div>
      </header>
      <div className="overflow-y-auto px-4 pb-4">
        {favoriteFailed && (
          <p role="alert" className="mb-2 text-sm text-red-700">
            {strings.stop.favoriteFailed}
          </p>
        )}
        <StopBody loaded={current} onRoute={onRoute} />
      </div>
    </Sheet>
  );
}

function StopBody({ loaded, onRoute }: { loaded: Loaded | null; onRoute: StopSheetProps["onRoute"] }) {
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
        <li key={`${line.route_id}:${line.direction_id}`}>
          <button
            type="button"
            onClick={() => onRoute(line.route_id, line.direction_id)}
            aria-label={`${line.short_name} ${line.headsign}. ${strings.stop.showRoute}`}
            className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
          >
            <LineBadge line={line} />
            <span className="min-w-0 flex-1 truncate">{line.headsign || line.long_name}</span>
            <span
              className={`shrink-0 text-sm tabular-nums ${line.headway_s === null ? "text-neutral-400" : "text-neutral-700"}`}
            >
              {headwayLabel(line.headway_s)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Sheet({ children }: { children: ReactNode }) {
  return (
    <section
      aria-live="polite"
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[60%] flex-col rounded-t-2xl bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
    >
      {children}
    </section>
  );
}

export function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-2xl text-neutral-500"
    >
      ×
    </button>
  );
}
