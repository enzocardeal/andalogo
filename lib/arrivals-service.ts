import { combineArrivals, type Arrivals, type EstimatedLine } from "./arrivals.ts";
import { lineTracks, type LinePattern, type LineRef, type LineTracks } from "./bus-tracks.ts";
import { circularDirections, estimateStop, indexPositions, type PositionIndex, type StopPattern } from "./eta.ts";
import { createOlhoVivo, OLHO_VIVO_URL, OlhoVivoError, type Positions, type StopPrediction } from "./olhovivo.ts";

const TTL_MS = 10_000;
const FAILURE_TTL_MS = 15_000;
const POSITIONS_TTL_MS = 15_000;
const PATTERNS_TTL_MS = 600_000;
const MAX_ENTRIES = 500;

export type ArrivalsServiceOptions = {
  token: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type Entry<T> = { expires: number; value: Promise<T> };

function createCache<T>(now: () => Date) {
  const cache = new Map<string, Entry<T>>();
  return function cached(key: string, load: () => Promise<{ value: T; ttl: number }>): Promise<T> {
    const time = now().getTime();
    const hit = cache.get(key);
    if (hit && hit.expires > time) {
      return hit.value;
    }
    if (cache.size >= MAX_ENTRIES) {
      for (const [entryKey, entry] of cache) {
        if (entry.expires <= time || cache.size >= MAX_ENTRIES) {
          cache.delete(entryKey);
        }
      }
    }
    const pending = load();
    const value = pending.then(({ value }) => value);
    cache.set(key, { expires: time + TTL_MS, value });
    pending.then(
      ({ ttl }) => cache.set(key, { expires: now().getTime() + ttl, value }),
      () => cache.set(key, { expires: now().getTime() + FAILURE_TTL_MS, value }),
    );
    return value;
  };
}

function messageOf(error: unknown): unknown {
  return error instanceof Error ? error.message : error;
}

export function createArrivalsService({ token, baseUrl = OLHO_VIVO_URL, fetchImpl = fetch, now = () => new Date() }: ArrivalsServiceOptions) {
  const client = token ? createOlhoVivo(token, fetchImpl, baseUrl) : null;
  const arrivals = createCache<Arrivals>(now);
  const patterns = createCache<StopPattern[]>(now);
  const positions = createCache<PositionIndex>(now);
  const linePatterns = createCache<LinePattern | null>(now);

  function positionIndex(): Promise<PositionIndex> {
    return positions("all", async () => ({
      value: indexPositions(await client!.get<Positions>("/Posicao")),
      ttl: POSITIONS_TTL_MS,
    }));
  }

  async function estimatesFor(stopPatterns: StopPattern[]): Promise<EstimatedLine[]> {
    if (stopPatterns.length === 0) {
      return [];
    }
    return estimateStop(stopPatterns, await positionIndex(), now());
  }

  async function load(code: string, loadPatterns: () => Promise<StopPattern[]>): Promise<{ value: Arrivals; ttl: number }> {
    if (!client) {
      return { value: { state: "unavailable", lines: [] }, ttl: TTL_MS };
    }
    const stopPatterns = patterns(code, async () => ({ value: await loadPatterns(), ttl: PATTERNS_TTL_MS }));
    const [prediction, estimates, loaded] = await Promise.allSettled([
      client.get<StopPrediction>("/Previsao/Parada", { codigoParada: code }),
      stopPatterns.then(estimatesFor),
      stopPatterns,
    ]);
    if (estimates.status === "rejected") {
      console.error("gps estimate failed:", messageOf(estimates.reason));
    }
    const estimated = estimates.status === "fulfilled" ? estimates.value : null;
    const circular = circularDirections(loaded.status === "fulfilled" ? loaded.value : []);
    try {
      if (prediction.status === "rejected" && !estimated?.some((line) => line.vehicles.length > 0)) {
        throw prediction.reason;
      }
      const predicted = prediction.status === "fulfilled" ? prediction.value : null;
      return { value: combineArrivals(predicted, estimated, now(), circular), ttl: TTL_MS };
    } catch (error) {
      console.error("olho vivo failed:", messageOf(error));
      const state = error instanceof OlhoVivoError && error.kind === "auth_failed" ? "auth_failed" : "upstream_down";
      return { value: { state, lines: [] }, ttl: FAILURE_TTL_MS };
    }
  }

  function arrivalsFor(code: string, loadPatterns: () => Promise<StopPattern[]>): Promise<Arrivals> {
    return arrivals(code, () => load(code, loadPatterns));
  }

  async function tracksFor(lines: LineRef[], loadLine: (line: LineRef) => Promise<LinePattern | null>): Promise<LineTracks[]> {
    if (!client) {
      return [];
    }
    const loaded = await Promise.all(
      lines.map((line) =>
        linePatterns(`${line.routeId}|${line.directionId}`, async () => ({ value: await loadLine(line), ttl: PATTERNS_TTL_MS })),
      ),
    );
    const found = loaded.filter((pattern) => pattern !== null);
    if (found.length === 0) {
      return [];
    }
    const index = await positionIndex();
    return found.map((pattern) => lineTracks(pattern, index, now()));
  }

  return { arrivalsFor, tracksFor };
}
