[![CI status](https://badgen.net/github/checks/maxmilton/stage1?label=ci)](https://github.com/maxmilton/stage1/actions)
[![Coverage %](https://qlty.sh/badges/71ce5b0f-6642-4ea1-9e5a-e558bc1f6169/test_coverage.svg)](https://qlty.sh/gh/maxmilton/projects/stage1)
[![NPM version](https://badgen.net/npm/v/stage1)](https://www.npmjs.com/package/stage1)
[![Licence](https://badgen.net/github/license/maxmilton/stage1)](LICENSE)

[![Minified size](https://badgen.net/bundlephobia/minzip/stage1)](https://bundlephobia.com/package/stage1)
![Dependency count](https://badgen.net/bundlephobia/dependency-count/stage1)

![Status](https://badgen.net/badge/status/beta/blue)

# stage1

High-performance JavaScript micro framework.

- zero runtime dependencies

## Signals and lists

An app imports its signals from one of two tiers, each with its own core:

<!-- prettier-ignore -->
| import | available functions | for |
| --- | --- | --- |
| `stage1` | `signal`, `computed`, `get`, `set`, `effect`, `scope`, `sub`, `defer`, `dispose`, `batch`, `untracked` | apps with computeds, effects and owners |
| `stage1/lite` | `signal`, `get`, ` `, `sub`, `dispose`, `batch` | the smallest apps: subs, no owners      |

Both export the same `list` and `mark`. They import no signals: wire them with the tier's `sub`.

```ts
import { list, mark, set, signal, sub } from "stage1"; // or "stage1/lite": the same code

interface Item {
  readonly id: number;
  readonly label: string;
}

const items = signal<readonly Item[]>([]);
const selected = signal(0);
const tbody = document.createElement("tbody");

const rows = list(
  tbody,
  "id",
  (item: Item) => {
    const tr = document.createElement("tr");
    tr.textContent = item.label;
    return tr;
  },
  (tr, item) => {
    tr.textContent = item.label;
  },
);
sub(items, rows);
sub(
  selected,
  mark(rows, (tr, on) => {
    tr.className = on ? "danger" : "";
  }),
);

set(items, [
  { id: 1, label: "one" },
  { id: 2, label: "two" },
]);
set(selected, 2); // row 2 gets "danger"
```

- `list(parent, key, create, update?, drop?)` returns the rows function. Called with items, it keeps one row per item in `parent`, matched by `item[key]`, and moves as few rows as it can. `update` runs on a kept row whose item is a new object; `drop` runs on each row the list removes, clears or replaces, while the row is still in the DOM.
- `mark(rows, fn)` returns the show function: shown a key, it calls `fn(row, true)` for that key's row and `fn(row, false)` for the row shown before. It also takes any map from key to element with `get`, such as a `Map`.
- The sub is the handle: dispose it, or its owner, to stop following the signal. The rows stay in the DOM, and a mark stays attached to its list.
- `stage1/lite` has no owners: a sub lives until it is disposed. Writing a list's items while it reconciles (from `create`, `update`, `drop`, or a mark callback the reconcile calls) is unsupported there: a development build throws.

### Owners (`stage1`)

An effect, sub or scope owns the effects, subs, computeds, scopes and `defer` cleanups its run creates; disposing it disposes them, newest first. An effect also disposes them before each re-run; a sub keeps them across calls. `scope(fn)` runs `fn` once, untracked, as an owner, and does not batch: at top level a write in `fn` runs the effects it reaches before `set` returns (`scope(() => batch(() => …))` runs them once, after the body). A scope made where nothing owns it is a root: keep it and dispose it.

Rows own nothing: what `create` makes belongs to the sub that calls the rows function and lives until that sub is disposed (a development build warns once when the `create` of a list without `drop` makes an effect, sub, computed or cleanup outside a scope). A row opts in through `drop`:

```ts
import { dispose, type Effect, effect, get, list, signal, sub } from "stage1";

type Row = HTMLTableRowElement & { fx: Effect };

const theme = signal("light");
const items = signal<readonly { readonly id: number; readonly label: string }[]>([]);

const rows = list(
  document.createElement("tbody"),
  "id",
  (item: { readonly id: number; readonly label: string }): Row => {
    const tr = document.createElement("tr") as Row;
    tr.textContent = item.label;
    tr.fx = effect(() => {
      tr.className = get(theme);
    });
    return tr;
  },
  undefined,
  (tr) => {
    dispose(tr.fx);
  },
);
sub(items, rows);
```

A row that owns several things makes them in a scope of its own, `tr.s = scope(() => { … })`, and `drop` disposes `tr.s` (without that `drop` the scope lives until the sub is disposed, and nothing warns). Make row effects in `create`: what `update` makes belongs to the sub. On clear and replace the list calls `rows.forEach(drop)`, so write `drop` to use only its first parameter.

### Migrating from the previous API

<!-- prettier-ignore -->
| before | now |
| --- | --- |
| `list(parent, items, key, create, update?)` | `const rows = list(parent, key, create, update?, drop?)`, then `sub(items, rows)` |
| `mark(selected, list, fn)`, `mark(selected, map, fn)` | `sub(selected, mark(rows, fn))`, `sub(selected, mark(map, fn))` |
| `dispose(list)`, `dispose(mark)` | dispose the sub, or its owner (`stage1`: a mark no longer detaches from its list) |
| type `List` | `Rows` (the rows function), `Marked` (what `mark` takes) |
| `stage1`: rows own what `create` makes | rows own nothing unless `drop` disposes it (see "Owners") |
| `stage1`: `effect(() => { const v = get(s); untracked(() => fn(v)); })` | `sub(s, fn)`: batched, run after its owners; keeps what `fn` makes; a write to `s` in `fn` calls it again after `fn` |
| `scope(fn)` batched its body | not batched: `scope(() => batch(() => …))` keeps the old timing |
| `within(owner, fn)` (e.g. in an async callback) | removed: the callback makes a root `scope` and keeps it; the component disposes it from a `defer` |
| `holder`, `own`, `owns`, type `Holder` | removed: create in place with `scope` and keep the handle (`Scope`, `Effect`) |
| `release(h)` | `batch(() => { for (let i = hs.length; i--; ) dispose(hs[i]); })` over the kept handles |
| sibling effects ran newest first | creation order (unspecified: do not rely on either) |

## TODO

- Decide whether to keep multiple implementations
  - Browser "live" compile, browser runtime mode
  - Bun default precompiled mode
  - ~~Bun "fast" precompiled mode (use this as the default implementation and remove "normal" precompiled mode?)~~ — NOW THE DEFAULT
    - ~~Downside is the API is different to the other modes (`collect` function return type)~~
  - `stage1/legacy` which is the old default precompiled mode
- Keep only the most used functionality in `stage1` and move less used but still useful functionality to `stage2`
  - Should the reactive store be in `stage1` or `stage2`?
  - Should less used DOM utilities be moved to `stage2`?
    - `prepend`
    - `insert`
    - `replace`
    - `text`?
  - How much focus should be given to `stage1` used as a prebuilt/CDN browser/live package vs a build-time library?
    - Maybe we can actually include more functionality when used as a lib but intentionally reduce what's included in the prebuilt browser/live package.
- Add documentation about:
  - Security:
    - Internal use of `innerHTML` — potential risk of XSS etc.; never use `h` and `html` functions with untrusted input
      - In future we may have `Sanitizer.sanitizeFor(...)` which could be used to sanitize untrusted input
        - It's unlikely we'll use it internally due to performance overhead but developers should definitely sanitize input when untrusted before passing it in... although we could create light wrapper functions
        - <https://developer.mozilla.org/en-US/docs/Web/API/Sanitizer/sanitizeFor>
        - <https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API>
  - New DOM utility functions
    - `fragment`
    - `text`
    - `create`
    - `clone`
    - `append`
    - `prepend`
    - `insert`
    - `replace`
    - `onRemove`
  - ~~New reactive store feature~~ — REPLACED BY SIGNALS (old implementation available via `stage1/legacy`)
  - Differences from the original `stage0` project:
    - There are now 3 runtime modes:
      - New precompiled runtime mode and a fast variant for ultimate performance. Compiles templates at build-time via a bun macro that minifies templates, generates metadata, and then includes minimal runtime code in your JS bundle. Currently only works with [Bun.build](https://bun.sh/docs/bundler).
        - The fast mode is a variant of the precompiled mode that uses a different API and is further optimized for performance.
      - The regular mode is still available which generates metadata when your JS is run in the browser. Regular mode can be used with or without a build process.
    - Ref nodes are now marked with `@` rather than `#`
    - `h` is now `function h(template: string): S1Node` e.g., `h('<p>@key<p>')`
    - `html` is available to use as a string template literal tag function e.g., `` html`<p>@key<p>` `` (regular mode only)
    - `view.collect` is now a `collect` function that needs to be imported separately
    - Extra DOM utils
    - New reactive `store` factory can be imported from `stage1/store`
    - Improved TypeScript support
    - Reduced size and improved load and runtime performance
    - Import paths:
      - Other than reconcilers and the store, everything is a named export from `stage1`
      - Reconcilers all export a `reconcile` function
      - `/keyed` --> `/reconcile/keyed`
      - `/reconcile` --> `/reconcile/non-keyed`
      - `/reuse-nodes` --> `/reconcile/reuse-nodes`
  - Ref names must be lowercase because some browsers normalize element attribute names when rendering HTML
    - Note: No longer the case in "fast" mode (different API).
  - Comments may be used as refs
- Add API and usage documentation
  - The regular mode `h()` function does not support skipping minification in whitespace sensitive HTML blocks like `<pre>` and `<code>` because it would be too slow. The precompiled mode `compile()` macro does however. Same for the other compile options.
- Add more tests
- Add examples
- Set up benchmarking + compare to `stage0` and other JS frameworks
- Submit to <https://github.com/krausest/js-framework-benchmark>

## Browser support

> Note: Internet Explorer is not supported.

Minimum browser version required:

<!-- Note: The limiting factor is use of <template> element. -->

- Chrome 26
- Edge 13
- Firefox 22
- Safari 8
- Opera 15

If using the browser runtime mode or synthetic click events:

<!-- Note: The limiting factor is use of Symbol. -->

- Chrome 38
- Edge 13
- Firefox 36
- Safari 9
- Opera 25

Some syntax require higher browser versions but can be transpiled e.g., arrow function expressions; [requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions#browser_compatibility)

Some optional features require a higher browser version:

- `html` tagged template literal function uses `String.raw`; [requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/raw#browser_compatibility)
- ~~`onRemove` utility function uses `for...of` and `MutationObserver`; [requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...of#browser_compatibility), [requirements](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/)~~
  - NOTE: Moved to `stage2` package
- `store` uses `Proxy`; [requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy#browser_compatibility)
  - Also uses [logical nullish assignment](<(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Logical_nullish_assignment#browser_compatibility)>) and [optional chaining operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining#browser_compatibility), however, build tools can transform these for old browser targets

SSR (server-side rendering) is not supported and is not the intended use of this library.

## Build environment JS runtime support

The default precompiled mode runtime requires [Bun](https://bun.sh/) version 1.0.20 or above because [Bun macros](https://bun.com/docs/bundler/macros) are needed.

The regular mode browser bundle does not have any specific build requirements (and can even be used without any build step).

## Bugs

Report any bugs you encounter on the [GitHub issue tracker](https://github.com/maxmilton/stage1/issues).

## Changelog

See [releases on GitHub](https://github.com/maxmilton/stage1/releases).

## Credits

Originally started as a fork of <https://github.com/Freak613/stage0>.

## License

[MIT License](LICENSE) · © [Max Milton](https://maxmilton.com)
