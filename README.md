[![Build status](https://img.shields.io/github/workflow/status/maxmilton/stage1/ci)](https://github.com/maxmilton/stage1/actions)
[![Coverage status](https://img.shields.io/codeclimate/coverage/maxmilton/stage1)](https://codeclimate.com/github/maxmilton/stage1)
[![NPM version](https://img.shields.io/npm/v/stage1.svg)](https://www.npmjs.com/package/stage1)
[![NPM bundle size (minified + gzip)](https://img.shields.io/bundlephobia/minzip/stage1.svg)](https://bundlephobia.com/result?p=stage1)
[![Licence](https://img.shields.io/github/license/maxmilton/stage1.svg)](https://github.com/maxmilton/stage1/blob/master/LICENSE)

# stage1

> Warning: This is alpha software. Test thoroughly before using in production! Please report any bugs you find!

Originally based on the excellent <https://github.com/Freak613/stage0>.

## TODO

- Add documentation about:
  - Differences from [original stage0](https://github.com/Freak613/stage0)
    - `h` is now `function h(template: string): S1Node`
    - `ht` is available for anyone who wants to use as a string template literal tag function e.g., `` ht`<p>#text<p>` ``
    - Import paths
    - Improved TypeScript support
    - Reduced size and (hopefully) improved load & runtime performance
  - `process.env.NODE_ENV` must be defined
  - If `process.env.NODE_ENV === 'production` you must minify `h` tagged template literals with a compatible minifier
    - Add full example with `esbuild` + `esbuild-minify-templates`
- Set up benchmarking + compare to `stage0` and other JS frameworks

## Changelog

See [releases on GitHub](https://github.com/maxmilton/stage1/releases).

## License

MIT license. See [LICENSE](https://github.com/maxmilton/stage1/blob/master/LICENSE).

---

© 2021 [Max Milton](https://maxmilton.com)
