"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { strings } from "@/lib/strings";

export function GoogleButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setPending(true);
    setFailed(false);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white disabled:opacity-60"
      >
        {pending ? strings.login.redirecting : strings.login.google}
      </button>
      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {strings.login.failed}
        </p>
      )}
    </div>
  );
}
