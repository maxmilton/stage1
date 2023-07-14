/* eslint-disable no-console */

export {};

console.time('build');

// Minified browser bundle which includes "regular mode" functions, utils, and store.
const out = await Bun.build({
  entrypoints: ['src/browser.ts'],
  outdir: 'dist',
  target: 'browser',
  // FIXME: Use iife once Bun.build supports it (but we should have 2 bundles, esm and iife)
  // format: 'iife',
  minify: true,
  sourcemap: 'external',
});

const out2 = await Bun.build({
  entrypoints: ['src/index.ts', 'src/store.ts'],
  outdir: 'dist',
  target: 'browser',
  sourcemap: 'external',
});

const out3 = await Bun.build({
  entrypoints: [
    'src/reconcile/keyed.ts',
    'src/reconcile/non-keyed.ts',
    'src/reconcile/reuse-nodes.ts',
  ],
  outdir: 'dist/reconcile',
  target: 'browser',
  sourcemap: 'external',
});

const out4 = await Bun.build({
  entrypoints: ['src/runtime/index.ts'],
  outdir: 'dist/runtime',
  target: 'browser',
  sourcemap: 'external',
});

const out5 = await Bun.build({
  entrypoints: ['src/runtime/macro.ts'],
  outdir: 'dist/runtime',
  target: 'bun',
  minify: true,
  sourcemap: 'external',
});

console.timeEnd('build');
console.log(out, out2, out3, out4, out5);
