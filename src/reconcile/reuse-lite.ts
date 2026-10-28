import { noop } from "../utils.ts";

export const reconcile = <T, N extends Node>(
  parent: Element,
  data: readonly T[],
  createFn: (itemData: T) => N,
  updateFn: (node: N, itemData: T) => void = noop,
): void => {
  let node: Node | null = parent.firstChild;
  let next: Node | null;
  // oxlint-disable-next-line typescript/prefer-for-of
  for (let index = 0; index < data.length; index++) {
    if (node) {
      updateFn(node as N, data[index]);
      node = node.nextSibling;
    } else {
      parent.appendChild(createFn(data[index]));
    }
  }
  while (node) {
    next = node.nextSibling;
    // eslint-disable-next-line unicorn/prefer-dom-node-remove
    parent.removeChild(node);
    node = next;
  }
};
