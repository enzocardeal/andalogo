import { toArrivals, type Arrivals } from "./arrivals.ts";
import { createOlhoVivo, OLHO_VIVO_URL, OlhoVivoError, type StopPrediction } from "./olhovivo.ts";

const TTL_MS = 10_000;
const FAILURE_TTL_MS = 15_000;
const MAX_ENTRIES = 500;

export type ArrivalsServiceOptions = {
  token: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type Entry = { expires: number; value: Promise<Arrivals> };

export function createArrivalsService({ token, baseUrl = OLHO_VIVO_URL, fetchImpl = fetch, now = () => new Date() }: ArrivalsServiceOptions) {
  const client = token ? createOlhoVivo(token, fetchImpl, baseUrl) : null;
  const cache = new Map<string, Entry>();

  async function load(code: string): Promise<{ arrivals: Arrivals; ttl: number }> {
    if (!client) {
      return { arrivals: { state: "unavailable", lines: [] }, ttl: TTL_MS };
    }
    try {
      const prediction = await client.get<StopPrediction>("/Previsao/Parada", { codigoParada: code });
      return { arrivals: toArrivals(prediction, now()), ttl: TTL_MS };
    } catch (error) {
      console.error("olho vivo failed:", error instanceof Error ? error.message : error);
      const state = error instanceof OlhoVivoError && error.kind === "auth_failed" ? "auth_failed" : "upstream_down";
      return { arrivals: { state, lines: [] }, ttl: FAILURE_TTL_MS };
    }
  }

  return function arrivalsFor(code: string): Promise<Arrivals> {
    const time = now().getTime();
    const cached = cache.get(code);
    if (cached && cached.expires > time) {
      return cached.value;
    }
    if (cache.size >= MAX_ENTRIES) {
      for (const [key, entry] of cache) {
        if (entry.expires <= time || cache.size >= MAX_ENTRIES) {
          cache.delete(key);
        }
      }
    }
    const pending = load(code);
    const value = pending.then(({ arrivals }) => arrivals);
    cache.set(code, { expires: time + TTL_MS, value });
    pending.then(({ ttl }) => cache.set(code, { expires: now().getTime() + ttl, value }));
    return value;
  };
}
