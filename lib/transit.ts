export type Feed = "sptrans" | "artesp";

export type Mode = "bus" | "metro" | "cptm" | "emtu";

export const MODES: readonly Mode[] = ["bus", "metro", "cptm", "emtu"];

export const RAIL_MODES: readonly Mode[] = ["metro", "cptm"];

export const FEED_PREFIX: Record<Feed, string> = { sptrans: "sp", artesp: "ar" };
