// Keyed list rendering driven by a signal, after ivi's keyed list update
// (https://github.com/localvoid/ivi). Rows are tracked in an array rather than
// read back from the DOM, so other nodes in the parent (such as whitespace from
// markup) cannot be mistaken for rows. Rows matched at either end are kept, a
// row that crossed to the other end is moved there directly, and the rest are
// placed right to left around the longest run of rows that kept their order,
// so no row moves unless it has to.

/* eslint-disable @typescript-eslint/no-unnecessary-condition, unicorn/prefer-continue, unicorn/prefer-early-return, unicorn/prefer-simple-condition-first */
// oxlint-disable id-length no-bitwise no-continue oxclippy/excessive-nesting oxclippy/similar-names

import { type Signal, sub } from "./signal.ts";
import { noop } from "./utils.ts";

/** Cleanups a row registered with `own`, kept on its node. */
const CLEANUPS = Symbol();

type Row = ChildNode & { [CLEANUPS]?: (() => void)[] };

// Cleanups registered by the create call in progress
let collected: (() => void)[] | undefined;

const own = (dispose: () => void): void => {
  (collected ??= []).push(dispose);
};

/**
 * Marks with -1 the entries of `a` in its longest increasing subsequence,
 * ignoring zeros. https://en.wikipedia.org/wiki/Longest_increasing_subsequence
 */
const markLIS = (a: Int32Array): void => {
  const length = a.length;
  const parent = new Int32Array(length);
  const tails = new Int32Array(length);
  let top = -1;
  for (let i = 0; i < length; i++) {
    const k = a[i];
    if (!k) continue;
    if (top < 0 || a[tails[top]] < k) {
      parent[i] = tails[top];
      tails[++top] = i;
      continue;
    }
    let lo = 0;
    let hi = top;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[tails[mid]] < k) lo = mid + 1;
      else hi = mid;
    }
    if (k < a[tails[lo]]) {
      if (lo) parent[i] = tails[lo - 1];
      tails[lo] = i;
    }
  }
  for (let j = tails[top]; top-- >= 0; j = parent[j]) a[j] = -1;
};

/**
 * Renders a row per item into `parent` and keeps the rows in step with
 * `items`, matching them by `key`. `update` runs on a kept row whose item is a
 * new object; `own` registers a cleanup to run when the row is removed. The
 * returned function stops the list and runs every row's cleanups.
 */
export const list = <T, N extends ChildNode>(
  parent: Element,
  items: Signal<readonly T[]>,
  key: keyof T,
  create: (item: T, own: (dispose: () => void) => void) => N,
  update: (node: N, item: T) => void = noop,
): (() => void) => {
  // An undefined reference node appends, as for null
  const insert = parent.insertBefore.bind(parent) as (node: N, before?: N) => N;
  let data: readonly T[] = [];
  let rows: N[] = [];
  // Rows holding cleanups, so clearing can skip the walk when there are none
  let owners = 0;

  const make = (item: T): N => {
    const outer = collected;
    collected = undefined;
    try {
      const node = create(item, own);
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (collected) {
        (node as Row)[CLEANUPS] = collected;
        owners++;
      }
      return node;
    } finally {
      collected = outer;
    }
  };

  const release = (node: Row): void => {
    const cleanups = node[CLEANUPS];
    if (cleanups) {
      owners--;
      for (const cleanup of cleanups) cleanup();
    }
  };

  const drop = (node: N): void => {
    if (owners) release(node);
    node.remove();
  };

  const releaseAll = (): void => {
    if (owners) for (const node of rows) release(node);
  };

  // Measured faster: built off-document, the rows cost no per-insert work
  const build = (next: readonly T[]): N[] => {
    const host = next.length > 0 && parent.isConnected ? parent.parentNode : null;
    const after = parent.nextSibling;
    if (host) parent.remove();
    const built = new Array<N>(next.length);
    for (let i = 0; i < next.length; i++) parent.appendChild((built[i] = make(next[i])));
    if (host) host.insertBefore(parent, after);
    return built;
  };

  const rebuild = (next: readonly T[]): N[] => {
    releaseAll();
    parent.textContent = "";
    return build(next);
  };

  // oxlint-disable-next-line complexity
  const reconcile = (next: readonly T[]): N[] => {
    const length = next.length;
    let aEnd = data.length - 1;
    if (!length || aEnd < 0) return rebuild(next);

    const result = new Array<N>(length);
    let aStart = 0;
    let bStart = 0;
    let bEnd = length - 1;
    let a: T;
    let b: T;

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
      for (let i = bEnd; i >= bStart; i--) insert((result[i] = make(next[i])), result[i + 1]);
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

  return () => {
    unsubscribe();
    releaseAll();
  };
};
