export const OLHO_VIVO_URL = "https://api.olhovivo.sptrans.com.br/v2.1";

const TIMEOUT_MS = 4000;

export type Vehicle = { p: string; t: string; a: boolean; ta: string; py: number; px: number };

export type PredictedLine = {
  c: string;
  cl: number;
  sl: number;
  lt0: string;
  lt1: string;
  qv: number;
  vs: Vehicle[];
};

export type StopPrediction = {
  hr: string;
  p: { cp: number; np: string; py: number; px: number; l: PredictedLine[] } | null;
};

export type Corridor = { cc: number; nc: string };

export type CorridorStop = { cp: number; np: string; ed: string; py: number; px: number };

export type OlhoVivoErrorKind = "auth_failed" | "upstream";

export class OlhoVivoError extends Error {
  kind: OlhoVivoErrorKind;

  constructor(kind: OlhoVivoErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export type OlhoVivo = {
  get<T>(path: string, params?: Record<string, string | number>): Promise<T>;
};

export function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((cookie) => cookie.split(";")[0].trim())
    .filter((pair) => pair.includes("="))
    .join("; ");
}

export function createOlhoVivo(token: string, fetchImpl: typeof fetch = fetch): OlhoVivo {
  let cookie = "";

  async function login(): Promise<void> {
    const url = `${OLHO_VIVO_URL}/Login/Autenticar?token=${encodeURIComponent(token)}`;
    const response = await fetchImpl(url, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await response.text()).trim();
    cookie = cookieHeader(response.headers.getSetCookie());
    if (!response.ok || body !== "true" || cookie === "") {
      cookie = "";
      throw new OlhoVivoError("auth_failed", `login returned ${response.status} ${body}`);
    }
  }

  async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
    const url = `${OLHO_VIVO_URL}${path}${query.size > 0 ? `?${query}` : ""}`;
    for (let attempt = 1; ; attempt++) {
      if (cookie === "") {
        await login();
      }
      const response = await fetchImpl(url, { headers: { cookie }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status === 401 && attempt === 1) {
        cookie = "";
        continue;
      }
      if (!response.ok) {
        throw new OlhoVivoError("upstream", `${path} returned ${response.status}`);
      }
      return (await response.json()) as T;
    }
  }

  return { get };
}
