import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Optional: load a .env.test file if it exists (takes lower precedence than .env.local)
dotenv.config({ path: "e2e/.env.test" });

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1, // sequential — tests may share env state
  use: {
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: {
      "Content-Type": "application/json",
    },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: "public",
      testMatch: /api\.public\.test\.ts/,
      use: { browserName: "chromium" },
    },
    {
      name: "v1-api",
      testMatch: /api\.v1\.test\.ts/,
    },
    {
      name: "pages",
      testMatch: /pages\..*\.test\.ts/,
      use: { browserName: "chromium" },
    },
  ],
});
