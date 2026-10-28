export const noop = (): void => {
  /* empty */
};

// DOM utilities

export const fragment = (): DocumentFragment => document.createDocumentFragment();
export const text = (data: string): Text => document.createTextNode(data);
interface Create {
  <K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K];
  (tagName: `${string}-${string}`): HTMLElement;
}
export const create: Create = (tagName: keyof HTMLElementTagNameMap | `${string}-${string}`) =>
  document.createElement(tagName);
/** Clone a node, including all its descendants. */
export const clone = <T extends Node>(node: T): T => node.cloneNode(true) as T;
/** Append a node to the end of the parent node. */
export const append = <T extends Node>(node: T, parent: Node): T => parent.appendChild(node);
/** Prepend a node to the beginning of the parent node. */
export const prepend = <T extends Node>(node: T, parent: Node): T =>
  parent.insertBefore(node, parent.firstChild);
/** Insert a node after the target node. Target must have a parent node! */
export const insert = <T extends Node>(node: T, target: Node): T =>
  // oxlint-disable-next-line typescript/no-non-null-assertion
  target.parentNode!.insertBefore(node, target.nextSibling);
/** Replace a target node with a new node. Target must have a parent node! */
export const replace = <T extends Node>(node: T, target: Node): T =>
  // oxlint-disable-next-line no-sequences typescript/no-non-null-assertion
  (target.parentNode!.replaceChild(node, target), node);
