import { NextResponse } from "next/server";
import { loginErrorFor } from "@/lib/login-error";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let description = searchParams.get("error_description");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
    description = error.message;
  }

  console.error("login failed:", description ?? searchParams.get("error") ?? "no code");
  return NextResponse.redirect(`${origin}/login?error=${loginErrorFor(description)}`);
}
