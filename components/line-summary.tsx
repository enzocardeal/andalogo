import { lineTimes } from "@/lib/headway";
import type { StopLine } from "@/lib/transit";

export function LineSummary({ line, now }: { line: StopLine; now: Date }) {
  const times = lineTimes(line, now);
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{line.headsign || line.long_name}</span>
        {times.next && <span className="truncate text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">{times.next}</span>}
      </span>
      <span
        className={`shrink-0 text-sm tabular-nums ${
          times.muted ? "text-neutral-400 dark:text-neutral-500" : "font-medium text-neutral-700 dark:text-neutral-300"
        }`}
      >
        {times.main}
      </span>
    </>
  );
}
