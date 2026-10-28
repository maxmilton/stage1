// This file has the same tests as test/unit/runtime.test.ts and
// test/unit/runtime-fast.test.ts — keep them in sync.

import { afterEach, describe, expect, expectTypeOf, test } from "bun:test";
import { cleanup, render } from "@maxmilton/test-utils/dom";
import { collect, h, html } from "../../src/browser/runtime.ts";
import type { Refs } from "../../src/types.ts";
import { Test } from "../fixtures/TestComponent_browser.ts";

// One test per ref so a miss names its ref; nodeName, unlike instanceof HTMLElement, tells elements apart.
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
    // `View` is not exported; name it through `collect()`, the consumer `h()` must satisfy.
    type View = Parameters<typeof collect>[1];
    expectTypeOf(h).not.toBeAny();
    expectTypeOf(h).toBeFunction();
    expectTypeOf(h).parameters.toEqualTypeOf<[html: string]>();
    // Erased: `T` -> its `Node` constraint, not the `= Element` default.
    expectTypeOf(h).returns.not.toBeAny();
    expectTypeOf(h).returns.not.toBeNever();
    expectTypeOf(h).returns.toExtend<ChildNode>();
    expectTypeOf(h).returns.toEqualTypeOf<View & Node>();
    // The `= Element` default applies only at a call site.
    expectTypeOf(h(/* html */ "<div></div>")).toEqualTypeOf<View & Element>();
    expectTypeOf(h<HTMLDivElement>).returns.toEqualTypeOf<View & HTMLDivElement>();
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

  test("returns a DOM node for div", () => {
    expect.assertions(2);
    const node = h(/* html */ "<div></div>");
    expect(node).toBeInstanceOf(Node);
    expect(node.nodeName).toBe("DIV");
  });

  test("returns a DOM node for text", () => {
    expect.assertions(2);
    const node = h(/* html */ "foo");
    expect(node).toBeInstanceOf(Node);
    expect(node.nodeName).toBe("#text");
  });

  // TODO: Add documentation about this; it differs from precompiled runtime h() behaviour.
  // Characterization: h() has no empty-template guard, so it throws on the missing first child.
  test("throws for empty string", () => {
    expect.assertions(1);
    expect(() => h(/* html */ "")).toThrow(window.TypeError);
  });

  // Serial: renders into the shared document.body.
  describe.serial("render", () => {
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

    // Accepted tradeoff: skipping whitespace-sensitive blocks would make live h() too slow (README).
    test("minifies whitespace in whitespace-sensitive blocks", () => {
      expect.assertions(1);
      const view = h(/* html */ "<div><pre>a  b</pre></div>");
      const rendered = render(view);
      expect(rendered.container.getHTML()).toBe(/* html */ "<div><pre>a b</pre></div>");
    });
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
    expectTypeOf(html<HTMLDivElement>).returns.toEqualTypeOf<
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

  // Serial: renders into the shared document.body.
  describe.serial("render", () => {
    afterEach(cleanup);

    test("renders basic template", () => {
      expect.assertions(1);
      // oxfmt-ignore
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
    // `View` is unexported, so the equality is circular for `view`; `toExtend` checks it.
    type View = Parameters<typeof collect>[1];
    expectTypeOf(collect).parameters.toExtend<[root: Node, view: Node]>();
    expectTypeOf(collect).parameters.toEqualTypeOf<[root: Node, view: View]>();
    // Erased: `R` -> its constraint, never reaching `R`.
    expectTypeOf(collect).returns.not.toBeAny();
    expectTypeOf(collect).returns.not.toBeNever();
    expectTypeOf(collect).returns.toExtend<Refs>();
    expectTypeOf(collect).returns.toEqualTypeOf<Refs>();
    expectTypeOf(collect<{ foo: HTMLDivElement; bar: Text }>).returns.toEqualTypeOf<{
      foo: HTMLDivElement;
      bar: Text;
    }>();
    // The `= Refs` default applies only at a call site.
    expectTypeOf((view: View) => collect(document, view)).returns.toEqualTypeOf<Refs>();

    // Interfaces have no implicit index signature, so `R extends Refs` alone would reject them.
    interface FooRefs {
      foo: HTMLDivElement;
    }
    expectTypeOf(collect<FooRefs>).returns.toEqualTypeOf<FooRefs>();
    // @ts-expect-error - ref values must be Nodes
    expectTypeOf(collect<{ foo: string }>);
    // @ts-expect-error - ref names must be lowercase; browsers normalise attribute names
    expectTypeOf(collect<{ Foo: HTMLDivElement }>);
    // @ts-expect-error - regression: a lowercase twin key must not let an uppercase one pass
    expectTypeOf(collect<{ foo: Text; Foo: Comment }>);
    // @ts-expect-error - regression: ref names must be strings; numeric keys were dropped
    expectTypeOf(collect<{ 1: Text }>);
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

  test("collects exactly the 19 marked refs in a deep tree", () => {
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

  // Accepted tradeoff: live mode doesn't validate, and its reverse attribute scan saves bytes.
  test("uses the last ref marker when an element has several", () => {
    expect.assertions(2);
    const view = h(/* html */ "<div @a @b></div>");
    const refs = collect<{ b: HTMLDivElement }>(view, view);
    expect(refs.b).toBeInstanceOf(window.HTMLDivElement);
    expect(Object.keys(refs)).toEqual(["b"]);
  });

  // Accepted tradeoff: live mode doesn't validate, so the unused markers ship to the page.
  test("leaves the other ref markers in the DOM", () => {
    expect.assertions(1);
    const view = h(/* html */ "<div @a @b></div>");
    collect(view, view);
    expect(view.getAttributeNames()).toHaveLength(1);
  });

  test("does not collect an escaped ref marker", () => {
    expect.assertions(1);
    const view = h(/* html */ String.raw`<div \@a></div>`);
    expect(Object.keys(collect(view, view))).toBeEmpty();
  });

  // Escaping is emergent: nothing strips the backslash, so it stays in the output.
  test("keeps the backslash of an escaped ref marker", () => {
    expect.assertions(1);
    const view = h(/* html */ String.raw`<div \@a></div>`);
    expect(view.outerHTML).toBe(/* html */ String.raw`<div \@a=""></div>`);
  });

  test("collects ref from template with only text", () => {
    expect.assertions(3);
    const view = h<Text>(/* html */ "@a");
    const refs = collect<{ a: Text }>(view, view);
    expect(refs.a.nodeName).toBe("#text");
    expect(refs.a).toBeInstanceOf(window.Text);
    expect(Object.keys(refs)).toHaveLength(1);
  });

  // No spaces: live mode only reads a comment ref whose text starts with "@".
  test("collects ref from template with only comment", () => {
    expect.assertions(3);
    const view = h<Comment>(/* html */ "<!--@a-->");
    const refs = collect<{ a: Comment }>(view, view);
    expect(refs.a.nodeName).toBe("#comment");
    expect(refs.a).toBeInstanceOf(window.Comment);
    expect(Object.keys(refs)).toHaveLength(1);
  });

  test("collects refs against a cloned root", () => {
    expect.assertions(3);
    // How components render: compile once, then collect against a clone h() never saw.
    const view = h(/* html */ "<ul @l><li @a>A</li><li @b>B</li></ul>");
    const root = view.cloneNode(true) as HTMLUListElement;
    const refs = collect<{ l: Element; a: Element; b: Element }>(root, view);
    const [first, second] = root.getElementsByTagName("li");
    expect(refs.l).toBe(root);
    expect(refs.a).toBe(first);
    expect(refs.b).toBe(second);
  });

  test("collects refs from a view compiled before a later h() call", () => {
    expect.assertions(2);
    // h() reuses one <template>; module-scope views like test/fixtures/TestComponent_browser.ts must survive that.
    const view = h(/* html */ "<div @a><span @b>x</span></div>");
    h(/* html */ "<p @c>other</p>");
    const refs = collect<{ a: Element; b: Element }>(view, view);
    const [span] = view.getElementsByTagName("span");
    expect(refs.b.nodeName).toBe("SPAN");
    expect(refs.b).toBe(span);
  });

  // Characterization: the parser doesn't lowercase text, so the key keeps a case `Refs<R>` can't type.
  test("keeps the case of a text ref name", () => {
    expect.assertions(1);
    const view = h(/* html */ "<div>@Foo</div>");
    expect(Object.keys(collect(view, view))).toEqual(["Foo"]);
  });

  // TODO: Add documentation about this; it differs from precompiled macro behaviour.
  // Characterization: live mode only reads a comment ref whose text starts with "@"; compile() accepts both.
  test("does not collect a comment ref with surrounding whitespace", () => {
    expect.assertions(1);
    const view = h(/* html */ "<div><!-- @a --><b @c></b></div>");
    expect(Object.keys(collect(view, view))).toEqual(["c"]);
  });

  // Accepted tradeoff: live mode reads any text starting with "@" as a ref; guarding <style> costs bytes.
  test("reads a style at-rule as a ref name", () => {
    expect.assertions(1);
    const view = h(/* html */ "<div><style>@media print{a{b:c}}</style></div>");
    expect(Object.keys(collect(view, view))).toEqual([/* css */ "media print{a{b:c}}"]);
  });

  // Accepted tradeoff, destructive half: the stylesheet is blanked.
  test("wipes the CSS of a style element read as a ref", () => {
    expect.assertions(1);
    const view = h(/* html */ "<div><style>@media print{a{b:c}}</style></div>");
    collect(view, view);
    expect(view.outerHTML).toBe(/* html */ "<div><style></style></div>");
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

  // h() takes no options, so compile()'s keepSpaces tests have no counterpart here.
});

describe("Test component", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(Test).not.toBeAny();
    expectTypeOf(Test).toBeFunction();
    expectTypeOf(Test).parameters.toEqualTypeOf<[props: { text: string }]>();
    expectTypeOf(Test).returns.not.toBeAny();
    expectTypeOf(Test).returns.not.toBeNever();
    expectTypeOf(Test).returns.toEqualTypeOf<HTMLDivElement>();
  });

  // Serial: renders into the shared document.body.
  describe.serial("render", () => {
    afterEach(cleanup);

    test("renders basic template", () => {
      expect.assertions(1);
      const rendered = render(Test({ text: "Hello" }));
      expect(rendered.container.getHTML()).toBe(/* html */ '<div id="test">Hello</div>');
    });
  });
});
