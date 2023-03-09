/* eslint-disable import/no-extraneous-dependencies, no-console */

import esbuild from 'esbuild';

// We don't use NODE_ENV here to avoid confusion with process.env.NODE_ENV
// which we want kept in the build output
const dev = !!process.env.DEV_BUILD;

/** @type {esbuild.BuildOptions} */
const esbuildConfig = {
  entryPoints: [
    'src/index.ts',
    'src/store.ts',
    'src/reconcile/keyed.ts',
    'src/reconcile/non-keyed.ts',
    'src/reconcile/reuse-nodes.ts',
  ],
  outdir: 'dist',
  platform: 'neutral',
  bundle: true,
  sourcemap: true,
  metafile: !dev && process.stdout.isTTY,
  logLevel: 'debug',
};

if (dev) {
  const context = await esbuild.context(esbuildConfig);
  await context.watch();
} else {
  const out = await esbuild.build(esbuildConfig);

  if (out.metafile) {
    console.log(await esbuild.analyzeMetafile(out.metafile));
  }
}
