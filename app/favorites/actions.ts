"use server";

import { refresh } from "next/cache";
import { moveItem } from "@/lib/favorites";
import { createClient } from "@/lib/supabase/server";

export async function removeFavorite(formData: FormData): Promise<void> {
  const stopId = formData.get("stopId");
  if (typeof stopId !== "string") {
    return;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_favorite", { p_stop_id: stopId });
  if (error) {
    throw new Error(`remove_favorite failed: ${error.message}`);
  }
  refresh();
}

export async function moveFavorite(formData: FormData): Promise<void> {
  const stopId = formData.get("stopId");
  if (typeof stopId !== "string") {
    return;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("favorites").select("stop_id").order("position");
  if (error) {
    throw new Error(`favorites select failed: ${error.message}`);
  }
  const order = moveItem(
    data.map((row) => row.stop_id as string),
    stopId,
    formData.get("delta") === "-1" ? -1 : 1,
  );
  if (order === null) {
    return;
  }
  const { error: reorderError } = await supabase.rpc("reorder_favorites", { p_stop_ids: order });
  if (reorderError) {
    throw new Error(`reorder_favorites failed: ${reorderError.message}`);
  }
  refresh();
}
