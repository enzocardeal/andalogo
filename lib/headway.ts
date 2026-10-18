import { strings } from "./strings.ts";

const CLOCK = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export type LineTimes = { main: string; next: string | null; muted: boolean };

export function headwayLabel(seconds: number | null): string {
  if (seconds === null) {
    return strings.stop.noService;
  }
  return `${strings.stop.every}${Math.max(1, Math.round(seconds / 60))} min`;
}

export function departureLabel(waitS: number, now: Date): string {
  const minutes = Math.floor(waitS / 60);
  if (minutes === 0) {
    return strings.stop.now;
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return CLOCK.format(new Date(now.getTime() + waitS * 1000));
}

export function lineTimes(
  line: { headway_s: number | null; departures: number[] | null },
  now: Date,
): LineTimes {
  if (line.departures === null) {
    return { main: headwayLabel(line.headway_s), next: null, muted: line.headway_s === null };
  }
  if (line.departures.length === 0) {
    return { main: strings.stop.noMoreDepartures, next: null, muted: true };
  }
  const [first, ...rest] = line.departures.map((wait) => departureLabel(wait, now));
  return { main: first, next: rest.length > 0 ? `${strings.stop.then} ${rest.join(" · ")}` : null, muted: false };
}
