export const noop = (): void => {};

// DOM
export const createFragment = (): DocumentFragment => new DocumentFragment();
export const create = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
): HTMLElementTagNameMap[K] => document.createElement(tagName);
export const append = <T extends Node>(node: T, parent: Node): T => parent.appendChild(node);
// eslint-disable-next-line max-len
export const prepend = <T extends Node>(node: T, parent: Node): T => parent.insertBefore(node, parent.firstChild);

/**
 * Run callback when a specified node is removed from the DOM.
 *
 * Use sparingly to minimize performance overhead.
 */
export const onNodeRemove = (node: Node, callback: () => void): void => {
  new MutationObserver((mutations, observer) => {
    for (const mutation of mutations) {
      for (const removedNode of mutation.removedNodes) {
        if (removedNode.contains(node)) {
          callback();
          observer.disconnect();
          return;
        }
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
};
