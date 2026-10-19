import { bucketOf } from "./eta-calibration.ts";
import { loadRouterUrls } from "./map-stops.ts";
import type { RouterRequest, RouterResponse } from "./router/messages.ts";
import type { BoardingChoice, Trip, TripPlace } from "./router/trips.ts";
import { createClient } from "./supabase/client.ts";

type Pending = { resolve: (response: RouterResponse) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let loaded: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let onLoaded: { resolve: () => void; reject: (error: Error) => void } | null = null;

function routerWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./router/router.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<RouterResponse>) => {
      if (data.type === "loaded") {
        onLoaded?.resolve();
      } else if (data.type !== "failed") {
        pending.get(data.id)?.resolve(data);
        pending.delete(data.id);
      } else if (data.id === null) {
        onLoaded?.reject(new Error(data.message));
      } else {
        pending.get(data.id)?.reject(new Error(data.message));
        pending.delete(data.id);
      }
    };
  }
  return worker;
}

export function prepareRouter(): Promise<void> {
  if (!loaded) {
    loaded = loadRouterUrls().then(
      ({ routingUrls, stopsUrls }) =>
        new Promise<void>((resolve, reject) => {
          if (routingUrls.length === 0) {
            reject(new Error("no routing files"));
            return;
          }
          onLoaded = { resolve, reject };
          navigator.storage?.persist?.().catch(() => false);
          const request: RouterRequest = { type: "load", routingUrls, stopsUrls };
          routerWorker().postMessage(request);
        }),
    );
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

async function factorAt(departure: Date): Promise<number> {
  const { dayType, hour } = bucketOf(departure);
  const { data, error } = await createClient().rpc("eta_factor", { p_day_type: dayType, p_hour: hour });
  if (error) {
    console.error("eta_factor failed:", error.message);
  }
  return typeof data === "number" && data > 0 ? data : 1;
}

function ask(request: (id: number) => RouterRequest): Promise<RouterResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    routerWorker().postMessage(request(id));
  });
}

export async function planTrip(from: TripPlace, to: TripPlace, departure: Date): Promise<Trip[]> {
  const [factor] = await Promise.all([factorAt(departure), prepareRouter()]);
  const response = await ask((id) => ({ type: "plan", id, from, to, departure: departure.getTime(), factor }));
  return response.type === "planned" ? response.trips : [];
}

export async function boardingChoices(from: TripPlace, to: TripPlace, trip: Trip, leg: number): Promise<BoardingChoice[]> {
  const [factor] = await Promise.all([factorAt(new Date(trip.depart)), prepareRouter()]);
  const response = await ask((id) => ({ type: "boarding", id, from, to, trip, leg, factor }));
  return response.type === "boarded" ? response.options : [];
}
