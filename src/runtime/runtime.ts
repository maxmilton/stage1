import type { LowercaseKeys, Refs } from '../types';
import { create } from '../utils';

const compilerTemplate = create('template');
const treeWalker = document.createTreeWalker(compilerTemplate);

/**
 * Creates a DOM node from a compiled template.
 * @param template - HTML template string.
 */
export const h = <T extends Node & ChildNode = Element>(
  template: string,
): T => {
  compilerTemplate.innerHTML = template;
  return compilerTemplate.content.firstChild as T;
};

// const next = (d: number) => {
//   while (d--) treeWalker.nextNode();
//   return treeWalker.currentNode;
// };

/**
 * Collects node refs from a compiled template.
 * @param root - Root node.
 * @param k - Ref key names.
 * @param d - Distances from previous ref node or root.
 * @returns An object mapping ref nodes keyed by their ref name. Note that some
 * browsers lowercase rendered HTML element attribute names so we lowercase the
 * typed key names to bring awareness to this.
 */
export const collect = <R extends Refs>(
  root: Node,
  k: readonly string[],
  d: readonly number[],
): LowercaseKeys<R> => {
  const refs: Refs = {};
  const len = k.length;
  let index = 0;
  let distance;
  // TODO: Performance test setting treeWalker to a local variable.
  treeWalker.currentNode = root;

  // TODO: Performance test these 2 approaches.
  // for (; index < len; index++) {
  //   refs[k[index]] = next(d[index]);
  // }
  for (; index < len; index++) {
    distance = d[index];
    while (distance--) treeWalker.nextNode();
    refs[k[index]] = treeWalker.currentNode;
  }

  return refs as LowercaseKeys<R>;
};
