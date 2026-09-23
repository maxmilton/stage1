import js from "@eslint/js";
import mm from "@maxmilton/eslint-config";
import oxlint from "eslint-plugin-oxlint";
import unicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import ts from "typescript-eslint";

export default defineConfig(
  js.configs.recommended,
  ts.configs.strictTypeChecked,
  ts.configs.stylisticTypeChecked,
  unicorn.configs.recommended,
  mm.configs.recommended,
  ...oxlint.buildFromOxlintConfigFile(".oxlintrc.jsonc"),
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* Rules not supported in oxlint yet */
      // https://github.com/oxc-project/oxc/issues/481
      // https://github.com/oxc-project/oxc/issues?q=%E2%98%82%EF%B8%8F

      "unicorn/prefer-unicode-code-point-escapes": "off", // bad browser support

      // TODO: Remove these once buildFromOxlintConfigFile correctly disables them.
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "consistent-return": "off",
      "unicorn/no-for-loop": "off",
      "unicorn/prefer-add-event-listener": "off",
      "unicorn/prefer-dom-node-append": "off",
      "unicorn/prefer-global-number-constants": "off",
      "unicorn/prefer-global-this": "off",
      "unicorn/prefer-query-selector": "off",
    },
  },
  {
    files: ["src/**"],
    rules: {
      "unicorn/no-computed-property-existence-check": "off", // used carefully
      "unicorn/no-top-level-assignment-in-function": "off", // used carefully
      "unicorn/prefer-smaller-scope": "off", // memory efficient, used carefully
    },
  },
  {
    files: ["test/e2e/**"],
    rules: {
      "unicorn/isolated-functions": "off", // page.evaluate callbacks run in the browser
    },
  },
  { ignores: ["dist"] },
);
