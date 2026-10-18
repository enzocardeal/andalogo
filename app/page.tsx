import { Suspense } from "react";
import { signOut } from "@/app/auth/actions";
import { TransitMap } from "@/components/transit-map";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export default function Home() {
  return (
    <main className="relative flex-1">
      <TransitMap />
      <Suspense>
        <AccountMenu />
      </Suspense>
    </main>
  );
}

async function AccountMenu() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims.email;
  if (!email) {
    return null;
  }

  return (
    <details className="absolute top-[calc(env(safe-area-inset-top)+1rem)] left-[max(1rem,env(safe-area-inset-left))]">
      <summary
        aria-label={strings.account.menu}
        className="flex size-11 list-none items-center justify-center rounded-full bg-white text-lg font-semibold uppercase shadow-md"
      >
        {email[0]}
      </summary>
      <form
        action={signOut}
        className="mt-2 flex w-64 flex-col gap-3 rounded-lg bg-white p-4 shadow-md"
      >
        <p className="truncate text-sm text-neutral-600">{email}</p>
        <LogoutButton />
      </form>
    </details>
  );
}
