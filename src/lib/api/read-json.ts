/**
 * Read a fetch Response as JSON without exploding on error responses.
 *
 * The Quick Start hub used to do `const json = await res.json()` before
 * checking `res.ok`. When a route replied 500 with an empty body, `res.json()`
 * threw a DOMException and the UI surfaced
 *   "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
 * instead of the actual failure. That made a dead OpenRouter key look like a
 * frontend bug.
 *
 * This reads the body as text first, so a non-JSON or empty error response
 * still produces a useful message. Client-safe: no server-only imports.
 */
export async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();

  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Leave parsed null — handled below.
    }
  }

  if (!res.ok) {
    const fromBody =
      parsed && typeof parsed === "object"
        ? (parsed as { error?: unknown }).error
        : undefined;
    const message =
      (typeof fromBody === "string" && fromBody) ||
      text.trim().slice(0, 300) ||
      `Request failed with ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`;
    throw new Error(message);
  }

  if (parsed === null && text.trim() === "") {
    throw new Error("The server returned an empty response.");
  }

  return parsed as T;
}
