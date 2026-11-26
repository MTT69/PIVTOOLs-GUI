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
  /** The parsed JSON error body, or null when the response was not JSON. Lets a caller branch on a machine-readable field such as `status`. */
  readonly body: Record<string, unknown> | null;

  constructor(message: string, status: number, body: Record<string, unknown> | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const ERROR_BODY_PREVIEW_CHARS = 120;

/** Build the ApiError for a non-2xx response: the JSON `error` as message (else status + a text snippet), and the parsed body. */
async function readError(res: Response): Promise<ApiError> {
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // Not JSON — a proxy page or a plain-text failure. Fall through.
  }
  if (body && typeof body.error === "string" && body.error) {
    return new ApiError(body.error, res.status, body);
  }
  const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const head = snippet.slice(0, ERROR_BODY_PREVIEW_CHARS);
  const message = head ? `${res.status} ${res.statusText}: ${head}` : `${res.status} ${res.statusText}`;
  return new ApiError(message, res.status, body);
}

/** GET (or any `init.method`) a backend route and return its parsed JSON body. Throws `ApiError` on non-2xx. */
export async function fetchJson<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await readError(res);
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
