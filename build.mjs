/* eslint-disable import/no-extraneous-dependencies */

import esbuild from 'esbuild';

const mode = process.env.NODE_ENV;
const dev = mode === 'development';

/** @param {Error?} err */
function handleErr(err) {
  if (err) throw err;
}

// New Tab app
esbuild
  .build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.mjs',
    platform: 'browser',
    // target: ['chrome88'],
    format: 'esm',
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    // banner: { js: '"use strict";' },
    bundle: true,
    // minify: !dev,
    sourcemap: true,
    watch: dev,
    logLevel: 'debug',
  })
  .catch(handleErr);
