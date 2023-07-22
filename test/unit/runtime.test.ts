// XXX: This file has the same tests as test/unit/compile.test.ts, keep them in sync.

import { afterEach, describe, expect, test } from 'bun:test';
import { collect, h } from '../../src/runtime/index';
import { compile } from '../../src/runtime/macro' assert { type: 'macro' };
import { cleanup, render } from './utils';

// FIXME: Use inline snapshots once bun:test supports them.

describe('compile', () => {
  // FIXME: Test for each of the compile macro options; keepComments, keepSpace
  //  ↳ When keepComments, check refs metadata calculations are still correct.

  test('does not minify in whitespace-sensitive blocks', () => {
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
    expect(meta.html).toBe(
      '<div><pre>\n          a\n           b\n          c\n\n\n          &lt;span&gt; Foo  &lt;/span&gt;\n        </pre><span>Bar</span><code>\n          &lt;span&gt;\n            Baz\n          &lt;/span&gt;\n        </code></div>',
    );
  });
});

describe('h', () => {
  afterEach(cleanup);

  test('renders basic template', () => {
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

  test('renders SVG template', () => {
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
      '<div><pre>\n          a\n           b\n          c\n\n\n          <span> Foo  </span>\n        </pre><span>Bar</span><code>\n          <span>\n            Baz\n          </span>\n        </code></div>',
    );
  });
});

// describe('html', () => {
//   afterEach(cleanup);
//
//   test('renders basic template', () => {
//     const view = html`
//       <ul>
//         <li>A</li>
//         <li>B</li>
//         <li>C</li>
//       </ul>
//     `;
//     const view = h(meta.html);
//     const rendered = render(view);
//     expect(rendered.container.innerHTML).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
//   });
// });

describe('collect', () => {
  test('collects all refs', () => {
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
        <footer @r>
          @s
        </footer>
      </div>
    `);
    const view = h(meta.html);
    const refs = collect(view, meta.k, meta.d);
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
    expect(refs.f).toBeInstanceOf(window.HTMLDivElement);
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
    expect(refs.r.nodeName).toEqual('FOOTER');
    expect(refs.r).toBeInstanceOf(window.HTMLElement);
    expect(refs.s.nodeName).toEqual('#text');
    expect(refs.s).toBeInstanceOf(window.Text);
  });

  test('collects ref at start of element attributes', () => {
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
  });

  test('collects ref at end of element attributes', () => {
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
  });

  test('collects ref in middle of element attributes', () => {
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
  });
});
