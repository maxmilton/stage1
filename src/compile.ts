import type { Ref, Refs, S1Node } from './types';
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

// eslint-disable-next-line func-names
const collect = function <T extends Refs = Refs>(this: S1Node, node: Node): T {
  const refs: Refs = {};
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
