import type { Trip, TripPlace } from "./trips.ts";

export type RouterRequest =
  | { type: "load"; routingUrls: string[]; stopsUrls: string[] }
  | { type: "plan"; id: number; from: TripPlace; to: TripPlace; departure: number; factor: number };

export type RouterResponse =
  | { type: "loaded"; elapsedMs: number }
  | { type: "planned"; id: number; trips: Trip[]; elapsedMs: number }
  | { type: "failed"; id: number | null; message: string };
