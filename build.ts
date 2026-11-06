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
  entrypoints: ["src/index.ts"],
  outdir: "dist",
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
    "src/reconcile/keyed.ts",
    "src/reconcile/non-keyed.ts",
    "src/reconcile/reuse-nodes.ts",
    "src/reconcile/reuse-lite.ts",
  ],
  outdir: "dist/reconcile",
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
    index: "src/index.ts",
    browser: "src/browser/index.ts",
    macro: "src/macro.ts",
    "reconcile/keyed": "src/reconcile/keyed.ts",
    "reconcile/non-keyed": "src/reconcile/non-keyed.ts",
    "reconcile/reuse-nodes": "src/reconcile/reuse-nodes.ts",
    "reconcile/reuse-lite": "src/reconcile/reuse-lite.ts",
  },
  plugins: [dts({ emitDtsOnly: true, sourcemap: true })],
});
await declarations.write({ dir: "dist", format: "es", chunkFileNames: "[name].js" });
await declarations.close();

console.timeEnd("dts");
