// XXX: This file has the same tests as test/unit/runtime.test.ts and
// test/unit/runtime-fast.test.ts, keep them in sync.

import { afterEach, describe, expect, expectTypeOf, test } from "bun:test";
import { cleanup, render } from "@maxmilton/test-utils/dom";
import { collect, h, html } from "../../src/browser/runtime.ts";
import type { InferRefs, Refs } from "../../src/types.ts";
import { Test } from "../TestComponent_browser.ts";

// A deep mixed tree exercising every node kind the TreeWalker has to step
// over. Each ref is its own test so a miss names the ref that went missing
// instead of stopping at the first of nineteen assertions. `nodeName` is the
// discriminating assertion — `instanceof HTMLElement` passes for any element,
// so it would not catch collect() landing on the wrong one.
const deepTree = () =>
  h(/* html */ `
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
      <!-- -->
      <footer @r>
        @s
      </footer>
    </div>
  `);

describe("h", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(h).not.toBeAny();
    expectTypeOf(h).toBeFunction();
    expectTypeOf(h).parameters.toEqualTypeOf<[html: string]>();
    // Erased: `T` -> its `Node` constraint, not the `= Element` default. `View`
    // is not exported ∴ the return is pinned relationally, not by name.
    expectTypeOf(h).returns.not.toBeAny();
    expectTypeOf(h).returns.not.toBeNever();
    expectTypeOf(h).returns.toExtend<ChildNode>();
    // `ReturnType` instantiates the constraint too ∴ the default is call-site only.
    expectTypeOf(h(/* html */ "<div></div>")).toEqualTypeOf<ReturnType<typeof h<Element>>>();
    expectTypeOf<ReturnType<typeof h<HTMLDivElement>>>().toExtend<ChildNode & HTMLDivElement>();
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
      expect.assertions(1);
      const view = h(/* html */ `
        <ul>
          <li>A</li>
          <li>B</li>
          <li>C</li>
        </ul>
      `);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>",
      );
    });

    test("renders basic template with messy whitespace", () => {
      expect.assertions(1);
      const view = h(/* html */ `
        <ul>
          <li \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF   >A</li>
          <li
            >
              B</li>
          <li>C
            </li>
        </ul>
      `);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>",
      );
    });

    test("renders SVG template", () => {
      expect.assertions(2);
      const view = h(/* html */ `
        <svg>
          <circle cx=10 cy='10' r="10" />
        </svg>
      `);
      const rendered = render(view);
      expect(view).toBeInstanceOf(window.SVGSVGElement);
      expect(rendered.container.getHTML()).toBe(
        /* html */ '<svg><circle cx="10" cy="10" r="10"></circle></svg>',
      );
    });

    test("returns root element", () => {
      expect.assertions(3);
      const view = h(/* html */ `
        <ul id=root>
          <li>A</li>
          <li>B</li>
          <li>C</li>
        </ul>
      `);
      const rendered = render(view);
      expect(view).toBeInstanceOf(window.HTMLUListElement);
      expect(view.id).toBe("root");
      expect(rendered.container.firstChild).toBe(view);
    });

    test("removes refs in template from output DOM", () => {
      expect.assertions(1);
      const view = h(/* html */ `
        <ul @list>
          <li @item-one>A</li>
          <li @item-two>B</li>
        </ul>
      `);
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(/* html */ "<ul><li>A</li><li>B</li></ul>");
    });

    // NOTE: This is not supported by the current implementation of the h()
    // function because it would be too slow.
    // biome-ignore lint/suspicious/noSkippedTests: unsupported by design; see SPEC V7
    test.skip("does not minify in whitespace-sensitive blocks", () => {});
  });
});

describe("html", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(html).not.toBeAny();
    expectTypeOf(html).toBeFunction();
    expectTypeOf(html).parameters.toEqualTypeOf<
      [template: TemplateStringsArray, ...substitutions: unknown[]]
    >();
    expectTypeOf(html).returns.not.toBeAny();
    expectTypeOf(html).returns.not.toBeNever();
    expectTypeOf(html).returns.toEqualTypeOf<ReturnType<typeof h>>();
    expectTypeOf(html`<div></div>`).toEqualTypeOf<ReturnType<typeof h<Element>>>();
    expectTypeOf<ReturnType<typeof html<HTMLDivElement>>>().toEqualTypeOf<
      ReturnType<typeof h<HTMLDivElement>>
    >();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(html).toBeFunction();
    expect(html).not.toBeClass();
  });

  test("expects 2 parameters (1 optional)", () => {
    expect.assertions(1);
    expect(html).toHaveParameters(1, 1);
  });

  describe("render", () => {
    afterEach(cleanup);

    test("renders basic template", () => {
      expect.assertions(1);
      // biome-ignore format: no space between html and comment
      const view = html/* html */`
        <ul>
          <li>A</li>
          <li>B</li>
          <li>C</li>
        </ul>
      `;
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(
        /* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>",
      );
    });
  });
});

describe("collect", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(collect).not.toBeAny();
    expectTypeOf(collect).toBeFunction();
    // `view` is the unexported `View` ∴ `toExtend`, not `toEqualTypeOf`.
    expectTypeOf(collect).parameters.toExtend<[root: Node, view: Node]>();
    // Erased: `R` -> its `= Refs` default, never reaching `LowercaseKeys<R>`.
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

  test("expects 2 parameters", () => {
    expect.assertions(1);
    expect(collect).toHaveParameters(2, 0);
  });

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
    ["r", "FOOTER"],
    ["s", "#text"],
  ])('collects the "%s" ref as %s', (name, nodeName) => {
    expect.assertions(1);
    const view = deepTree();
    const refs: Refs = collect(view, view);
    expect(refs[name].nodeName).toBe(nodeName);
  });

  test("collects every ref in a deep tree and no others", () => {
    expect.assertions(1);
    const view = deepTree();
    expect(Object.keys(collect(view, view))).toHaveLength(19);
  });

  test("collects ref at start of element attributes", () => {
    expect.assertions(4);
    const view = h(/* html */ `
      <div>
        <input @search id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const refs = collect<{ search: HTMLInputElement }>(view, view);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe("search");
    expect(refs.search.name).toBe("q");
    expect(Object.keys(refs)).toHaveLength(1);
  });

  test("collects ref at end of element attributes", () => {
    expect.assertions(4);
    const view = h(/* html */ `
      <div>
        <input id=search name=q class="input search" type=search minlength=2 maxlength=40 placeholder="Search..." autofocus autocomplete=off @search />
      </div>
    `);
    const refs = collect<{ search: HTMLInputElement }>(view, view);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe("search");
    expect(refs.search.name).toBe("q");
    expect(Object.keys(refs)).toHaveLength(1);
  });

  test("collects ref in middle of element attributes", () => {
    expect.assertions(4);
    const view = h(/* html */ `
      <div>
        <input id=search name=q class="input search" type=search minlength=2 @search maxlength=40 placeholder="Search..." autofocus autocomplete=off />
      </div>
    `);
    const refs = collect<{ search: HTMLInputElement }>(view, view);
    expect(refs.search).toBeInstanceOf(window.HTMLInputElement);
    expect(refs.search.id).toBe("search");
    expect(refs.search.name).toBe("q");
    expect(Object.keys(refs)).toHaveLength(1);
  });

  // NOTE: collector() scans attributes in reverse to save bytes, so the LAST
  // marker wins here while compile() keeps the FIRST and treats several markers
  // as an error. That divergence is accepted, not an oversight — see SPEC B1.
  // Live mode does no validation, so the unused marker is left in the output.
  test("uses the last ref marker when an element has several", () => {
    expect.assertions(3);
    const view = h(/* html */ "<div @a @b></div>");
    const refs = collect<{ b: HTMLDivElement }>(view, view);
    expect(refs.b).toBeInstanceOf(window.HTMLDivElement);
    expect(Object.keys(refs)).toEqual(["b"]);
    expect(view.outerHTML).toBe(/* html */ '<div @a=""></div>');
  });

  test("does not collect an escaped ref marker", () => {
    expect.assertions(2);
    const view = h(/* html */ "<div \\@a></div>");
    const refs = collect(view, view);
    expect(Object.keys(refs)).toBeEmpty();
    expect(view.outerHTML).toBe(/* html */ '<div \\@a=""></div>');
  });

  test("collects ref from template with only text", () => {
    expect.assertions(3);
    const view = h<Text>(/* html */ "@a");
    const refs = collect<{ a: Text }>(view, view);
    expect(refs.a.nodeName).toBe("#text");
    expect(refs.a).toBeInstanceOf(window.Text);
    expect(Object.keys(refs)).toHaveLength(1);
  });

  // NOTE: Unlike the compile() macro, browser mode comment refs must have no
  // surrounding whitespace. The h() whitespace collapse keeps spaces inside
  // comments and collector() only matches when nodeValue starts with "@", so
  // `<!-- @a -->` is silently not collected. See browser/runtime.ts:39.
  test("collects ref from template with only comment", () => {
    expect.assertions(3);
    const view = h<Comment>(/* html */ "<!--@a-->");
    const refs = collect<{ a: Comment }>(view, view);
    expect(refs.a.nodeName).toBe("#comment");
    expect(refs.a).toBeInstanceOf(window.Comment);
    expect(Object.keys(refs)).toHaveLength(1);
  });

  test("collects refs from template with many comments", () => {
    expect.assertions(13);
    interface TemplateRefs {
      a: Text;
      b: Comment;
      c: HTMLDivElement;
      d: Text;
      e: Comment;
      f: HTMLDivElement;
    }
    const view = h(/* html */ `
      <div>
        <!---->
        @a
        <!---->
        <!--@b-->
        <div @c>
          <!---->
          @d
          <!--@e-->
          <!---->
          <div @f></div>
        </div>
      </div>
    `);
    const refs = collect<TemplateRefs>(view, view);
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
  });

  // NOTE: The regular mode h() function does not support options like the
  // runtime mode compile() macro does. So there's no need to test them here.
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
