import { parseLineParams, type LinePattern, type LineRef } from "@/lib/bus-tracks";
import { liveService } from "@/lib/live-service";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const lines = parseLineParams(new URL(request.url).searchParams.getAll("line"));
  if (!lines) {
    return Response.json({ error: "invalid lines" }, { status: 400 });
  }
  const loadLine = async ({ routeId, directionId }: LineRef) => {
    const { data: pattern, error } = await supabase.rpc("get_line_eta", { p_route_id: routeId, p_direction_id: directionId });
    if (error) {
      throw new Error(`get_line_eta failed: ${error.message}`);
    }
    return pattern as LinePattern | null;
  };
  try {
    return Response.json({ lines: await liveService.tracksFor(lines, loadLine) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("positions failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "upstream" }, { status: 502 });
  }
}
