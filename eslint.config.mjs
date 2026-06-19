import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  // Funnel every LLM call through the concurrency-limited wrappers so the shared
  // OpenRouter key is never hammered. Use generateObjectLimited/generateTextLimited
  // from "@/lib/ai/generate" instead of importing them straight from "ai".
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ai",
              importNames: ["generateObject", "generateText"],
              message:
                "Import { generateObjectLimited as generateObject } (or generateTextLimited) from '@/lib/ai/generate' so the call routes through the global LLM concurrency limiter.",
            },
          ],
        },
      ],
    },
  },
  // The wrapper module itself legitimately imports the raw functions.
  {
    files: ["src/lib/ai/**"],
    rules: { "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
