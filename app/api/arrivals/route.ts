import { stopCode } from "@/lib/arrivals";
import type { StopPattern } from "@/lib/eta";
import { liveService } from "@/lib/live-service";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const code = stopCode(new URL(request.url).searchParams.get("stop"));
  if (!code) {
    return Response.json({ error: "invalid stop" }, { status: 400 });
  }
  const loadPatterns = async () => {
    const { data: patterns, error } = await supabase.rpc("get_stop_eta", { p_stop_id: `sp:${code}` });
    if (error) {
      throw new Error(`get_stop_eta failed: ${error.message}`);
    }
    return patterns as StopPattern[];
  };
  return Response.json(await liveService.arrivalsFor(code, loadPatterns), { headers: { "Cache-Control": "private, no-store" } });
}
