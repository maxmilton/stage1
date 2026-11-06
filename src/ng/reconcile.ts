// Keyed list rendering driven by a signal, after ivi's keyed list update
// (https://github.com/localvoid/ivi). Rows are tracked in an array rather than
// read back from the DOM, so other nodes in the parent (such as whitespace from
// markup) cannot be mistaken for rows. Rows matched at either end are kept, a
// row that crossed to the other end is moved there directly, and the rest are
// placed right to left around the longest run of rows that kept their order,
// so no row moves unless it has to. New rows with no others left to place go
// in in order.
//
// A Bun build with the STAGE1_LIST_LITE feature flag leaves out `own`, and with
// it the per-row bookkeeping for cleanups: calling `own` then throws, naming the flag.

// oxlint-disable id-length no-bitwise no-continue oxclippy/excessive-nesting oxclippy/similar-names

import { feature } from "bun:bundle";
import { type Signal, sub } from "./signal.ts";
import { noop } from "./utils.ts";

/** Cleanups a row registered with `own`, kept on its node. */
const CLEANUPS = Symbol();
/** What `mark` reaches a list through, kept on the list's dispose function. */
const ROWS = Symbol();

type Row = ChildNode & { [CLEANUPS]?: (() => void)[] };

/**
 * Sets the list's one callback for new rows and returns its items' key and
 * getters for its items and rows, in the same order. The lookup lives in
 * `mark`, so a list without one ships none of it.
 */
type Attach<K, N> = (
  created?: (key: K, row: N) => void,
) => [
  key: PropertyKey,
  items: () => readonly Record<PropertyKey, unknown>[],
  rows: () => readonly N[],
];

/** A list's dispose function, which `mark` also takes to reach its rows. */
export type List<K, N> = (() => void) & { readonly [ROWS]: Attach<K, N> };

// Cleanups registered by the create call in progress
let collected: (() => void)[] | undefined;

const own = (dispose: () => void): void => {
  if (feature("STAGE1_LIST_LITE")) {
    throw new Error("stage1: own is left out of a STAGE1_LIST_LITE build");
  }
  (collected ??= []).push(dispose);
};

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
 * new object; `own` registers a cleanup to run when the row is removed (not in a
 * STAGE1_LIST_LITE build). The
 * returned function stops the list and runs every row's cleanups; pass it to
 * `mark` to highlight a row by key.
 */
export const list = <T, K extends keyof T, N extends ChildNode>(
  parent: Element,
  items: Signal<readonly T[]>,
  key: K,
  create: (item: T, own: (dispose: () => void) => void) => N,
  update: (node: N, item: T) => void = noop,
): List<T[K], N> => {
  // An undefined reference node appends, as for null
  const insert = parent.insertBefore.bind(parent) as (node: N, before?: N) => N;
  let data: readonly T[] = [];
  let rows: N[] = [];
  // Rows holding cleanups, so clearing can skip the walk when there are none
  let owners = 0;
  // The mark's callback for new rows
  let created: ((key: T[K], row: N) => void) | undefined;

  // A ternary, so Bun folds the flag and drops the other arrow whole
  const make = feature("STAGE1_LIST_LITE")
    ? (item: T): N => {
        const node = create(item, own);
        if (created) created(item[key], node);
        return node;
      }
    : (item: T): N => {
        const outer = collected;
        collected = undefined;
        try {
          const node = create(item, own);
          // oxlint-disable-next-line typescript/no-unnecessary-condition
          if (collected) {
            (node as Row)[CLEANUPS] = collected;
            owners++;
          }
          if (created) created(item[key], node);
          return node;
        } finally {
          collected = outer;
        }
      };

  const release = feature("STAGE1_LIST_LITE")
    ? noop
    : (node: Row): void => {
        const cleanups = node[CLEANUPS];
        if (cleanups) {
          owners--;
          for (const cleanup of cleanups) cleanup();
        }
      };

  const drop = (node: N): void => {
    if (!feature("STAGE1_LIST_LITE") && owners) release(node);
    node.remove();
  };

  const releaseAll = (): void => {
    if (!feature("STAGE1_LIST_LITE") && owners) for (const node of rows) release(node);
  };

  // Measured faster: built off-document, the rows cost no per-insert work
  const build = /*@__NOINLINE__*/ (next: readonly T[]): N[] => {
    const host = next.length > 0 && parent.isConnected ? parent.parentNode : null;
    const after = parent.nextSibling;
    if (host) parent.remove();
    // make takes only the item, so map's index and array arguments are ignored
    // oxlint-disable-next-line unicorn/no-array-callback-reference
    const built = next.map(make);
    for (const row of built) parent.appendChild(row);
    if (host) host.insertBefore(parent, after);
    return built;
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

  const unsubscribe = sub(items, (next) => {
    rows = reconcile(next);
    data = next;
  });

  const dispose = (): void => {
    unsubscribe();
    releaseAll();
  };
  (dispose as { [ROWS]?: Attach<T[K], N> })[ROWS] = (fn) => {
    created = fn;
    return [key, () => data as readonly Record<PropertyKey, unknown>[], () => rows];
  };
  return dispose as List<T[K], N>;
};

/** Lookups since a list last changed before `mark` builds a key map for the rest. */
const SCANS = 8;

/**
 * Marks the element whose key is `source`'s value: `fn(node, true)` marks it,
 * and when `source` changes, `fn(node, false)` unmarks it and the new key's
 * element is marked. `nodes` is a `list` (its dispose function) or any map from
 * key to element with `get`, such as a `Map`.
 *
 * - A list's rows start unmarked, and a row created while its key is selected is marked as it is
 *   created. Nothing is registered per row, so the list creates and clears rows at full speed. One
 *   mark per list; `fn` never runs for a removed row.
 * - A map's elements must be in it before their key is selected.
 * - Keys compare with `===`, as `list` matches them, so a NaN key marks nothing.
 *
 * The returned function stops marking.
 */
export const mark = <K, N extends ChildNode>(
  source: Signal<K>,
  // The keys' type comes from `source`, so a map may hold only some of them; a
  // method, as on Map, so a map typed with fewer keys is still accepted
  // oxlint-disable-next-line typescript/method-signature-style
  nodes: List<NoInfer<K>, N> | { get(key: NoInfer<K>): N | undefined },
  fn: (node: N, on: boolean) => void,
): (() => void) => {
  // The value the sink has seen, which in a batch can differ from `source.v`.
  // A private symbol until the sink's first call, which then marks at once
  let shown: unknown = ROWS;
  let lit: N | undefined;
  let find: (key: K) => N | undefined;
  const attach = (nodes as Partial<List<K, N>>)[ROWS];
  if (attach) {
    const [key, items, rows] = attach((k, row) => {
      if (k === shown) fn((lit = row), true);
    });
    // A lookup scans the rows until the list has gone SCANS lookups without
    // changing its rows; then a key map, built once, serves the rest until it does.
    // Measured in Chromium at 100 to 1000 rows, building a map costs as much as
    // 6.5 to 7 scans with string keys and 9.5 to 12 with number keys.
    let seen: unknown;
    let scans = 0;
    let map: Map<unknown, N> | undefined;
    find = (k) => {
      const data = items();
      const all = rows();
      // Rows matched by key keep it, so the map holds while the rows array does
      if (all !== seen) {
        seen = all;
        scans = 0;
        map = undefined;
      }
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
  const unsubscribe = sub(source, (k) => {
    if (k === shown) return;
    const old = lit;
    lit = find((shown = k));
    // A row the list removed has no parent; a map's elements are always unmarked
    if (old && (!attach || old.parentNode)) fn(old, false);
    // `lit`, not a local: if that call changed the selection again, this
    // re-marks the newest element rather than marking a stale one
    if (lit) fn(lit, true);
  });
  return () => {
    unsubscribe();
    attach?.();
  };
};
