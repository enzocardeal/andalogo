import { copyFileSync, mkdirSync } from "node:fs";

const source = new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url);
const target = new URL("../public/maplibre-gl-worker.js", import.meta.url);

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
copyFileSync(source, target);
