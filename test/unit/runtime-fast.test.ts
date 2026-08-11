// XXX: This file has the same tests as test/unit/runtime.test.ts and
// test/unit/browser-runtime.test.ts, keep them in sync.

import { afterEach, describe, expect, expectTypeOf, test } from "bun:test";
import { cleanup, render } from "@maxmilton/test-utils/dom";
import { collect, h } from "../../src/fast/runtime.ts";
import { compile } from "../../src/macro.ts" with { type: "macro" };
import type { Refs } from "../../src/types.ts";
import { Test } from "../TestComponent_fast.ts";

describe("h", () => {
  test("types", () => {
    expectTypeOf(h).not.toBeAny();
    expectTypeOf(h).toBeFunction();
    expectTypeOf(h).parameters.toEqualTypeOf<[html: string]>();
    expectTypeOf(h).returns.not.toBeAny();
    expectTypeOf(h).returns.toEqualTypeOf<ChildNode & Node>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(h).toBeFunction();
    expect(h).not.toBeClass();
  });

  test("expects 1 parameter", () => {
    expect.assertions(1);
    expect(h).toHaveParameters(1, 0);
  });

  describe("render", () => {
    afterEach(cleanup);

    test("renders basic template", () => {
      expect.assertions(2);
      const meta = compile(/* html */ `
        <ul>
          <li>A</li>
          <li>B</li>
          <li>C</li>
        </ul>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>",
      );
      expect(meta.success).toBeTrue();
    });

    test("renders basic template with messy whitespace", () => {
      expect.assertions(2);
      const meta = compile(/* html */ `
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
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>",
      );
      expect(meta.success).toBeTrue();
    });

    test("renders SVG template", () => {
      expect.assertions(3);
      const meta = compile(/* html */ `
        <svg>
          <circle cx=10 cy='10' r="10" />
        </svg>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(view).toBeInstanceOf(window.SVGSVGElement);
      expect(rendered.container.getHTML()).toBe(
        /* html */ '<svg><circle cx="10" cy="10" r="10"></circle></svg>',
      );
      expect(meta.success).toBeTrue();
    });

    test("returns root element", () => {
      expect.assertions(4);
      const meta = compile(/* html */ `
        <ul id=root>
          <li>A</li>
          <li>B</li>
          <li>C</li>
        </ul>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(view).toBeInstanceOf(window.HTMLUListElement);
      expect(view.id).toBe("root");
      expect(rendered.container.firstChild).toBe(view);
      expect(meta.success).toBeTrue();
    });

    test("removes refs in template from output DOM", () => {
      expect.assertions(2);
      const meta = compile(/* html */ `
        <ul @list>
          <li @item-one>A</li>
          <li @item-two>B</li>
        </ul>
      `);
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(/* html */ "<ul><li>A</li><li>B</li></ul>");
      expect(meta.success).toBeTrue();
    });

    test("does not minify in whitespace-sensitive blocks", () => {
      expect.assertions(2);
      const meta = compile(/* html */ `
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
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<div><pre>\n            a\n            b\n            c\n\n\n            &lt;span&gt; Foo  &lt;/span&gt;\n          </pre><span>Bar</span><code>\n            &lt;span&gt;\n              Baz\n            &lt;/span&gt;\n          </code></div>",
      );
      expect(meta.success).toBeTrue();
    });
  });
});

// TODO: Once bun supports macros used as template literals tag functions, we
// should consider adding a html function similar to the browser runtime.

// describe("html", () => {
//   test("types", () => {
//     expectTypeOf(html).not.toBeAny();
//     expectTypeOf(html).toBeFunction();
//     expectTypeOf(html).parameters.toEqualTypeOf<[template: TemplateStringsArray, ...substitutions: unknown[]]>();
//     expectTypeOf(html).returns.not.toBeAny();
//     expectTypeOf(html).returns.toEqualTypeOf<ReturnType<typeof h>>();
//   });
//
//   test("is a function", () => {
//     expect.assertions(2);
//     expect(html).toBeFunction();
//     expect(html).not.toBeClass();
//   });
//
//   test("expects 2 parameters (1 optional)", () => {
//     expect.assertions(1);
//     expect(html).toHaveParameters(1, 1);
//   });
//
//   describe("render", () => {
//     afterEach(cleanup);
//
//     test("renders basic template", () => {
//       expect.assertions(2);
//       // biome-ignore format: no space between html and comment
//       const meta = html/* html */`
//         <ul>
//           <li>A</li>
//           <li>B</li>
//           <li>C</li>
//         </ul>
//       `;
//       const view = h(meta.html);
//       const rendered = render(view);
//       expect(rendered.container.innerHTML).toBe(/* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>");
//       expect(meta.success).toBeTrue();
//     });
//   });
// });

describe("collect", () => {
  test("types", () => {
    expectTypeOf(collect).not.toBeAny();
    expectTypeOf(collect).toBeFunction();
    expectTypeOf(collect).parameters.toEqualTypeOf<[root: Node, d: readonly number[]]>();
    expectTypeOf(collect).returns.not.toBeAny();
    expectTypeOf(collect).returns.toExtend<Node[]>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(collect).toBeFunction();
    expect(collect).not.toBeClass();
  });

  test("expects 2 parameters", () => {
    expect.assertions(1);
    expect(collect).toHaveParameters(2, 0);
  });

  test("collects all refs", () => {
    expect.assertions(43);
    const meta = compile<Refs>(/* html */ `
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
    expect(refs[meta.ref.a].nodeName).toBe("DIV");
    expect(refs[meta.ref.a]).toBeInstanceOf(window.HTMLDivElement);
    expect(refs[meta.ref.b].nodeName).toBe("HEADER");
    expect(refs[meta.ref.b]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.c].nodeName).toBe("NAV");
    expect(refs[meta.ref.c]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.d].nodeName).toBe("A");
    expect(refs[meta.ref.d]).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs[meta.ref.e].nodeName).toBe("A");
    expect(refs[meta.ref.e]).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs[meta.ref.f].nodeName).toBe("MAIN");
    expect(refs[meta.ref.f]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.g].nodeName).toBe("H1");
    expect(refs[meta.ref.g]).toBeInstanceOf(window.HTMLHeadingElement);
    expect(refs[meta.ref.h].nodeName).toBe("P");
    expect(refs[meta.ref.h]).toBeInstanceOf(window.HTMLParagraphElement);
    expect(refs[meta.ref.i].nodeName).toBe("B");
    expect(refs[meta.ref.i]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.j].nodeName).toBe("A");
    expect(refs[meta.ref.j]).toBeInstanceOf(window.HTMLAnchorElement);
    expect(refs[meta.ref.k].nodeName).toBe("OL");
    expect(refs[meta.ref.k]).toBeInstanceOf(window.HTMLOListElement);
    expect(refs[meta.ref.l].nodeName).toBe("LI");
    expect(refs[meta.ref.l]).toBeInstanceOf(window.HTMLLIElement);
    expect(refs[meta.ref.m].nodeName).toBe("LI");
    expect(refs[meta.ref.m]).toBeInstanceOf(window.HTMLLIElement);
    expect(refs[meta.ref.n].nodeName).toBe("FORM");
    expect(refs[meta.ref.n]).toBeInstanceOf(window.HTMLFormElement);
    expect(refs[meta.ref.o].nodeName).toBe("INPUT");
    expect(refs[meta.ref.o]).toBeInstanceOf(window.HTMLInputElement);
    expect(refs[meta.ref.p].nodeName).toBe("TEXTAREA");
    expect(refs[meta.ref.p]).toBeInstanceOf(window.HTMLTextAreaElement);
    expect(refs[meta.ref.q].nodeName).toBe("BUTTON");
    expect(refs[meta.ref.q]).toBeInstanceOf(window.HTMLButtonElement);
    expect(refs[meta.ref.r].nodeName).toBe("#comment");
    expect(refs[meta.ref.r]).toBeInstanceOf(window.Comment);
    expect(refs[meta.ref.s].nodeName).toBe("FOOTER");
    expect(refs[meta.ref.s]).toBeInstanceOf(window.HTMLElement);
    expect(refs[meta.ref.t].nodeName).toBe("#text");
    expect(refs[meta.ref.t]).toBeInstanceOf(window.Text);
    expect(refs).toHaveLength(20);
    expect(Object.keys(meta.ref)).toHaveLength(20);
    expect(meta.success).toBeTrue();
  });

  test("collects ref at start of element attributes", () => {
    expect.assertions(6);
    const meta = compile<{ search: HTMLInputElement }>(/* html */ `
      <div>
        <input @search id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.d);
    expect(refs[meta.ref.search]).toBeInstanceOf(window.HTMLInputElement);
    expect(refs[meta.ref.search].id).toBe("search");
    expect(refs[meta.ref.search].name).toBe("q");
    expect(refs).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
    expect(meta.success).toBeTrue();
  });

  test("collects ref at end of element attributes", () => {
    expect.assertions(6);
    const meta = compile<{ search: HTMLInputElement }>(/* html */ `
      <div>
        <input id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off @search />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.d);
    expect(refs[meta.ref.search]).toBeInstanceOf(window.HTMLInputElement);
    expect(refs[meta.ref.search].id).toBe("search");
    expect(refs[meta.ref.search].name).toBe("q");
    expect(refs).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
    expect(meta.success).toBeTrue();
  });

  test("collects ref in middle of element attributes", () => {
    expect.assertions(6);
    const meta = compile<{ search: HTMLInputElement }>(/* html */ `
      <div>
        <input id=search name=q class="input search" type=search minlength=2 @search maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.d);
    expect(refs[meta.ref.search]).toBeInstanceOf(window.HTMLInputElement);
    expect(refs[meta.ref.search].id).toBe("search");
    expect(refs[meta.ref.search].name).toBe("q");
    expect(refs).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
    expect(meta.success).toBeTrue();
  });

  test("collects ref from template with only text", () => {
    expect.assertions(3);
    const meta = compile<{ a: Text }>(/* html */ "@a");
    const view = h(meta.html);
    const refs = collect<{ a: Text }>(view, meta.d);
    expect(refs[meta.ref.a].nodeName).toBe("#text");
    expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
    expect(meta.success).toBeTrue();
  });

  test("collects ref from template with only comment", () => {
    expect.assertions(3);
    const meta = compile<{ a: Comment }>(/* html */ "<!-- @a -->");
    const view = h(meta.html);
    const refs = collect<{ a: Comment }>(view, meta.d);
    expect(refs[meta.ref.a].nodeName).toBe("#comment");
    expect(refs[meta.ref.a]).toBeInstanceOf(window.Comment);
    expect(meta.success).toBeTrue();
  });

  // NOTE: The whitespace-only Text node kept inside <pre> is a real node in the
  // walk, so a template like this fails if compile() does not count it in `d`.
  test("collects ref after a whitespace-sensitive block", () => {
    expect.assertions(3);
    const meta = compile<{ a: Comment }>(/* html */ "<div><pre>   </pre><!-- @a --></div>");
    const view = h(meta.html);
    const refs = collect<{ a: Comment }>(view, meta.d);
    expect(refs[meta.ref.a].nodeName).toBe("#comment");
    expect(refs[meta.ref.a]).toBeInstanceOf(window.Comment);
    expect(meta.success).toBeTrue();
  });

  // NOTE: A bare "<" splits the Text node into several compile-time chunks but
  // is still one node at runtime, so the walk distance must count it once.
  test("collects ref after text split across chunks", () => {
    expect.assertions(3);
    const meta = compile<{ x: Comment }>(/* html */ "<div>a < b<!-- @x --></div>");
    const view = h(meta.html);
    const refs = collect<{ x: Comment }>(view, meta.d);
    expect(refs[meta.ref.x].nodeName).toBe("#comment");
    expect(refs[meta.ref.x]).toBeInstanceOf(window.Comment);
    expect(meta.success).toBeTrue();
  });

  test("collects refs from template with many comments", () => {
    expect.assertions(16);
    const meta = compile<Refs>(/* html */ `
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
    expect(refs[meta.ref.a].nodeName).toBe("#text");
    expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
    expect(refs[meta.ref.b].nodeName).toBe("#comment");
    expect(refs[meta.ref.b]).toBeInstanceOf(window.Comment);
    expect(refs[meta.ref.c].nodeName).toBe("DIV");
    expect(refs[meta.ref.c]).toBeInstanceOf(window.HTMLDivElement);
    expect(refs[meta.ref.d].nodeName).toBe("#text");
    expect(refs[meta.ref.d]).toBeInstanceOf(window.Text);
    expect(refs[meta.ref.e].nodeName).toBe("#comment");
    expect(refs[meta.ref.e]).toBeInstanceOf(window.Comment);
    expect(refs[meta.ref.f].nodeName).toBe("DIV");
    expect(refs[meta.ref.f]).toBeInstanceOf(window.HTMLDivElement);
    expect(refs).toHaveLength(6);
    expect(Object.keys(meta.ref)).toHaveLength(6);
    expect(meta.d).toHaveLength(6);
    expect(meta.success).toBeTrue();
  });

  describe("keepSpaces option", () => {
    test("collects refs when option is default", () => {
      expect.assertions(9);
      const meta = compile<Refs>(/* html */ `
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
      expect(refs[meta.ref.a].nodeName).toBe("#text");
      expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
      expect(refs[meta.ref.b].nodeName).toBe("DIV");
      expect(refs[meta.ref.b]).toBeInstanceOf(window.HTMLDivElement);
      expect(refs[meta.ref.c].nodeName).toBe("#text");
      expect(refs[meta.ref.c]).toBeInstanceOf(window.Text);
      expect(refs).toHaveLength(4);
      expect(Object.keys(meta.ref)).toHaveLength(4);
      expect(meta.success).toBeTrue();
    });

    test("collects refs when option is true", () => {
      expect.assertions(9);
      const meta = compile<Refs>(
        /* html */ `
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
      expect(refs[meta.ref.a].nodeName).toBe("#text");
      expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
      expect(refs[meta.ref.b].nodeName).toBe("DIV");
      expect(refs[meta.ref.b]).toBeInstanceOf(window.HTMLDivElement);
      expect(refs[meta.ref.c].nodeName).toBe("#text");
      expect(refs[meta.ref.c]).toBeInstanceOf(window.Text);
      expect(refs).toHaveLength(4);
      expect(Object.keys(meta.ref)).toHaveLength(4);
      expect(meta.success).toBeTrue();
    });

    test("collects refs when option is false", () => {
      expect.assertions(9);
      const meta = compile<Refs>(
        /* html */ `
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
      expect(refs[meta.ref.a].nodeName).toBe("#text");
      expect(refs[meta.ref.a]).toBeInstanceOf(window.Text);
      expect(refs[meta.ref.b].nodeName).toBe("DIV");
      expect(refs[meta.ref.b]).toBeInstanceOf(window.HTMLDivElement);
      expect(refs[meta.ref.c].nodeName).toBe("#text");
      expect(refs[meta.ref.c]).toBeInstanceOf(window.Text);
      expect(refs).toHaveLength(4);
      expect(Object.keys(meta.ref)).toHaveLength(4);
      expect(meta.success).toBeTrue();
    });
  });
});

describe("Test component", () => {
  test("types", () => {
    expectTypeOf(Test).not.toBeAny();
    expectTypeOf(Test).toBeFunction();
    expectTypeOf(Test).parameters.toEqualTypeOf<[props: { text: string }]>();
    expectTypeOf(Test).returns.not.toBeAny();
    expectTypeOf(Test).returns.toEqualTypeOf<HTMLDivElement>();
  });

  describe("render", () => {
    afterEach(cleanup);

    test("renders basic template", () => {
      expect.assertions(1);
      const rendered = render(Test({ text: "Hello" }));
      expect(rendered.container.getHTML()).toBe(/* html */ '<div id="test">Hello</div>');
    });
  });
});
