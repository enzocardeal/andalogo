import { strings } from "./strings.ts";

export function headwayLabel(seconds: number | null): string {
  if (seconds === null) {
    return strings.stop.noService;
  }
  return `${strings.stop.every}${Math.max(1, Math.round(seconds / 60))} min`;
}
