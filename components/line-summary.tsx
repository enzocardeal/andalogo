import type { LiveLine } from "@/lib/arrivals";
import { lineTimes } from "@/lib/headway";
import type { StopLine } from "@/lib/transit";

export function LineSummary({ line, now, live = null }: { line: StopLine; now: Date; live?: LiveLine | null }) {
  const times = lineTimes(line, now, live);
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{line.headsign || line.long_name}</span>
        {times.next && <span className="truncate text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">{times.next}</span>}
      </span>
      {times.live ? (
        <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-green-700 tabular-nums dark:text-green-400">
          <span aria-hidden="true" className="size-2 rounded-full bg-current motion-safe:animate-pulse" />
          {times.main}
        </span>
      ) : (
        <span
          className={`shrink-0 text-sm tabular-nums ${
            times.muted ? "text-neutral-400 dark:text-neutral-500" : "font-medium text-neutral-700 dark:text-neutral-300"
          }`}
        >
          {times.main}
        </span>
      )}
    </>
  );
}
