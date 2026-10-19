import type { Place } from "./places.ts";
import type { Line, Mode } from "./transit.ts";

export const MAX_RECENT = 8;
const STORAGE_KEY = "andalogo.recentSearches";
const LABELS = { route: "short_name", stop: "name", place: "name" } as const;

export type RecentRoute = Pick<Line, "short_name" | "long_name" | "mode" | "color" | "text_color"> & { id: string };

export type RecentStop = { id: string; name: string; mode: Mode };

export type RecentSearch = { kind: "route"; route: RecentRoute } | { kind: "stop"; stop: RecentStop } | { kind: "place"; place: Place };

export function recentKey(entry: RecentSearch): string {
  if (entry.kind === "route") {
    return `route:${entry.route.id}`;
  }
  if (entry.kind === "stop") {
    return `stop:${entry.stop.id}`;
  }
  return `place:${entry.place.name}|${entry.place.lat.toFixed(4)}|${entry.place.lon.toFixed(4)}`;
}

export function addRecent(list: RecentSearch[], entry: RecentSearch): RecentSearch[] {
  const key = recentKey(entry);
  return [entry, ...list.filter((item) => recentKey(item) !== key)].slice(0, MAX_RECENT);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function labelOf(entry: RecentSearch): string {
  if (entry.kind === "route") {
    return `${entry.route.short_name} ${entry.route.long_name}`;
  }
  return entry.kind === "stop" ? entry.stop.name : `${entry.place.name} ${entry.place.detail}`;
}

export function matchRecent(list: RecentSearch[], term: string): RecentSearch[] {
  const needle = normalize(term.trim());
  return list.filter((entry) => normalize(labelOf(entry)).includes(needle));
}

function isRecent(value: unknown): value is RecentSearch {
  const entry = value as { kind?: unknown; [field: string]: unknown } | null;
  if (typeof entry !== "object" || entry === null || typeof entry.kind !== "string" || !(entry.kind in LABELS)) {
    return false;
  }
  const kind = entry.kind as keyof typeof LABELS;
  const item = entry[kind] as Record<string, unknown> | null | undefined;
  if (typeof item !== "object" || item === null || typeof item[LABELS[kind]] !== "string" || typeof item.id !== "string") {
    return false;
  }
  return kind !== "place" || (typeof item.lat === "number" && typeof item.lon === "number");
}

export function parseRecent(text: string | null): RecentSearch[] {
  try {
    const value: unknown = JSON.parse(text ?? "[]");
    return Array.isArray(value) ? value.filter(isRecent).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function loadRecent(): RecentSearch[] {
  try {
    return parseRecent(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveRecent(list: RecentSearch[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (error) {
    console.error("recent searches not saved:", error);
  }
}
