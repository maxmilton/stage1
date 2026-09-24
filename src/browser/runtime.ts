import type { InferRefs, LowercaseKeys, Refs } from "../types.ts";
import { create } from "../utils.ts";

const REFS = Symbol();

interface RefMeta {
  /** Ref key name. */
  readonly k: string;
  /** Distance from previous ref node or root. */
  readonly d: number;
}

interface View extends ChildNode {
  /** @internal */
  [REFS]: readonly RefMeta[];
}

const compilerTemplate = create("template");
const treeWalker = document.createTreeWalker(compilerTemplate);
let str: string | null | undefined;

const collector = /*@__NOINLINE__*/ (node: Node): string | undefined => {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const attrs = (node as Element).attributes;
    let index = attrs.length;

    while (index--) {
      str = attrs[index].name;
      if (str[0] === "@") {
        (node as Element).removeAttribute(str);
        return str.slice(1);
      }
    }
    // oxlint-disable-next-line typescript/consistent-return
    return;
  }

  str = node.nodeValue;
  // eslint-disable-next-line unicorn/prefer-early-return
  if (str && str[0] === "@") {
    node.nodeValue = "";
    return str.slice(1);
  }
};

/**
 * Creates a DOM node from a template and collects ref node metadata.
 *
 * @param template - HTML template string.
 */
export const h = <T extends Node = Element>(template: string): View & T => {
  compilerTemplate.innerHTML = template
    // Reduce any whitespace to a single space
    .replace(/\s+/g, " ")
    // Remove space adjacent to tags
    .replace(/> /g, ">")
    .replace(/ </g, "<");

  const node = compilerTemplate.content.firstChild as View & T;
  // oxlint-disable-next-line no-multi-assign
  const metadata: RefMeta[] = (node[REFS] = []);
  // oxlint-disable-next-line no-multi-assign
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

export const html = <T extends Node = Element>(
  template: TemplateStringsArray,
  ...substitutions: unknown[]
): View & T => h(String.raw(template, ...substitutions));

/**
 * Collects node refs from a compiled template view.
 *
 * @param root - Root node.
 * @param view - Compiled template view.
 * @returns An object mapping ref nodes keyed by their ref name. Note that
 *   browsers lowercase rendered HTML element attribute names so we lowercase
 *   the typed key names to prevent surprises.
 */
export const collect = /*@__NOINLINE__*/ <R extends InferRefs<R> = Refs>(
  root: Node,
  view: View,
): LowercaseKeys<R> => {
  const refs: Refs = {};
  const len = view[REFS].length;
  let index = 0;
  let metadata: RefMeta;
  let distance: number;
  treeWalker.currentNode = root;

  for (; index < len; index++) {
    metadata = view[REFS][index];
    distance = metadata.d;
    while (distance--) treeWalker.nextNode();
    refs[metadata.k] = treeWalker.currentNode;
  }

  return refs as LowercaseKeys<R>;
};
