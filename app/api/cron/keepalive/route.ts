import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const { error } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) {
    console.error("keepalive query failed:", error.message);
    return Response.json({ ok: false }, { status: 500 });
  }

  return Response.json({ ok: true, at: new Date().toISOString() });
}
