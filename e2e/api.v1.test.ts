import { test, expect } from "@playwright/test";
import { BASE_URL } from "./helpers";

// These tests require CHAMPIQ_TEST_API_KEY env var to be set.
// Get it by: 1) running the app, 2) logging in, 3) going to Settings → Keys,
// 4) creating a ChampIQ API key, and 5) putting it in .env.local as
// CHAMPIQ_TEST_API_KEY=chh_...
const API_KEY = process.env.CHAMPIQ_TEST_API_KEY;

test.describe("v1 API — signals", () => {
  test.skip(!API_KEY, "CHAMPIQ_TEST_API_KEY not set — skipping v1 API tests");

  test("GET /api/v1/signals returns signal list", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/signals`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Endpoint returns an array of signals directly
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      expect(body[0]).toHaveProperty("id");
      expect(body[0]).toHaveProperty("name");
    }
  });

  test("POST /api/v1/signals/run with missing signal returns non-401", async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/v1/signals/run`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      data: { signal_id: "nonexistent-signal-id", domain: "example.com" },
    });
    // Auth passes — returns 404 or 400 if signal not found, not 401
    expect(res.status()).not.toBe(401);
  });

  test("POST /api/v1/discover returns companies array", async ({ request }) => {
    test.setTimeout(30000);
    const res = await request.post(`${BASE_URL}/api/v1/discover`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      data: { icp: "SaaS companies with 10-50 employees" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("companies");
    expect(Array.isArray(body.companies)).toBe(true);
  });
});

test.describe("v1 API — auth", () => {
  test("missing Authorization header returns 401", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/signals`);
    expect(res.status()).toBe(401);
  });

  test("invalid API key returns 401", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/signals`, {
      headers: { Authorization: "Bearer chh_invalid_key_abc123" },
    });
    expect(res.status()).toBe(401);
  });

  test("non-chh_ prefixed key returns 401", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/signals`, {
      headers: { Authorization: "Bearer sk_test_not_a_chh_key" },
    });
    expect(res.status()).toBe(401);
  });
});
