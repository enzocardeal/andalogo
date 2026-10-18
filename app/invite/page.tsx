import { strings } from "@/lib/strings";
import { InviteForm } from "./invite-form";

export default function InvitePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{strings.invite.title}</h1>
        <p className="text-neutral-600">{strings.invite.intro}</p>
      </div>
      <InviteForm />
    </main>
  );
}
