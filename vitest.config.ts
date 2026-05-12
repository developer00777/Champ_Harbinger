import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // server-only throws in jsdom — mock it out for unit tests
      "server-only": resolve(
        __dirname,
        "src/__tests__/__mocks__/server-only.ts",
      ),
      "@/db": resolve(__dirname, "db/index.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
