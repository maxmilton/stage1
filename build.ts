/* eslint-disable no-console */

import * as rollup from 'rollup';
import { minify } from 'terser';

console.time('build');

const out1 = await Bun.build({
  entrypoints: ['src/browser/index.ts'],
  outdir: 'dist/browser',
  target: 'browser',
  minify: true,
  sourcemap: 'inline',
});
const bundle = await rollup.rollup({
  input: out1.outputs[0].path,
});
await bundle.write({
  file: out1.outputs[0].path,
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
          mangle: {
            properties: {
              regex: /^\$\$/,
            },
          },
        });
      },
    },
  ],
});

const out2 = await Bun.build({
  entrypoints: ['src/browser/index.ts'],
  outdir: 'dist/browser',
  target: 'browser',
  naming: '[dir]/[name].mjs',
  minify: true,
  sourcemap: 'external',
});

const out3 = await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'browser',
  minify: true,
  sourcemap: 'external',
});

const out4 = await Bun.build({
  entrypoints: ['src/macro.ts'],
  outdir: 'dist',
  target: 'bun',
  minify: true,
  sourcemap: 'external',
});

const out5 = await Bun.build({
  entrypoints: [
    'src/reconcile/keyed.ts',
    'src/reconcile/non-keyed.ts',
    'src/reconcile/reuse-nodes.ts',
  ],
  outdir: 'dist/reconcile',
  target: 'browser',
  sourcemap: 'external',
});

console.timeEnd('build');
console.log(out1, out2, out3, out4, out5);
