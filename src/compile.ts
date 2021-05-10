// TODO: Benchmark my changes vs original stage0 (init + runtime speed and memory):
// - Object vs class for Ref in `indices`
// - Direct reference vs this + TREE_WALKER.roll vs function roll
// - `collector` returning '' vs 0
// - refTag vs name[0] === '#'
// - for of node.attributes vs [...node.attributes] vs Array.from(node.attributes)

import type { Ref, RefNodes, S1Node } from './types';

const TREE_WALKER = document.createTreeWalker(
  document,
  // -1 = NodeFilter.SHOW_ALL
  -1,
  null,
  false,
);

const compilerTemplate = document.createElement('template');

// 35 = #
const refTag = (value: string) => value.charCodeAt(0) === 35;

function collector(node: Node): string | void {
  // 1 = Node.ELEMENT_NODE
  if (node.nodeType === 1) {
    for (const attr of (node as Element).attributes) {
      const aname = attr.name;
      if (refTag(aname)) {
        (node as Element).removeAttribute(aname);
        return aname.slice(1);
      }
    }
    return;
  }

  const content = node.nodeValue;
  if (content && refTag(content)) {
    node.nodeValue = '';
    return content.slice(1);
  }
}

function roll(n: number) {
  while (--n) TREE_WALKER.nextNode();
  return TREE_WALKER.currentNode;
}

function genPath(node: Node) {
  const indices: Ref[] = [];
  let ref: string | void;
  let index = 0;

  TREE_WALKER.currentNode = node;

  do {
    if ((ref = collector(node))) {
      indices.push({ i: index + 1, ref });
      index = 1;
    } else {
      index++;
    }
  } while ((node = TREE_WALKER.nextNode()));

  return indices;
}

function collect<T extends RefNodes = {}>(this: S1Node, node: Element): T {
  const refs: RefNodes = {};

  TREE_WALKER.currentNode = node;

  this._refs.map((x) => (refs[x.ref] = roll(x.i)));

  return refs as T;
}

export function h(strings: TemplateStringsArray, ...args: any[]): S1Node {
  // production mode requires a compatible template literal minifier!
  compilerTemplate.innerHTML =
    process.env.NODE_ENV === 'production'
      ? String.raw(strings, ...args)
      : String.raw(strings, ...args)
          // so collector doesn't incorrectly classify as TEXT_NODE
          .trim()
          // remove whitespace around node ref tags
          .replace(/>\s+#(\w+)\s+</gm, '>#$1<');

  const node = compilerTemplate.content.firstChild as S1Node;
  node._refs = genPath(node);
  node.collect = collect;

  return node;
}
