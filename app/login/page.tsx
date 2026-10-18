import Link from "next/link";
import { Suspense } from "react";
import { parseLoginError } from "@/lib/login-error";
import { strings } from "@/lib/strings";
import { GoogleButton } from "./google-button";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{strings.app.name}</h1>
        <p className="text-neutral-600">{strings.app.description}</p>
      </div>
      <Suspense>
        <LoginError searchParams={searchParams} />
      </Suspense>
      <GoogleButton />
    </main>
  );
}

async function LoginError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const error = parseLoginError((await searchParams).error);
  if (error === null) {
    return null;
  }
  if (error === "auth") {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        {strings.login.failed}
      </p>
    );
  }
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      <p>{strings.login.inviteRequired}</p>
      <Link href="/invite" className="font-medium underline">
        {strings.login.inviteLink}
      </Link>
    </div>
  );
}
