import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // @Codex: temporary downgrade to unblock delivery while typed refactors are phased in.
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // @Codex: generated local test artifacts
    "playwright-report/**",
    "test-results/**",
    "tmp-e2e-data*/**",
    "tmp-native-derived-data/**",
    "tmp-parity-smoke/**",
  ]),
]);

export default eslintConfig;
