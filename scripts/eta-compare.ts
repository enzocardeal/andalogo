import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { combineArrivals, type Arrivals } from "../lib/arrivals.ts";
import { ACTUAL_BUCKETS, BUCKETS, createArrivalWatch, errorsOf, score, SOURCES, type Prediction, type Source } from "../lib/eta-accuracy.ts";
import { circularDirections, estimateStop, indexPositions, type PositionIndex, type StopPattern } from "../lib/eta.ts";
import { createOlhoVivo, type Positions, type StopPrediction } from "../lib/olhovivo.ts";

const SAMPLE_MS = 30_000;
const PATTERNS_TTL_MS = 600_000;
const PARALLEL = 5;
const LOG_DIR = "data/eta";

type GpsSource = Exclude<Source, "sptrans" | "shown">;

const { values } = parseArgs({ options: { minutes: { type: "string" }, stops: { type: "string" }, wait: { type: "string" } } });
const dbUrl = process.env.SUPABASE_DB_URL;
const token = process.env.OLHOVIVO_TOKEN;
if (!dbUrl || !token) {
  console.error("usage: SUPABASE_DB_URL=... OLHOVIVO_TOKEN=... npm run eta:compare [-- --minutes <n> --stops <n> --wait <n>]");
  process.exit(2);
}
const started = Date.now();
const stopAt = started + Number(values.minutes ?? 90) * 60_000;
const captureUntil = stopAt - Number(values.wait ?? 30) * 60_000;

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sql = postgres(dbUrl, { max: 1, onnotice: () => {}, idle_timeout: 60 });
const client = createOlhoVivo(token);
const watch = createArrivalWatch();

const stops = (
  await sql<{ id: string }[]>`
    select s.id
    from public.stops s
    where s.feed = 'sptrans' and s.mode = 'bus'
      and (select count(*) from public.stop_routes sr where sr.stop_id = s.id) >= 4
    order by random()
    limit ${Number(values.stops ?? 40)}`
).map((row) => row.id);
log(`sampling ${stops.length} stops`);

const patterns = new Map<string, { loaded: number; value: StopPattern[] }>();

async function patternsOf(stop: string): Promise<StopPattern[]> {
  const cached = patterns.get(stop);
  if (cached && Date.now() - cached.loaded < PATTERNS_TTL_MS) {
    return cached.value;
  }
  const [{ value }] = await sql<{ value: StopPattern[] }[]>`select public.get_stop_eta(${stop}) as value`;
  patterns.set(stop, { loaded: Date.now(), value });
  return value;
}

const VARIANTS: Record<GpsSource, (pattern: StopPattern) => StopPattern> = {
  gps: (pattern) => pattern,
  hourly: (pattern) => ({ ...pattern, hour_start: null }),
};

function minutesBy(arrivals: Arrivals): Map<string, number> {
  return new Map(
    arrivals.lines.flatMap((line) => line.vehicles.map((vehicle) => [`${line.routeId}|${line.directionId}|${vehicle.p}`, vehicle.minutes])),
  );
}

async function capture(stop: string, index: PositionIndex): Promise<void> {
  const stopPatterns = await patternsOf(stop);
  const prediction = await client.get<StopPrediction>("/Previsao/Parada", { codigoParada: stop.replace(/^sp:/, "") }).catch(() => null);
  const now = new Date();
  const circular = circularDirections(stopPatterns);
  const estimated = Object.fromEntries(
    Object.entries(VARIANTS).map(([source, variant]) => [source, estimateStop(stopPatterns.map(variant), index, now)]),
  ) as Record<GpsSource, ReturnType<typeof estimateStop>>;
  const bySource = {
    sptrans: minutesBy(combineArrivals(prediction, null, now, circular)),
    ...Object.fromEntries(Object.entries(estimated).map(([source, lines]) => [source, minutesBy(combineArrivals(null, lines, now, circular))])),
    shown: minutesBy(combineArrivals(prediction, estimated.gps, now, circular)),
  } as Record<Source, Map<string, number>>;
  const keys = new Set(SOURCES.flatMap((source) => [...bySource[source].keys()]));
  for (const key of keys) {
    const [routeId, directionId, p] = key.split("|");
    const minutes = Object.fromEntries(SOURCES.flatMap((source) => (bySource[source].has(key) ? [[source, bySource[source].get(key)!]] : [])));
    const pattern = stopPatterns.find((candidate) => candidate.route_id === routeId && candidate.direction_id === Number(directionId));
    watch.add({ capturedAt: now.getTime(), stop, routeId, directionId: Number(directionId), p, minutes }, pattern);
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`.padStart(5);
}

function table(predictions: Prediction[], paired: boolean, by: "shown" | "actual"): string[] {
  const lines = [`source    ${by} min      n  mean abs  bias   ±1 min  ±2 min  p90 abs`];
  for (const source of SOURCES) {
    for (const bucket of by === "actual" ? ACTUAL_BUCKETS : BUCKETS) {
      const result = score(errorsOf(predictions, source, bucket, paired, by));
      if (!result) {
        continue;
      }
      lines.push(
        `${source.padEnd(9)} ${`${bucket[0]}-${bucket[1]}`.padStart(9)} ${String(result.n).padStart(6)} ${result.meanAbs.toFixed(2).padStart(9)} ` +
          `${result.bias.toFixed(2).padStart(5)} ${percent(result.within1)}   ${percent(result.within2)}   ${result.p90.toFixed(1).padStart(6)}`,
      );
    }
  }
  return lines;
}

function report(predictions: Prediction[]): string {
  return [
    "",
    "Buses that both SPTrans and GPS predicted, by real minutes to arrival:",
    ...table(predictions, true, "actual"),
    "",
    "Buses that both SPTrans and GPS predicted, by shown minutes:",
    ...table(predictions, true, "shown"),
    "",
    "Every bus that each source predicted, by shown minutes:",
    ...table(predictions, false, "shown"),
  ].join("\n");
}

async function stop(): Promise<never> {
  const predictions = watch.predictions();
  const arrived = predictions.filter((prediction) => prediction.arrivedAt !== undefined).length;
  const summary =
    `${predictions.length} predictions at ${stops.length} stops, ${arrived} with an observed arrival, ${watch.waiting()} buses still waiting` +
    report(predictions);
  mkdirSync(LOG_DIR, { recursive: true });
  const name = `${LOG_DIR}/compare-${new Date(started).toISOString().replace(/[:.]/g, "-")}`;
  writeFileSync(`${name}.jsonl`, predictions.map((prediction) => JSON.stringify(prediction)).join("\n"));
  writeFileSync(`${name}.txt`, `${summary}\n`);
  console.log(summary);
  log(`wrote ${name}.jsonl and ${name}.txt`);
  await sql.end();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

let tick = 0;
while (Date.now() < stopAt) {
  const begun = Date.now();
  try {
    const index = indexPositions(await client.get<Positions>("/Posicao"));
    watch.observe(index);
    if (tick % 2 === 0 && Date.now() < captureUntil) {
      for (let i = 0; i < stops.length; i += PARALLEL) {
        await Promise.all(stops.slice(i, i + PARALLEL).map((stop) => capture(stop, index).catch((error) => log(`${stop} failed: ${messageOf(error)}`))));
      }
    }
    if (tick % 10 === 0) {
      const predictions = watch.predictions();
      log(`${predictions.length} predictions, ${predictions.filter((prediction) => prediction.arrivedAt !== undefined).length} arrived, ${watch.waiting()} buses waiting`);
    }
  } catch (error) {
    log(`olho vivo failed: ${messageOf(error)}`);
  }
  tick++;
  await sleep(Math.max(0, Math.min(SAMPLE_MS - (Date.now() - begun), stopAt - Date.now())));
}
await stop();
