import { decodeStops, STOPS_BUCKET, type MapStop } from "./stops-file.ts";
import { createClient } from "./supabase/client.ts";
import { supabaseEnv } from "./supabase/env.ts";

function publicUrl(file: string): string {
  return `${supabaseEnv().url}/storage/v1/object/public/${STOPS_BUCKET}/${file}`;
}

export async function loadMapStops(): Promise<MapStop[]> {
  const { data, error } = await createClient().from("feed_versions").select("stops_file");
  if (error) {
    throw error;
  }
  const files = await Promise.all(
    data.map(async ({ stops_file }: { stops_file: string }) => {
      const response = await fetch(publicUrl(stops_file));
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

export async function loadRouterUrls(): Promise<{ routingUrls: string[]; stopsUrls: string[] }> {
  const { data, error } = await createClient().from("feed_versions").select("stops_file, routing_file");
  if (error) {
    throw error;
  }
  const rows = data as { stops_file: string; routing_file: string | null }[];
  const ready = rows.filter((row) => row.routing_file !== null);
  return { routingUrls: ready.map((row) => publicUrl(row.routing_file!)), stopsUrls: rows.map((row) => publicUrl(row.stops_file)) };
}
