import { createPlaceSearch, parsePlaceQuery } from "@/lib/places";
import { createClient } from "@/lib/supabase/server";

const placeSearch = createPlaceSearch();

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const query = parsePlaceQuery(params);
  if (!query) {
    return Response.json({ error: "invalid query" }, { status: 400 });
  }
  try {
    const places = params.get("full") === "1" ? await placeSearch.full(query) : await placeSearch.suggest(query);
    return Response.json({ places }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("places failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "upstream" }, { status: 502 });
  }
}
