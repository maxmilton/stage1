// XXX: This file has the same tests as test/unit/compile.test.ts and test/unit/runtime.test.ts, keep them in sync.

import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@maxmilton/test-utils/dom';
import { collect, h } from '../../src/fast/runtime.ts';
import { compile } from '../../src/macro.ts' with { type: 'macro' };
import type { Refs } from '../../src/types.ts';
import { Test } from '../TestComponent_fast.ts';

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
      expect.assertions(1);
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
    });

    test('renders basic template with messy whitespace', () => {
      expect.assertions(1);
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
    });

    test('renders SVG template', () => {
      expect.assertions(2);
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
    });

    test('returns root element', () => {
      expect.assertions(3);
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
    });

    test('removes refs in template from output DOM', () => {
      expect.assertions(1);
      const meta = compile(`
        <ul @list>
          <li @item-one>A</li>
          <li @item-two>B</li>
        </ul>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.innerHTML).toBe('<ul><li>A</li><li>B</li></ul>');
    });

    test('does not minify in whitespace-sensitive blocks', () => {
      expect.assertions(1);
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
    });
  });
});

describe('collect', () => {
  test('is a function', () => {
    expect.assertions(2);
    expect(collect).toBeFunction();
    expect(collect).not.toBeClass();
  });

  test('expects 2 parameters', () => {
    expect.assertions(1);
    expect(collect).toHaveParameters(2, 0);
  });

  test('collects all refs', () => {
    expect.assertions(42);
    const meta = compile<Refs>(`
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
    const refs = collect<Refs>(view, meta.d);
    expect(refs[meta.ref.a].nodeName).toEqual('DIV');
    expect(refs[meta.ref.a]).toBeInstanceOf(window.HTMLDivElement);
    expect(refs[meta.ref.b].nodeName).toEqual('HEADER');
    expect(refs[meta.ref.b]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.c].nodeName).toEqual('NAV');
    expect(refs[meta.ref.c]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.d].nodeName).toEqual('A');
    expect(refs[meta.ref.d]).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs[meta.ref.e].nodeName).toEqual('A');
    expect(refs[meta.ref.e]).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs[meta.ref.f].nodeName).toEqual('MAIN');
    expect(refs[meta.ref.f]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.g].nodeName).toEqual('H1');
    expect(refs[meta.ref.g]).toBeInstanceOf(window.HTMLHeadingElement);
    expect(refs[meta.ref.h].nodeName).toEqual('P');
    expect(refs[meta.ref.h]).toBeInstanceOf(window.HTMLParagraphElement);
    expect(refs[meta.ref.i].nodeName).toEqual('B');
    expect(refs[meta.ref.i]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.j].nodeName).toEqual('A');
    expect(refs[meta.ref.j]).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs[meta.ref.k].nodeName).toEqual('OL');
    expect(refs[meta.ref.k]).toBeInstanceOf(window.HTMLOListElement);
    expect(refs[meta.ref.l].nodeName).toEqual('LI');
    expect(refs[meta.ref.l]).toBeInstanceOf(window.HTMLLIElement);
    expect(refs[meta.ref.m].nodeName).toEqual('LI');
    expect(refs[meta.ref.m]).toBeInstanceOf(window.HTMLLIElement);
    expect(refs[meta.ref.n].nodeName).toEqual('FORM');
    expect(refs[meta.ref.n]).toBeInstanceOf(window.HTMLFormElement);
    expect(refs[meta.ref.o].nodeName).toEqual('INPUT');
    expect(refs[meta.ref.o]).toBeInstanceOf(window.HTMLInputElement);
    expect(refs[meta.ref.p].nodeName).toEqual('TEXTAREA');
    expect(refs[meta.ref.p]).toBeInstanceOf(window.HTMLTextAreaElement);
    expect(refs[meta.ref.q].nodeName).toEqual('BUTTON');
    expect(refs[meta.ref.q]).toBeInstanceOf(window.HTMLButtonElement);
    expect(refs[meta.ref.r].nodeName).toEqual('#comment');
    expect(refs[meta.ref.r]).toBeInstanceOf(window.Comment);
    expect(refs[meta.ref.s].nodeName).toEqual('FOOTER');
    expect(refs[meta.ref.s]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.t].nodeName).toEqual('#text');
    expect(refs[meta.ref.t]).toBeInstanceOf(window.Text);
    expect(Object.keys(refs)).toHaveLength(20);
    expect(Object.keys(meta.ref)).toHaveLength(20);
  });

  test('collects ref at start of element attributes', () => {
    expect.assertions(5);
    const meta = compile<{ search: HTMLInputElement }>(`
      <div>
        <input @search id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.d);
    expect(refs[meta.ref.search]).toBeInstanceOf(window.HTMLInputElement);
    expect(refs[meta.ref.search].id).toBe('search');
    expect(refs[meta.ref.search].name).toBe('q');
    expect(Object.keys(refs)).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test('collects ref at end of element attributes', () => {
    expect.assertions(5);
    const meta = compile<{ search: HTMLInputElement }>(`
      <div>
        <input id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off @search />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.d);
    expect(refs[meta.ref.search]).toBeInstanceOf(window.HTMLInputElement);
    expect(refs[meta.ref.search].id).toBe('search');
    expect(refs[meta.ref.search].name).toBe('q');
    expect(Object.keys(refs)).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test('collects ref in middle of element attributes', () => {
    expect.assertions(5);
    const meta = compile<{ search: HTMLInputElement }>(`
      <div>
        <input id=search name=q class="input search" type=search minlength=2 @search maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.d);
    expect(refs[meta.ref.search]).toBeInstanceOf(window.HTMLInputElement);
    expect(refs[meta.ref.search].id).toBe('search');
    expect(refs[meta.ref.search].name).toBe('q');
    expect(Object.keys(refs)).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test('collects ref from template with only text', () => {
    expect.assertions(2);
    const meta = compile<{ a: Text }>('@a');
    const view = h(meta.html);
    const refs = collect<{ a: Text }>(view, meta.d);
    expect(refs[meta.ref.a].nodeName).toEqual('#text');
    expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
  });

  test('collects ref from template with only comment', () => {
    expect.assertions(2);
    const meta = compile<{ a: Comment }>('<!-- @a -->');
    const view = h(meta.html);
    const refs = collect<{ a: Comment }>(view, meta.d);
    expect(refs[meta.ref.a].nodeName).toEqual('#comment');
    expect(refs[meta.ref.a]).toBeInstanceOf(window.Comment);
  });

  test('collects refs from template with many comments', () => {
    expect.assertions(15);
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
    const refs = collect<Refs>(view, meta.d);
    expect(refs[meta.ref.a].nodeName).toEqual('#text');
    expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
    expect(refs[meta.ref.b].nodeName).toEqual('#comment');
    expect(refs[meta.ref.b]).toBeInstanceOf(window.Comment);
    expect(refs[meta.ref.c].nodeName).toEqual('DIV');
    expect(refs[meta.ref.c]).toBeInstanceOf(window.HTMLDivElement);
    expect(refs[meta.ref.d].nodeName).toEqual('#text');
    expect(refs[meta.ref.d]).toBeInstanceOf(window.Text);
    expect(refs[meta.ref.e].nodeName).toEqual('#comment');
    expect(refs[meta.ref.e]).toBeInstanceOf(window.Comment);
    expect(refs[meta.ref.f].nodeName).toEqual('DIV');
    expect(refs[meta.ref.f]).toBeInstanceOf(window.HTMLDivElement);
    expect(Object.keys(refs)).toHaveLength(6);
    expect(Object.keys(meta.ref)).toHaveLength(6);
    expect(Object.keys(meta.d)).toHaveLength(6);
  });

  describe('keepSpaces option', () => {
    test('collects refs when option is default', () => {
      expect.assertions(8);
      const meta = compile<Refs>(`
        <div>
          @a
          <div @b>
            @c
            <div @d></div>
          </div>
        </div>
      `);
      const view = h(meta.html);
      const refs = collect<Refs>(view, meta.d);
      expect(refs[meta.ref.a].nodeName).toEqual('#text');
      expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
      expect(refs[meta.ref.b].nodeName).toEqual('DIV');
      expect(refs[meta.ref.b]).toBeInstanceOf(window.HTMLDivElement);
      expect(refs[meta.ref.c].nodeName).toEqual('#text');
      expect(refs[meta.ref.c]).toBeInstanceOf(window.Text);
      expect(Object.keys(refs)).toHaveLength(4);
      expect(Object.keys(meta.ref)).toHaveLength(4);
    });

    test('collects refs when option is true', () => {
      expect.assertions(8);
      const meta = compile<Refs>(
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
      const refs = collect<Refs>(view, meta.d);
      expect(refs[meta.ref.a].nodeName).toEqual('#text');
      expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
      expect(refs[meta.ref.b].nodeName).toEqual('DIV');
      expect(refs[meta.ref.b]).toBeInstanceOf(window.HTMLDivElement);
      expect(refs[meta.ref.c].nodeName).toEqual('#text');
      expect(refs[meta.ref.c]).toBeInstanceOf(window.Text);
      expect(Object.keys(refs)).toHaveLength(4);
      expect(Object.keys(meta.ref)).toHaveLength(4);
    });

    test('collects refs when option is false', () => {
      expect.assertions(8);
      const meta = compile<Refs>(
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
      const refs = collect<Refs>(view, meta.d);
      expect(refs[meta.ref.a].nodeName).toEqual('#text');
      expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
      expect(refs[meta.ref.b].nodeName).toEqual('DIV');
      expect(refs[meta.ref.b]).toBeInstanceOf(window.HTMLDivElement);
      expect(refs[meta.ref.c].nodeName).toEqual('#text');
      expect(refs[meta.ref.c]).toBeInstanceOf(window.Text);
      expect(Object.keys(refs)).toHaveLength(4);
      expect(Object.keys(meta.ref)).toHaveLength(4);
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
