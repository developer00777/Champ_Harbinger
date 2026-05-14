import { createClerkClient } from "@clerk/backend";
import { randomUUID } from "node:crypto";

const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!clerkSecretKey || !clerkPublishableKey) {
  throw new Error(
    "E2E tests require CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY " +
      "in .env.local from a Clerk *test* instance (https://dashboard.clerk.com).",
  );
}

// Per Clerk's testing best practices: tests must run against a *test* instance
// (pk_test_… / sk_test_…), not production keys. Catches the easy footgun of
// pointing tests at a real Clerk app and creating real users.
if (!clerkPublishableKey.startsWith("pk_test_")) {
  throw new Error(
    `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with pk_test_ for e2e tests ` +
      `(got prefix "${clerkPublishableKey.slice(0, 10)}…"). Create a separate ` +
      `Clerk dev instance for testing — never run e2e against production keys.`,
  );
}
if (!clerkSecretKey.startsWith("sk_test_")) {
  throw new Error(
    `CLERK_SECRET_KEY must start with sk_test_ for e2e tests. ` +
      `Create a separate Clerk dev instance for testing.`,
  );
}

/** Clerk backend client — only works with sk_test_ keys. */
const clerk = createClerkClient({
  secretKey: clerkSecretKey,
  publishableKey: clerkPublishableKey,
});

/** Prefix for test data so cleanup can target it precisely. */
export const TEST_PREFIX = "__e2e_test__";

export const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/**
 * Create a fresh Clerk test user. Uses skipPasswordChecks so the test
 * password never needs to satisfy policy rules.
 */
export async function createTestUser(email?: string): Promise<TestUser> {
  const targetEmail = email ?? `${TEST_PREFIX}${randomUUID()}@example.com`;
  const password = "Test1234!";

  const user = await clerk.users.createUser({
    emailAddress: [targetEmail],
    password,
    skipPasswordChecks: true,
    publicMetadata: { e2e_test: true },
  });

  return { id: user.id, email: targetEmail, password };
}

/**
 * Delete every Clerk user whose email starts with TEST_PREFIX.
 * Call this in afterAll hooks to keep the test Clerk instance clean.
 */
export async function cleanupTestUsers(): Promise<void> {
  const list = await clerk.users.getUserList({ limit: 200 });
  const targets = list.data.filter((u) =>
    u.emailAddresses.some((e) => e.emailAddress.startsWith(TEST_PREFIX)),
  );
  if (!targets.length) return;
  await Promise.all(targets.map((u) => clerk.users.deleteUser(u.id)));
}
