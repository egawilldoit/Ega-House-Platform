import { defineConfig, globalIgnores } from "eslint/config";
import webConfig from "./apps/web/eslint.config.mjs";

// Root lint covers the whole repository tree. The web application lint
// configuration lives with the application (apps/web/eslint.config.mjs) and
// is reused here; the EGA Runner (standalone package under scripts/) keeps
// its own rule override on top.
const eslintConfig = defineConfig([
  ...webConfig,
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/out/**",
    "**/coverage/**",
    "**/test-results/**",
    "**/.worktrees/**",
    "**/.expo/**",
  ]),
  {
    files: ["scripts/ega-runner/**/*.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  // Scripts keep parameters that callers or a documented V1 interface require
  // even when the body does not read them. The `_` prefix is the marker; honour
  // it here instead of relying on `eslint-disable` comments.
  {
    files: ["scripts/**/*.{ts,mts,cts,mjs,cjs,js}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**/*.ts", "**/__tests__/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
