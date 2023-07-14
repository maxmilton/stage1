export const noop = (): void => {};

// DOM utilities
export const createFragment = (): DocumentFragment => new DocumentFragment();
export const create = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
): HTMLElementTagNameMap[K] => document.createElement(tagName);
export const append = <T extends Node>(node: T, parent: Node): T =>
  parent.appendChild(node);
export const prepend = <T extends Node>(node: T, parent: Node): T =>
  parent.insertBefore(node, parent.firstChild);
export const clone = <T extends Node>(node: T): T => node.cloneNode(true) as T;

/**
 * Runs callback function when a specified node is removed from the DOM.
 *
 * @remarks Somewhat computationally expensive, especially when there are many
 * DOM mutations. Use sparingly to minimize performance overhead.
 */
export const onRemove = (node: Node, fn: () => void): void => {
  new MutationObserver((mutations, observer) => {
    for (const mutation of mutations) {
      for (const removedNode of mutation.removedNodes) {
        if (removedNode.contains(node)) {
          fn();
          observer.disconnect();
          return;
        }
      }
    }
  }).observe(document, {
    childList: true,
    subtree: true,
  });
};
