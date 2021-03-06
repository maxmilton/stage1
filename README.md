[![Build status](https://img.shields.io/github/workflow/status/maxmilton/stage1/ci)](https://github.com/maxmilton/stage1/actions)
[![Coverage status](https://img.shields.io/codeclimate/coverage/maxmilton/stage1)](https://codeclimate.com/github/maxmilton/stage1)
[![NPM version](https://img.shields.io/npm/v/stage1.svg)](https://www.npmjs.com/package/stage1)
[![NPM bundle size (minified + gzip)](https://img.shields.io/bundlephobia/minzip/stage1.svg)](https://bundlephobia.com/result?p=stage1)
[![Licence](https://img.shields.io/github/license/maxmilton/stage1.svg)](https://github.com/maxmilton/stage1/blob/master/LICENSE)

# stage1

High-performance JavaScript micro framework.

> Warning: This is alpha software. Test thoroughly before using in production. Please report any bugs you find!

Originally a fork of the excellent <https://github.com/Freak613/stage0> project.

## TODO

- Add documentation about:
  - Differences from the original `stage0` project:
    - `h` is now `function h(template: string): S1Node` e.g., `h('<p>#text<p>')`
    - `html` is available to use as a string template literal tag function e.g., `` html`<p>#text<p>` ``
    - Import paths
      - Other than reconcilers, everything is a named export from `stage1`
      - Reconcilers all export a `reconcile` function
      - `/keyed` --> `/reconcile/keyed`
      - `/reconcile` --> `/reconcile/non-keyed`
      - `/reuse-nodes` --> `/reconcile/reuse-nodes`
    - Extra DOM utils
    - Improved TypeScript support
    - Reduced size and improved load and runtime performance
  - `process.env.NODE_ENV` must be defined
  - If `process.env.NODE_ENV === 'production` you must minify `h`/`html` strings with a compatible minifier
    - Add full example with `esbuild` + `esbuild-minify-templates`
- Add API and usage documentation
- Add more tests
- Add examples
- Set up benchmarking + compare to `stage0` and other JS frameworks
- Submit to <https://github.com/krausest/js-framework-benchmark>

## Browser support

> Note: Internet Explorer is not supported.

Minimum browser version required:

- Chrome 26
- Edge 13
- Firefox 22
- Safari 8
- Opera 15

Some optional features require a higher browser version:

- Compiler `html` tagged template literal function; [requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/raw#browser_compatibility)
- `createFragment` utility function; [requirements](https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment/DocumentFragment#browser_compatibility)

SSR via Node.js or Deno is not supported and is not the intended use of this library.

## Bugs

Please report any bugs you encounter on the [GitHub issue tracker](https://github.com/maxmilton/stage1/issues).

## Changelog

See [releases on GitHub](https://github.com/maxmilton/stage1/releases).

## License

MIT license. See [LICENSE](https://github.com/maxmilton/stage1/blob/master/LICENSE).

---

?? 2022 [Max Milton](https://maxmilton.com)
