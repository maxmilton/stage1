import { createBundle } from "dts-buddy";
import { rollup } from "rollup";
import { minify } from "terser";

console.time("prebuild");
await Bun.$`rm -rf dist`;
console.timeEnd("prebuild");

console.time("build:1");

// Use rollup and terser to generate compact IIFE code
const { outputs } = await Bun.build({
  entrypoints: ["src/browser/index.ts"],
  outdir: "dist",
  naming: "[dir]/browser.js",
  target: "browser",
  define: {
    "Node.ELEMENT_NODE": "1",
  },
  // Avoid double-minifying since we run Terser on the IIFE output
  minify: false,
  sourcemap: "inline",
});
const bundle = await rollup({
  input: outputs[0].path,
});
await bundle.write({
  file: outputs[0].path,
  format: "iife",
  name: "stage1",
  sourcemap: true,
  plugins: [
    {
      name: "terser",
      renderChunk(src) {
        return minify(src, {
          ecma: 2015,
          compress: {
            comparisons: false,
            negate_iife: false,
            reduce_funcs: false,
            passes: 2,
          },
          mangle: {
            safari10: true,
            // do not mangle the global export name
            reserved: ["stage1"],
          },
          format: {
            wrap_func_args: true,
            wrap_iife: true,
          },
          sourceMap: true,
        }) as Promise<{ code: string; map: string }>;
      },
    },
  ],
});

console.timeEnd("build:1");
console.time("build:2");

await Bun.build({
  entrypoints: ["src/browser/index.ts"],
  outdir: "dist",
  naming: "[dir]/browser.mjs",
  target: "browser",
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
  minify: true,
  sourcemap: "linked",
});

await Bun.build({
  entrypoints: ["src/macro.ts"],
  outdir: "dist",
  target: "bun",
  minify: true,
  sourcemap: "linked",
});

await Bun.build({
  entrypoints: [
    "src/reconcile/keyed.ts",
    "src/reconcile/non-keyed.ts",
    "src/reconcile/reuse-nodes.ts",
  ],
  outdir: "dist/reconcile",
  target: "browser",
  minify: true,
  sourcemap: "linked",
});

console.timeEnd("build:2");
console.time("dts");

await createBundle({
  output: "dist/index.d.ts",
  modules: {
    stage1: "src/index.ts",
    "stage1/browser": "src/browser/index.ts",
    "stage1/macro": "src/macro.ts",
    "stage1/reconcile/keyed": "src/reconcile/keyed.ts",
    "stage1/reconcile/non-keyed": "src/reconcile/non-keyed.ts",
    "stage1/reconcile/reuse-nodes": "src/reconcile/reuse-nodes.ts",
  },
  include: ["src"],
});

console.timeEnd("dts");
