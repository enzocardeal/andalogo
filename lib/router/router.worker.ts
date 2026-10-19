import { boardingOptions } from "./boarding.ts";
import { buildFootpaths, type Footpaths } from "./footpaths.ts";
import type { RouterRequest, RouterResponse } from "./messages.ts";
import { loadNetwork, type Network, type NetworkFile } from "./network.ts";
import { plan, serviceClock } from "./plan.ts";
import { decodeStops } from "../stops-file.ts";
import { placeOf, toJourney, toTrip } from "./trips.ts";

let ready: Promise<{ network: Network; footpaths: Footpaths }> | null = null;

function reply(response: RouterResponse) {
  self.postMessage(response);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

self.onmessage = async ({ data }: MessageEvent<RouterRequest>) => {
  if (data.type === "load") {
    if (ready) {
      return;
    }
    const started = performance.now();
    const json = async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
      }
      return response.json();
    };
    ready = Promise.all([Promise.all(data.routingUrls.map(json)), Promise.all(data.stopsUrls.map(json))]).then(([files, stops]) => {
      const network = loadNetwork(files as NetworkFile[], stops.flatMap(decodeStops));
      return { network, footpaths: buildFootpaths(network) };
    });
    try {
      await ready;
      reply({ type: "loaded", elapsedMs: performance.now() - started });
    } catch (error) {
      ready = null;
      reply({ type: "failed", id: null, message: messageOf(error) });
    }
    return;
  }
  try {
    if (!ready) {
      throw new Error("the router is not loaded");
    }
    const { network, footpaths } = await ready;
    const endpoints = { from: data.from, to: data.to };
    if (data.type === "boarding") {
      const { day, previousDay, seconds } = serviceClock(new Date(data.trip.depart));
      const journey = toJourney(network, data.trip, data.trip.depart, seconds);
      const query = { from: data.from, departure: seconds, day, previousDay, factor: data.factor };
      const options = boardingOptions(network, footpaths, journey, data.leg, query).map((option) => ({
        stop: placeOf(network, option.stop),
        current: option.current,
        trip: toTrip(network, option.journey, endpoints, data.trip.depart, seconds),
      }));
      reply({ type: "boarded", id: data.id, options });
      return;
    }
    const started = performance.now();
    const departure = new Date(data.departure);
    const journeys = plan(network, footpaths, { from: data.from, to: data.to, departure, factor: data.factor });
    const seconds = serviceClock(departure).seconds;
    const trips = journeys.map((journey) => toTrip(network, journey, endpoints, data.departure, seconds));
    reply({ type: "planned", id: data.id, trips, elapsedMs: performance.now() - started });
  } catch (error) {
    reply({ type: "failed", id: data.id, message: messageOf(error) });
  }
};
