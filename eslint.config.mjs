import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import { EFFECT_EXEMPT_PATTERNS, EFFECT_RESTRICTIONS } from "./scripts/use-effect-ratchet.mjs";

const packageCommonJsConfig = {
  ...nextVitals[0],
  name: "mediflow/web-auth-lifecycle-owner-commonjs",
  files: ["**/*.cjs", "packages/web-auth-lifecycle-owner/**/*.js"],
  languageOptions: {
    ...nextVitals[0].languageOptions,
    sourceType: "commonjs",
    parserOptions: {
      ...nextVitals[0].languageOptions?.parserOptions,
      sourceType: "script",
    },
  },
  rules: {
    ...nextVitals[0].rules,
    "@typescript-eslint/no-require-imports": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  packageCommonJsConfig,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    name: "mediflow/no-use-effect",
    rules: { "no-restricted-syntax": ["error", ...EFFECT_RESTRICTIONS] },
  },
  {
    name: "mediflow/use-effect-ratchet",
    files: EFFECT_EXEMPT_PATTERNS,
    rules: { "no-restricted-syntax": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "tmp/**",
    "tmp-*/**",
    "playwright-report/**",
    "test-results/**",
    ".next-*/**",
    ".next-ui-review/**",
    ".codex-ui-sandbox/**",
    ".pm2/**",
    "tmp-e2e-data*/**",
    "tmp-native-derived-data/**",
    "tmp-parity-smoke/**",
    ".texpadtmp/**",
    ".venv*/**",
    "scripts/__pycache__/**",
    "native/MediFlowMac/.build/**",
    "native/MediFlowMac/Build/**",
    "experiments/gpui-patient-pilot/target/**",
    "experiments/rust-boundary/target/**",
    "experiments/gpui-patient-pilot/worker/dossier.bundle.mjs",
  ]),
]);

export default eslintConfig;
