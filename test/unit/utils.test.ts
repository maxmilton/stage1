import { describe, expect, mock, test } from 'bun:test';
import { append, clone, create, createFragment, noop, onRemove, prepend } from '../../src/utils';

const ul = document.createElement('ul');
const liA = document.createElement('li');
liA.className = 'a';
const liB = document.createElement('li');
liB.className = 'b';
const liC = document.createElement('li');
liC.className = 'c';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class Sample {}

const NOT_DOM_NODES = [
  null,
  undefined,
  '',
  'div',
  '<div>',
  '<div></div>',
  0,
  1,
  -1,
  1n,
  -1n,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.NaN,
  true,
  false,
  {},
  [],
  [liA.cloneNode()],
  () => {},
  () => liA.cloneNode(),
  function div() {},
  Sample,
  new Sample(),
  Symbol('test'),
  new Map(),
  new Set(),
  new Int8Array(1),
  new Uint8Array(1),
] as const;

describe('noop', () => {
  test('is a function', () => {
    expect.assertions(1);
    expect(noop).toBeInstanceOf(Function);
  });

  test('expects no parameters', () => {
    expect.assertions(1);
    expect(noop).toHaveLength(0);
  });

  test('returns undefined', () => {
    expect.assertions(1);
    expect(noop()).toBeUndefined();
  });

  test('is an empty function', () => {
    expect.assertions(1);
    expect(noop.toString()).toBe('() => {\n}');
  });
});

describe('createFragment', () => {
  test('is a function', () => {
    expect.assertions(1);
    expect(createFragment).toBeInstanceOf(Function);
  });

  test('expects no parameters', () => {
    expect.assertions(1);
    expect(createFragment).toHaveLength(0);
  });

  test('returns a DocumentFragment', () => {
    expect.assertions(1);
    expect(createFragment()).toBeInstanceOf(window.DocumentFragment);
  });
});

describe('create', () => {
  test('is a function', () => {
    expect.assertions(1);
    expect(create).toBeInstanceOf(Function);
  });

  test('expects 1 parameter', () => {
    expect.assertions(1);
    expect(create).toHaveLength(1);
  });

  const inputs = [
    ['x', window.HTMLUnknownElement],
    ['div', window.HTMLDivElement],
    ['span', window.HTMLSpanElement],
    ['a', window.HTMLAnchorElement],
    ['img', window.HTMLImageElement],
    ['h1', window.HTMLHeadingElement],
    ['h2', window.HTMLHeadingElement],
    ['h3', window.HTMLHeadingElement],
    ['h4', window.HTMLHeadingElement],
    ['h5', window.HTMLHeadingElement],
    ['h6', window.HTMLHeadingElement],
    ['p', window.HTMLParagraphElement],
    ['input', window.HTMLInputElement],
    ['textarea', window.HTMLTextAreaElement],
    ['button', window.HTMLButtonElement],
    ['select', window.HTMLSelectElement],
    ['option', window.HTMLOptionElement],
    ['optgroup', window.HTMLOptGroupElement],
    ['datalist', window.HTMLDataListElement],
    ['form', window.HTMLFormElement],
    ['fieldset', window.HTMLFieldSetElement],
    ['legend', window.HTMLLegendElement],
    ['label', window.HTMLLabelElement],
    ['ul', window.HTMLUListElement],
    ['ol', window.HTMLOListElement],
    ['li', window.HTMLLIElement],
    ['dl', window.HTMLDListElement],
    ['dt', window.HTMLElement],
    ['dd', window.HTMLElement],
    ['table', window.HTMLTableElement],
    ['caption', window.HTMLTableCaptionElement],
    ['thead', window.HTMLTableSectionElement],
    ['tbody', window.HTMLTableSectionElement],
    ['tfoot', window.HTMLTableSectionElement],
    ['colgroup', window.HTMLTableColElement],
    ['col', window.HTMLTableColElement],
    ['tr', window.HTMLTableRowElement],
    ['td', window.HTMLTableCellElement],
    ['th', window.HTMLTableCellElement],
    ['hr', window.HTMLHRElement],
    ['br', window.HTMLBRElement],
    ['pre', window.HTMLPreElement],
    ['blockquote', window.HTMLQuoteElement],
    ['q', window.HTMLQuoteElement],
    ['ins', window.HTMLModElement],
    ['del', window.HTMLModElement],
    ['iframe', window.HTMLIFrameElement],
    ['embed', window.HTMLEmbedElement],
    ['object', window.HTMLObjectElement],
    ['video', window.HTMLVideoElement],
    ['audio', window.HTMLAudioElement],
    ['source', window.HTMLSourceElement],
    ['track', window.HTMLTrackElement],
    ['canvas', window.HTMLCanvasElement],
    ['map', window.HTMLMapElement],
    ['area', window.HTMLAreaElement],
    ['time', window.HTMLTimeElement],
    ['template', window.HTMLTemplateElement],
    ['slot', window.HTMLSlotElement],
  ] as const;

  for (const [input, expected] of inputs) {
    test(`returns ${expected.name} for "${input}" argument`, () => {
      expect.assertions(1);
      // @ts-expect-error - "x" is an intentional invalid element name
      expect(create(input)).toBeInstanceOf(expected);
    });
  }
});

describe('append', () => {
  test('is a function', () => {
    expect.assertions(1);
    expect(append).toBeInstanceOf(Function);
  });

  test('expects 2 parameters', () => {
    expect.assertions(1);
    expect(append).toHaveLength(2);
  });

  test('throws without parameters', () => {
    expect.assertions(5);
    // @ts-expect-error - intentional invalid parameters
    expect(() => append()).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    expect(() => append(null)).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(() => append(undefined)).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    expect(() => append(null, null)).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(() => append(undefined, undefined)).toThrow(window.TypeError);
  });

  test('throws when parameters are not an element', () => {
    expect.assertions(NOT_DOM_NODES.length * 2);
    for (const input of NOT_DOM_NODES) {
      // @ts-expect-error - intentional invalid parameters
      expect(() => append(ul.cloneNode(), input)).toThrow(window.TypeError);
      // @ts-expect-error - intentional invalid parameters
      expect(() => append(input, ul.cloneNode())).toThrow(window.TypeError);
    }
  });

  test('appends child element', () => {
    expect.assertions(1);
    const root = ul.cloneNode() as HTMLUListElement;
    append(liA.cloneNode(), root);
    append(liB.cloneNode(), root);
    append(liC.cloneNode(), root);
    expect(root.outerHTML).toBe(
      '<ul><li class="a"></li><li class="b"></li><li class="c"></li></ul>',
    );
  });
});

describe('prepend', () => {
  test('is a function', () => {
    expect.assertions(1);
    expect(prepend).toBeInstanceOf(Function);
  });

  test('expects 2 parameters', () => {
    expect.assertions(1);
    expect(prepend).toHaveLength(2);
  });

  test('throws without parameters', () => {
    expect.assertions(5);
    // @ts-expect-error - intentional invalid parameters
    expect(() => prepend()).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    expect(() => prepend(null)).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(() => prepend(undefined)).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    expect(() => prepend(null, null)).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(() => prepend(undefined, undefined)).toThrow(window.TypeError);
  });

  test('throws when parameters are not an element', () => {
    expect.assertions(NOT_DOM_NODES.length * 2 - 1); // skip null as child node
    for (const input of NOT_DOM_NODES) {
      // @ts-expect-error - intentional invalid parameters
      expect(() => prepend(ul.cloneNode(), input)).toThrow(window.TypeError);
      // FIXME: happy-dom does not handle this as per spec.
      // eslint-disable-next-line no-continue
      if (input === null) continue;
      // @ts-expect-error - intentional invalid parameters
      expect(() => prepend(input, ul.cloneNode())).toThrow(window.TypeError);
    }
  });

  test('prepends child element', () => {
    expect.assertions(1);
    const root = ul.cloneNode() as HTMLUListElement;
    prepend(liA.cloneNode(), root);
    prepend(liB.cloneNode(), root);
    prepend(liC.cloneNode(), root);
    expect(root.outerHTML).toBe(
      '<ul><li class="c"></li><li class="b"></li><li class="a"></li></ul>',
    );
  });
});

describe('clone', () => {
  test('is a function', () => {
    expect.assertions(1);
    expect(clone).toBeInstanceOf(Function);
  });

  test('expects 1 parameter', () => {
    expect.assertions(1);
    expect(clone).toHaveLength(1);
  });

  test('throws without parameters', () => {
    expect.assertions(3);
    // @ts-expect-error - intentional invalid parameters
    expect(() => clone()).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    expect(() => clone(null)).toThrow(window.TypeError);
    // @ts-expect-error - intentional invalid parameters
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(() => clone(undefined)).toThrow(window.TypeError);
  });

  const inputs = [
    document.createElement('div'),
    document.createElement('span'),
    document.createElement('p'),
    document.createElement('a'),
    document.createElement('button'),
    document.createElement('input'),
    document.createElement('textarea'),
    document.createElement('select'),
  ] as const;

  for (const input of inputs) {
    test(`returns cloned ${input.tagName} element`, () => {
      expect.assertions(2);
      const result = clone(input);
      expect(result).not.toBe(input);
      expect(result.tagName).toBe(input.tagName);
    });
  }
});

describe('onRemove', () => {
  test('is a function', () => {
    expect.assertions(1);
    expect(onRemove).toBeInstanceOf(Function);
  });

  test('expects 2 parameters', () => {
    expect.assertions(1);
    expect(onRemove).toHaveLength(2);
  });

  test('calls callback when watched element is removed', async () => {
    expect.assertions(1);
    const spy = mock(() => {});
    const root = document.createElement('div');
    document.body.appendChild(root);
    onRemove(root, spy);
    root.remove();
    await happyDOM.waitUntilComplete();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('calls callback when parent parent element is removed', async () => {
    expect.assertions(1);
    const spy = mock(() => {});
    const root = document.createElement('div');
    const parent = document.createElement('div');
    const child = document.createElement('div');
    parent.appendChild(child);
    root.appendChild(parent);
    document.body.appendChild(root);
    onRemove(child, spy);
    root.remove();
    await happyDOM.waitUntilComplete();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('does not call callback when nested child element is removed', async () => {
    expect.assertions(1);
    const spy = mock(() => {});
    const root = document.createElement('div');
    const child = document.createElement('div');
    root.appendChild(child);
    document.body.appendChild(root);
    onRemove(root, spy);
    child.remove();
    await happyDOM.waitUntilComplete();
    expect(spy).not.toHaveBeenCalled();
  });

  test('does not call callback when element is added or moved', async () => {
    expect.assertions(1);
    const spy = mock(() => {});
    const root = document.createElement('div');
    const child = document.createElement('div');
    document.body.appendChild(root);
    onRemove(root, spy);
    root.appendChild(child);
    document.body.appendChild(root);
    await happyDOM.waitUntilComplete();
    expect(spy).not.toHaveBeenCalled();
  });
});
