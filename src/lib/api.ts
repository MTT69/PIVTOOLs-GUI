/**
 * The one way to call the Flask backend for JSON.
 *
 * Every backend failure under `/backend/` is JSON (`pivtools_gui/errors.py`):
 * `{ success: false, error: "<message>" }` with the real HTTP status. These
 * helpers check `res.ok` BEFORE parsing, so a non-2xx never surfaces as
 * `SyntaxError: Unexpected token '<'` — the backend's own message is thrown.
 *
 * Never call `fetch(...).json()` directly for a backend route; use these.
 *
 * Known debt: a 2xx body with `success: false` is returned, not thrown, because
 * many routes report expected failures (board not detected, invalid config)
 * that way at HTTP 200. Components therefore have two error paths: `catch`
 * for non-2xx and `if (!data.success)` for 200. Once the backend envelopes are
 * normalised to real status codes, make `fetchJson` throw on `success: false`
 * and delete the per-component checks.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const ERROR_BODY_PREVIEW_CHARS = 120;

/** Best message for a non-2xx response: the JSON `error`, else status + a text snippet. */
async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    if (body && typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON — a proxy page or a plain-text failure. Fall through.
  }
  const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const head = snippet.slice(0, ERROR_BODY_PREVIEW_CHARS);
  return head ? `${res.status} ${res.statusText}: ${head}` : `${res.status} ${res.statusText}`;
}

/** GET (or any `init.method`) a backend route and return its parsed JSON body. Throws `ApiError` on non-2xx. */
export async function fetchJson<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new ApiError(await readErrorMessage(res), res.status);
  return res.json() as Promise<T>;
}

/** POST a JSON body to a backend route and return its parsed JSON body. Throws `ApiError` on non-2xx. */
export function postJson<T = any>(input: string, body: unknown, init?: RequestInit): Promise<T> {
  return fetchJson<T>(input, {
    ...init,
    method: init?.method ?? "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

/** Normalise anything thrown into a user-facing string. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}
