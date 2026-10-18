"use client";

import { CloseButton, Sheet } from "@/components/stop-sheet";
import { LineBadge } from "@/components/line-badge";
import { DEFAULT_ROUTE_COLOR, patternOf } from "@/lib/map-view";
import { strings } from "@/lib/strings";
import type { RouteDetails } from "@/lib/transit";

type RouteSheetProps = {
  route: RouteDetails | null;
  failed: boolean;
  dir: number;
  onDirection: (dir: number) => void;
  onStop: (stopId: string) => void;
  onClose: () => void;
};

export function RouteSheet({ route, failed, dir, onDirection, onStop, onClose }: RouteSheetProps) {
  const pattern = route ? patternOf(route, dir) : null;
  const other = route?.patterns.find((candidate) => candidate.direction_id !== pattern?.direction_id) ?? null;

  return (
    <Sheet>
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          {route ? (
            <span className="flex min-w-0 items-center gap-2">
              <LineBadge line={route} />
              <span className="truncate text-sm text-neutral-600">{route.long_name}</span>
            </span>
          ) : (
            <h2 className="text-lg font-semibold">{failed ? strings.route.failed : strings.loading}</h2>
          )}
          {pattern && (
            <h2 className="text-lg font-semibold">
              {strings.route.towards} {pattern.headsign}
            </h2>
          )}
        </div>
        <CloseButton label={strings.route.close} onClick={onClose} />
      </header>
      <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
        {other && (
          <button
            type="button"
            onClick={() => onDirection(other.direction_id)}
            className="min-h-11 self-start rounded-lg border border-neutral-300 px-4 text-sm font-medium"
          >
            ⇄ {strings.route.switchDirection}
          </button>
        )}
        {route && !pattern && <p className="text-sm text-neutral-600">{strings.route.notFound}</p>}
        {pattern && (
          <>
            <p className="text-sm text-neutral-500">
              {pattern.stops.length} {strings.route.stops}
            </p>
            <ol className="flex flex-col">
              {pattern.stops.map((stop, index) => (
                <li key={`${stop.id}:${index}`}>
                  <button
                    type="button"
                    onClick={() => onStop(stop.id)}
                    className="flex min-h-11 w-full items-center gap-3 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-full border-2 bg-white"
                      style={{ borderColor: route?.color ?? DEFAULT_ROUTE_COLOR }}
                    />
                    <span className="truncate">{stop.name}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </Sheet>
  );
}
