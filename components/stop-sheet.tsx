"use client";

import { useEffect, useState, type ReactNode } from "react";
import { StarIcon } from "@/components/bottom-nav";
import { LineBadge } from "@/components/line-badge";
import { LineSummary } from "@/components/line-summary";
import { liveLineFor, sortByArrival, type Arrivals } from "@/lib/arrivals";
import { SHEET_SHARE } from "@/lib/map-view";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { StopDetails } from "@/lib/transit";
import { useArrivals } from "@/lib/use-arrivals";

type Loaded = { stopId: string; stop: StopDetails | null; failed: boolean; fetchedAt: Date };

type StopSheetProps = {
  stopId: string;
  onClose: () => void;
  onRoute: (routeId: string, dir: number) => void;
  onFavoriteChange: (stopId: string, favorite: boolean) => void;
};

export function StopSheet({ stopId, onClose, onRoute, onFavoriteChange }: StopSheetProps) {
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
          setLoaded({ stopId, stop: (data as StopDetails | null) ?? null, failed: error !== null, fetchedAt: new Date() });
          setFavoriteFailed(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stopId]);

  const current = loaded?.stopId === stopId ? loaded : null;
  const stop = current?.stop ?? null;
  const arrivals = useArrivals(stop && stop.mode === "bus" && stop.id.startsWith("sp:") ? stop.id : null);
  const live = arrivals?.state === "live";

  async function toggleFavorite() {
    if (!stop) {
      return;
    }
    const favorite = !stop.favorite;
    setLoaded({ stopId, stop: { ...stop, favorite }, failed: false, fetchedAt: current!.fetchedAt });
    setFavoriteFailed(false);
    onFavoriteChange(stop.id, favorite);
    const { error } = await createClient().rpc(favorite ? "add_favorite" : "remove_favorite", {
      p_stop_id: stop.id,
    });
    if (error) {
      console.error("favorite failed:", error.message);
      setLoaded({ stopId, stop, failed: false, fetchedAt: current!.fetchedAt });
      setFavoriteFailed(true);
      onFavoriteChange(stop.id, !favorite);
    }
  }

  return (
    <Sheet>
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-lg font-semibold">{stop?.name ?? strings.loading}</h2>
          {stop && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {strings.modes[stop.mode]} ·{" "}
              {live ? strings.arrivals.live : stop.mode === "emtu" ? strings.stop.timetable : strings.stop.scheduled}
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
                stop.favorite ? "text-amber-500" : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              <StarIcon filled={stop.favorite} />
            </button>
          )}
          <CloseButton label={strings.stop.close} onClick={onClose} />
        </div>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        {favoriteFailed && (
          <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-400">
            {strings.stop.favoriteFailed}
          </p>
        )}
        {arrivals && !live && arrivals.state !== "unavailable" && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {strings.arrivals.noLiveData}
          </p>
        )}
        <StopBody loaded={current} arrivals={arrivals} onRoute={onRoute} />
      </div>
    </Sheet>
  );
}

type StopBodyProps = { loaded: Loaded | null; arrivals: Arrivals | null; onRoute: StopSheetProps["onRoute"] };

function StopBody({ loaded, arrivals, onRoute }: StopBodyProps) {
  if (!loaded) {
    return null;
  }
  if (loaded.failed) {
    return <p role="alert" className="text-sm text-red-700 dark:text-red-400">{strings.stop.failed}</p>;
  }
  if (!loaded.stop) {
    return <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.stop.notFound}</p>;
  }
  if (loaded.stop.lines.length === 0) {
    return <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.stop.noLines}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
      {sortByArrival(loaded.stop.lines, arrivals).map((line) => (
        <li key={`${line.route_id}:${line.direction_id}`}>
          <button
            type="button"
            onClick={() => onRoute(line.route_id, line.direction_id)}
            aria-label={`${line.short_name} ${line.headsign}. ${strings.stop.showRoute}`}
            className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
          >
            <LineBadge line={line} />
            <LineSummary
              line={line}
              now={loaded.fetchedAt}
              live={liveLineFor(arrivals, line.route_id, line.direction_id)}
            />
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
      style={{ maxHeight: `${SHEET_SHARE * 100}%` }}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl bg-white dark:bg-neutral-900 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
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
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-2xl text-neutral-500 dark:text-neutral-400"
    >
      ×
    </button>
  );
}
