/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable block-scoped-var */
/* eslint-disable no-continue */
/* eslint-disable no-labels */
/* eslint-disable no-multi-assign */
/* eslint-disable no-sequences */
/* eslint-disable no-var */
/* eslint-disable vars-on-top */

import { noop } from '../utils';

// This is almost straightforward implementation of reconcillation algorithm
// based on ivi documentation:
// https://github.com/localvoid/ivi/blob/2c81ead934b9128e092cc2a5ef2d3cabc73cb5dd/packages/ivi/src/vdom/implementation.ts#L1366
// With some fast paths from Surplus implementation:
// https://github.com/adamhaile/surplus/blob/master/src/runtime/content.ts#L86
//
// How this implementation differs from others, is that it's working with data directly,
// without maintaining nodes arrays, and uses dom props firstChild/lastChild/nextSibling
// for markers moving.
export const reconcile = <T extends any[], N extends Node>(
  key: keyof N,
  parent: Element,
  renderedValues: any[],
  data: any[],
  createFn: (...args: T) => N,
  updateFn: (node: N, ...args: T) => void = noop,
  beforeNode?: Node,
  afterNode?: Node | null,
): void => {
  // Fast path for clear
  if (data.length === 0) {
    if (beforeNode !== undefined || afterNode !== undefined) {
      let node =
        beforeNode !== undefined ? beforeNode.nextSibling : parent.firstChild;
      let tmp;

      if (afterNode === undefined) afterNode = null;

      while (node !== afterNode) {
        // @ts-expect-error - FIXME:!
        tmp = node.nextSibling;
        // @ts-expect-error - FIXME:!
        parent.removeChild(node);
        node = tmp;
      }
    } else {
      parent.textContent = '';
    }
    return;
  }

  // Fast path for create
  if (renderedValues.length === 0) {
    let node;
    const mode = afterNode !== undefined ? 1 : 0;
    for (let i = 0, len = data.length; i < len; i++) {
      // @ts-expect-error - FIXME:!
      node = createFn(data[i]);
      // @ts-expect-error - FIXME:!
      mode ? parent.insertBefore(node, afterNode) : parent.appendChild(node);
    }
    return;
  }

  let prevStart = 0;
  let newStart = 0;
  let loop = true;
  let prevEnd = renderedValues.length - 1;
  let newEnd = data.length - 1;
  let a;
  let b;
  let prevStartNode = beforeNode ? beforeNode.nextSibling : parent.firstChild;
  let newStartNode = prevStartNode;
  let prevEndNode = afterNode ? afterNode.previousSibling : parent.lastChild;

  fixes: while (loop) {
    loop = false;
    let _node;

    // Skip prefix
    (a = renderedValues[prevStart]), (b = data[newStart]);
    while (a[key] === b[key]) {
      // @ts-expect-error - FIXME:!
      updateFn(prevStartNode, b);
      prevStart++;
      newStart++;
      // @ts-expect-error - FIXME:!
      newStartNode = prevStartNode = prevStartNode.nextSibling;
      if (prevEnd < prevStart || newEnd < newStart) break fixes;
      a = renderedValues[prevStart];
      b = data[newStart];
    }

    // Skip suffix
    (a = renderedValues[prevEnd]), (b = data[newEnd]);
    while (a[key] === b[key]) {
      // @ts-expect-error - FIXME:!
      updateFn(prevEndNode, b);
      prevEnd--;
      newEnd--;
      afterNode = prevEndNode;
      // @ts-expect-error - FIXME:!
      prevEndNode = prevEndNode.previousSibling;
      if (prevEnd < prevStart || newEnd < newStart) break fixes;
      a = renderedValues[prevEnd];
      b = data[newEnd];
    }

    // Fast path to swap backward
    (a = renderedValues[prevEnd]), (b = data[newStart]);
    while (a[key] === b[key]) {
      loop = true;
      // @ts-expect-error - FIXME:!
      updateFn(prevEndNode, b);
      // @ts-expect-error - FIXME:!
      _node = prevEndNode.previousSibling;
      // @ts-expect-error - FIXME:!
      parent.insertBefore(prevEndNode, newStartNode);
      prevEndNode = _node;
      newStart++;
      prevEnd--;
      if (prevEnd < prevStart || newEnd < newStart) break fixes;
      a = renderedValues[prevEnd];
      b = data[newStart];
    }

    // Fast path to swap forward
    (a = renderedValues[prevStart]), (b = data[newEnd]);
    while (a[key] === b[key]) {
      loop = true;
      // @ts-expect-error - FIXME:!
      updateFn(prevStartNode, b);
      // @ts-expect-error - FIXME:!
      _node = prevStartNode.nextSibling;
      // @ts-expect-error - FIXME:!
      parent.insertBefore(prevStartNode, afterNode);
      prevStart++;
      afterNode = prevStartNode;
      prevStartNode = _node;
      newEnd--;
      if (prevEnd < prevStart || newEnd < newStart) break fixes;
      a = renderedValues[prevStart];
      b = data[newEnd];
    }
  }

  // Fast path for shrink
  if (newEnd < newStart) {
    if (prevStart <= prevEnd) {
      let next;
      while (prevStart <= prevEnd) {
        if (prevEnd === 0) {
          // @ts-expect-error - FIXME:!
          parent.removeChild(prevEndNode);
        } else {
          // @ts-expect-error - FIXME:!
          next = prevEndNode.previousSibling;
          // @ts-expect-error - FIXME:!
          parent.removeChild(prevEndNode);
          prevEndNode = next;
        }
        prevEnd--;
      }
    }
    return;
  }

  // Fast path for add
  if (prevEnd < prevStart) {
    if (newStart <= newEnd) {
      let node;
      const mode = afterNode ? 1 : 0;
      while (newStart <= newEnd) {
        // @ts-expect-error - FIXME:!
        node = createFn(data[newStart]);
        // @ts-expect-error - FIXME:!
        mode ? parent.insertBefore(node, afterNode) : parent.appendChild(node);
        newStart++;
      }
    }
    return;
  }

  // Positions for reusing nodes from current DOM state
  const P = new Array(newEnd + 1 - newStart);
  for (let i = newStart; i <= newEnd; i++) P[i] = -1;

  // Index to resolve position from current to new
  const I = new Map();
  for (let i = newStart; i <= newEnd; i++) I.set(data[i][key], i);

  let reusingNodes = newStart + data.length - 1 - newEnd;
  const toRemove = [];

  for (let i = prevStart; i <= prevEnd; i++) {
    if (I.has(renderedValues[i][key])) {
      P[I.get(renderedValues[i][key])] = i;
      reusingNodes++;
    } else {
      toRemove.push(i);
    }
  }

  // Fast path for full replace
  if (reusingNodes === 0) {
    if (beforeNode !== undefined || afterNode !== undefined) {
      let node =
        beforeNode !== undefined ? beforeNode.nextSibling : parent.firstChild;
      let tmp;

      if (afterNode === undefined) afterNode = null;

      while (node !== afterNode) {
        // @ts-expect-error - FIXME:!
        tmp = node.nextSibling;
        // @ts-expect-error - FIXME:!
        parent.removeChild(node);
        node = tmp;
        prevStart++;
      }
    } else {
      parent.textContent = '';
    }

    let node;
    const mode = afterNode ? 1 : 0;
    for (let i = newStart; i <= newEnd; i++) {
      // @ts-expect-error - FIXME:!
      node = createFn(data[i]);
      // @ts-expect-error - FIXME:!
      mode ? parent.insertBefore(node, afterNode) : parent.appendChild(node);
    }

    return;
  }

  // What else?
  const longestSeq = longestPositiveIncreasingSubsequence(P, newStart);

  // Collect nodes to work with them
  const nodes = [];
  let tmpC = prevStartNode;
  for (let i = prevStart; i <= prevEnd; i++) {
    nodes[i] = tmpC;
    // @ts-expect-error - FIXME:!
    tmpC = tmpC.nextSibling;
  }

  for (let i = 0; i < toRemove.length; i++) {
    // @ts-expect-error - FIXME:!
    parent.removeChild(nodes[toRemove[i]]);
  }

  let lisIdx = longestSeq.length - 1;
  let tmpD;
  for (let i = newEnd; i >= newStart; i--) {
    if (longestSeq[lisIdx] === i) {
      afterNode = nodes[P[longestSeq[lisIdx]]];
      // @ts-expect-error - FIXME:!
      updateFn(afterNode, data[i]);
      lisIdx--;
    } else {
      if (P[i] === -1) {
        // @ts-expect-error - FIXME:!
        tmpD = createFn(data[i]);
      } else {
        tmpD = nodes[P[i]];
        // @ts-expect-error - FIXME:!
        updateFn(tmpD, data[i]);
      }
      // @ts-expect-error - FIXME:!
      parent.insertBefore(tmpD, afterNode);
      afterNode = tmpD;
    }
  }
};

// Picked from
// https://github.com/adamhaile/surplus/blob/master/src/runtime/content.ts#L368

// return an array of the indices of ns that comprise the longest increasing subsequence within ns
const longestPositiveIncreasingSubsequence = (ns: any[], newStart: number) => {
  const seq = [];
  const is = [];
  let l = -1;
  const pre = new Array(ns.length);

  for (var i = newStart, len = ns.length; i < len; i++) {
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

  for (i = is[l]; l >= 0; i = pre[i], l--) {
    seq[l] = i;
  }

  return seq;
};

const findGreatestIndexLEQ = (seq: any[], n: number) => {
  // invariant: lo is guaranteed to be index of a value <= n, hi to be >
  // therefore, they actually start out of range: (-1, last + 1)
  let lo = -1;
  let hi = seq.length;

  // fast path for simple increasing sequences
  if (hi > 0 && seq[hi - 1] <= n) return hi - 1;

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (seq[mid] > n) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return lo;
};
