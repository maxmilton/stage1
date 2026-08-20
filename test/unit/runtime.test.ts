// XXX: This file has the same tests as test/unit/runtime-fast.test.ts and
// test/unit/browser-runtime.test.ts, keep them in sync.

import { afterEach, describe, expect, expectTypeOf, test } from "bun:test";
import { cleanup, render } from "@maxmilton/test-utils/dom";
import { compile } from "../../src/macro.ts" with { type: "macro" };
import { collect, h } from "../../src/runtime.ts";
import type { InferRefs, Refs } from "../../src/types.ts";
import { Test } from "../TestComponent.ts";

describe("h", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(h).not.toBeAny();
    expectTypeOf(h).toBeFunction();
    expectTypeOf(h).parameters.toEqualTypeOf<[html: string]>();
    // Erased: `T` -> its `Node` constraint, not the `= Element` default.
    expectTypeOf(h).returns.not.toBeAny();
    expectTypeOf(h).returns.not.toBeNever();
    expectTypeOf(h).returns.toEqualTypeOf<ChildNode & Node>();
    // `ReturnType` instantiates the constraint too ∴ the default is call-site only.
    expectTypeOf(h(/* html */ "<div></div>")).toEqualTypeOf<ChildNode & Element>();
    expectTypeOf<ReturnType<typeof h<HTMLDivElement>>>().toEqualTypeOf<
      ChildNode & HTMLDivElement
    >();
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
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>",
      );
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
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>",
      );
    });

    test("renders SVG template", () => {
      expect.assertions(3);
      const meta = compile(/* html */ `
        <svg>
          <circle cx=10 cy='10' r="10" />
        </svg>
      `);
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const rendered = render(view);
      expect(view).toBeInstanceOf(window.SVGSVGElement);
      expect(rendered.container.getHTML()).toBe(
        /* html */ '<svg><circle cx="10" cy="10" r="10"></circle></svg>',
      );
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
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const rendered = render(view);
      expect(view).toBeInstanceOf(window.HTMLUListElement);
      expect(view.id).toBe("root");
      expect(rendered.container.firstChild).toBe(view);
    });

    test("removes refs in template from output DOM", () => {
      expect.assertions(2);
      const meta = compile(/* html */ `
        <ul @list>
          <li @item-one>A</li>
          <li @item-two>B</li>
        </ul>
      `);
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(/* html */ "<ul><li>A</li><li>B</li></ul>");
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
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<div><pre>\n            a\n            b\n            c\n\n\n            &lt;span&gt; Foo  &lt;/span&gt;\n          </pre><span>Bar</span><code>\n            &lt;span&gt;\n              Baz\n            &lt;/span&gt;\n          </code></div>",
      );
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
    expect.assertions(0);
    expectTypeOf(collect).not.toBeAny();
    expectTypeOf(collect).toBeFunction();
    expectTypeOf(collect).parameters.toEqualTypeOf<
      [root: Node, k: readonly string[], d: readonly number[]]
    >();
    // Erased: `R` -> its constraint, never reaching `LowercaseKeys<R>`.
    expectTypeOf(collect).returns.not.toBeAny();
    expectTypeOf(collect).returns.not.toBeNever();
    expectTypeOf(collect).returns.toExtend<Refs>();
    // Ref keys are lowercased — browsers normalise attribute names.
    expectTypeOf<ReturnType<typeof collect<{ Foo: HTMLDivElement; bar: Text }>>>().toEqualTypeOf<{
      foo: HTMLDivElement;
      bar: Text;
    }>();
    expectTypeOf<InferRefs<{ foo: string }>>().toEqualTypeOf<{ foo: Node }>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(collect).toBeFunction();
    expect(collect).not.toBeClass();
  });

  test("expects 3 parameters", () => {
    expect.assertions(1);
    expect(collect).toHaveParameters(3, 0);
  });

  // A deep mixed tree exercising every node kind the walk has to step over.
  // Each ref is its own test so a wrong distance names the ref it landed on
  // instead of stopping at the first of twenty assertions. `nodeName` is the
  // discriminating assertion — `instanceof HTMLElement` passes for any element,
  // so it would not catch the walk landing on the wrong one.
  const DEEP_TREE = compile(/* html */ `
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

  test.each([
    ["a", "DIV"],
    ["b", "HEADER"],
    ["c", "NAV"],
    ["d", "A"],
    ["e", "A"],
    ["f", "MAIN"],
    ["g", "H1"],
    ["h", "P"],
    ["i", "B"],
    ["j", "A"],
    ["k", "OL"],
    ["l", "LI"],
    ["m", "LI"],
    ["n", "FORM"],
    ["o", "INPUT"],
    ["p", "TEXTAREA"],
    ["q", "BUTTON"],
    ["r", "#comment"],
    ["s", "FOOTER"],
    ["t", "#text"],
  ])('collects the "%s" ref as %s', (name, nodeName) => {
    expect.assertions(2);
    expect(DEEP_TREE.success).toBeTrue(); // guard: refs are meaningless if compile failed
    const view = h(DEEP_TREE.html);
    // `LowercaseKeys<Refs>` drops the index signature, so re-widen to index it.
    const refs = collect<Refs>(view, DEEP_TREE.k, DEEP_TREE.d) as Refs;
    expect(refs[name].nodeName).toBe(nodeName);
  });

  test("collects every ref in a deep tree and no others", () => {
    expect.assertions(2);
    expect(DEEP_TREE.success).toBeTrue(); // guard
    const view = h(DEEP_TREE.html);
    expect(Object.keys(collect<Refs>(view, DEEP_TREE.k, DEEP_TREE.d))).toHaveLength(20);
  });

  test("collects ref at start of element attributes", () => {
    expect.assertions(5);
    const meta = compile(/* html */ `
      <div>
        <input @search id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.k, meta.d);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe("search");
    expect(refs.search.name).toBe("q");
    expect(Object.keys(refs)).toHaveLength(1);
  });

  test("collects ref at end of element attributes", () => {
    expect.assertions(5);
    const meta = compile(/* html */ `
      <div>
        <input id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off @search />
      </div>
    `);
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.k, meta.d);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe("search");
    expect(refs.search.name).toBe("q");
    expect(Object.keys(refs)).toHaveLength(1);
  });

  test("collects ref in middle of element attributes", () => {
    expect.assertions(5);
    const meta = compile(/* html */ `
      <div>
        <input id=search name=q class="input search" type=search minlength=2 @search maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    const view = h(meta.html);
    const refs = collect<{ search: HTMLInputElement }>(view, meta.k, meta.d);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe("search");
    expect(refs.search.name).toBe("q");
    expect(Object.keys(refs)).toHaveLength(1);
  });

  // NOTE: The walk is unchecked for speed — `k`/`d` must come from the same
  // compile() as `root`. Walking past the end of the tree throws rather than
  // returning undefined, and a `k` longer than `d` silently yields the same
  // node for the surplus keys. See SPEC V16.
  test("throws when the walk distance overruns the tree", () => {
    expect.assertions(1);
    const view = h(/* html */ "<div><span></span></div>");
    expect(() => collect(view, ["a"], [99])).toThrow(window.TypeError);
  });

  // This should never happen when compile macro is used.
  test("returns the same node for surplus ref keys", () => {
    expect.assertions(2);
    const view = h(/* html */ "<div><span></span></div>");
    const refs = collect<{ a: Node; b: Node }>(view, ["a", "b"], [1]);
    expect(refs.a.nodeName).toBe("SPAN");
    expect(refs.b).toBe(refs.a);
  });

  test("collects ref from template with only text", () => {
    expect.assertions(3);
    const meta = compile<{ a: Text }>(/* html */ "@a");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    const view = h(meta.html);
    const refs = collect<{ a: Text }>(view, meta.k, meta.d);
    expect(refs.a.nodeName).toBe("#text");
    expect(refs.a).toBeInstanceOf(window.Text);
  });

  test("collects ref from template with only comment", () => {
    expect.assertions(3);
    const meta = compile<{ a: Comment }>(/* html */ "<!-- @a -->");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    const view = h(meta.html);
    const refs = collect<{ a: Comment }>(view, meta.k, meta.d);
    expect(refs.a.nodeName).toBe("#comment");
    expect(refs.a).toBeInstanceOf(window.Comment);
  });

  // NOTE: The whitespace-only Text node kept inside <pre> is a real node in the
  // walk, so a template like this fails if compile() does not count it in `d`.
  test("collects ref after a whitespace-sensitive block", () => {
    expect.assertions(3);
    const meta = compile<{ a: Comment }>(/* html */ "<div><pre>   </pre><!-- @a --></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    const view = h(meta.html);
    const refs = collect<{ a: Comment }>(view, meta.k, meta.d);
    expect(refs.a.nodeName).toBe("#comment");
    expect(refs.a).toBeInstanceOf(window.Comment);
  });

  // NOTE: A bare "<" splits the Text node into several compile-time chunks but
  // is still one node at runtime, so the walk distance must count it once.
  test("collects ref after text split across chunks", () => {
    expect.assertions(3);
    const meta = compile<{ x: Comment }>(/* html */ "<div>a < b<!-- @x --></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    const view = h(meta.html);
    const refs = collect<{ x: Comment }>(view, meta.k, meta.d);
    expect(refs.x.nodeName).toBe("#comment");
    expect(refs.x).toBeInstanceOf(window.Comment);
  });

  test("collects refs from template with many comments", () => {
    expect.assertions(16);
    interface TemplateRefs {
      a: Text;
      b: Comment;
      c: HTMLDivElement;
      d: Text;
      e: Comment;
      f: HTMLDivElement;
    }
    const meta = compile(/* html */ `
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
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    const view = h(meta.html);
    const refs = collect<TemplateRefs>(view, meta.k, meta.d);
    expect(refs.a.nodeName).toBe("#text");
    expect(refs.a).toBeInstanceOf(window.Text);
    expect(refs.b.nodeName).toBe("#comment");
    expect(refs.b).toBeInstanceOf(window.Comment);
    expect(refs.c.nodeName).toBe("DIV");
    expect(refs.c).toBeInstanceOf(window.HTMLDivElement);
    expect(refs.d.nodeName).toBe("#text");
    expect(refs.d).toBeInstanceOf(window.Text);
    expect(refs.e.nodeName).toBe("#comment");
    expect(refs.e).toBeInstanceOf(window.Comment);
    expect(refs.f.nodeName).toBe("DIV");
    expect(refs.f).toBeInstanceOf(window.HTMLDivElement);
    expect(Object.keys(refs)).toHaveLength(6);
    expect(meta.k).toHaveLength(6);
    expect(meta.d).toHaveLength(6);
  });

  describe("keepSpaces option", () => {
    test("collects refs when option is default", () => {
      expect.assertions(10);
      interface TemplateRefs {
        a: Text;
        b: HTMLDivElement;
        c: Text;
        d: HTMLDivElement;
      }
      const meta = compile(/* html */ `
        <div>
          @a
          <div @b>
            @c
            <div @d></div>
          </div>
        </div>
      `);
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const refs = collect<TemplateRefs>(view, meta.k, meta.d);
      expect(refs.a.nodeName).toBe("#text");
      expect(refs.a).toBeInstanceOf(window.Text);
      expect(refs.b.nodeName).toBe("DIV");
      expect(refs.b).toBeInstanceOf(window.HTMLDivElement);
      expect(refs.c.nodeName).toBe("#text");
      expect(refs.c).toBeInstanceOf(window.Text);
      expect(refs.d.nodeName).toBe("DIV");
      expect(refs.d).toBeInstanceOf(window.HTMLDivElement);
      expect(Object.keys(refs)).toHaveLength(4);
    });

    test("collects refs when option is true", () => {
      expect.assertions(10);
      interface TemplateRefs {
        a: Text;
        b: HTMLDivElement;
        c: Text;
        d: HTMLDivElement;
      }
      const meta = compile(
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
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const refs = collect<TemplateRefs>(view, meta.k, meta.d);
      expect(refs.a.nodeName).toBe("#text");
      expect(refs.a).toBeInstanceOf(window.Text);
      expect(refs.b.nodeName).toBe("DIV");
      expect(refs.b).toBeInstanceOf(window.HTMLDivElement);
      expect(refs.c.nodeName).toBe("#text");
      expect(refs.c).toBeInstanceOf(window.Text);
      expect(refs.d.nodeName).toBe("DIV");
      expect(refs.d).toBeInstanceOf(window.HTMLDivElement);
      expect(Object.keys(refs)).toHaveLength(4);
    });

    test("collects refs when option is false", () => {
      expect.assertions(10);
      interface TemplateRefs {
        a: Text;
        b: HTMLDivElement;
        c: Text;
        d: HTMLDivElement;
      }
      const meta = compile(
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
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      const view = h(meta.html);
      const refs = collect<TemplateRefs>(view, meta.k, meta.d);
      expect(refs.a.nodeName).toBe("#text");
      expect(refs.a).toBeInstanceOf(window.Text);
      expect(refs.b.nodeName).toBe("DIV");
      expect(refs.b).toBeInstanceOf(window.HTMLDivElement);
      expect(refs.c.nodeName).toBe("#text");
      expect(refs.c).toBeInstanceOf(window.Text);
      expect(refs.d.nodeName).toBe("DIV");
      expect(refs.d).toBeInstanceOf(window.HTMLDivElement);
      expect(Object.keys(refs)).toHaveLength(4);
    });
  });
});

describe("Test component", () => {
  test("types", () => {
    expect.assertions(0);
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
