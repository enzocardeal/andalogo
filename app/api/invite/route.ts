import { codeMatches, parseInvite } from "@/lib/invite";
import { strings } from "@/lib/strings";
import { createAdminClient } from "@/lib/supabase/admin";

const INVITE_CAP_SQLSTATE = "AL001";

function fail(status: number, message: string) {
  return Response.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  const expected = process.env.INVITE_CODE;
  if (!expected) {
    return fail(404, strings.invite.closed);
  }

  const invite = parseInvite(await request.json().catch(() => null));
  if (!invite) {
    return fail(400, strings.invite.invalidData);
  }

  if (!codeMatches(invite.code, expected)) {
    return fail(403, strings.invite.invalidCode);
  }

  const { error } = await createAdminClient()
    .from("invited_emails")
    .upsert({ email: invite.email }, { onConflict: "email", ignoreDuplicates: true });
  if (error?.code === INVITE_CAP_SQLSTATE) {
    return fail(409, strings.invite.limitReached);
  }
  if (error) {
    console.error("invite insert failed:", error.message);
    return fail(500, strings.invite.failed);
  }

  return Response.json({ ok: true });
}
