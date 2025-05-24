import type { FlatRefs, InferRefs } from './types';
import { create } from './utils';

const template = create('template');

/**
 * Creates a DOM node from a compiled template.
 * @param html - HTML string.
 */
export const h = <T extends Node & ChildNode = Element>(html: string): T => {
  template.innerHTML = html;
  return template.content.firstChild as T;
};

/**
 * Collects node refs from a compiled template.
 * @param root - Root node.
 * @param d - Distances from previous ref node or root.
 * @returns An object mapping ref nodes keyed by their ref name. Note that some
 * browsers lowercase rendered HTML element attribute names so we lowercase the
 * typed key names to bring awareness to this.
 */
/* @__NOINLINE__ */
export const collect = <R extends InferRefs<R>>(
  root: Node,
  d: readonly number[],
): FlatRefs<R> => {
  const len = d.length;
  // eslint-disable-next-line unicorn/no-new-array
  const refs = new Array<Node>(len);
  let index = 0;
  let distance: number;
  let current: Node;
  let node: Node | null = root;

  for (; index < len; ++index) {
    distance = d[index];

    while (distance--) {
      current = node;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      node = node.firstChild || node.nextSibling;

      while (!node) {
        current = current.parentNode!;
        node = current.nextSibling;
      }
    }
    refs[index] = node;
  }

  return refs as FlatRefs<R>;
};
