/* eslint-disable consistent-return */

// TODO: Benchmark my changes vs original stage0 (init + runtime speed and memory):
// - Object vs class for Ref in `indices`
// - Direct reference vs this + TREE_WALKER.roll vs function roll
// - `collector` returning '' vs 0
// - isRefTag vs name[0] === '#'
// - for of node.attributes vs [...node.attributes] vs Array.from(node.attributes)
// - Use of arrow functions instead of the function keyword

import type { Ref, RefNodes, S1Node } from './types';
import { create } from './utils';

// -1 = NodeFilter.SHOW_ALL
const treeWalker = document.createTreeWalker(document, -1, null);
const compilerTemplate = create('template');

// 35 = #
const isRefTag = (value: string) => value.charCodeAt(0) === 35;

const collector = (node: Node): string | void => {
  // 1 = Node.ELEMENT_NODE
  if (node.nodeType === 1) {
    for (const attr of (node as Element).attributes) {
      const aname = attr.name;
      if (isRefTag(aname)) {
        (node as Element).removeAttribute(aname);
        return aname.slice(1);
      }
    }
    return;
  }

  const content = node.nodeValue;
  if (content && isRefTag(content)) {
    node.nodeValue = '';
    return content.slice(1);
  }
};

const roll = (n: number) => {
  while (--n) treeWalker.nextNode();
  return treeWalker.currentNode;
};

const genPath = (node: Node) => {
  const indices: Ref[] = [];
  let ref: string | void;
  let index = 0;

  treeWalker.currentNode = node;

  do {
    if ((ref = collector(node))) {
      indices.push({ i: index + 1, ref });
      index = 1;
    } else {
      index++;
    }
    // @ts-expect-error - null node used to end loop
  } while ((node = treeWalker.nextNode()));

  return indices;
};

// eslint-disable-next-line @typescript-eslint/ban-types, func-names
const collect = function <T extends RefNodes = {}>(
  this: S1Node,
  node: Element,
): T {
  const refs: RefNodes = {};

  treeWalker.currentNode = node;
  this._refs.map((x) => (refs[x.ref] = roll(x.i)));

  return refs as T;
};

export const h = (
  strings: TemplateStringsArray,
  ...args: unknown[]
): S1Node => {
  // Compatible template literal minifier is mandatory for production consumers!
  compilerTemplate.innerHTML = process.env.NODE_ENV === 'production'
    ? String.raw(strings, ...args)
    : String.raw(strings, ...args)
      // to get the correct first node
      .trim()
      // faster genPath and cleaner test snapshots
      .replace(/\n\s+/g, '\n')
      // remove whitespace around ref tags in Text nodes
      .replace(/>\s+#(\w+)\s+</gm, '>#$1<');

  const node = compilerTemplate.content.firstChild as S1Node;
  node._refs = genPath(node);
  node.collect = collect;

  return node;
};
