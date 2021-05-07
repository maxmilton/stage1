import type { Stage1Node } from './types';

// 35 = #
const isTag = (value: string) => value.charCodeAt(0) === 35;

function collector(node: Node): string | 0 {
  // 3 = Node.TEXT_NODE
  if (node.nodeType !== 3) {
    if (node.attributes !== undefined) {
      for (const attr of Array.from(node.attributes)) {
        const aname = attr.name;
        // if (aname[0] === '#') {
        if (isTag(aname)) {
          node.removeAttribute(aname);
          return aname.slice(1);
        }
      }
    }
    return 0;
  }

  const nodeData = node.nodeValue!;
  // if (nodeData[0] === '#') {
  if (isTag(nodeData)) {
    node.nodeValue = '';
    return nodeData.slice(1);
  }
  return 0;
}

const TREE_WALKER = document.createTreeWalker(
  document,
  NodeFilter.SHOW_ALL,
  null,
  false,
);
TREE_WALKER.roll = function (n: number) {
  while (--n) this.nextNode();
  return this.currentNode;
};

class Ref {
  constructor(idx: number, ref: Node) {
    this.idx = idx;
    this.ref = ref;
  }
}

function genPath(node: Node) {
  const w = TREE_WALKER;
  w.currentNode = node;

  const indices = [];
  let ref;
  let idx = 0;

  do {
    if ((ref = collector(node))) {
      indices.push(new Ref(idx + 1, ref));
      idx = 1;
    } else {
      idx++;
    }
  } while ((node = w.nextNode()));

  return indices;
}

function walker(node: Node) {
  const refs = {};

  const w = TREE_WALKER;
  w.currentNode = node;

  this._refPaths.map((x) => (refs[x.ref] = w.roll(x.idx)));

  return refs;
}

export function compile(node: Stage1Node): void {
  node._refPaths = genPath(node);
  node.collect = walker;
}

const compilerTemplate = document.createElement('template');

export function h(strings: TemplateStringsArray, ...args: any[]): Stage1Node {
  const template = String.raw(strings, ...args);
  // .replace(/>\n+/g, '>')
  // .replace(/\s+</g, '<')
  // .replace(/>\s+/g, '>')
  // .replace(/\n\s+/g, '<!-- -->');
  compilerTemplate.innerHTML = template;
  const content = compilerTemplate.content.firstChild;
  compile(content);
  return content;
}
