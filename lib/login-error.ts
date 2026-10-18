export type LoginError = "invite" | "auth";

const HOOK_REFUSAL = "Cadastro permitido apenas para convidados.";

export function loginErrorFor(description: string | null): LoginError {
  return description?.includes(HOOK_REFUSAL) ? "invite" : "auth";
}

export function parseLoginError(value: string | string[] | undefined): LoginError | null {
  return value === "invite" || value === "auth" ? value : null;
}
