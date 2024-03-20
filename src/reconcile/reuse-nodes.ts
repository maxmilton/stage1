import { noop } from '../utils';

export const reconcile = <T, N extends Node>(
  parent: Element,
  renderedData: T[],
  data: T[],
  createFn: (itemData: T) => N,
  updateFn: (node: N, itemData: T) => void = noop,
  beforeNode?: Node,
  afterNode?: Node | null,
): void => {
  const len = data.length;
  if (len === 0) {
    if (beforeNode !== undefined || afterNode !== undefined) {
      let node =
        beforeNode === undefined ? parent.firstChild : beforeNode.nextSibling;
      let tmp;

      if (afterNode === undefined) afterNode = null;

      while (node !== afterNode) {
        tmp = node!.nextSibling;
        node!.remove();
        node = tmp;
      }
    } else {
      parent.textContent = '';
    }
    return;
  }
  if (renderedData.length > len) {
    let index = renderedData.length;
    let tail = afterNode == null ? parent.lastChild : afterNode.previousSibling;
    let tmp;
    while (index > len) {
      tmp = tail!.previousSibling;
      tail!.remove();
      tail = tmp;
      index--;
    }
  }

  let head = beforeNode ? beforeNode.nextSibling : parent.firstChild;
  if (head === afterNode) head = null;

  const mode = afterNode ? 1 : 0;
  let index = 0;
  let item;
  for (; index < len; index++) {
    item = data[index];
    if (head) {
      // @ts-expect-error - FIXME: head type
      updateFn(head, item);
    } else {
      // @ts-expect-error - FIXME: head type
      head = createFn(item);
      if (mode) {
        parent.insertBefore(head!, afterNode!);
      } else {
        parent.appendChild(head!);
      }
    }
    head = head!.nextSibling;
    if (head === afterNode) head = null;
  }
};
