// XXX: This file has the same tests as test/unit/compile.test.ts, keep them in sync.

import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@maxmilton/test-utils/dom';
import { compile } from '../../src/macro.ts' with { type: 'macro' };
import { collect, h } from '../../src/runtime.ts';
import type { Refs } from '../../src/types.ts';
import { Test } from '../TestComponent.ts';

describe('h', () => {
  test('is a function', () => {
    expect.assertions(2);
    expect(h).toBeFunction();
    expect(h).not.toBeClass();
  });

  test('expects 1 parameters', () => {
    expect.assertions(1);
    expect(h).toHaveParameters(1, 0);
  });

  describe('render', () => {
    afterEach(cleanup);

    test('renders basic template', () => {
      expect.assertions(2);
      const meta = compile(`
        <ul>
          <li>A</li>
          <li>B</li>
          <li>C</li>
        </ul>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.innerHTML).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
      expect(meta.success).toBeTrue();
    });

    test('renders basic template with messy whitespace', () => {
      expect.assertions(2);
      const meta = compile(`
        <ul>
          <li \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF   >A</li>
          <li
            >
              B</li>
          <li>C
            </li>
        </ul>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.innerHTML).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
      expect(meta.success).toBeTrue();
    });

    test('renders SVG template', () => {
      expect.assertions(3);
      const meta = compile(`
        <svg>
          <circle cx=10 cy='10' r="10" />
        </svg>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(view).toBeInstanceOf(window.SVGSVGElement);
      expect(rendered.container.innerHTML).toBe(
        '<svg><circle cx="10" cy="10" r="10"></circle></svg>',
      );
      expect(meta.success).toBeTrue();
    });

    test('returns root element', () => {
      expect.assertions(4);
      const meta = compile(`
        <ul id=root>
          <li>A</li>
          <li>B</li>
          <li>C</li>
        </ul>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(view).toBeInstanceOf(window.HTMLUListElement);
      expect(view.id).toBe('root');
      expect(rendered.container.firstChild).toBe(view);
      expect(meta.success).toBeTrue();
    });

    test('removes refs in template from output DOM', () => {
      expect.assertions(2);
      const meta = compile(`
        <ul @list>
          <li @item-one>A</li>
          <li @item-two>B</li>
        </ul>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.innerHTML).toBe('<ul><li>A</li><li>B</li></ul>');
      expect(meta.success).toBeTrue();
    });

    test('does not minify in whitespace-sensitive blocks', () => {
      expect.assertions(2);
      const meta = compile(`
        <div>
          <pre>
            a
            b
            c


            &lt;span&gt; Foo  &lt;/span&gt;
          </pre>
          <span>
            Bar
          </span>
          <code>
            &lt;span&gt;
              Baz
            &lt;/span&gt;
          </code>

        </div>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.innerHTML).toBe(
        '<div><pre>\n            a\n            b\n            c\n\n\n            &lt;span&gt; Foo  &lt;/span&gt;\n          </pre><span>Bar</span><code>\n            &lt;span&gt;\n              Baz\n            &lt;/span&gt;\n          </code></div>',
      );
      expect(meta.success).toBeTrue();
    });
  });
});

// TODO: Once bun supports macros used as template literals tag functions, we
// could consider adding a html function similar to the standard runtime.

// describe('html', () => {
//   test('is a function', () => {
//     expect.assertions(2);
//     expect(html).toBeFunction();
//     expect(html).not.toBeClass();
//   });
//
//   test('expects 2 parameters (1 optional)', () => {
//     expect.assertions(1);
//     expect(html).toHaveParameters(1, 1);
//   });
//
//   describe('render', () => {
//     afterEach(cleanup);
//
//     test('renders basic template', () => {
//       expect.assertions(2);
//       const meta = html`
//         <ul>
//           <li>A</li>
//           <li>B</li>
//           <li>C</li>
//         </ul>
//       `;
//       const view = h(meta.html);
//       const rendered = render(view);
//       expect(rendered.container.innerHTML).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
//       expect(meta.success).toBeTrue();
//     });
//   });
// });

describe('collect', () => {
  test('is a function', () => {
    expect.assertions(2);
    expect(collect).toBeFunction();
    expect(collect).not.toBeClass();
  });

  test('expects 3 parameters', () => {
    expect.assertions(1);
    expect(collect).toHaveParameters(3, 0);
  });

  test('collects all refs', () => {
    expect.assertions(42);
    const meta = compile(`
      <div @a>
        <header @b>
          <nav @c>
            <a @d href="@one">One</a>
            <a @e href="@two">Two</a>
          </nav>
        </header>
        <main @f>
          <h1 @g>Test</h1>
          <p @h><b @i>This</b> is a <a href="@" @j>test</a>.</p>
          <ol @k>
            <li @l id=one>One</li>
            <li @m id=two>Two</li>
          </ol>
          <form @n>
            <input @o />
            <textarea @p></textarea>
            <button @q>Submit</button>
          </form>
        </main>
        <!-- @r -->
        <footer @s>
          @t
        </footer>
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<Refs>(view, meta.k, meta.d);
    expect(refs.a.nodeName).toEqual('DIV');
    expect(refs.a).toBeInstanceOf(window.HTMLDivElement);
    expect(refs.b.nodeName).toEqual('HEADER');
    expect(refs.b).toBeInstanceOf(window.HTMLElement);
    expect(refs.c.nodeName).toEqual('NAV');
    expect(refs.c).toBeInstanceOf(window.HTMLElement);
    expect(refs.d.nodeName).toEqual('A');
    expect(refs.d).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs.e.nodeName).toEqual('A');
    expect(refs.e).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs.f.nodeName).toEqual('MAIN');
    expect(refs.f).toBeInstanceOf(window.HTMLElement);
    expect(refs.g.nodeName).toEqual('H1');
    expect(refs.g).toBeInstanceOf(window.HTMLHeadingElement);
    expect(refs.h.nodeName).toEqual('P');
    expect(refs.h).toBeInstanceOf(window.HTMLParagraphElement);
    expect(refs.i.nodeName).toEqual('B');
    expect(refs.i).toBeInstanceOf(window.HTMLElement);
    expect(refs.j.nodeName).toEqual('A');
    expect(refs.j).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs.k.nodeName).toEqual('OL');
    expect(refs.k).toBeInstanceOf(window.HTMLOListElement);
    expect(refs.l.nodeName).toEqual('LI');
    expect(refs.l).toBeInstanceOf(window.HTMLLIElement);
    expect(refs.m.nodeName).toEqual('LI');
    expect(refs.m).toBeInstanceOf(window.HTMLLIElement);
    expect(refs.n.nodeName).toEqual('FORM');
    expect(refs.n).toBeInstanceOf(window.HTMLFormElement);
    expect(refs.o.nodeName).toEqual('INPUT');
    expect(refs.o).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.p.nodeName).toEqual('TEXTAREA');
    expect(refs.p).toBeInstanceOf(window.HTMLTextAreaElement);
    expect(refs.q.nodeName).toEqual('BUTTON');
    expect(refs.q).toBeInstanceOf(window.HTMLButtonElement);
    expect(refs.r.nodeName).toEqual('#comment');
    expect(refs.r).toBeInstanceOf(window.Comment);
    expect(refs.s.nodeName).toEqual('FOOTER');
    expect(refs.s).toBeInstanceOf(window.HTMLElement);
    expect(refs.t.nodeName).toEqual('#text');
    expect(refs.t).toBeInstanceOf(window.Text);
    expect(Object.keys(refs)).toHaveLength(20);
    expect(meta.success).toBeTrue();
  });

  test('collects ref at start of element attributes', () => {
    expect.assertions(5);
    const meta = compile(`
      <div>
        <input @search id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.k, meta.d);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe('search');
    expect(refs.search.name).toBe('q');
    expect(Object.keys(refs)).toHaveLength(1);
    expect(meta.success).toBeTrue();
  });

  test('collects ref at end of element attributes', () => {
    expect.assertions(5);
    const meta = compile(`
      <div>
        <input id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off @search />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.k, meta.d);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe('search');
    expect(refs.search.name).toBe('q');
    expect(Object.keys(refs)).toHaveLength(1);
    expect(meta.success).toBeTrue();
  });

  test('collects ref in middle of element attributes', () => {
    expect.assertions(5);
    const meta = compile(`
      <div>
        <input id=search name=q class="input search" type=search minlength=2 @search maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.k, meta.d);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe('search');
    expect(refs.search.name).toBe('q');
    expect(Object.keys(refs)).toHaveLength(1);
    expect(meta.success).toBeTrue();
  });

  test('collects ref from template with only text', () => {
    expect.assertions(3);
    const meta = compile<{ a: Text }>('@a');
    const view = h(meta.html);
    const refs = collect<{ a: Text }>(view, meta.k, meta.d);
    expect(refs.a.nodeName).toEqual('#text');
    expect(refs.a).toBeInstanceOf(window.Text);
    expect(meta.success).toBeTrue();
  });

  test('collects ref from template with only comment', () => {
    expect.assertions(3);
    const meta = compile<{ a: Comment }>('<!-- @a -->');
    const view = h(meta.html);
    const refs = collect<{ a: Comment }>(view, meta.k, meta.d);
    expect(refs.a.nodeName).toEqual('#comment');
    expect(refs.a).toBeInstanceOf(window.Comment);
    expect(meta.success).toBeTrue();
  });

  test('collects refs from template with many comments', () => {
    expect.assertions(16);
    const meta = compile<Refs>(`
          <div>
            <!-- -->
            @a
            <!-- -->
            <!-- @b -->
            <div @c>
              <!-- -->
              @d
              <!-- @e -->
              <!-- -->
              <div @f></div>
            </div>
          </div>
        `);
    const view = h(meta.html);
    const refs = collect<Refs>(view, meta.k, meta.d);
    expect(refs.a.nodeName).toEqual('#text');
    expect(refs.a).toBeInstanceOf(window.Text);
    expect(refs.b.nodeName).toEqual('#comment');
    expect(refs.b).toBeInstanceOf(window.Comment);
    expect(refs.c.nodeName).toEqual('DIV');
    expect(refs.c).toBeInstanceOf(window.HTMLDivElement);
    expect(refs.d.nodeName).toEqual('#text');
    expect(refs.d).toBeInstanceOf(window.Text);
    expect(refs.e.nodeName).toEqual('#comment');
    expect(refs.e).toBeInstanceOf(window.Comment);
    expect(refs.f.nodeName).toEqual('DIV');
    expect(refs.f).toBeInstanceOf(window.HTMLDivElement);
    expect(Object.keys(refs)).toHaveLength(6);
    expect(Object.keys(meta.k)).toHaveLength(6);
    expect(Object.keys(meta.d)).toHaveLength(6);
    expect(meta.success).toBeTrue();
  });

  describe('keepSpaces option', () => {
    test('collects refs when option is default', () => {
      expect.assertions(8);
      const meta = compile(`
        <div>
          @a
          <div @b>
            @c
            <div @d></div>
          </div>
        </div>
      `);
      const view = h(meta.html);
      const refs = collect<Refs>(view, meta.k, meta.d);
      expect(refs.a.nodeName).toEqual('#text');
      expect(refs.a).toBeInstanceOf(window.Text);
      expect(refs.b.nodeName).toEqual('DIV');
      expect(refs.b).toBeInstanceOf(window.HTMLDivElement);
      expect(refs.c.nodeName).toEqual('#text');
      expect(refs.c).toBeInstanceOf(window.Text);
      expect(Object.keys(refs)).toHaveLength(4);
      expect(meta.success).toBeTrue();
    });

    test('collects refs when option is true', () => {
      expect.assertions(8);
      const meta = compile(
        `
          <div>
            @a
            <div @b>
              @c
              <div @d></div>
            </div>
          </div>
        `,
        { keepSpaces: true },
      );
      const view = h(meta.html);
      const refs = collect<Refs>(view, meta.k, meta.d);
      expect(refs.a.nodeName).toEqual('#text');
      expect(refs.a).toBeInstanceOf(window.Text);
      expect(refs.b.nodeName).toEqual('DIV');
      expect(refs.b).toBeInstanceOf(window.HTMLDivElement);
      expect(refs.c.nodeName).toEqual('#text');
      expect(refs.c).toBeInstanceOf(window.Text);
      expect(Object.keys(refs)).toHaveLength(4);
      expect(meta.success).toBeTrue();
    });

    test('collects refs when option is false', () => {
      expect.assertions(8);
      const meta = compile(
        `
          <div>
            @a
            <div @b>
              @c
              <div @d></div>
            </div>
          </div>
        `,
        { keepSpaces: false },
      );
      const view = h(meta.html);
      const refs = collect<Refs>(view, meta.k, meta.d);
      expect(refs.a.nodeName).toEqual('#text');
      expect(refs.a).toBeInstanceOf(window.Text);
      expect(refs.b.nodeName).toEqual('DIV');
      expect(refs.b).toBeInstanceOf(window.HTMLDivElement);
      expect(refs.c.nodeName).toEqual('#text');
      expect(refs.c).toBeInstanceOf(window.Text);
      expect(Object.keys(refs)).toHaveLength(4);
      expect(meta.success).toBeTrue();
    });
  });
});

describe('Test component', () => {
  test('renders basic template', () => {
    expect.assertions(1);
    const rendered = render(Test({ text: 'Hello' }));
    expect(rendered.container.innerHTML).toBe('<div id="test">Hello</div>');
  });
});
