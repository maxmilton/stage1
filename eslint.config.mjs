import js from "@eslint/js";
import mm from "@maxmilton/eslint-config";
import { defineConfig } from "eslint/config";
import unicorn from "eslint-plugin-unicorn";
import ts from "typescript-eslint";

export default defineConfig(
  js.configs.recommended,
  ts.configs.strictTypeChecked,
  ts.configs.stylisticTypeChecked,
  // @ts-expect-error - broken upstream types
  unicorn.configs.recommended,
  mm.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "warn", // byte savings
      "@typescript-eslint/no-unnecessary-type-parameters": "warn", // somewhat unstable and not always useful
      "@typescript-eslint/prefer-for-of": "off", // worse for performance-critical code
      "@typescript-eslint/prefer-includes": "off", // indexOf is faster
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/prefer-string-starts-ends-with": "off", // alternatives offer byte savings and better performance
      "@typescript-eslint/restrict-plus-operands": "warn", // byte savings (but reduces debugging ability)
      "@typescript-eslint/restrict-template-expressions": "warn", // byte savings (but reduces debugging ability)
      "consistent-return": "warn", // void return can be used for efficient code... but be careful!
      "no-cond-assign": "off", // useful for compact and memory efficient code... but be careful!
      "no-multi-assign": "warn", // more compact at the cost of being harder to read... but be careful!
      "no-param-reassign": "warn", // can be used for efficient code... but be careful!
      "no-plusplus": "off", // byte savings
      "no-return-assign": "warn", // useful for compact and memory efficient code... but be careful!
      "prefer-template": "warn", // byte savings with same performance
      "unicorn/explicit-length-check": "off", // byte savings + faster
      "unicorn/no-array-callback-reference": "warn",
      "unicorn/no-array-for-each": "off", // forEach is often faster (in Chrome and Bun but not Firefox)
      "unicorn/prefer-add-event-listener": "off", // stage1
      "unicorn/prefer-at": "off", // bad browser support
      "unicorn/prefer-dom-node-append": "off", // stage1
      "unicorn/prefer-global-this": "off", // prefer to clearly separate Bun and DOM
      "unicorn/prefer-includes": "off", // indexOf is faster (in Chrome)
      "unicorn/prefer-query-selector": "off", // stage1
      "unicorn/prefer-string-raw": "off", // TODO: Remove once String.raw doesn't crash bun macros
      "unicorn/prefer-string-replace-all": "off", // slower and worse browser support
      "unicorn/switch-case-braces": ["error", "avoid"], // byte savings (minification doesn't currently automatically remove)
    },
  },
  { ignores: ["**/*.bak", "coverage", "dist"] },
);
