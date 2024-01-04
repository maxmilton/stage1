import type { LowercaseKeys, Refs } from '../types';
import { create } from '../utils';

interface RefInfo {
  /** Ref key name. */
  readonly k: string;
  /** Distance from previous ref node or root. */
  readonly d: number;
}

export interface S1View extends Node, ChildNode {
  /** @private */
  $$refs: readonly RefInfo[];
}

const compilerTemplate = create('template');
const treeWalker = document.createTreeWalker(compilerTemplate);
let str;

const collector = (node: Node): string | undefined => {
  // 1 = Node.ELEMENT_NODE
  if (node.nodeType === 1) {
    const attrs = (node as Element).attributes;
    let index = attrs.length;

    while (index--) {
      str = attrs[index].name;
      if (str[0] === '@') {
        (node as Element).removeAttribute(str);
        return str.slice(1);
      }
    }
    return;
  }

  str = node.nodeValue;
  if (str && str[0] === '@') {
    node.nodeValue = '';
    return str.slice(1);
  }
};

/**
 * Creates a DOM node from a template and collects ref node metadata.
 * @param template - HTML template string.
 */
export const h = <T extends Node & ChildNode = Element>(
  template: string,
): S1View & T => {
  compilerTemplate.innerHTML = template
    // reduce any whitespace to a single space
    .replace(/\s+/g, ' ')
    // remove space adjacent to tags
    .replace(/> /g, '>')
    .replace(/ </g, '<');

  const node = compilerTemplate.content.firstChild as S1View & T;
  const metadata: RefInfo[] = (node.$$refs = []);
  let current: Node | null = (treeWalker.currentNode = node);
  let distance = 0;

  while (current) {
    if ((str = collector(current))) {
      metadata.push({ k: str, d: distance });
      distance = 1;
    } else {
      distance++;
    }
    current = treeWalker.nextNode();
  }

  return node;
};

export const html = (
  template: TemplateStringsArray,
  ...substitutions: unknown[]
): S1View => h(String.raw(template, ...substitutions));

/**
 * Collects node refs from a compiled template view.
 * @param root - Root node.
 * @param view - Compiled template view.
 * @returns An object mapping ref nodes keyed by their ref name. Note that some
 * browsers lowercase rendered HTML element attribute names so we lowercase the
 * typed key names to bring awareness to this.
 */
export const collect = <R extends Refs = Refs>(
  root: Node,
  view: S1View,
): LowercaseKeys<R> => {
  const walker = treeWalker;
  const len = view.$$refs.length;
  const refs: Refs = {};
  let index = 0;
  let metadata;
  let distance;
  walker.currentNode = root;

  for (; index < len; index++) {
    metadata = view.$$refs[index];
    distance = metadata.d;
    while (distance--) walker.nextNode();
    refs[metadata.k] = walker.currentNode;
  }

  return refs as LowercaseKeys<R>;
};
