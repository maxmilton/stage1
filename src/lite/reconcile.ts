// Keyed list rendering driven by a signal, after ivi's keyed list update
// (https://github.com/localvoid/ivi). Rows are tracked in an array rather than
// read back from the DOM, so other nodes in the parent (such as whitespace from
// markup) cannot be mistaken for rows. Rows matched at either end are kept, a
// row that crossed to the other end is moved there directly, and the rest are
// placed right to left around the longest run of rows that kept their order,
// so no row moves unless it has to. New rows with no others left to place go
// in in order.
//
// The lite tier's list and mark, on its subs (./signal.ts): no owners, so rows own nothing, and
// the list and the mark are subs (their handles are for the lite `dispose`). The list tells its
// mark when its rows change, so the mark keeps none of the old rows. A disposed mark stays attached
// to its list (a documented gap): rows created later with the key it showed last are still marked.
// Writing a list's items from its create, update or mark callbacks is unsupported (the sub
// reconciles nested and duplicates rows): a dev build throws. The diff is ../reconcile.ts's: keep
// the two in step.
// `create` and `update` must not throw (unsupported: the rows no longer match the items, though a
// connected parent is put back). A dev build says so, wrapping the error.

// oxlint-disable id-length no-bitwise no-continue oxclippy/excessive-nesting oxclippy/similar-names
// oxlint-disable node/no-process-env no-negated-condition unicorn/no-negated-condition

import { noop } from "../utils.ts";
import { type Signal, type Sub, sub } from "./signal.ts";

/** What `mark` reaches a list through, on the list's sub handle. */
const ROWS = Symbol();

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
export type List<K, N> = Sub & { readonly [ROWS]: Attach<K, N> };

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
 * new object. `dispose` stops the list. Pass it to `mark` to highlight a row by
 * key.
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
  const make = (item: T): N => {
    const row = create(item);
    if (created) created(item[key], row);
    return row;
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
      if (a !== b) update(rows[aStart], b);
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
        if (a !== b) update(rows[aStart], b);
        result[bStart++] = rows[aStart++];
      } else if ((a = data[aEnd]) === (b = next[bEnd]) || a[key] === b[key]) {
        if (a !== b) update(rows[aEnd], b);
        result[bEnd--] = rows[aEnd--];
      } else if ((a = data[aEnd])[key] === (b = next[bStart])[key]) {
        if (a !== b) update(rows[aEnd], b);
        insert((result[bStart++] = rows[aEnd--]), rows[aStart]);
      } else if ((a = data[aStart])[key] === (b = next[bEnd])[key]) {
        if (a !== b) update(rows[aStart], b);
        insert((result[bEnd] = rows[aStart++]), result[bEnd-- + 1]);
      } else break;
    }

    if (aStart > aEnd) {
      // In order before one node, so an append inserts before no row: in Chromium,
      // inserting before a row makes `:nth-*` rules restyle every row
      for (let i = bStart; i <= bEnd; i++) insert((result[i] = make(next[i])), result[bEnd + 1]);
    } else if (bStart > bEnd) {
      for (let i = aStart; i <= aEnd; i++) rows[i].remove();
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
        if (j === undefined) row.remove();
        else {
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

  // Dev: whether a reconcile is running (a sub calls a nested write back at once)
  let busy = false;
  const apply = (next: readonly T[]): void => {
    const prev = rows;
    if (process.env.NODE_ENV !== "production") {
      if (busy) {
        throw new Error(
          "stage1: a list's items were written during its reconcile, which stage1/lite does not support (it would duplicate rows)",
        );
      }
      busy = true;
      try {
        rows = reconcile(next);
      } catch (error) {
        throw new Error(
          "stage1: a list's create or update threw; its rows no longer match its items",
          {
            cause: error,
          },
        );
      } finally {
        busy = false;
      }
    } else rows = reconcile(next);
    data = next;
    // Tells the mark its map and marked row may be stale
    if (created && rows !== prev) created();
  };

  const handle = sub(items, apply) as List<T[K], N> & { [ROWS]: Attach<T[K], N> };
  handle[ROWS] = attach;
  return handle;
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
 * `dispose` stops the mark, though it stays attached to its list: rows created later with the key
 * it showed last are still marked.
 */
export const mark = <K, N extends ChildNode>(
  source: Signal<K>,
  // The keys' type comes from `source`, so a map may hold only some of them; a
  // method, as on Map, so a map typed with fewer keys is still accepted
  // oxlint-disable-next-line typescript/method-signature-style
  nodes: List<NoInfer<K>, N> | { get(key: NoInfer<K>): N | undefined },
  fn: (node: N, on: boolean) => void,
): Sub => {
  // The value the run has seen, which in a batch can differ from `source.v`.
  // A private symbol until the first run, which then marks at once
  let shown: unknown = ROWS;
  let lit: N | undefined;
  let find: (key: K) => N | undefined;
  const attach = (nodes as Partial<List<K, N>>)[ROWS];
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
  return sub(source, show);
};
