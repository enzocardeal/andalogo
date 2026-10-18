import { appendFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { bucketOf, createCalibration, type Totals } from "../lib/eta-calibration.ts";
import { loadCalibrationPatterns, savePaces } from "../lib/eta-db.ts";
import { activeSha256 } from "../lib/gtfs/db.ts";
import { createOlhoVivo, type Positions } from "../lib/olhovivo.ts";

const SAMPLE_MS = 30_000;
const MAX_DELAY_MS = 600_000;
const LOG_DIR = "data/eta";
const LOG_FILE = `${LOG_DIR}/collector.log`;

const { values } = parseArgs({ options: { minutes: { type: "string" } } });
const dbUrl = process.env.SUPABASE_DB_URL;
const token = process.env.OLHOVIVO_TOKEN;
if (!dbUrl || !token) {
  console.error("usage: SUPABASE_DB_URL=... OLHOVIVO_TOKEN=... npm run eta:collect [-- --minutes <n>]");
  process.exit(2);
}
const stopAt = values.minutes ? Date.now() + Number(values.minutes) * 60_000 : Infinity;

mkdirSync(LOG_DIR, { recursive: true });

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  appendFileSync(LOG_FILE, `${line}\n`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hourKey(): string {
  const { dayType, hour } = bucketOf(new Date());
  return `${dayType} ${hour}h`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sql = postgres(dbUrl, { max: 1, onnotice: () => {}, idle_timeout: 60 });
const client = createOlhoVivo(token);

async function load() {
  for (let delay = SAMPLE_MS; ; delay = Math.min(MAX_DELAY_MS, delay * 2)) {
    try {
      const sha = await activeSha256(sql, "sptrans");
      const patterns = await loadCalibrationPatterns(sql);
      log(`loaded ${patterns.length} patterns of feed ${sha?.slice(0, 12)}`);
      return { sha, calibration: createCalibration(patterns) };
    } catch (error) {
      log(`database failed, next try in ${delay / 1000} s: ${messageOf(error)}`);
      await sleep(delay);
    }
  }
}

let { sha, calibration } = await load();
let pending: Totals[] = [];
let stats = { snapshots: 0, observations: 0, errors: 0 };
let hour = hourKey();

async function flush(): Promise<void> {
  pending.push(...calibration.drain());
  let saved = 0;
  try {
    saved = pending.length > 0 ? await savePaces(sql, pending) : 0;
    pending = [];
  } catch (error) {
    log(`save failed, kept ${pending.length} buckets: ${messageOf(error)}`);
  }
  log(
    `${hour}: saved ${saved} rows, ${stats.snapshots} snapshots, ${stats.observations} observations, ` +
      `${stats.errors} errors, ${calibration.tracked()} buses tracked`,
  );
  stats = { snapshots: 0, observations: 0, errors: 0 };
}

async function reloadIfNewFeed(): Promise<void> {
  try {
    if ((await activeSha256(sql, "sptrans")) !== sha) {
      ({ sha, calibration } = await load());
    }
  } catch (error) {
    log(`feed check failed: ${messageOf(error)}`);
  }
}

async function stop(): Promise<never> {
  await flush();
  await sql.end();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

let delay = SAMPLE_MS;
while (Date.now() < stopAt) {
  const started = Date.now();
  try {
    stats.observations += calibration.observe(await client.get<Positions>("/Posicao"));
    stats.snapshots++;
    delay = SAMPLE_MS;
  } catch (error) {
    stats.errors++;
    delay = Math.min(MAX_DELAY_MS, delay * 2);
    log(`olho vivo failed, next try in ${delay / 1000} s: ${messageOf(error)}`);
  }
  if (hourKey() !== hour) {
    await flush();
    hour = hourKey();
    await reloadIfNewFeed();
  }
  await sleep(Math.max(0, Math.min(delay - (Date.now() - started), stopAt - Date.now())));
}
await stop();
