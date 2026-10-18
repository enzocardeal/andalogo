import { setTimeout as pause } from "node:timers/promises";
import { parseArgs } from "node:util";
import { loadNetwork } from "../lib/gtfs/load.ts";
import { checkCorridorStop, checkStop, passes, sample, summarize, type StopCheck } from "../lib/idmap.ts";
import { createOlhoVivo, type Corridor, type CorridorStop, type StopPrediction } from "../lib/olhovivo.ts";

const CALL_INTERVAL_MS = 500;
const BUS_ROUTE_TYPE = "3";
const MAX_LISTED_FAILURES = 15;

const { values } = parseArgs({
  options: {
    gtfs: { type: "string" },
    sample: { type: "string", default: "100" },
    corridor: { type: "string", default: "20" },
    seed: { type: "string", default: "1" },
  },
});

const token = process.env.OLHOVIVO_TOKEN;
if (!values.gtfs || !token) {
  console.error("usage: OLHOVIVO_TOKEN=... npm run idmap:check -- --gtfs <sptrans.zip> [--sample 100] [--corridor 20] [--seed 1]");
  process.exit(2);
}
const seed = Number(values.seed);

const network = await loadNetwork(values.gtfs);
const routes = new Set(network.routeTypes.keys());
const busStops = [...network.stopRoutes]
  .filter(([id, keys]) => network.stops.has(id) && [...keys].some((key) => network.routeTypes.get(key.split("|")[0]) === BUS_ROUTE_TYPE))
  .map(([id]) => id)
  .sort();
console.log(`GTFS: ${network.stops.size} stops, ${busStops.length} served by bus routes, ${routes.size} routes`);

const client = createOlhoVivo(token);

const corridorStops: CorridorStop[] = [];
for (const corridor of await client.get<Corridor[]>("/Corredor")) {
  await pause(CALL_INTERVAL_MS);
  corridorStops.push(...(await client.get<CorridorStop[]>("/Parada/BuscarParadasPorCorredor", { codigoCorredor: corridor.cc })));
}
corridorStops.sort((a, b) => a.cp - b.cp);
const corridorChecks = sample(corridorStops, Number(values.corridor), seed).map((stop) => checkCorridorStop(stop, network.stops));

const stopChecks: StopCheck[] = [];
const errors: string[] = [];
for (const id of sample(busStops, Number(values.sample), seed)) {
  await pause(CALL_INTERVAL_MS);
  try {
    const prediction = await client.get<StopPrediction>("/Previsao/Parada", { codigoParada: id });
    stopChecks.push(checkStop(network.stops.get(id)!, network.stopRoutes.get(id) ?? new Set(), routes, prediction));
  } catch (error) {
    errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const results = summarize(stopChecks, corridorChecks);
const emptyStops = stopChecks.filter((stop) => stop.found && stop.lines.length === 0).length;
console.log(`\nChecked ${stopChecks.length} stops (${emptyStops} found with no line) and ${corridorChecks.length} corridor stops.`);
if (errors.length > 0) {
  console.log(`${errors.length} calls failed:\n  ${errors.slice(0, MAX_LISTED_FAILURES).join("\n  ")}`);
}
console.log("");
for (const result of results) {
  const percent = result.total === 0 ? "-" : `${((100 * result.passed) / result.total).toFixed(1)} %`;
  console.log(`${!result.gate ? "INFO" : passes(result) ? "PASS" : "FAIL"}  ${result.name}: ${result.passed}/${result.total} (${percent})`);
  for (const failure of result.failures.slice(0, MAX_LISTED_FAILURES)) {
    console.log(`        ${failure}`);
  }
}

process.exit(results.filter((result) => result.gate).every(passes) && errors.length === 0 ? 0 : 1);
