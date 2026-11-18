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

An app imports its signals from one of three tiers, each with its own core:

<!-- prettier-ignore -->
| import | available functions | for |
| --- | --- | --- |
| `stage1` | `signal`, `computed`, `get`, `set`, `effect`, `scope`, `sub`, `defer`, `dispose`, `batch`, `untracked`, `trigger`, `owner`, `within` | apps with computeds, effects and owners |
| `stage1/lite` | `signal`, `get`, `set`, `sub`, `dispose`, `batch`, `trigger` | small apps: subs, no owners |
| `stage1/ultralite` | `signal`, `get`, `set`, `sub`, `dispose`, `batch` | the smallest apps: one sub per signal, no owners |

All three export the same `list` and `mark`. They import no signals: wire them with the tier's `sub`.

```ts
import { list, mark, set, signal, sub } from "stage1"; // or a lite tier: the same code

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
- `batch(fn)` returns what `fn` returns, on every tier: `const sum = batch(() => { set(a, 1); set(b, 2); return get(a) + get(b); })`. When its end delivers its writes and a callback throws there, that error reaches the caller instead (if `fn` threw too, which error wins is unspecified). Only an outermost batch's end delivers, and on `stage1` and `stage1/lite` only outside every callback and effect: elsewhere `batch` returns first, and the error reaches what delivers the writes later.
- The lite tiers have no owners: a sub lives until it is disposed. Writing a list's items while it reconciles (from `create`, `update`, `drop`, or a mark callback the reconcile calls) reconciles again after it when a `stage1` or `stage1/lite` sub runs the rows function. When the write is delivered at once, on `stage1/ultralite` outside a batch or when the rows function was called outside every callback and batch, it is unsupported: a development build throws (see "The lite tiers").

### Owners (`stage1`)

An effect, sub or scope owns the effects, subs, computeds, scopes and `defer` cleanups its run creates; disposing it disposes them, newest first. An effect also disposes them before each re-run; a sub keeps them across calls. `scope(fn)` runs `fn` once, untracked, as an owner, and does not batch: at top level a write in `fn` runs the effects it reaches before `set` returns (`scope(() => batch(() => …))` runs them once, after the body). A scope made where nothing owns it is a root: keep it and dispose it.

Code that runs later (an event handler, a timer, a promise callback) runs with no owner, so a scope made there is a root. To make it the component's, keep `const parent = owner()` while the component's body runs and create inside `within(parent, fn)` later:

```ts
import { defer, owner, scope, within } from "stage1";

scope(() => {
  const parent = owner()!;
  const onClick = () => {
    within(parent, () => {
      scope(() => mountDialog());
    });
  };
  button.addEventListener("click", onClick);
  defer(() => button.removeEventListener("click", onClick));
});
```

`within(target, fn)` runs `fn` untracked as the target's own code, and returns what it returns: what `fn` creates belongs to the target and goes when the target is disposed (an effect disposes it before its next run). Like a scope's body, it does not batch. On a disposed target it does not call `fn` and returns `undefined`, so a callback that arrives after its component was disposed does nothing. Only `fn`'s synchronous part runs as the owner: after an `await`, nothing owns. Keep `owner()` rather than the component's own handle (`const root = scope(() => … within(root, …))`): a handler that runs during the body (a synchronous `click()` or `focus()`) would find `root` not yet assigned.

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

### The lite tiers

`stage1/lite`'s `sub` keeps the timing of `stage1`'s: a write made while a callback runs is delivered after that callback returns (a callback that writes its own signal is called again then), and the first call is held the same way, so at rest the writes it makes are delivered before `sub` returns (inside a callback or batch, when that callback returns or the batch ends). No write calls a sub back inside a callback, so a chain of subs that each write the next signal runs in one loop at any length. If the first call throws, the sub is disposed and the error rethrown; at rest, the same happens when the delivery of the first call's writes throws (inside a callback or batch, that error reaches the write or batch delivering them, and the sub stays). Every callback a write reaches runs even when some throw; then one of their errors reaches the writer (which one is unspecified). `batch` defers delivery to the end of the outermost batch, or, inside a callback, until that callback returns.

`stage1/ultralite` holds at most one sub per signal: a development build throws on a second, and a production build replaces the first. The sub's handle is its signal, so its sub costs nothing beyond the signal's three fields; fan-out goes inside the one sub, as list and mark wiring does. Outside a batch a write calls the sub at once, before `set` returns, and its error reaches the writer as thrown, so a callback that writes another signal nests that signal's sub inside it (one that writes its own signal is called again inside itself) and a chain of such writes recurses once per link (a stack overflow after several thousand links on V8, tens of thousands on JSC). A batch end delivers the signals written, and the writes its callbacks make are delivered in the same loop. So when a list's `create`, `update` or `drop`, or a mark callback the reconcile calls, writes the list's items outside a batch, the rows function runs again inside the reconcile: a development build throws, and a production build duplicates rows. A write to the selection made there shows its key against the rows as they were before the reconcile. Inside a batch both wait for the reconcile.

On both lite tiers:

- Each write that changes a signal with a sub while a batch is open (on `stage1/lite`, also while a callback or a held first call runs) takes a queue entry until it is delivered, so a batch of n such writes holds n entries until its end; the queue keeps its peak capacity.
- An endless write loop (a sub writing NaN to its own signal included: NaN never equals the value it was last called with) hangs a production build; on `stage1/ultralite` outside a batch it overflows the stack instead. A development build throws once one pass (`stage1/lite`) or one batch end (`stage1/ultralite`) made a million calls, so a legitimate one that large throws there too.
- Values compare with `===` (NaN counts as changed); sibling order is unspecified.

### Mutable data

Writes notify by value: `set` compares with `===`, and a reader runs again only when a value it read is no longer `===` to what it read. An object, array, `Map` or typed array changed in place keeps its identity, so nothing is notified (`set(s, s.v)` does nothing). Change mutable data one of these ways:

- **A new value** (copy, then change the copy): `set(items, [...items.v, item])`. A list's items must be changed this way: `list` keeps the array it last rendered and diffs the next one against it by identity, so changing that array in place, even before passing a copy, corrupts the next reconcile (rows go missing; a later removal can throw). A development build throws at the list's next call if the array it rendered was changed in place. An item changed in place keeps its row as rendered: `update` runs only for an item that is a new object.
- **A tick** (recommended for data changed in place): keep the data in a plain variable with a counter signal beside it. Readers read the counter, writers change the data in place and then count up. Use a counter, not a boolean: two flips in one batch end where they started and notify nothing.

  ```ts
  const points = new Float32Array(4096); // changed in place
  const tick = signal(0);
  effect(() => {
    get(tick);
    draw(points);
  }); // the lite tiers: sub(tick, () => draw(points))

  points[0] = 1;
  set(tick, (tick.v + 1) & 0x3fffffff); // wraps: stays a small integer (no allocation per write)
  ```

  A `Map` of counters, one per key, notifies only that key's readers.

- **A new handle on the same data**: `set(buf, buf.v.subarray(0))` (a new view of the same buffer), or a box, `set(s, { d: s.v.d })`.
- **`trigger(s)`** (`stage1` and `stage1/lite`), for data that must stay in its signal: `s.v.push(x); trigger(s)` runs the signal's readers as a `set` of a value they have not seen would, passing the same object. Shallow: a computed that returns the same object stops it there, as for any unchanged value. Never use it for a list's items. A sub that triggers its own signal on every call never settles (an endless write loop).

Setting a placeholder first (`set(s, undefined); set(s, x)`) is not a notification: in a batch the readers find `x` again and do not run; outside one they run twice, once with the placeholder.

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
| `within(owner, fn, a?, b?)` (e.g. in an async callback) | `within(parent, fn)`, with `parent = owner()` kept from the component's body: `fn` takes no arguments, the owner is required (no `undefined`), and on a disposed owner `fn` is not called (see "Owners") |
| `holder`, `own`, `owns`, type `Holder` | removed: create in place with `scope` and keep the handle (`Scope`, `Effect`) |
| `release(h)` | `batch(() => { for (let i = hs.length; i--; ) dispose(hs[i]); })` over the kept handles |
| sibling effects ran newest first | creation order (unspecified: do not rely on either) |
| `stage1/lite`: a write in a sub's callback called the subs it reached at once (nested) | delivered after the callback returns, as `stage1`'s `sub` (see "The lite tiers"); `stage1/ultralite` keeps the nested timing outside batches for one-sub signals |
| `stage1/lite`: type `Sub` (what `sub` returns) | `Effect`, as `stage1`'s `sub` names it |

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
