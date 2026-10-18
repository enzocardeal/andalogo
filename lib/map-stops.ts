import { decodeStops, STOPS_BUCKET, type MapStop } from "./stops-file.ts";
import { createClient } from "./supabase/client.ts";
import { supabaseEnv } from "./supabase/env.ts";

export async function loadMapStops(): Promise<MapStop[]> {
  const { data, error } = await createClient().from("feed_versions").select("stops_file");
  if (error) {
    throw error;
  }
  const { url } = supabaseEnv();
  const files = await Promise.all(
    data.map(async ({ stops_file }: { stops_file: string }) => {
      const response = await fetch(`${url}/storage/v1/object/public/${STOPS_BUCKET}/${stops_file}`);
      if (!response.ok) {
        throw new Error(`${stops_file} returned ${response.status}`);
      }
      return decodeStops(await response.json());
    }),
  );
  return files.flat();
}

export async function loadFavoriteIds(): Promise<string[]> {
  const { data, error } = await createClient().from("favorites").select("stop_id");
  if (error) {
    throw error;
  }
  return data.map((row: { stop_id: string }) => row.stop_id);
}
