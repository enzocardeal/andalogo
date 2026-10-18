import { createArrivalsService } from "./arrivals-service.ts";

export const liveService = createArrivalsService({
  token: process.env.OLHOVIVO_TOKEN,
  baseUrl: process.env.OLHOVIVO_URL || undefined,
});
