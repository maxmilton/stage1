import { createBundle } from 'dts-buddy';
import { rollup } from 'rollup';
import { minify } from 'terser';

console.time('prebuild');
await Bun.$`rm -rf dist`;
console.timeEnd('prebuild');

console.time('build1');

const out = await Bun.build({
  entrypoints: ['src/browser/index.ts'],
  outdir: 'dist',
  naming: '[dir]/browser.js',
  target: 'browser',
  minify: true,
  sourcemap: 'inline',
});
// TODO: Once bun supports compact iife output, remove this rollup build step.
const bundle = await rollup({
  input: out.outputs[0].path,
});
await bundle.write({
  file: out.outputs[0].path,
  format: 'iife',
  name: 'stage1',
  sourcemap: true,
  plugins: [
    // @ts-expect-error - TODO: Fix return types
    {
      name: 'terser',
      renderChunk(src) {
        return minify(src, {
          ecma: 2015,
          sourceMap: true,
          compress: {
            reduce_funcs: false, // prevent functions being inlined
            passes: 2,
          },
        });
      },
    },
  ],
});

console.timeEnd('build1');
console.time('build2');

await Bun.build({
  entrypoints: ['src/browser/index.ts'],
  outdir: 'dist',
  target: 'browser',
  naming: '[dir]/browser.mjs',
  minify: true,
  sourcemap: 'linked',
});

await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'browser',
  minify: true,
  sourcemap: 'linked',
});

await Bun.build({
  entrypoints: ['src/macro.ts'],
  outdir: 'dist',
  target: 'bun',
  minify: true,
  sourcemap: 'linked',
});

await Bun.build({
  entrypoints: [
    'src/reconcile/keyed.ts',
    'src/reconcile/non-keyed.ts',
    'src/reconcile/reuse-nodes.ts',
  ],
  outdir: 'dist/reconcile',
  target: 'browser',
  minify: true,
  sourcemap: 'linked',
});

console.timeEnd('build2');
console.time('dts');

await createBundle({
  output: 'dist/index.d.ts',
  modules: {
    stage1: 'src/index.ts',
    'stage1/browser': 'src/browser/index.ts',
    'stage1/macro': 'src/macro.ts',
    'stage1/reconcile/keyed': 'src/reconcile/keyed.ts',
    'stage1/reconcile/non-keyed': 'src/reconcile/non-keyed.ts',
    'stage1/reconcile/reuse-nodes': 'src/reconcile/reuse-nodes.ts',
  },
  include: ['src'],
});

console.timeEnd('dts');
