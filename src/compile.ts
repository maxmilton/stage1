// TODO: Benchmark my changes vs original stage0 (init + runtime speed and memory):
// - Object vs class for Ref in `indices`
// - Direct reference vs this + TREE_WALKER.roll vs function roll
// - `collector` returning '' vs 0
// - isRefTag vs value.charCodeAt(0) === 35 vs value[0] === '#'
//    ↳ https://jsben.ch/CI1u5
// - Iterating over attributes; Array.from(node.attributes)
//    ↳ Also see https://github.com/Freak613/stage0/commit/be29f76fccef54760b2294b7ed44c2315f176899
//    ↳ https://jsben.ch/vPfrS (for loop wins)
// - Use of arrow functions instead of the function keyword

import type { Ref, RefNodes, S1Node } from './types';
import { create } from './utils';

const compilerTemplate = create('template');
const treeWalker = document.createTreeWalker(compilerTemplate);

const collector = (node: Node): string | void => {
  // 1 = Node.ELEMENT_NODE
  if (node.nodeType === 1) {
    const attrs = (node as Element).attributes;
    let index = attrs.length;

    while (index--) {
      const aname = attrs[index].name;
      if (aname[0] === '#') {
        (node as Element).removeAttribute(aname);
        return aname.slice(1);
      }
    }
    return;
  }

  const content = node.nodeValue;
  if (content && content[0] === '#') {
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

  while (node) {
    if ((ref = collector(node))) {
      indices.push({ i: index + 1, ref });
      index = 1;
    } else {
      index++;
    }
    (node as Node | null) = treeWalker.nextNode();
  }

  return indices;
};

// eslint-disable-next-line @typescript-eslint/ban-types, func-names
const collect = function <T extends RefNodes = {}>(
  this: S1Node,
  node: Element,
): T {
  const refs: RefNodes = {};
  treeWalker.currentNode = node;

  for (const x of this._refs) {
    refs[x.ref] = roll(x.i);
  }

  return refs as T;
};

export const h = (template: string): S1Node => {
  // Compatible template literal minifier is mandatory for production consumers!
  compilerTemplate.innerHTML =
    process.env.NODE_ENV === 'production'
      ? template
      : template
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

export const html = (
  template: TemplateStringsArray,
  ...substitutions: unknown[]
): S1Node => h(String.raw(template, ...substitutions));
