import { createPlaceSearch, parsePlaceQuery } from "@/lib/places";
import { createClient } from "@/lib/supabase/server";

const searchPlaces = createPlaceSearch();

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const query = parsePlaceQuery(new URL(request.url).searchParams);
  if (!query) {
    return Response.json({ error: "invalid query" }, { status: 400 });
  }
  try {
    return Response.json({ places: await searchPlaces(query) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("places failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "upstream" }, { status: 502 });
  }
}
