"use client";

import Link from "next/link";
import { strings } from "@/lib/strings";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{strings.errorPage.title}</h1>
        <p className="text-neutral-600">{strings.errorPage.text}</p>
      </div>
      <button
        type="button"
        onClick={() => retry()}
        className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white"
      >
        {strings.errorPage.retry}
      </button>
      <Link href="/" className="flex min-h-11 items-center justify-center font-medium underline">
        {strings.errorPage.home}
      </Link>
    </main>
  );
}
