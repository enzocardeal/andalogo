import { createHash, timingSafeEqual } from "node:crypto";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_CODE_LENGTH = 200;

export type Invite = {
  code: string;
  email: string;
};

export function parseInvite(body: unknown): Invite | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { code, email } = body as Record<string, unknown>;
  if (typeof code !== "string" || typeof email !== "string") {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  if (
    code === "" ||
    code.length > MAX_CODE_LENGTH ||
    normalized.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }
  return { code, email: normalized };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function codeMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}
