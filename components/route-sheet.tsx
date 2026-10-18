"use client";

import { Fragment, useEffect, useRef, type CSSProperties } from "react";
import { CloseButton, Sheet } from "@/components/stop-sheet";
import { LineBadge } from "@/components/line-badge";
import { passedStops } from "@/lib/bus-motion";
import { BUS_ICON_SVG } from "@/lib/live-icon";
import { DEFAULT_ROUTE_COLOR, patternOf } from "@/lib/map-view";
import { strings } from "@/lib/strings";
import type { RouteDetails } from "@/lib/transit";

export type RouteProgress = { offsets: number[]; alongM: number };

type RouteSheetProps = {
  route: RouteDetails | null;
  failed: boolean;
  dir: number;
  selectedStopId: string | null;
  progress: RouteProgress | null;
  onDirection: (dir: number) => void;
  onStop: (stopId: string) => void;
  onClose: () => void;
};

const CHECK_SVG =
  '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6"/></svg>';

export function RouteSheet({ route, failed, dir, selectedStopId, progress, onDirection, onStop, onClose }: RouteSheetProps) {
  const pattern = route ? patternOf(route, dir) : null;
  const other = route?.patterns.find((candidate) => candidate.direction_id !== pattern?.direction_id) ?? null;
  const color = route?.color ?? DEFAULT_ROUTE_COLOR;
  const passed =
    pattern && progress && progress.offsets.length === pattern.stops.length ? passedStops(progress.offsets, progress.alongM) : null;
  const list = useRef<HTMLDivElement>(null);
  const busRow = useRef<HTMLLIElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const scrollKey = route && passed !== null ? `${route.id}|${dir}` : null;

  useEffect(() => {
    if (!scrollKey || scrolledFor.current === scrollKey || !list.current || !busRow.current) {
      return;
    }
    scrolledFor.current = scrollKey;
    const listBox = list.current.getBoundingClientRect();
    const rowBox = busRow.current.getBoundingClientRect();
    list.current.scrollTop += rowBox.top - listBox.top - (listBox.height - rowBox.height) / 2;
  }, [scrollKey]);

  const bus = route && (
    <li ref={busRow} className="-ml-1 flex min-h-9 items-center gap-2">
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 place-items-center rounded-full text-white"
        style={{ backgroundColor: color, "--glyph-window": color } as CSSProperties}
        dangerouslySetInnerHTML={{ __html: BUS_ICON_SVG }}
      />
      <span className="text-sm font-semibold" style={{ color }}>
        {route.short_name} · {strings.route.busHere}
      </span>
    </li>
  );

  return (
    <Sheet>
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          {route ? (
            <span className="flex min-w-0 items-center gap-2">
              <LineBadge line={route} />
              <span className="truncate text-sm text-neutral-600 dark:text-neutral-400">{route.long_name}</span>
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
      <div ref={list} className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-4 pb-4">
        {other && (
          <button
            type="button"
            onClick={() => onDirection(other.direction_id)}
            className="min-h-11 self-start rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 text-sm font-medium"
          >
            ⇄ {strings.route.switchDirection}
          </button>
        )}
        {route && !pattern && <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.route.notFound}</p>}
        {pattern && (
          <>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {pattern.stops.length} {strings.route.stops}
            </p>
            <ol className="flex flex-col">
              {pattern.stops.map((stop, index) => {
                const ticked = passed !== null && index < passed;
                const selected = stop.id === selectedStopId;
                return (
                  <Fragment key={`${stop.id}:${index}`}>
                    {passed === index && bus}
                    <li>
                      <button
                        type="button"
                        onClick={() => onStop(stop.id)}
                        className="flex min-h-11 w-full items-center gap-3 text-left"
                      >
                        {ticked ? (
                          <span
                            aria-hidden="true"
                            className="grid size-3 shrink-0 place-items-center rounded-full"
                            style={{ backgroundColor: color, color: route?.text_color ?? "#FFFFFF" }}
                            dangerouslySetInnerHTML={{ __html: CHECK_SVG }}
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="size-3 shrink-0 rounded-full border-2 bg-white dark:bg-neutral-900"
                            style={{ borderColor: color }}
                          />
                        )}
                        <span
                          className={`truncate ${ticked ? "text-neutral-400 dark:text-neutral-500" : ""} ${selected ? "font-semibold" : ""}`}
                        >
                          {stop.name}
                          {ticked && <span className="sr-only"> ({strings.route.passed})</span>}
                        </span>
                        {selected && (
                          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{strings.route.yourStop}</span>
                        )}
                      </button>
                    </li>
                  </Fragment>
                );
              })}
              {passed === pattern.stops.length && bus}
            </ol>
          </>
        )}
      </div>
    </Sheet>
  );
}
