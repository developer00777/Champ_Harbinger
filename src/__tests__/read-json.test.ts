import { describe, expect, it } from "vitest";

import { jsonOrThrow } from "@/lib/api/read-json";

describe("jsonOrThrow", () => {
  it("returns the parsed body on success", async () => {
    const res = new Response(JSON.stringify({ companies: [1, 2] }), {
      status: 200,
    });
    await expect(jsonOrThrow<{ companies: number[] }>(res)).resolves.toEqual({
      companies: [1, 2],
    });
  });

  it("surfaces the route's error message on a JSON error response", async () => {
    const res = new Response(JSON.stringify({ error: "OpenRouter rejected" }), {
      status: 502,
    });
    await expect(jsonOrThrow(res)).rejects.toThrow(/OpenRouter rejected/);
  });

  it("does NOT throw a JSON-parse error on a bodiless 500", async () => {
    // This is the exact regression: Next's bodiless 500 used to make
    // res.json() raise "Unexpected end of JSON input".
    const res = new Response(null, { status: 500 });
    await expect(jsonOrThrow(res)).rejects.toThrow(/500/);
    await expect(
      jsonOrThrow(new Response(null, { status: 500 })),
    ).rejects.not.toThrow(/Unexpected end of JSON input/);
  });

  it("falls back to raw text when the error body is not JSON", async () => {
    const res = new Response("Internal Server Error", { status: 500 });
    await expect(jsonOrThrow(res)).rejects.toThrow(/Internal Server Error/);
  });

  it("rejects clearly when a 200 carries an empty body", async () => {
    const res = new Response("", { status: 200 });
    await expect(jsonOrThrow(res)).rejects.toThrow(/empty response/i);
  });
});
