export const noop = (): void => {};

// DOM
export const createFragment = (): DocumentFragment => new DocumentFragment();
export const create = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
): HTMLElementTagNameMap[K] => document.createElement(tagName);
export const append = <T extends Node>(node: T, parent: Node): T => parent.appendChild(node);
// eslint-disable-next-line max-len
export const prepend = <T extends Node>(node: T, parent: Node): T => parent.insertBefore(node, parent.firstChild);
