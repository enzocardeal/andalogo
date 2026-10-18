import { DEFAULT_ROUTE_COLOR } from "@/lib/map-view";
import type { Line } from "@/lib/transit";

export function LineBadge({ line }: { line: Pick<Line, "short_name" | "color" | "text_color"> }) {
  return (
    <span
      className="shrink-0 rounded px-2 py-1 text-sm font-semibold tabular-nums"
      style={{ backgroundColor: line.color ?? DEFAULT_ROUTE_COLOR, color: line.text_color ?? "#ffffff" }}
    >
      {line.short_name}
    </span>
  );
}
