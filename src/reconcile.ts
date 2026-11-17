// Keyed list rendering, after ivi's keyed list update (https://github.com/localvoid/ivi). Rows are
// tracked in an array rather than read back from the DOM, so other nodes in the parent (such as
// whitespace from markup) cannot be mistaken for rows. Rows matched at either end are kept, a row
// that crossed to the other end is moved there directly, and the rest are placed right to left
// around the longest run of rows that kept their order, so no row moves unless it has to. New rows
// with no others left to place go in in order.
//
// One module for every tier, and it imports no signal module: `list` returns the rows function and
// `mark` the show function, and the app wires both with its tier's sub:
// `sub(items, rows)`, `sub(selected, mark(rows, fn))`. The list never touches owners: what `create`
// and `update` make belongs to whatever calls the rows function (on the full tier, the sub, until
// it is disposed). Rows that own effects opt in through `drop`, which runs for each row the list
// removes, clears or replaces, while the row is still in the DOM.
// The list keeps the items array it is given and diffs the next call's against it, so an array it
// has rendered must not change in place (pass a new one); if it did, a dev build throws at the
// list's next call (./dev.ts).
// An item changed in place keeps its row as rendered: `update` runs only for a new object.
// `create`, `update` and `drop` must not throw (unsupported: the rows no longer match the items,
// though a connected parent is put back); a dev build says so, wrapping the error. Calling the rows
// function again while it reconciles is unsupported; a dev build throws. When a stage1 or
// stage1/lite sub runs the reconcile, a create, update, drop or mark callback that writes the items
// reconciles again after it (those subs deliver a write made in a callback after that callback
// returns). A write delivered at once re-enters: under stage1/ultralite's sub outside a batch, or
// on any tier when the rows function was called outside every callback and batch. Dev builds also
// tell a full core when a create or update runs (`watchRows` in ./dev.ts), so it can warn about
// what rows make outside a scope.
// Unspecified: duplicate keys; `drop`'s extra arguments on clear and replace; a show call made
// during a reconcile, as a write to the selection delivered at once makes (it looks up the rows as
// they were before the reconcile).

// oxlint-disable id-length no-bitwise no-continue oxclippy/similar-names
// oxlint-disable node/no-process-env no-negated-condition unicorn/no-negated-condition

import { checkItems, recheckItems, report, watchRows } from "./dev.ts";
import { noop } from "./utils.ts";

/** Where `mark` reaches a list: a property of the rows function. */
const ROWS = Symbol();

/**
 * Sets the list's one callback for new rows and returns its items' key and getters for its items
 * and rows, in the same order. The lookup lives in `mark`, so a list without one ships none of it.
 */
type Attach<K, N> = (
  created?: (key?: K, row?: N) => void,
) => [
  key: PropertyKey,
  items: () => readonly Record<PropertyKey, unknown>[],
  rows: () => readonly N[],
];

/** What `mark` takes from a list: rows of type `N` keyed by `K`. */
export interface Marked<K, N> {
  readonly [ROWS]: Attach<K, N>;
}

/** A list's rows function: call it with the items (a sub's callback) to reconcile its rows. */
export type Rows<T, K, N> = ((items: readonly T[]) => void) & Marked<K, N>;

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
 * Returns the rows function of a list in `parent`: called with items, it renders a row per item
 * and keeps the rows in step with them, matching them by `key`. `update` runs on a kept row whose
 * item is a new object. `drop` runs on each row the list removes (also when it clears or replaces
 * them), before the row leaves the DOM; it must use only its first parameter (on clear and replace
 * it is called as `rows.forEach(drop)`, so it also gets `(index, rows)`). A row that owns an
 * effect keeps its handle (`tr.fx = effect(…)` in create, `(tr) => dispose(tr.fx)` as drop); one
 * that owns several makes them in a scope of its own (`tr.s = scope(() => …)`) and drop disposes
 * that. Pass the rows function to `mark` to highlight a row by key.
 */
export const list = <T, K extends keyof T, N extends ChildNode>(
  parent: Element,
  key: K,
  create: (item: T) => N,
  update: (node: N, item: T) => void = noop,
  drop?: (node: N) => void,
): Rows<T, T[K], N> => {
  // Dev builds only: a reconcile is running (a write to the items delivered at once re-enters)
  let busy = false;
  if (process.env.NODE_ENV !== "production") {
    // oxlint-disable-next-line no-param-reassign
    [create, update] = watchRows(create, update, drop);
  }
  // An undefined reference node appends, as for null
  const insert = parent.insertBefore.bind(parent) as (node: N, before?: N) => N;
  let data: readonly T[] = [];
  let rows: N[] = [];
  // The mark's callback for new rows
  let created: ((key?: T[K], row?: N) => void) | undefined;
  const make = (item: T): N => {
    const row = create(item);
    if (created) created(item[key], row);
    return row;
  };

  // Every row goes, each dropped first, and the new rows are built off-document (measured
  // faster: no per-insert work)
  const rebuild = /*@__NOINLINE__*/ (next: readonly T[]): N[] => {
    // drop gets (row, index, rows) here (documented in list's JSDoc)
    // oxlint-disable-next-line unicorn/no-array-for-each unicorn/no-array-callback-reference
    if (drop) rows.forEach(drop);
    parent.textContent = "";
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

  // oxlint-disable-next-line complexity
  const reconcile = /*@__NOINLINE__*/ (next: readonly T[]): N[] => {
    const length = next.length;
    let aEnd = data.length - 1;
    if (!length || aEnd < 0) return rebuild(next);

    let aStart = 0;
    let bEnd = length - 1;

    // Rows kept in place at the start, identity first so unchanged items skip the key reads
    const min = length <= aEnd ? length : aEnd + 1;
    for (; aStart < min; aStart++) {
      const a = data[aStart];
      const b = next[aStart];
      if (a !== b) {
        if (a[key] !== b[key]) break;
        update(rows[aStart], b);
      }
    }
    // Every row kept in place: the list keeps its array, which `mark` relies on
    if (aStart === length && aStart > aEnd) return rows;
    // Preallocated: rows are placed from both ends
    const result = new Array<N>(length);
    for (let i = 0; i < aStart; i++) result[i] = rows[i];
    let bStart = aStart;

    // Match rows at both ends, identity first so unchanged items skip the key reads; a row that
    // crossed to the other end is moved there directly. Each end's item is read once per pass
    while (aStart <= aEnd && bStart <= bEnd) {
      const first = data[aStart];
      const start = next[bStart];
      if (first === start || first[key] === start[key]) {
        if (first !== start) update(rows[aStart], start);
        result[bStart++] = rows[aStart++];
        continue;
      }
      const final = data[aEnd];
      const end = next[bEnd];
      if (final === end || final[key] === end[key]) {
        if (final !== end) update(rows[aEnd], end);
        result[bEnd--] = rows[aEnd--];
      } else if (final[key] === start[key]) {
        if (final !== start) update(rows[aEnd], start);
        insert((result[bStart++] = rows[aEnd--]), rows[aStart]);
      } else if (first[key] === end[key]) {
        if (first !== end) update(rows[aStart], end);
        insert((result[bEnd] = rows[aStart++]), result[bEnd-- + 1]);
      } else break;
    }

    if (aStart > aEnd) {
      // In order before one node, so an append inserts before no row: in Chromium,
      // inserting before a row makes `:nth-*` rules restyle every row
      for (let i = bStart; i <= bEnd; i++) insert((result[i] = make(next[i])), result[bEnd + 1]);
    } else {
      // Also when every new item matched at an end (the map is then empty, and the rows left are
      // removed below): one removal site, so a list pays for one drop guard here and one on clear
      const index = new Map<T[K], number>();
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
        if (j === undefined) {
          if (drop) drop(row);
          row.remove();
        } else {
          if (j < last) moved = true;
          else last = j;
          sources[j - bStart] = i + 1;
          if (data[i] !== next[j]) update(row, next[j]);
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

  const apply = ((next: readonly T[]): void => {
    const prev = rows;
    if (process.env.NODE_ENV !== "production") {
      if (busy) {
        report(
          "critical",
          "a list's rows were called again during their reconcile: a write to its items from a list callback was delivered at once (stage1/ultralite outside a batch, or rows called outside every callback and batch)",
        );
      }
      // After the busy check: a call made during a reconcile must not check or replace the guard's
      // copy, which is of `next` until the reconcile ends
      const old = checkItems(apply, data, next);
      busy = true;
      try {
        rows = reconcile(next);
      } catch (error) {
        // The guard's error instead if an items array changed during the reconcile
        recheckItems(apply, data, next, old, error);
        report(
          "critical",
          "a list's create, update, or drop threw; its rows no longer match its items",
          { cause: error },
        );
      } finally {
        busy = false;
      }
    } else rows = reconcile(next);
    data = next;
    // Tells the mark its map and marked row may be stale
    if (created && rows !== prev) created();
  }) as Rows<T, T[K], N> & { [ROWS]: Attach<T[K], N> };
  apply[ROWS] = (fn) => {
    created = fn;
    return [key, () => data as readonly Record<PropertyKey, unknown>[], () => rows];
  };
  return apply;
};

/** Lookups since a list last changed before `mark` builds a key map for the rest. */
const SCANS = 8;

/**
 * Returns a show function that marks the element whose key it was last called with:
 * `fn(node, true)` marks it, and on a call with another key, `fn(node, false)` unmarks it and the
 * new key's element is marked. `nodes` is a list's rows function or any map from key to element
 * with `get`, such as a `Map`. Wire it to the selection: `sub(selected, mark(rows, fn))`.
 *
 * - A list's rows start unmarked, and a row created while its key is shown is marked as it is
 *   created. Nothing is registered per row, so the list creates and clears rows at full speed. One
 *   mark per list (a later mark replaces it); `fn` never runs for a removed row.
 * - A map's elements must be in it before their key is shown.
 * - Keys compare with `===`, as `list` matches them, so a NaN key marks nothing.
 *
 * The mark stays attached to its list when whatever calls it stops: rows created later with the
 * key it showed last are still marked.
 */
export const mark = <K, N extends ChildNode>(
  // A method, as on Map, so a map typed with fewer keys is still accepted
  // oxlint-disable-next-line typescript/method-signature-style
  nodes: Marked<K, N> | { get(key: K): N | undefined },
  fn: (node: N, on: boolean) => void,
): ((key: K) => void) => {
  // The key last shown. A private symbol until the first call, which then marks at once
  let shown: unknown = ROWS;
  let lit: N | undefined;
  let find: (key: K) => N | undefined;
  const attach = (nodes as Partial<Marked<K, N>>)[ROWS];
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
  return (k: K): void => {
    if (k === shown) return;
    const old = lit;
    lit = find((shown = k));
    // A row the list removed is no longer `lit`; a map's elements are always unmarked
    if (old) fn(old, false);
    // `lit`, not a local: if that call changed the selection again, this
    // re-marks the newest element rather than marking a stale one
    if (lit) fn(lit, true);
  };
};
