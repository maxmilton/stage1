export const noop = (): void => {};

// DOM utilities

export const fragment = (): DocumentFragment => document.createDocumentFragment();
export const text = (data: string): Text => document.createTextNode(data);
export const create = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
): HTMLElementTagNameMap[K] => document.createElement(tagName);
/** Clone a node, including all its descendants. */
export const clone = <T extends Node>(node: T): T => node.cloneNode(true) as T;
/** Append a node to the end of the parent node. */
export const append = <T extends Node>(node: T, parent: Node): T => parent.appendChild(node);
/** Prepend a node to the beginning of the parent node. */
export const prepend = <T extends Node>(node: T, parent: Node): T =>
  parent.insertBefore(node, parent.firstChild);
/** Insert a node after the target node. Target must have a parent node! */
export const insert = <T extends Node>(node: T, target: Node): T =>
  target.parentNode!.insertBefore(node, target.nextSibling);
/** Replace a target node with a new node. Target must have a parent node! */
export const replace = <T extends Node>(node: T, target: Node): T =>
  (
    // biome-ignore lint/complexity/noCommaOperator: save bytes on return statement
    target.parentNode!.replaceChild(node, target), node // eslint-disable-line no-sequences
  );
