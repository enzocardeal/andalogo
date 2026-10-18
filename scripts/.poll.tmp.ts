import { appendFileSync, writeFileSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import { createOlhoVivo, type StopPrediction } from "../lib/olhovivo.ts";

const out = process.argv[2];
const client = createOlhoVivo(process.env.OLHOVIVO_TOKEN!);
writeFileSync(out, "");
for (let i = 0; i < 30; i++) {
  const at = new Date().toISOString();
  try {
    const p = await client.get<StopPrediction>("/Previsao/Parada", { codigoParada: "610016740" });
    const rows = (p.p?.l ?? []).flatMap((line) => line.vs.map((v) => ({ line: line.c, sl: line.sl, prefix: v.p, t: v.t, ta: v.ta, lat: v.py, lon: v.px })));
    appendFileSync(out, JSON.stringify({ at, hr: p.hr, found: !!p.p, lines: (p.p?.l ?? []).map((l) => `${l.c}/${l.sl}:${l.vs.length}`), rows }) + "\n");
  } catch (error) {
    appendFileSync(out, JSON.stringify({ at, error: String(error) }) + "\n");
  }
  await pause(10_000);
}
