"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { strings } from "@/lib/strings";

type Result = { ok: boolean; message: string };

export function InviteForm() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setResult(null);
    try {
      const response = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: form.get("code"), email: form.get("email") }),
      });
      const body: { message?: string } | null = await response.json().catch(() => null);
      setResult(
        response.ok
          ? { ok: true, message: strings.invite.done }
          : { ok: false, message: body?.message ?? strings.invite.failed },
      );
    } catch {
      setResult({ ok: false, message: strings.invite.failed });
    } finally {
      setPending(false);
    }
  }

  if (result?.ok) {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-lg bg-green-50 p-3 text-green-900">
        <p>{result.message}</p>
        <Link href="/login" className="font-medium underline">
          {strings.invite.goToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{strings.invite.code}</span>
        <input
          name="code"
          required
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-h-11 rounded-lg border border-neutral-300 px-3"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{strings.invite.email}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          className="min-h-11 rounded-lg border border-neutral-300 px-3"
        />
      </label>
      {result && (
        <p role="alert" className="text-sm text-red-700">
          {result.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white disabled:opacity-60"
      >
        {pending ? strings.invite.sending : strings.invite.submit}
      </button>
    </form>
  );
}
