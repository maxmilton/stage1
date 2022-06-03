import * as assert from 'uvu/assert';
import {
  append, create, createFragment, noop, prepend,
} from '../src/utils';
import { describe } from './utils';

const ul = document.createElement('ul');
const liA = document.createElement('li');
liA.className = 'a';
const liB = document.createElement('li');
liB.className = 'b';
const liC = document.createElement('li');
liC.className = 'c';

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

describe('noop', (test) => {
  test('is a function', () => {
    assert.type(noop, 'function');
  });

  test('expects no parameters', () => {
    assert.is(noop.length, 0);
  });

  test('returns undefined', () => {
    assert.is(noop(), undefined);
  });

  test('is an empty function', () => {
    assert.fixture(noop.toString(), '() => {\n}');
  });
});

describe('createFragment', (test) => {
  test('is a function', () => {
    assert.type(createFragment, 'function');
  });

  test('expects no parameters', () => {
    assert.is(createFragment.length, 0);
  });

  test('returns a DocumentFragment', () => {
    assert.instance(createFragment(), DocumentFragment);
  });
});

describe('create', (test) => {
  test('is a function', () => {
    assert.type(create, 'function');
  });

  test('expects 1 parameter', () => {
    assert.is(create.length, 1);
  });

  test('returns expected element', () => {
    // @ts-expect-error - intentional invalid element name
    assert.instance(create('x'), window.HTMLUnknownElement);
    assert.instance(create('div'), window.HTMLDivElement);
    assert.instance(create('span'), window.HTMLSpanElement);
    assert.instance(create('a'), window.HTMLAnchorElement);
    assert.instance(create('img'), window.HTMLImageElement);
    assert.instance(create('h1'), window.HTMLHeadingElement);
    assert.instance(create('h2'), window.HTMLHeadingElement);
    assert.instance(create('h3'), window.HTMLHeadingElement);
    assert.instance(create('h4'), window.HTMLHeadingElement);
    assert.instance(create('h5'), window.HTMLHeadingElement);
    assert.instance(create('h6'), window.HTMLHeadingElement);
    assert.instance(create('p'), window.HTMLParagraphElement);
    assert.instance(create('input'), window.HTMLInputElement);
    assert.instance(create('textarea'), window.HTMLTextAreaElement);
    assert.instance(create('button'), window.HTMLButtonElement);
    assert.instance(create('select'), window.HTMLSelectElement);
    assert.instance(create('option'), window.HTMLOptionElement);
    assert.instance(create('optgroup'), window.HTMLOptGroupElement);
    assert.instance(create('form'), window.HTMLFormElement);
    assert.instance(create('fieldset'), window.HTMLFieldSetElement);
    assert.instance(create('legend'), window.HTMLLegendElement);
    assert.instance(create('label'), window.HTMLLabelElement);
    assert.instance(create('ul'), window.HTMLUListElement);
    assert.instance(create('ol'), window.HTMLOListElement);
    assert.instance(create('li'), window.HTMLLIElement);
    assert.instance(create('dl'), window.HTMLDListElement);
    assert.instance(create('dt'), window.HTMLElement);
    assert.instance(create('dd'), window.HTMLElement);
    assert.instance(create('table'), window.HTMLTableElement);
    assert.instance(create('caption'), window.HTMLTableCaptionElement);
    assert.instance(create('thead'), window.HTMLTableSectionElement);
    assert.instance(create('tbody'), window.HTMLTableSectionElement);
    assert.instance(create('tfoot'), window.HTMLTableSectionElement);
    assert.instance(create('colgroup'), window.HTMLTableColElement);
    assert.instance(create('col'), window.HTMLTableColElement);
    assert.instance(create('tr'), window.HTMLTableRowElement);
    assert.instance(create('td'), window.HTMLTableCellElement);
    assert.instance(create('th'), window.HTMLTableCellElement);
    assert.instance(create('hr'), window.HTMLHRElement);
    assert.instance(create('br'), window.HTMLBRElement);
    assert.instance(create('pre'), window.HTMLPreElement);
    assert.instance(create('blockquote'), window.HTMLQuoteElement);
    assert.instance(create('q'), window.HTMLQuoteElement);
    assert.instance(create('ins'), window.HTMLModElement);
    assert.instance(create('del'), window.HTMLModElement);
    assert.instance(create('iframe'), window.HTMLIFrameElement);
    assert.instance(create('embed'), window.HTMLEmbedElement);
    assert.instance(create('object'), window.HTMLObjectElement);
    assert.instance(create('param'), window.HTMLParamElement);
    assert.instance(create('video'), window.HTMLVideoElement);
    assert.instance(create('audio'), window.HTMLAudioElement);
    assert.instance(create('source'), window.HTMLSourceElement);
    assert.instance(create('track'), window.HTMLTrackElement);
    assert.instance(create('canvas'), window.HTMLCanvasElement);
    assert.instance(create('map'), window.HTMLMapElement);
    assert.instance(create('area'), window.HTMLAreaElement);
    assert.instance(create('time'), window.HTMLTimeElement);
  });
});

describe('append', (test) => {
  test('is a function', () => {
    assert.type(append, 'function');
  });

  test('expects 2 parameters', () => {
    assert.is(append.length, 2);
  });

  test('throws without parameters', () => {
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => append());
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => append(null));
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => append(undefined));
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => append(null, null));
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => append(undefined, undefined));
  });

  test('throws when parameters are not an element', () => {
    for (const input of NOT_DOM_NODES) {
      // @ts-expect-error - intentional invalid parameters
      assert.throws(() => append(ul.cloneNode(), input));
      // @ts-expect-error - intentional invalid parameters
      assert.throws(() => append(input, ul.cloneNode()));
    }
  });

  test('appends child element', () => {
    const root = ul.cloneNode() as HTMLUListElement;
    append(liA.cloneNode(), root);
    append(liB.cloneNode(), root);
    append(liC.cloneNode(), root);
    assert.snapshot(
      root.outerHTML,
      '<ul><li class="a"></li><li class="b"></li><li class="c"></li></ul>',
    );
  });
});

describe('prepend', (test) => {
  test('is a function', () => {
    assert.type(prepend, 'function');
  });

  test('expects 2 parameters', () => {
    assert.is(prepend.length, 2);
  });

  test('throws without parameters', () => {
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => prepend());
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => prepend(null));
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => prepend(undefined));
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => prepend(null, null));
    // @ts-expect-error - intentional invalid parameters
    assert.throws(() => prepend(undefined, undefined));
  });

  test('throws when parameters are not an element', () => {
    for (const input of NOT_DOM_NODES) {
      // @ts-expect-error - intentional invalid parameters
      assert.throws(() => prepend(ul.cloneNode(), input));
      // @ts-expect-error - intentional invalid parameters
      assert.throws(() => prepend(input, ul.cloneNode()));
    }
  });

  test('prepends child element', () => {
    const root = ul.cloneNode() as HTMLUListElement;
    prepend(liA.cloneNode(), root);
    prepend(liB.cloneNode(), root);
    prepend(liC.cloneNode(), root);
    assert.snapshot(
      root.outerHTML,
      '<ul><li class="c"></li><li class="b"></li><li class="a"></li></ul>',
    );
  });
});
