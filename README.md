[![CI status](https://badgen.net/github/checks/maxmilton/stage1?label=ci)](https://github.com/maxmilton/stage1/actions)
[![Coverage %](https://qlty.sh/badges/71ce5b0f-6642-4ea1-9e5a-e558bc1f6169/test_coverage.svg)](https://qlty.sh/gh/maxmilton/projects/stage1)
[![NPM version](https://badgen.net/npm/v/stage1)](https://www.npmjs.com/package/stage1)
[![Licence](https://badgen.net/github/license/maxmilton/stage1)](LICENSE)

[![Minified size](https://badgen.net/bundlephobia/minzip/stage1)](https://bundlephobia.com/package/stage1)
![Dependency count](https://badgen.net/bundlephobia/dependency-count/stage1)

![Status](https://badgen.net/badge/status/alpha/blue)

# stage1

Tiny, fast, composable primitives. Build your own web framework.

- zero runtime dependencies

## Signals and lists

An app imports its signals from one of three tiers, each with its own core:

<!-- prettier-ignore -->
| import | available functions | for |
| --- | --- | --- |
| `stage1` | `signal`, `computed`, `get`, `set`, `effect`, `scope`, `sub`, `defer`, `dispose`, `batch`, `untracked`, `trigger`, `owner`, `within`, `task` (experimental), `reactive` (experimental) | apps with computeds, effects and owners |
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

### State patterns

State lives in signals; what differs is how code reaches them:

- **Signals, alone or in records** (every tier): module-level signals, or a record of them per object, `const pager = { offset: signal(0), limit: signal(10) }`, read with `get(pager.offset)` and written with `set(pager.offset, 20)`. The fastest form at every V8 tier and on JSC.
- **A class with accessors** (every tier): a public `$key` signal field and a `get`/`set` pair per key, so that `pager.offset` is `get(pager.$offset)` and `pager.offset = 20` is `set(pager.$offset, 20)`. Never `return set(…)` from a setter: on JSC that tail call makes optimized writes recompile (writes 2–4× slower). A class of four keys costs about 40 B (brotli) more than a record of signals.
- **`reactive(C)`** (`stage1`; experimental: it may change or be removed in any release) writes those accessors for you: about 100 B (brotli) once, then about 4 B more per class than records of signals.

```ts
import { batch, computed, effect, reactive, signal, sub } from "stage1";

class Pager {
  declare offset: number; // a key's type: `declare` emits no field
  declare limit: number;
  declare readonly page: number; // a computed's key: read only
  readonly $offset = signal(0);
  readonly $limit = signal(10);
  readonly $page = computed(() => Math.floor(this.offset / this.limit));
  next(): void {
    this.offset += this.limit;
  }
}
reactive(Pager); // once per class, at module level

const pager = new Pager();
effect(() => {
  show(pager.offset, pager.limit, pager.page); // tracked: get(pager.$offset), …
});
pager.next(); // set(pager.$offset, get(pager.$offset) + get(pager.$limit))
batch(() => {
  pager.offset = 0;
  pager.limit = 20;
}); // one run, after both writes
sub(pager.$limit, (limit) => {
  save("limit", limit);
});
```

`reactive(C)` makes one instance, `new C()`, and gives each `$key` field it owns that holds a signal or a computed an accessor pair `key` on `C.prototype`. It returns `C` itself, so statics, `instanceof`, `#private` and instances made before are kept, and an instance costs what its constructor does.

- **The constructor runs once more, at the call, with no arguments**: every parameter needs a default (the types require one), and its side effects happen once more (a counter sees one more instance). Make effects, subs, scopes and tasks (a `task` makes an effect) in a method the app calls, not in the constructor (development builds throw). That instance has no accessors yet, so `this.key = v` in the constructor, or in what it calls, gives it an own `key` that nothing reads (development builds then make one more instance, after installing the accessors, to tell it from a field). A subclass with `$` fields of its own is passed to `reactive` too.
- **`declare key: V;`** types each key: a field (`key!: V`, `key = …`) is an own property that hides the accessor (development builds throw). The types reject a missing or mismatched declaration (one narrower than the value type included) and a `$` field, method, or getter that is neither a signal nor a computed.
- **A computed field** reads as `get` does. Declare its key `declare readonly key: V;`: writing it is an error (development builds throw). Like any computed, it belongs to the owner the instance is made under.
- **`pager.$key` is the key's exact signal** (a computed field's computed), for `sub`, `trigger`, `.v` (a signal's untracked read), and `get` and `set` on hot paths; `sub(pager.$items, rows)` wires a list.
- **A key that is already a member** (a method, an accessor, `toString`, a base class's) is overwritten on `C.prototype`; development builds throw.
- **The accessors are enumerable**: `for…in` lists the keys after the `$` fields. `Object.keys`, spread, `JSON.stringify` and `structuredClone` see the `$` fields (the last two throw once a key has a reader, and `structuredClone` at once for a computed field).
- **Shallow**: `pager.items.push(item)` notifies nothing (see "Mutable data").
- **Several keys: batch.** Outside a batch each write runs what it reaches before the next one.
- **A read is the value now**: `const { offset } = pager` is a snapshot that later writes do not change; pass `pager` or `pager.$offset` to code that should follow it. In an effect, `pager.offset++` is a tracked read and a write: its own write does not run the effect again, but every later write does, and it counts up again. `pager.offset = pager.$offset.v + 1` writes without following.

The cost, against explicit `get` and `set` in optimized code (V8's TurboFan and Turbolev, JSC): hand-written accessors are within about 10–15%. `reactive`'s share one accessor pair among every key, so code that reads many keys (16 in one loop, or 4 after other classes' keys ran) reads about 1.6–2.1× slower on TurboFan and 2.5–2.8× on JSC, where it also writes 2.4× slower (geomeans over the benchmark: TurboFan 1.08, Turbolev 1.00, JSC 1.46). Code that stays in V8's mid tier (Maglev; much real-world code never leaves it) pays about 1.4× (reads about 2×) for any property form, hand-written included. On hot paths, use `get` and `set` on `pager.$key`.

Example (tested, not exported): [`examples/reactive.ts`](examples/reactive.ts), a pager's view model. The header of [`src/composables.ts`](src/composables.ts) has the rest (what development builds check).

### Async data (`stage1`)

An effect's or scope's cleanup already gives async work what it needs, and writing it out as below is the recommended way: it gives the most control and clarity. A promise callback runs after the run that started it has ended, so it tracks nothing (a read after an `await` subscribes nothing: read the inputs first) and nothing owns what it creates. So write the outcome into signals or the DOM there; a `set` runs what it reaches before it returns, and the effects that read the signal create under their own owners. Guard the callbacks with a flag the run's cleanup clears:

```ts
import { effect, get, signal, untracked } from "stage1";

async function loadData(key: number, signal: AbortSignal) {
  // ... your async code e.g. fetch
}

const id = signal(1);
const out = document.createElement("p");
effect(() => {
  const key = get(id);
  const ac = new AbortController();
  let live = true; // this run's load is current and has not settled
  const show = (text: string): void => {
    // Check live in case DOM was removed by the time we got here e.g. parent scope was disposed
    if (live) {
      live = false;
      out.textContent = text;
    }
  };
  try {
    untracked(() => loadData(key, ac.signal)).then(
      show, // loadData ok
      (error: unknown) => {
        show(`error: ${String(error)}`); // loadData error
      },
    );
  } catch (error) {
    show(`error: ${String(error)}`); // error from somewhere other than loadData
  }
  // Before the next run and on disposal: drop the load and abort if still in flight
  return () => {
    if (live) {
      live = false;
      ac.abort();
    }
  };
});
```

- **The flag** drops a superseded load's outcome (latest wins) and a disposed component's, rejections included. (`within` skips a disposed owner too, but an effect's re-run is not a disposal: it does not drop a superseded load.) Keep it in an effect's or scope's cleanup, never in a sub's callback: a sub keeps its cleanups until it is disposed, so its next call would not drop this one. Abort only while the flag is set: aborting a settled request still costs an event and a `DOMException`.
- **`then(ok, err)`**, not `.catch` or `try { await … }`: with those, an error a reader throws during `ok`'s `set` reaches the error handler, which shows it as the load's error or, the flag being cleared, drops it. Here it is reported as an unhandled rejection.
- **`try` around the call**: a synchronous throw from the loader otherwise disposes a new effect or scope (the creating call throws) or reaches whoever wrote the input.
- **`untracked`**: what the loader reads synchronously would otherwise subscribe the effect.
- Never `effect(async () => …)`: an effect returns its cleanup or nothing (development builds throw). Read a signal the effect itself writes with `.v`, not `get`, or a landing that writes a value other than the one the effect read runs it again. Refresh with a tick the effect reads (see "Mutable data").

Examples (tested, not exported; copy them): [`examples/once.ts`](examples/once.ts) loads once when a component is created (no helper needed); [`examples/search.ts`](examples/search.ts) is search as you type with abort and list rows. With `task` (below): [`examples/profile.ts`](examples/profile.ts) is a keyed load with abort and refresh, [`examples/todos.ts`](examples/todos.ts) a list with an optimistic add, [`examples/posts.ts`](examples/posts.ts) one task waiting for another, and [`examples/validate.ts`](examples/validate.ts) a debounced check.

**`task(fn)` (experimental: it may change or be removed in any release)** runs `fn` in an effect and holds its outcome in a signal: `const user = task(() => fetchUser(get(id)))` gives `{ status, value, error }` records, `status` being `TaskStatus.Pending`, `TaskStatus.Ready` or `TaskStatus.Error` (a const enum), and keeps the last value while pending and after an error. `task(fn, fallback)` holds `fallback` as the value until the first one lands (an empty list, say), and `fn` returns `WAIT` to stay pending (while another task's value is not there yet). It applies the flag, `then(ok, err)` and the `try` for you, and development builds check for the loops it can see; calling the loader `untracked` and aborting stay with you. What stays with you (inputs, reading it, lifetime, lists, writes) and its recipes are in the header of [`src/task.ts`](src/task.ts).

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
