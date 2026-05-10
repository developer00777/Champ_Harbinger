import "@testing-library/jest-dom/vitest";

// Stub required env vars so modules that validate them at import time
// don't crash during unit tests (no real DB or LLM provider needed).
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.OPENROUTER_API_KEY ??= "test-key";
process.env.HARBINGER_DEFAULT_MODEL ??= "anthropic/claude-sonnet-4-6";
