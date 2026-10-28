// Keyed list rendering driven by a signal. The diff is src/reconcile/keyed.ts's
// (ivi's algorithm with Surplus' fast paths), without boundary nodes since the
// list owns every child of its parent. Unlike keyed.ts, a backward swap inserts
// before the first unprocessed row, which a forward swap may have just moved away.

// oxlint-disable no-labels no-param-reassign typescript/no-non-null-assertion

import { type Signal, sub } from "./signal.ts";

/** Cleanups a row registered with `own`, kept on its node. */
const CLEANUPS = Symbol();

type Row = ChildNode & { [CLEANUPS]?: (() => void)[] };

// Cleanups registered by the create call in progress
let collected: (() => void)[] | undefined;

const own = (dispose: () => void): void => {
  (collected ??= []).push(dispose);
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
  update?: (node: N, item: T) => void,
): (() => void) => {
  let rendered: readonly T[] = [];
  // Rows holding cleanups, so clearing can skip the walk when there are none
  let owners = 0;

  const make = (item: T): N => {
    const outer = collected;
    collected = undefined;
    try {
      const node = create(item, own);
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

  const remove = (node: ChildNode): void => {
    if (owners) release(node);
    node.remove();
  };

  const releaseAll = (): void => {
    for (let node = parent.firstChild; owners && node; node = node.nextSibling) release(node);
  };

  const clear = (): void => {
    releaseAll();
    parent.textContent = "";
  };

  const reconcile = (data: readonly T[]): void => {
    const dataLen = data.length;
    let prevEnd = rendered.length - 1;

    if (dataLen === 0) {
      clear();
      return;
    }

    if (prevEnd < 0) {
      // Measured faster: built off-document, the rows cost no per-insert work
      const host = parent.isConnected ? parent.parentNode : null;
      const next = parent.nextSibling;
      if (host) parent.remove();
      for (let index = 0; index < dataLen; index++) parent.appendChild(make(data[index]));
      if (host) host.insertBefore(parent, next);
      return;
    }

    let prevStart = 0;
    let newStart = 0;
    let newEnd = dataLen - 1;
    let shouldLoop = true;
    let a: T;
    let b: T;
    let prevStartNode = parent.firstChild!;
    let prevEndNode = parent.lastChild!;
    let afterNode: ChildNode | null = null;

    fixes: while (shouldLoop) {
      shouldLoop = false;
      let tmpNode: ChildNode;

      // Skip prefix
      a = rendered[prevStart];
      b = data[newStart];
      while (a[key] === b[key]) {
        if (update && a !== b) update(prevStartNode as N, b);
        prevStart++;
        newStart++;
        prevStartNode = prevStartNode.nextSibling!;
        if (prevEnd < prevStart || newEnd < newStart) break fixes;
        a = rendered[prevStart];
        b = data[newStart];
      }

      // Skip suffix
      a = rendered[prevEnd];
      b = data[newEnd];
      while (a[key] === b[key]) {
        if (update && a !== b) update(prevEndNode as N, b);
        prevEnd--;
        newEnd--;
        afterNode = prevEndNode;
        prevEndNode = prevEndNode.previousSibling!;
        if (prevEnd < prevStart || newEnd < newStart) break fixes;
        a = rendered[prevEnd];
        b = data[newEnd];
      }

      // Fast path to swap backward
      a = rendered[prevEnd];
      b = data[newStart];
      while (a[key] === b[key]) {
        shouldLoop = true;
        if (update && a !== b) update(prevEndNode as N, b);
        tmpNode = prevEndNode.previousSibling!;
        parent.insertBefore(prevEndNode, prevStartNode);
        prevEndNode = tmpNode;
        newStart++;
        prevEnd--;
        if (prevEnd < prevStart || newEnd < newStart) break fixes;
        a = rendered[prevEnd];
        b = data[newStart];
      }

      // Fast path to swap forward
      a = rendered[prevStart];
      b = data[newEnd];
      while (a[key] === b[key]) {
        shouldLoop = true;
        if (update && a !== b) update(prevStartNode as N, b);
        tmpNode = prevStartNode.nextSibling!;
        parent.insertBefore(prevStartNode, afterNode);
        prevStart++;
        afterNode = prevStartNode;
        prevStartNode = tmpNode;
        newEnd--;
        if (prevEnd < prevStart || newEnd < newStart) break fixes;
        a = rendered[prevStart];
        b = data[newEnd];
      }
    }

    // Fast path for shrink
    if (newEnd < newStart) {
      while (prevStart <= prevEnd) {
        const prev = prevEndNode.previousSibling!;
        remove(prevEndNode);
        prevEndNode = prev;
        prevEnd--;
      }
      return;
    }

    // Fast path for add
    if (prevEnd < prevStart) {
      while (newStart <= newEnd) parent.insertBefore(make(data[newStart++]), afterNode);
      return;
    }

    // Positions for reusing nodes from current DOM state
    const P = new Array<number>(newEnd + 1 - newStart);
    for (let i = newStart; i <= newEnd; i++) P[i] = -1;

    // Index to resolve position from current to new
    const I = new Map<T[keyof T], number>();
    for (let i = newStart; i <= newEnd; i++) I.set(data[i][key], i);

    let reusingNodes = newStart + dataLen - 1 - newEnd;
    const toRemove: number[] = [];

    for (let i = prevStart; i <= prevEnd; i++) {
      const index = I.get(rendered[i][key]);
      if (index === undefined) {
        toRemove.push(i);
      } else {
        P[index] = i;
        reusingNodes++;
      }
    }

    // Fast path for full replace
    if (reusingNodes === 0) {
      clear();
      for (let i = newStart; i <= newEnd; i++) parent.appendChild(make(data[i]));
      return;
    }

    const longestSeq = longestPositiveIncreasingSubsequence(P, newStart);

    // Collect nodes to work with them
    const nodes: ChildNode[] = [];
    let tmpC: ChildNode | null = prevStartNode;
    for (let i = prevStart; i <= prevEnd; i++) {
      nodes[i] = tmpC!;
      tmpC = tmpC!.nextSibling;
    }

    for (const index of toRemove) remove(nodes[index]);

    let lisIdx = longestSeq.length - 1;
    let node: ChildNode;
    for (let i = newEnd; i >= newStart; i--) {
      if (longestSeq[lisIdx] === i) {
        afterNode = nodes[P[i]];
        if (update && rendered[P[i]] !== data[i]) update(afterNode as N, data[i]);
        lisIdx--;
      } else {
        if (P[i] === -1) {
          node = make(data[i]);
        } else {
          node = nodes[P[i]];
          if (update && rendered[P[i]] !== data[i]) update(node as N, data[i]);
        }
        parent.insertBefore(node, afterNode);
        afterNode = node;
      }
    }
  };

  const unsubscribe = sub(items, (data) => {
    reconcile(data);
    rendered = data;
  });

  return () => {
    unsubscribe();
    releaseAll();
  };
};

// https://github.com/adamhaile/surplus/blob/master/src/runtime/content.ts#L396C10-L396C30
const findGreatestIndexLEQ = (seq: readonly number[], n: number): number => {
  // Invariant: lo is guaranteed to be index of a value <= n, hi to be >
  // therefore, they actually start out of range: (-1, last + 1)
  let lo = -1;
  let hi = seq.length;

  // fast path for simple increasing sequences
  if (hi > 0 && seq[hi - 1] <= n) return hi - 1;

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (seq[mid] > n) hi = mid;
    else lo = mid;
  }

  return lo;
};

// Return an array of the indices of ns that comprise the longest increasing subsequence within ns
// https://github.com/adamhaile/surplus/blob/master/src/runtime/content.ts#L368C10-L368C46
const longestPositiveIncreasingSubsequence = (
  ns: readonly number[],
  newStart: number,
): number[] => {
  const seq: number[] = [];
  const is: number[] = [];
  const pre = new Array<number>(ns.length);
  const len = ns.length;
  let i = newStart;
  let l = -1;

  for (; i < len; i++) {
    const n = ns[i];
    if (n < 0) continue;
    const j = findGreatestIndexLEQ(seq, n);
    if (j !== -1) pre[i] = is[j];
    if (j === l) {
      l++;
      seq[l] = n;
      is[l] = i;
    } else if (n < seq[j + 1]) {
      seq[j + 1] = n;
      is[j + 1] = i;
    }
  }

  for (i = is[l]; l >= 0; i = pre[i], l--) seq[l] = i;

  return seq;
};
