"use client";

import { useFormStatus } from "react-dom";
import { strings } from "@/lib/strings";

export function LogoutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 font-medium disabled:opacity-60"
    >
      {pending ? strings.account.loggingOut : strings.account.logout}
    </button>
  );
}
