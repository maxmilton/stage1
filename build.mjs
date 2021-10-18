/* eslint-disable import/no-extraneous-dependencies, no-console */

import esbuild from 'esbuild';

const out = await esbuild.build({
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
  watch: !!process.env.DEV_BUILD,
  metafile: process.stdout.isTTY,
  logLevel: 'debug',
});

if (out.metafile) {
  console.log(await esbuild.analyzeMetafile(out.metafile));
}
