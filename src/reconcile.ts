// Keyed list rendering driven by a signal, after ivi's keyed list update
// (https://github.com/localvoid/ivi). Rows are tracked in an array rather than
// read back from the DOM, so other nodes in the parent (such as whitespace from
// markup) cannot be mistaken for rows. Rows matched at either end are kept, a
// row that crossed to the other end is moved there directly, and the rest are
// placed right to left around the longest run of rows that kept their order,
// so no row moves unless it has to. New rows with no others left to place go
// in in order.
//
// Owner-aware on ./signal.ts (the lite tier's owner-less list is ./lite/reconcile.ts):
//  - A list is a holder (an owner that never runs) owned by whatever owner creates it, so it is
//    disposed with it. Its oldest child is its subscription (an effect on `items` that owns
//    nothing, so its re-runs tear nothing down); the holders of rows that own something are its
//    newer children. Rows' holders climb to the subscription, so a queued row effect lets the
//    list reconcile first (parent-first).
//  - Rows own lazily: `create` runs untracked with the list's pending holder as owner. A row whose
//    create made nothing costs nothing; once the pending holder owns something it becomes the
//    row's holder (kept on the row, adopted by the list) and the list makes a new pending holder.
//    So removing a row disposes what it owns, and when no row owns anything (the list owns only
//    its subscription) clearing and removing touch no row.
//  - `update` (and the mark's callback for new rows) runs untracked with the list's holder as
//    owner: what it makes lives until the list is disposed, cleared or replaced (a dev build
//    warns). Make a row's effects in `create`.
//  - The list tells its mark when its rows change, so the mark keeps none of the old rows.
//  - `dispose(list)` stops it and disposes what its rows own; the rows stay in the DOM ("who
//    removes, disposes": the caller removes them).
// `create` and `update` must not throw (unsupported: the rows no longer match the items, though a
// connected parent is put back). A dev build says so, wrapping the error. What rows' cleanups throw
// is dropped (dev: logged), as for any cleanup.

// oxlint-disable id-length no-bitwise no-continue oxclippy/excessive-nesting oxclippy/similar-names
// oxlint-disable node/no-process-env no-console no-negated-condition unicorn/no-negated-condition

import {
  dispose,
  type Effect,
  effect,
  get,
  type Holder,
  holder,
  own,
  owns,
  release,
  type Signal,
  within,
} from "./signal.ts";
import { noop } from "./utils.ts";

/** A row's holder, on rows that own something. */
const SCOPE = Symbol();
/** What `mark` reaches a list through: the list holder's `g`. */
const ROWS = Symbol();

type Row = ChildNode & { [SCOPE]?: Holder };

/**
 * Sets the list's one callback for new rows and returns its items' key and
 * getters for its items and rows, in the same order. The lookup lives in
 * `mark`, so a list without one ships none of it.
 */
type Attach<K, N> = (
  created?: (key?: K, row?: N) => void,
) => [
  key: PropertyKey,
  items: () => readonly Record<PropertyKey, unknown>[],
  rows: () => readonly N[],
];

/** A list's handle: `dispose` stops it; `mark` takes it to reach its rows. */
export type List<K, N> = Effect & { readonly [ROWS]: Attach<K, N> };

/**
 * Marks with -1 the entries of `a` in its longest increasing subsequence,
 * ignoring zeros. https://en.wikipedia.org/wiki/Longest_increasing_subsequence
 */
const markLIS = /*@__NOINLINE__*/ (a: Int32Array): void => {
  const length = a.length;
  const parent = new Int32Array(length);
  const tails = new Int32Array(length);
  let top = -1;
  for (let i = 0; i < length; i++) {
    const k = a[i];
    if (!k) continue;
    // Values are distinct, so the search lands on a tail above k unless all are below
    let lo = 0;
    let hi = top;
    if (top < 0 || a[tails[top]] < k) lo = top + 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[tails[mid]] < k) lo = mid + 1;
      else hi = mid;
    }
    if (lo) parent[i] = tails[lo - 1];
    tails[lo] = i;
    if (lo > top) top = lo;
  }
  for (let j = tails[top]; top-- >= 0; j = parent[j]) a[j] = -1;
};

/**
 * Renders a row per item into `parent` and keeps the rows in step with
 * `items`, matching them by `key`. `update` runs on a kept row whose item is a
 * new object. Effects, computeds, scopes and cleanups that `create` makes belong
 * to the row: they are disposed when the row is removed (what `update` makes
 * belongs to the list). Both run untracked. The list belongs to the current
 * owner; `dispose` stops it early. Pass it to `mark` to highlight a row by key.
 */
export const list = <T, K extends keyof T, N extends ChildNode>(
  parent: Element,
  items: Signal<readonly T[]>,
  key: K,
  create: (item: T) => N,
  update: (node: N, item: T) => void = noop,
): List<T[K], N> => {
  // An undefined reference node appends, as for null
  const insert = parent.insertBefore.bind(parent) as (node: N, before?: N) => N;
  let data: readonly T[] = [];
  let rows: N[] = [];
  // The mark's callback for new rows
  let created: ((key?: T[K], row?: N) => void) | undefined;
  const attach: Attach<T[K], N> = (fn) => {
    created = fn;
    return [key, () => data as readonly Record<PropertyKey, unknown>[], () => rows];
  };
  // The list's holder; it owns the subscription (its oldest child, set by its first run), then the
  // rows' holders and what `update` makes
  const self = own(holder(undefined, attach));
  let sub: Effect | undefined;
  // The owner of the next create until it owns something (made by the subscription's first run)
  let pending: Holder;

  const make = (item: T): N => {
    const row = within(pending, create, item);
    // The pending holder owns something: it becomes the row's, and the list's child (`make`
    // runs within the list's holder); a new one climbs to the subscription like it
    if (owns(pending)) {
      (row as Row)[SCOPE] = own(pending);
      pending = holder(undefined, undefined, sub);
    }
    if (created) created(item[key], row);
    return row;
  };

  // `update` runs untracked with the list's holder as owner: what it makes belongs to the list,
  // not the row, so a dev build runs it within a holder of its own and warns if that owns anything
  const change =
    process.env.NODE_ENV !== "production"
      ? (row: N, item: T): void => {
          const h = holder();
          within(h, update, row, item);
          if (owns(h)) {
            own(h);
            console.warn(
              "stage1: a list's update made an effect, computed, scope or cleanup: it belongs to the list, not the row (make it in create)",
            );
          }
        }
      : update;

  // Rows' holders are the list's children newer than its subscription: none until a row owns
  // something
  const drop = (row: N): void => {
    if (owns(self, sub)) {
      const h = (row as Row)[SCOPE];
      if (h !== undefined) dispose(h);
    }
    row.remove();
  };

  // Disposes the rows' holders (and what `update` made), newest first
  const releaseAll = (): void => {
    release(self, sub);
  };

  // Measured faster: built off-document, the rows cost no per-insert work
  const build = /*@__NOINLINE__*/ (next: readonly T[]): N[] => {
    const host = next.length > 0 && parent.isConnected ? parent.parentNode : null;
    const after = parent.nextSibling;
    if (host) parent.remove();
    // A throwing create (unsupported) still leaves the parent where it was
    try {
      // make takes only the item, so map's index and array arguments are ignored
      // oxlint-disable-next-line unicorn/no-array-callback-reference
      const built = next.map(make);
      for (const row of built) parent.appendChild(row);
      return built;
    } finally {
      if (host) host.insertBefore(parent, after);
    }
  };

  const rebuild = (next: readonly T[]): N[] => {
    releaseAll();
    parent.textContent = "";
    return build(next);
  };

  // oxlint-disable-next-line complexity
  const reconcile = /*@__NOINLINE__*/ (next: readonly T[]): N[] => {
    const length = next.length;
    let aEnd = data.length - 1;
    if (!length || aEnd < 0) return rebuild(next);

    let aStart = 0;
    let bEnd = length - 1;
    let a: T;
    let b: T;

    // Rows kept in place at the start, identity first so unchanged items skip the key reads
    const min = length <= aEnd ? length : aEnd + 1;
    while (aStart < min && ((a = data[aStart]) === (b = next[aStart]) || a[key] === b[key])) {
      if (a !== b) change(rows[aStart], b);
      aStart++;
    }
    // Every row kept in place: the list keeps its array, which `mark` relies on
    if (aStart === length && aStart > aEnd) return rows;
    const result = new Array<N>(length);
    for (let i = 0; i < aStart; i++) result[i] = rows[i];
    let bStart = aStart;

    // Match rows at both ends, identity first so unchanged items skip the key
    // reads; a row that crossed to the other end is moved there directly
    while (aStart <= aEnd && bStart <= bEnd) {
      if ((a = data[aStart]) === (b = next[bStart]) || a[key] === b[key]) {
        if (a !== b) change(rows[aStart], b);
        result[bStart++] = rows[aStart++];
      } else if ((a = data[aEnd]) === (b = next[bEnd]) || a[key] === b[key]) {
        if (a !== b) change(rows[aEnd], b);
        result[bEnd--] = rows[aEnd--];
      } else if ((a = data[aEnd])[key] === (b = next[bStart])[key]) {
        if (a !== b) change(rows[aEnd], b);
        insert((result[bStart++] = rows[aEnd--]), rows[aStart]);
      } else if ((a = data[aStart])[key] === (b = next[bEnd])[key]) {
        if (a !== b) change(rows[aStart], b);
        insert((result[bEnd] = rows[aStart++]), result[bEnd-- + 1]);
      } else break;
    }

    if (aStart > aEnd) {
      // In order before one node, so an append inserts before no row: in Chromium,
      // inserting before a row makes `:nth-*` rules restyle every row
      for (let i = bStart; i <= bEnd; i++) insert((result[i] = make(next[i])), result[bEnd + 1]);
    } else if (bStart > bEnd) {
      for (let i = aStart; i <= aEnd; i++) drop(rows[i]);
    } else {
      const index = new Map<T[keyof T], number>();
      for (let i = bStart; i <= bEnd; i++) index.set(next[i][key], i);
      // Nothing matched at either end and no key survives: replace everything
      if (!aStart && aEnd === data.length - 1) {
        let i = 0;
        while (i <= aEnd && !index.has(data[i][key])) i++;
        if (i > aEnd) return rebuild(next);
      }
      // Old position + 1 per new position; 0 marks a new row
      const sources = new Int32Array(bEnd - bStart + 1);
      let last = 0;
      let moved = false;
      for (let i = aStart; i <= aEnd; i++) {
        const row = rows[i];
        const j = index.get(data[i][key]);
        if (j === undefined) drop(row);
        else {
          if (j < last) moved = true;
          else last = j;
          sources[j - bStart] = i + 1;
          if (data[i] !== next[j]) change(row, next[j]);
          result[j] = row;
        }
      }
      if (moved) markLIS(sources);
      for (let i = bEnd; i >= bStart; i--) {
        const source = sources[i - bStart];
        if (!source) insert((result[i] = make(next[i])), result[i + 1]);
        else if (source > 0 && moved) insert(result[i], result[i + 1]);
      }
    }
    return result;
  };

  const apply = (next: readonly T[]): void => {
    const prev = rows;
    if (process.env.NODE_ENV !== "production") {
      try {
        rows = reconcile(next);
      } catch (error) {
        throw new Error(
          "stage1: a list's create or update threw; its rows no longer match its items",
          {
            cause: error,
          },
        );
      }
    } else rows = reconcile(next);
    data = next;
    // Tells the mark its map and marked row may be stale
    if (created && rows !== prev) created();
  };

  // The subscription: tracks `items` and applies them untracked, within the list's holder, so it
  // owns nothing and its re-runs tear nothing down. Its first run makes the first pending holder,
  // climbing to it (a queued row effect lets the list reconcile first); it must, as the flush
  // ending `effect` may re-run it. A write to `items` during the reconcile (by create, update, a
  // row's effect or cleanup) only queues this effect, which is running, so it reads `items` again
  // after each reconcile (which also makes the next write re-run it). A dispose during the
  // reconcile disposes the list's holder; disposing it again at the end releases what was
  // adopted since (rows made after the disposal).
  // `this` is the subscription (a run calls the effect's function as the node's method)
  // oxlint-disable-next-line func-names
  within(self, effect, function (this: Effect) {
    // oxlint-disable-next-line typescript/no-this-alias unicorn/no-this-assignment
    if (sub === undefined) pending = holder(undefined, undefined, (sub = this));
    for (let next; (next = get(items)) !== data;) within(self, apply, next);
    if (self.g === undefined) dispose(self);
  });
  return self as never;
};

/** Lookups since a list last changed before `mark` builds a key map for the rest. */
const SCANS = 8;

/**
 * Marks the element whose key is `source`'s value: `fn(node, true)` marks it,
 * and when `source` changes, `fn(node, false)` unmarks it and the new key's
 * element is marked. `nodes` is a `list` or any map from key to element with
 * `get`, such as a `Map`.
 *
 * - A list's rows start unmarked, and a row created while its key is selected is marked as it is
 *   created. Nothing is registered per row, so the list creates and clears rows at full speed. One
 *   mark per list; `fn` never runs for a removed row.
 * - A map's elements must be in it before their key is selected.
 * - Keys compare with `===`, as `list` matches them, so a NaN key marks nothing.
 *
 * The mark belongs to the current owner; `dispose` stops it early.
 */
export const mark = <K, N extends ChildNode>(
  source: Signal<K>,
  // The keys' type comes from `source`, so a map may hold only some of them; a
  // method, as on Map, so a map typed with fewer keys is still accepted
  // oxlint-disable-next-line typescript/method-signature-style
  nodes: List<NoInfer<K>, N> | { get(key: NoInfer<K>): N | undefined },
  fn: (node: N, on: boolean) => void,
): Effect => {
  // The value the run has seen, which in a batch can differ from `source.v`.
  // A private symbol until the first run, which then marks at once
  let shown: unknown = ROWS;
  let lit: N | undefined;
  let find: (key: K) => N | undefined;
  const attach = (nodes as unknown as Holder).g as Attach<K, N> | undefined;
  if (attach) {
    // A lookup scans the rows until the list has gone SCANS lookups without
    // changing its rows; then a key map, built once, serves the rest until it does.
    // Measured in Chromium at 100 to 1000 rows, building a map costs as much as
    // 6.5 to 7 scans with string keys and 9.5 to 12 with number keys.
    let scans = 0;
    let map: Map<unknown, N> | undefined;
    // Called with a new row, or with none when the rows changed: the map goes, and the
    // marked row if it was removed, so the mark keeps none of the old rows
    const [key, items, rows] = attach((k, row) => {
      if (row === undefined) {
        scans = 0;
        map = undefined;
        if (lit && !lit.parentNode) lit = undefined;
      } else if (k === shown) fn((lit = row), true);
    });
    find = (k) => {
      const data = items();
      const all = rows();
      if (!map && ++scans > SCANS) {
        map = new Map();
        for (let i = 0; i < data.length; i++) map.set(data[i][key], all[i]);
      }
      if (map) return map.get(k);
      let i = 0;
      while (i < data.length && data[i][key] !== k) i++;
      // Past the last row when no item has the key
      return all[i];
    };
  } else {
    find = (k) => (nodes as { get: (key: K) => N | undefined }).get(k);
  }
  const show = (k: K): void => {
    if (k === shown) return;
    const old = lit;
    lit = find((shown = k));
    // A row the list removed is no longer `lit`; a map's elements are always unmarked
    if (old) fn(old, false);
    // `lit`, not a local: if that call changed the selection again, this
    // re-marks the newest element rather than marking a stale one
    if (lit) fn(lit, true);
  };
  // The mark's holder detaches it from its list when disposed. Its effect follows `source`; it
  // reads it again after showing a key, as `fn` may have changed it (an effect's own write
  // does not re-run it), which also makes its next check re-run it
  const self = own(holder(attach && (() => attach())));
  within(self, effect, () => {
    for (let k; (k = get(source)) !== shown;) within(self, show, k);
  });
  return self;
};
