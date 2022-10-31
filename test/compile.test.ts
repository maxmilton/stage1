import * as assert from 'uvu/assert';
import { h, html } from '../src/compile';
import { cleanup, describe, render } from './utils';

describe('h', (test) => {
  test.after.each(cleanup);

  test('renders basic template', () => {
    const view = h(`
      <ul>
        <li>A</li>
        <li>B</li>
        <li>C</li>
      </ul>
    `);
    const rendered = render(view);
    assert.fixture(rendered.container.innerHTML, '<ul>\n<li>A</li>\n<li>B</li>\n<li>C</li>\n</ul>');
  });

  test('renders SVG template', () => {
    const view = h(`
      <svg>
        <circle cx="10" cy="10" r="10" />
      </svg>
    `);
    const rendered = render(view);
    assert.fixture(
      rendered.container.innerHTML,
      '<svg>\n<circle cx="10" cy="10" r="10"></circle>\n</svg>',
    );
    assert.instance(view, window.SVGElement);
  });

  test('returns root element', () => {
    const view = h(`
      <ul id=root>
        <li>A</li>
        <li>B</li>
        <li>C</li>
      </ul>
    `);
    assert.is(view.nodeName, 'UL');
    assert.is((view as unknown as HTMLUListElement).id, 'root');
  });

  test('removes refs in template from output DOM', () => {
    const view = h(`
      <ul #list>
        <li #item-one>A</li>
        <li #item-two>B</li>
      </ul>
    `);
    const rendered = render(view);
    assert.fixture(rendered.container.innerHTML, '<ul>\n<li>A</li>\n<li>B</li>\n</ul>');
  });

  test('collects all refs', () => {
    const view = h(`
      <div #a>
        <header #b>
          <nav #c>
            <a href="#one" #d>One</a>
            <a href="#two" #e>Two</a>
          </nav>
        </header>
        <main #f>
          <h1 #g>Test</h1>
          <p #h><b #i>This</b> is a <a href="#" #j>test</a>.</p>
          <ol #k>
            <li id=one #l>One</li>
            <li id=two #m>Two</li>
          </ol>
          <form #n>
            <input #o />
            <textarea #p></textarea>
            <button #q>Submit</button>
          </form>
        </main>
        <footer #r>
          #s
        </footer>
      </div>
    `);
    const nodes = view.collect(view);
    assert.instance(nodes.a, window.HTMLDivElement);
    assert.is(nodes.a.nodeName, 'DIV');
    assert.instance(nodes.b, window.HTMLElement);
    assert.is(nodes.b.nodeName, 'HEADER');
    assert.instance(nodes.c, window.HTMLElement);
    assert.is(nodes.c.nodeName, 'NAV');
    assert.instance(nodes.d, window.HTMLAnchorElement);
    assert.is(nodes.d.nodeName, 'A');
    assert.instance(nodes.e, window.HTMLAnchorElement);
    assert.is(nodes.e.nodeName, 'A');
    assert.instance(nodes.f, window.HTMLElement);
    assert.is(nodes.f.nodeName, 'MAIN');
    assert.instance(nodes.g, window.HTMLHeadingElement);
    assert.is(nodes.g.nodeName, 'H1');
    assert.instance(nodes.h, window.HTMLParagraphElement);
    assert.is(nodes.h.nodeName, 'P');
    assert.instance(nodes.i, window.HTMLElement);
    assert.is(nodes.i.nodeName, 'B');
    assert.instance(nodes.j, window.HTMLAnchorElement);
    assert.is(nodes.j.nodeName, 'A');
    assert.instance(nodes.k, window.HTMLOListElement);
    assert.is(nodes.k.nodeName, 'OL');
    assert.instance(nodes.l, window.HTMLLIElement);
    assert.is(nodes.l.nodeName, 'LI');
    assert.instance(nodes.m, window.HTMLLIElement);
    assert.is(nodes.m.nodeName, 'LI');
    assert.instance(nodes.n, window.HTMLFormElement);
    assert.is(nodes.n.nodeName, 'FORM');
    assert.instance(nodes.o, window.HTMLInputElement);
    assert.is(nodes.o.nodeName, 'INPUT');
    assert.instance(nodes.p, window.HTMLTextAreaElement);
    assert.is(nodes.p.nodeName, 'TEXTAREA');
    assert.instance(nodes.q, window.HTMLButtonElement);
    assert.is(nodes.q.nodeName, 'BUTTON');
    assert.instance(nodes.r, window.HTMLElement);
    assert.is(nodes.r.nodeName, 'FOOTER');
    assert.instance(nodes.s, window.Text);
    assert.is(nodes.s.nodeName, '#text');
  });

  test('collects ref at start of element attributes', () => {
    const view = h(`
      <div>
        <input #search id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const nodes = view.collect(view);
    assert.instance(nodes.search, window.HTMLInputElement);
  });

  test('collects ref at end of element attributes', () => {
    const view = h(`
      <div>
        <input id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off #search />
      </div>
    `);
    const nodes = view.collect(view);
    assert.instance(nodes.search, window.HTMLInputElement);
  });

  test('collects ref in middle of element attributes', () => {
    const view = h(`
      <div>
        <input id=search name=q class="input search" type=search minlength=2 #search maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const nodes = view.collect(view);
    assert.instance(nodes.search, window.HTMLInputElement);
  });

  test('does not format template when NODE_ENV=production', () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const view = html`<ul>
      <li>A</li>
      <li>B</li>
      <li>C</li>
    </ul> `;
    const rendered = render(view);
    assert.fixture(
      rendered.container.innerHTML,
      '<ul>\n      <li>A</li>\n      <li>B</li>\n      <li>C</li>\n    </ul>',
    );
    process.env.NODE_ENV = oldNodeEnv;
  });
});

describe('html', (test) => {
  test.after.each(cleanup);

  test('renders basic template', () => {
    const view = html`
      <ul>
        <li>A</li>
        <li>B</li>
        <li>C</li>
      </ul>
    `;
    const rendered = render(view);
    assert.fixture(rendered.container.innerHTML, '<ul>\n<li>A</li>\n<li>B</li>\n<li>C</li>\n</ul>');
  });
});
