// Dev builds only: what the dev checks share. Every caller sits behind
// `process.env.NODE_ENV !== "production"`, so a production bundle keeps none of this module (a
// module of its own for that). The dead dev code left in the callers, the import included, can
// still change the names in Bun's minified output (and in swc's, which keeps some of them): Bun
// picks its names from the characters of all the code it bundles, dead code too.
//
// Sections: `report`, which every check reports through; checkers each tier calls with what is
// private to it (`checkReturn`, `checkCycle`); the row seam, the full core's warning about what a
// list's create or update makes (`watchRows`, `checkRow`, `unwatched`); the list guard (`checkItems`,
// `recheckItems`).
// `v` is the full core's field name, generics are named as in ./reconcile.ts, and the row seam keeps
// its warnings as bits:
// oxlint-disable id-length no-bitwise

// ── Report ───────────────────────────────────────────────────────────────────

/**
 * Reports a misuse as `stage1: <message>`: "critical" throws it (with `options`, such as a cause),
 * "error" logs it with `error`, and "warn" warns.
 */
export function report(level: "critical", message: string, options?: ErrorOptions): never;
export function report(level: "error", message: string, error: unknown): void;
export function report(level: "warn", message: string): void;
export function report(
  level: "critical" | "error" | "warn",
  message: string,
  detail?: unknown,
): void {
  const text = `stage1: ${message}`;
  if (level === "critical") throw new Error(text, detail as ErrorOptions | undefined);
  // oxlint-disable-next-line no-console
  if (level === "error") console.error(text, detail);
  // oxlint-disable-next-line no-console
  else console.warn(text);
}

// ── Checkers ─────────────────────────────────────────────────────────────────

/**
 * Full core (`start`, `run`): throws if a runner's fn (an effect's or scope's) returned neither a
 * function, its cleanup, nor undefined; clears that value first.
 */
export const checkReturn = (runner: { v: unknown }): void => {
  if (runner.v !== undefined && typeof runner.v !== "function") {
    runner.v = undefined;
    report("critical", "an effect or scope returned neither a function nor undefined");
  }
};

/**
 * Every tier: the bound on an endless write loop. Throws `message` once `count`, the calls the
 * running drain made (a full flush, a lite pass, an ultralite batch end; each tier counts its own),
 * passes a million: far above any loop that settles.
 */
export const checkCycle = (count: number, message: string): void => {
  if (count > 1_000_000) report("critical", message);
};

// ── Row seam ─────────────────────────────────────────────────────────────────
// The full core (./signal.ts) warns about what a list's create or update makes outside a scope of
// the row's own: the list's wiring owns it, not the row. The list (./reconcile.ts) wraps its create
// and update with `watchRows`, which sets `watched` around each call, and the core's `create` calls
// `checkRow` for each node it makes; the core's `within` runs its fn `unwatched`. Lite cores never
// call `checkRow`.

/**
 * A list's state for the row seam: `owner` is this object until the core records the owner of the
 * call's first creation (the owner the call runs under: the list's wiring, or none); `update` says
 * which callback runs; `warned` holds the warnings given (1 create, 2 update).
 */
interface RowWatch {
  owner: unknown;
  update: boolean;
  warned: number;
}

/** The list call running now, if any. */
let watched: RowWatch | undefined;

/** Runs `fn`, a create or (`update`) an update of the list `state` belongs to, as `watched`. */
const watch = <R>(state: RowWatch, update: boolean, fn: () => R): R => {
  const prev = watched;
  state.owner = state;
  state.update = update;
  watched = state;
  try {
    return fn();
  } finally {
    watched = prev;
  }
};

/**
 * List (`list`): wraps its `create` and `update` for `checkRow`. A list with a `drop` disposes what
 * its rows own: the create warning is taken as given, so only the update warning (what update makes
 * belongs to the wiring, never to the row) remains.
 */
export const watchRows = <T, N>(
  create: (item: T) => N,
  update: (node: N, item: T) => void,
  drop: unknown,
): [(item: T) => N, (node: N, item: T) => void] => {
  const state: RowWatch = { owner: undefined, update: false, warned: drop ? 1 : 0 };
  return [
    (item) => watch(state, false, () => create(item)),
    (node, item) => {
      watch(state, true, () => {
        update(node, item);
      });
    },
  ];
};

/**
 * Full core (`within`): runs `fn` outside any list call: what it makes has the owner its caller
 * chose, so the row checks skip it.
 */
export const unwatched = <R>(fn: () => R): R => {
  const prev = watched;
  watched = undefined;
  try {
    return fn();
  } finally {
    watched = prev;
  }
};

/**
 * Full core (`create`): for a node made under `owner` while a list call runs, warns once per list
 * when its create makes it `unscoped` (an effect, sub, computed, or cleanup straight under a
 * re-running wiring, not in a scope of the row's own), and once per list when its update makes
 * anything straight under whatever runs it (never the row's).
 */
export const checkRow = (owner: unknown, unscoped: boolean): void => {
  const state = watched;
  if (state === undefined) return;
  if (state.owner === state) state.owner = owner;
  // Made inside something the call made: that was checked when it was made
  if (owner !== state.owner) return;
  if (state.update) {
    if (!(state.warned & 2)) {
      state.warned |= 2;
      report(
        "warn",
        "a list's update made an effect, sub, computed, scope, or defer: the list's wiring owns it, not the row; make it in create instead, in a scope the list's drop disposes",
      );
    }
  } else if (!(state.warned & 1) && unscoped) {
    state.warned |= 1;
    report(
      "warn",
      "a list's create made an effect, sub, computed, or defer outside a scope: the list's wiring owns it, not the row; make it in a scope of the row's own that the list's drop disposes",
    );
  }
};

// ── List guard ───────────────────────────────────────────────────────────────
// Called from the rows function's dev block in ./reconcile.ts. A list keeps the items array it is
// given and diffs the next call's against it, so an array it has rendered must not change in place.
// Per list, the guard keeps a copy of the array the list holds and throws before a reconcile if that
// array no longer matches it (its length or the item at an index). It then copies the array to
// render and hands back the old copy, which the caller keeps until the reconcile ends. When the
// reconcile throws, the list still holds the old array, so its copy is put back, and both arrays are
// checked: one changed during the reconcile (by a create, update, or drop) gets the guard's error
// rather than the list's.
// - Sticky: every call throws while the array the list holds differs from its copy (a clear
//   included), and the rows stay as last rendered.
// - Not checked: items changed in place (an item keeps its identity, so its row is kept as
//   rendered: `update` runs only for a new object); mark lookups between rows calls; a change to
//   the old array during a reconcile that returns (one to the new array is reported at the list's
//   next call).
// - Compares are by identity, so a Proxy whose index reads return a new object each time fails the
//   check with its array unchanged. A non-iterable items value (an array-like included) throws the
//   copy's TypeError, not the list's error.

/** Per list (its rows function): a copy of the array it holds (during its reconcile, of `next`). */
const copies = new WeakMap<object, readonly unknown[]>();

/** Throws the guard's error if `array` no longer matches `copy`. */
const checkCopy = (
  array: readonly unknown[],
  copy: readonly unknown[],
  options?: ErrorOptions,
): void => {
  if (array.length !== copy.length || copy.some((item, index) => item !== array[index])) {
    report(
      "critical",
      "a list's items array was changed in place after it was passed to the list; pass a new array instead ([...items, item], items.toSorted(), or items.with(i, item))",
      options,
    );
  }
};

/**
 * Before a reconcile: throws if `data`, the array the list holds, changed; then copies `next`.
 * Returns the copy of `data`, for `recheckItems`.
 */
export const checkItems = (
  list: object,
  data: readonly unknown[],
  next: readonly unknown[],
): readonly unknown[] => {
  // None on a list's first call (it holds its own empty array)
  const old = copies.get(list) ?? [];
  checkCopy(data, old);
  copies.set(list, [...next]);
  return old;
};

/**
 * After the reconcile threw `cause`: puts back `old`, the copy of `data` (which the list still
 * holds), then throws the guard's error if either array changed during the reconcile.
 */
export const recheckItems = (
  list: object,
  data: readonly unknown[],
  next: readonly unknown[],
  old: readonly unknown[],
  cause: unknown,
): void => {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- checkItems sets it before each reconcile
  const copy = copies.get(list)!;
  copies.set(list, old);
  checkCopy(next, copy, { cause });
  checkCopy(data, old, { cause });
};
