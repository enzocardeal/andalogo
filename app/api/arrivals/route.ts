import { stopCode } from "@/lib/arrivals";
import { createArrivalsService } from "@/lib/arrivals-service";
import { createClient } from "@/lib/supabase/server";

const arrivalsFor = createArrivalsService({
  token: process.env.OLHOVIVO_TOKEN,
  baseUrl: process.env.OLHOVIVO_URL || undefined,
});

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
  return Response.json(await arrivalsFor(code), { headers: { "Cache-Control": "private, no-store" } });
}
