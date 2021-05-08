import type { _Ref, S1Node, NodeRefs } from './types';

// 35 = #
const isRefTag = (value: string) => value.charCodeAt(0) === 35;

function collector(node: Element): string {
  // 3 = Node.TEXT_NODE
  if (node.nodeType !== 3) {
    if (node.attributes !== undefined) {
      for (const attr of [...node.attributes]) {
        const aname = attr.name;
        if (isRefTag(aname)) {
          node.removeAttribute(aname);
          return aname.slice(1);
        }
      }
    }
    return '';
  }

  const text = node.nodeValue!;
  if (isRefTag(text)) {
    node.nodeValue = '';
    return text.slice(1);
  }
  return '';
}

const TREE_WALKER = document.createTreeWalker(
  document,
  // -1 = NodeFilter.SHOW_ALL
  -1,
  null,
  false,
);

function roll(n: number) {
  while (--n) TREE_WALKER.nextNode();
  return TREE_WALKER.currentNode;
}

class Ref implements _Ref {
  readonly index: number;
  readonly ref: string;
  constructor(index: number, ref: string) {
    this.index = index;
    this.ref = ref;
  }
}

function genPath(node: Element) {
  const indices = [];
  let ref: string;
  let index = 0;

  TREE_WALKER.currentNode = node;

  do {
    if ((ref = collector(node))) {
      indices.push(new Ref(index + 1, ref));
      index = 1;
    } else {
      index++;
    }
  } while ((node = TREE_WALKER.nextNode()));

  return indices;
}

function collect<T extends NodeRefs = {}>(this: S1Node, node: Element): T {
  const refs: NodeRefs = {};

  TREE_WALKER.currentNode = node;

  this._refs.map((x) => (refs[x.ref] = roll(x.index)));

  return refs as T;
}

const compilerTemplate = document.createElement('template');

export function h(strings: TemplateStringsArray, ...args: any[]): S1Node {
  // production mode requires a compatible template literal minifier!
  const template =
    process.env.NODE_ENV === 'production'
      ? String.raw(strings, ...args)
      : String.raw(strings, ...args)
          // so collector doesn't incorrectly classify as TEXT_NODE
          .trim()
          // remove whitespace around node ref tags
          .replace(/>\s+#(\w+)\s+</gm, '>#$1<');

  compilerTemplate.innerHTML = template;

  const node = compilerTemplate.content.firstChild as S1Node;
  node._refs = genPath(node);
  node.collect = collect;

  return node;
}
