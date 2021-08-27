import { noop } from '../utils';

export function reuseNodes<T extends any[], N extends Node>(
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
        tmp = node.nextSibling;
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
    let tail = afterNode !== undefined ? afterNode.previousSibling : parent.lastChild;
    let tmp;
    while (i > data.length) {
      tmp = tail.previousSibling;
      parent.removeChild(tail);
      tail = tmp;
      i--;
    }
  }

  let _head = beforeNode ? beforeNode.nextSibling : parent.firstChild;
  if (_head === afterNode) _head = undefined;

  const _mode = afterNode ? 1 : 0;
  for (let i = 0, item, head = _head, mode = _mode; i < data.length; i++) {
    item = data[i];
    if (head) {
      updateFn(head, item);
    } else {
      head = createFn(item);
      mode ? parent.insertBefore(head, afterNode) : parent.appendChild(head);
    }
    head = head.nextSibling;
    if (head === afterNode) head = null;
  }
}
