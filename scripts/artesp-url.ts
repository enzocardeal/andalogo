import { ARTESP_PACKAGE_URL, latestZipUrl, type CkanResource } from "../lib/gtfs/artesp.ts";

const response = await fetch(ARTESP_PACKAGE_URL);
if (!response.ok) {
  throw new Error(`the ARTESP catalog returned ${response.status}`);
}
const body = (await response.json()) as { result: { resources: CkanResource[] } };
const url = latestZipUrl(body.result.resources);
if (!url) {
  throw new Error("the ARTESP catalog lists no zip resource");
}
console.log(url);
