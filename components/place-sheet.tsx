"use client";

import { CloseButton, Sheet } from "@/components/stop-sheet";
import { SIGN_COLORS } from "@/lib/map-layers";
import { DEFAULT_ROUTE_COLOR } from "@/lib/map-view";
import { formatDistance, walkMinutes, type NearbyStop } from "@/lib/places";
import { strings } from "@/lib/strings";

type PlaceSheetProps = {
  label: string;
  stops: NearbyStop[] | null;
  onStop: (stopId: string) => void;
  onClose: () => void;
};

function modeColor(stop: NearbyStop): string {
  if (stop.mode === "bus") {
    return SIGN_COLORS.bus;
  }
  if (stop.mode === "emtu") {
    return SIGN_COLORS.emtu;
  }
  return stop.color ?? DEFAULT_ROUTE_COLOR;
}

export function PlaceSheet({ label, stops, onStop, onClose }: PlaceSheetProps) {
  return (
    <Sheet>
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">{strings.place.near}</span>
          <h2 className="truncate text-lg font-semibold">{label}</h2>
        </div>
        <CloseButton label={strings.place.close} onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain px-4 pb-4">
        {stops === null ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{strings.loading}</p>
        ) : stops.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.place.none}</p>
        ) : (
          <ul className="flex flex-col">
            {stops.map((stop) => (
              <li key={stop.id}>
                <button type="button" onClick={() => onStop(stop.id)} className="flex min-h-14 w-full items-center gap-3 text-left">
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: modeColor(stop) }} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{stop.name}</span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">{strings.modes[stop.mode]}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end text-sm tabular-nums">
                    <span className="font-medium">{formatDistance(stop.distanceM)}</span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {walkMinutes(stop.distanceM)} min {strings.place.walk}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
