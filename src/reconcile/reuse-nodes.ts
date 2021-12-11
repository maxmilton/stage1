/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import { noop } from '../utils';

export function reconcile<T extends any[], N extends Node>(
  parent: Element,
  renderedValues: any[],
  data: any[],
  createFn: (...args: T) => N,
  updateFn: (node: N, ...args: T) => void = noop,
  beforeNode?: Node,
  afterNode?: Node | null,
): void {
  if (data.length === 0) {
    if (beforeNode !== undefined || afterNode !== undefined) {
      let node = beforeNode !== undefined ? beforeNode.nextSibling : parent.firstChild;
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
  if (renderedValues.length > data.length) {
    let i = renderedValues.length;
    // @ts-expect-error - FIXME:!
    let tail = afterNode !== undefined ? afterNode.previousSibling : parent.lastChild;
    let tmp;
    while (i > data.length) {
      // @ts-expect-error - FIXME:!
      tmp = tail.previousSibling;
      // @ts-expect-error - FIXME:!
      parent.removeChild(tail);
      tail = tmp;
      i--;
    }
  }

  let _head = beforeNode ? beforeNode.nextSibling : parent.firstChild;
  // @ts-expect-error - FIXME:!
  if (_head === afterNode) _head = undefined;

  const _mode = afterNode ? 1 : 0;
  for (let i = 0, item, head = _head, mode = _mode; i < data.length; i++) {
    item = data[i];
    if (head) {
      // @ts-expect-error - FIXME:!
      updateFn(head, item);
    } else {
      // @ts-expect-error - FIXME:!
      head = createFn(item);
      // @ts-expect-error - FIXME:!
      mode ? parent.insertBefore(head, afterNode) : parent.appendChild(head);
    }
    // @ts-expect-error - FIXME:!
    head = head.nextSibling;
    if (head === afterNode) head = null;
  }
}
