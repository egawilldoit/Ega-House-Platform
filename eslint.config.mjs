import { defineConfig, globalIgnores } from "eslint/config";
import webConfig from "./apps/web/eslint.config.mjs";

// Root lint covers the whole repository tree. The web application lint
// configuration lives with the application (apps/web/eslint.config.mjs) and
// is reused here.
const eslintConfig = defineConfig([
  ...webConfig,
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/out/**",
    "**/coverage/**",
    "**/test-results/**",
  ]),
]);

export default eslintConfig;
