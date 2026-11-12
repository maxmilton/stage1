import { rolldown } from "rolldown";
import { dts } from "rolldown-plugin-dts";

console.time("prebuild");
await Bun.$`rm -rf dist`;
console.timeEnd("prebuild");

console.time("build:1");

// Use rolldown to generate compact ES2015 IIFE code
const bundle = await rolldown({
  input: "src/browser/index.ts",
  platform: "browser",
  transform: {
    target: "es2015",
    define: { "Node.ELEMENT_NODE": "1" },
  },
});
await bundle.write({
  file: "dist/browser.js",
  format: "iife",
  name: "stage1",
  sourcemap: true,
  minify: { compress: { target: "es2015" } },
  generatedCode: { symbols: false },
  strict: false,
  intro: '"use strict";',
});
await bundle.close();

console.timeEnd("build:1");
console.time("build:2");

await Bun.build({
  entrypoints: ["src/browser/index.ts"],
  outdir: "dist",
  naming: "[dir]/browser.mjs",
  target: "browser",
  allowUnresolved: [],
  env: "disable",
  define: {
    "Node.ELEMENT_NODE": "1",
  },
  minify: true,
  sourcemap: "linked",
});

await Bun.build({
  entrypoints: ["src/legacy/index.ts"],
  outdir: "dist/legacy",
  target: "browser",
  allowUnresolved: [],
  env: "disable",
  minify: true,
  sourcemap: "linked",
});

await Bun.build({
  entrypoints: ["src/macro.ts"],
  outdir: "dist",
  target: "bun",
  allowUnresolved: [],
  env: "disable",
  minify: true,
  sourcemap: "linked",
});

await Bun.build({
  entrypoints: [
    "src/legacy/reconcile/keyed.ts",
    "src/legacy/reconcile/non-keyed.ts",
    "src/legacy/reconcile/reuse-nodes.ts",
    "src/legacy/reconcile/reuse-lite.ts",
  ],
  outdir: "dist/legacy/reconcile",
  target: "browser",
  allowUnresolved: [],
  env: "disable",
  minify: true,
  sourcemap: "linked",
});

console.timeEnd("build:2");
console.time("dts");

const declarations = await rolldown({
  input: {
    browser: "src/browser/index.ts",
    macro: "src/macro.ts",
    "legacy/index": "src/legacy/index.ts",
    "legacy/reconcile/keyed": "src/legacy/reconcile/keyed.ts",
    "legacy/reconcile/non-keyed": "src/legacy/reconcile/non-keyed.ts",
    "legacy/reconcile/reuse-nodes": "src/legacy/reconcile/reuse-nodes.ts",
    "legacy/reconcile/reuse-lite": "src/legacy/reconcile/reuse-lite.ts",
  },
  plugins: [dts({ emitDtsOnly: true, sourcemap: true })],
});
await declarations.write({ dir: "dist", format: "es", chunkFileNames: "[name].js" });
await declarations.close();

console.timeEnd("dts");
