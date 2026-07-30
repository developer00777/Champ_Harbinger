/**
 * Turn a thrown upstream-provider error into a response the UI can actually
 * render.
 *
 * Why this exists: route handlers wrap their work in `withAction()`, which is
 * only an AsyncLocalStorage `.run()` and does not catch. When OpenRouter
 * rejected our key, the error threw straight out of the handler, Next returned
 * a 500 with an empty body, and the client's `await res.json()` failed with
 * "Failed to execute 'json' on 'Response': Unexpected end of JSON input".
 * The user saw a JSON parse error; the real cause (a dead API key) was only
 * visible in container logs.
 *
 * Contract: ALWAYS returns a JSON-serialisable body with a non-empty `error`
 * string, so a route using this can never emit a bodiless error again.
 */

export interface UpstreamErrorResponse {
  status: number;
  body: { error: string; detail?: string };
}

/** Pull a numeric status off the assorted shapes AI-SDK / fetch errors use. */
function statusOf(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;

  for (const key of ["statusCode", "status", "code"]) {
    const v = e[key];
    if (typeof v === "number" && v >= 100 && v < 600) return v;
  }

  // OpenRouter nests the real code inside the raw body string.
  if (typeof e.body === "string") {
    try {
      const parsed = JSON.parse(e.body) as { error?: { code?: unknown } };
      const code = parsed?.error?.code;
      if (typeof code === "number") return code;
    } catch {
      // not JSON — fall through
    }
  }
  return null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "";
}

export function describeUpstreamError(err: unknown): UpstreamErrorResponse {
  const status = statusOf(err);
  const message = messageOf(err);
  const name = err instanceof Error ? err.name : "";

  // 402 — the key is valid but the account is out of money. Deliberately does
  // NOT mention Settings: adding another key won't help, topping up will.
  if (status === 402 || /insufficient credit|quota|billing/i.test(message)) {
    return {
      status: 502,
      body: {
        error:
          "The AI provider rejected the request for insufficient credits. Top up the OpenRouter account, then retry.",
        detail: message || undefined,
      },
    };
  }

  // 401/403 — the key itself is bad (revoked, deleted, or never valid).
  // OpenRouter answers a dead key with the confusing "User not found."
  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|user not found|invalid api key/i.test(message) ||
    /Unauthorized/i.test(name)
  ) {
    return {
      status: 502,
      body: {
        error:
          "OpenRouter rejected the API key. Add a working key under Settings → Keys, or fix OPENROUTER_API_KEY on the server, then retry.",
        detail: message || undefined,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: message || "The request failed unexpectedly. Please retry.",
    },
  };
}
