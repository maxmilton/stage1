/* eslint-disable import/no-extraneous-dependencies */

import esbuild from 'esbuild';

const mode = process.env.NODE_ENV;
const dev = mode === 'development';

esbuild
  .build({
    entryPoints: [
      'src/index.ts',
      'src/reconcile/keyed.ts',
      'src/reconcile/reconcile.ts',
      'src/reconcile/reuse-nodes.ts',
    ],
    outdir: 'dist',
    platform: 'neutral',
    bundle: true,
    sourcemap: true,
    watch: dev,
    logLevel: 'debug',
  })
  .catch((err) => {
    throw err;
  });
