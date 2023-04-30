[![Build status](https://img.shields.io/github/actions/workflow/status/maxmilton/stage1/ci.yml?branch=master)](https://github.com/maxmilton/stage1/actions)
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
  - Internal use of `innerHTML` — potencial risk of XSS etc.; never use `h` and `html` functions with untrusted input
    - In future we may have `Sanitizer.sanitizeFor(...)` which could be used to sanitize untrusted input
      - It's unlikely we'll use it internally due to performance overhead but developers should definately sanitize input when untrusted before passing it in... although we could create light wrapper functions
      - <https://developer.mozilla.org/en-US/docs/Web/API/Sanitizer/sanitizeFor>
      - <https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API>
  - New DOM utility functions
    - `createFragment`
    - `create`
    - `append`
    - `prepend`
    - `onNodeRemove`
  - New reactive store feature
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
    - New reactive `store` factory can be imported from `stage1/store`
    - Improved TypeScript support
    - Reduced size and improved load and runtime performance
  - `process.env.NODE_ENV` must be defined
  - If `process.env.NODE_ENV === 'production` you must minify `h`/`html` strings with a compatible minifier
    - Add full example with `esbuild` + `esbuild-minify-templates`
  - Ref names must be lowercase because some browsers normalise element attribute names when rendering HTML
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

- Compiler `html` tagged template literal function uses `String.raw`; [requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/raw#browser_compatibility)
- `createFragment` utility function uses `DocumentFragment`; [requirements](https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment/DocumentFragment#browser_compatibility)
- `onNodeRemove` utility function uses `for...of`; [requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...of#browser_compatibility)
- `store` uses `Proxy`; [requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy#browser_compatibility)
  - Also uses [logical nullish assignment](<(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Logical_nullish_assignment#browser_compatibility)>) and [optional chaining operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining#browser_compatibility), however, build tools can transform these for old browser targets

SSR via Node.js or Deno is not supported and is not the intended use of this library.

## Bugs

Please report any bugs you encounter on the [GitHub issue tracker](https://github.com/maxmilton/stage1/issues).

## Changelog

See [releases on GitHub](https://github.com/maxmilton/stage1/releases).

## License

MIT license. See [LICENSE](https://github.com/maxmilton/stage1/blob/master/LICENSE).

---

© 2023 [Max Milton](https://maxmilton.com)
