export type Feed = "sptrans" | "artesp";

export type Mode = "bus" | "metro" | "cptm" | "emtu";

export const MODES: readonly Mode[] = ["bus", "metro", "cptm", "emtu"];

export const RAIL_MODES: readonly Mode[] = ["metro", "cptm"];

export const FEED_PREFIX: Record<Feed, string> = { sptrans: "sp", artesp: "ar" };

export type Line = {
  route_id: string;
  short_name: string;
  long_name: string;
  mode: Mode;
  color: string | null;
  text_color: string | null;
};

export type StopLine = Line & { direction_id: number; headsign: string; headway_s: number | null };

export type StopDetails = {
  id: string;
  name: string;
  mode: Mode;
  lat: number;
  lon: number;
  favorite: boolean;
  lines: StopLine[];
};

export type Favorite = { stop_id: string; stop: StopDetails | null };

export type PatternStop = { id: string; name: string; lat: number; lon: number };

export type RoutePattern = { direction_id: number; headsign: string; polyline: string; stops: PatternStop[] };

export type RouteDetails = {
  id: string;
  short_name: string;
  long_name: string;
  mode: Mode;
  color: string | null;
  text_color: string | null;
  patterns: RoutePattern[];
};

export type SearchResult = {
  routes: (Line & { id: string })[];
  stops: { id: string; name: string; mode: Mode; lat: number; lon: number }[];
};
