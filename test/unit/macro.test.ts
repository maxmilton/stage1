// XXX: This file has the same tests as test/unit/compile.test.ts, keep them in sync.

import { describe, expect, spyOn, test } from "bun:test";
import { compile } from "../../src/macro.ts" with { type: "macro" };
import { compile as compileNoMacro } from "../../src/macro.ts";

describe("compile", () => {
  test("is a function", () => {
    expect.assertions(2);
    expect(compileNoMacro).toBeFunction();
    expect(compileNoMacro).not.toBeClass();
  });

  test("expects 2 parameters (1 optional)", () => {
    expect.assertions(1);
    expect(compileNoMacro).toHaveParameters(1, 1);
  });

  test("returns an object", () => {
    expect.assertions(1);
    const meta = compile("<div></div>");
    expect(meta).toBePlainObject();
  });

  test('returns "html" property with string value', () => {
    expect.assertions(2);
    const meta = compile("<div></div>");
    expect(meta).toHaveProperty("html");
    expect(meta.html).toBeString();
  });

  test('returns "k" property with array value', () => {
    expect.assertions(2);
    const meta = compile("<div></div>");
    expect(meta).toHaveProperty("k");
    expect(meta.k).toBeArray();
  });

  test('returns "d" property with array value', () => {
    expect.assertions(2);
    const meta = compile("<div></div>");
    expect(meta).toHaveProperty("d");
    expect(meta.d).toBeArray();
  });

  test('returns "ref" property with object value', () => {
    expect.assertions(2);
    const meta = compile("<div></div>");
    expect(meta).toHaveProperty("ref");
    expect(meta.ref).toBePlainObject();
  });

  test('returns "success" property with boolean value', () => {
    expect.assertions(2);
    const meta = compile("<div></div>");
    expect(meta).toHaveProperty("success");
    expect(meta.success).toBeBoolean();
  });

  test("does not return any other properties", () => {
    expect.assertions(2);
    const meta = compile("<div></div>");
    const properties = Object.keys(meta);
    expect(properties).toEqual(["html", "k", "d", "ref", "success"]);
    expect(properties).toHaveLength(5);
  });

  test("has empty k, d, and ref properties when no node refs", () => {
    expect.assertions(4);
    const meta = compile("<div></div>");
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.success).toBeTrue();
  });

  test("has 3 k, d, and ref properties when 3 node refs", () => {
    expect.assertions(4);
    const meta = compile("<div @a><div @b></div><div @c></div></div>");
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
    expect(meta.success).toBeTrue();
  });

  test("has 3 k, d, and ref properties when 3 node refs with whitespace", () => {
    expect.assertions(4);
    const meta = compile(`
      <div>
        <div @a></div>
        <div @b></div>
        <div @c></div>
      </div>
    `);
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
    expect(meta.success).toBeTrue();
  });

  test("has 3 k, d, and ref properties when 3 node refs with messy whitespace", () => {
    expect.assertions(4);
    const meta = compile(
      "\n\n\t<div><div     @a  ></div> \t\t\n\n\n<div \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF @b></  div> <div @c></\n\tdiv>\n\n</div>\n",
    );
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
    expect(meta.success).toBeTrue();
  });

  test("has 1 k, d, and ref properties when 1 text ref", () => {
    expect.assertions(4);
    const meta = compile("<div>@a</div>");
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
    expect(meta.success).toBeTrue();
  });

  // TODO: Add documentation about this since it differs from the default compile.ts h() behaviour
  test("has 1 k, d, and ref properties when 1 text ref with whitespace", () => {
    expect.assertions(4);
    const meta = compile("<div> @a</div>");
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
    expect(meta.success).toBeTrue();
  });

  test("has empty k, d, and ref properties when escaped node ref", () => {
    expect.assertions(4);
    const meta = compile("<div \\@a></div>");
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.success).toBeTrue();
  });

  test("has empty k, d, and ref properties when escaped text ref", () => {
    expect.assertions(4);
    const meta = compile("<div>\\@a</div>");
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.success).toBeTrue();
  });

  test("has correct meta ref properties when 3 node refs", () => {
    expect.assertions(4);
    const meta = compile("<div @a><div @b></div><div @c></div></div>");
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(meta.success).toBeTrue();
  });

  test("has correct meta ref properties when 3 node refs with whitespace", () => {
    expect.assertions(4);
    const meta = compile(`
      <div>
        <div @a></div>
        <div @b></div>
        <div @c></div>
      </div>
    `);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(meta.success).toBeTrue();
  });

  test("has correct meta ref properties when 3 node refs with messy whitespace", () => {
    expect.assertions(4);
    const meta = compile(
      "\n\n\t<div><div     @a  ></div> \t\t\n\n\n<div \f\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF @b></  div> <div @c></\n\tdiv>\n\n</div>\n",
    );
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(meta.success).toBeTrue();
  });

  test("has correct meta ref properties when 1 text ref", () => {
    expect.assertions(2);
    const meta = compile("<div>@a</div>");
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.success).toBeTrue();
  });

  test("has correct meta ref properties when 1 text ref with whitespace", () => {
    expect.assertions(2);
    const meta = compile("<div> @a</div>");
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.success).toBeTrue();
  });

  test("has correct meta ref properties when escaped node ref", () => {
    expect.assertions(2);
    // eslint-disable-next-line no-useless-escape
    const meta = compile("<div>\@a</div>");
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.success).toBeTrue();
  });

  test("has no meta ref properties when escaped text ref", () => {
    expect.assertions(2);
    const meta = compile("<div>\\@a</div>");
    expect(meta.ref).toBeEmptyObject();
    expect(meta.success).toBeTrue();
  });

  test("does not minify in whitespace-sensitive blocks", () => {
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
    expect(meta.html).toBe(
      "<div><pre>\n          a\n           b\n          c\n\n\n          &lt;span&gt; Foo  &lt;/span&gt;\n        </pre><span>Bar</span><code>\n          &lt;span&gt;\n            Baz\n          &lt;/span&gt;\n        </code></div>",
    );
    expect(meta.success).toBeTrue();
  });

  // FIXME: Uncomment once bun string handling in macros bug is fixed.
  // ↳ Currently blocked by bun bug; https://github.com/oven-sh/bun/issues/3832
  // test("does not escape HTML entities", () => {
  //   expect.assertions(2);
  //   const template = "<div>&lt;span&gt;Foo&lt;/span&gt;</div>";
  //   const meta = compile(template);
  //   expect(meta.html).toBe(template);
  //   expect(meta.success).toBeTrue();
  // });

  describe("errors", () => {
    test("logs error when more than one root element", () => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = "<div></div><div></div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith(
        "Expected template to have a single root element:",
        template,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    test("logs error when doctype found", () => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = "<!DOCTYPE html><div></div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith(
        "Found doctype but none was expected in template:",
        template,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    test("logs error when duplicate ref keys found", () => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = "<div><span>@a</span><span>@a</span></div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith("Duplicate ref keys found in template:", template);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    test("returns success false when more than one root element", () => {
      expect.assertions(1);
      const meta = compile("<div></div><div></div>");
      expect(meta.success).toBeFalse();
    });

    test("returns success false when doctype found", () => {
      expect.assertions(1);
      const meta = compile("<!DOCTYPE html><div></div>");
      expect(meta.success).toBeFalse();
    });

    test("returns success false when duplicate ref keys found", () => {
      expect.assertions(1);
      const meta = compile("<div><span>@a</span><span>@a</span></div>");
      expect(meta.success).toBeFalse();
    });
  });

  test("returns expected html for basic template", () => {
    expect.assertions(2);
    const meta = compile(`
      <ul>
        <li>A</li>
        <li>B</li>
        <li>C</li>
      </ul>
    `);
    expect(meta.html).toBe("<ul><li>A</li><li>B</li><li>C</li></ul>");
    expect(meta.success).toBeTrue();
  });

  // TODO: Test once lol-html (which powers bun's HTMLRewriter) fix their whitespace handling.
  test.skip("returns expected html for basic template with messy whitespace", () => {
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
    expect(meta.html).toBe("<ul><li>A</li><li>B</li><li>C</li></ul>");
    expect(meta.success).toBeTrue();
  });

  test("returns expected html for SVG template", () => {
    expect.assertions(2);
    const meta = compile(`
      <svg>
        <circle cx=10 cy='10' r="10" />
      </svg>
    `);
    expect(meta.html).toBe("<svg><circle cx=10 cy='10' r=\"10\" /></svg>");
    expect(meta.success).toBeTrue();
  });

  describe("comments", () => {
    test("removes comments", () => {
      expect.assertions(2);
      const meta = compile("<div><!-- comment --></div>");
      expect(meta.html).toBe("<div></div>");
      expect(meta.success).toBeTrue();
    });

    test("removes multiple comments", () => {
      expect.assertions(2);
      const meta = compile("<div><!-- comment --><!-- comment --><!-- comment --></div>");
      expect(meta.html).toBe("<div></div>");
      expect(meta.success).toBeTrue();
    });

    test("removes comment when template is only comment", () => {
      expect.assertions(2);
      const meta = compile("<!-- comment -->");
      expect(meta.html).toBe("");
      expect(meta.success).toBeTrue();
    });

    test.each([
      "<div><!-- comment --></div>",
      "<div><!-- --></div>",
      "<div><!--  --></div>",
      "<div><!--   --></div>",
      "<div><!-----></div>",
      "<div><!----></div>",
      "<div><!---></div>",
      "<div><!--></div>",
      "<div><!-></div>",
      "<div><!></div>",
      "<div><!-- <!-- --></div>",
      "<div><!--  \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF --></div>",
      "<div><!-- comment --!></div>",
      "<div><!--   --!></div>",
      "<div><!--  --!></div>",
      "<div><!-- --!></div>",
      "<div><!-----!></div>",
      "<div><!----!></div>",
      // '<div><!---!></div>', // TODO: Broken; bug in lol-html.
      // '<div><!--!></div>', // TODO: Broken; bug in lol-html.
      "<div><!-!></div>",
      "<div><!!></div>",
      "<div><!-- !-----></div>",
      "<div><!-- !----></div>",
      "<div><!-- !---></div>",
      "<div><!-- !--></div>",
      "<div><!-- <div> --></div>",
      "<div><!-- </div> --></div>",
      "<div><!-- <div></div> --></div>",
      "<div><!--<div>--></div>",
      "<div><!--</div>--></div>",
      "<div><!--<div></div>--></div>",
      "<div><!bogus></div>", // https://html.spec.whatwg.org/#bogus-comment-state
    ])("removes comment for %j", (template) => {
      expect.assertions(2);
      const meta = compileNoMacro(template);
      expect(meta.html).toBe("<div></div>");
      expect(meta.success).toBeTrue();
    });

    test("removes comments for complex mixed template", () => {
      expect.assertions(2);
      const meta = compile(`
        <div>
          <span>
            </span>
          <!-- comment -->
          <!-- -->
          <!--  -->
          <!--   -->
          <!----->
          <!---->
          <!--->
          <!-->
          <!->
          <!>
          <!-- <!-- -->
          <!--  \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF -->
          <!-- comment --!>
          <!--   --!>
          <!--  --!>
          <!-- --!>
          <!-----!>
          <!----!>
          <!---!>
          <!--!>
          <!-- !----->
          <!-- !---->
          <!-- !--->
          <!-- !-->
          <!-- <div> -->
          <!-- </div> -->
          <!-- <div></div> -->
          <!--<div>-->
          <!--</div>-->
          <!--<div></div>-->
          <span></span>
        </div>
      `);
      expect(meta.html).toBe("<div><span></span><span></span></div>");
      expect(meta.success).toBeTrue();
    });

    test("has 1 k, d, and ref properties when 1 comment ref", () => {
      expect.assertions(4);
      const meta = compile("<div><!-- @a --></div>");
      expect(meta.k).toHaveLength(1);
      expect(meta.d).toHaveLength(1);
      expect(Object.keys(meta.ref)).toHaveLength(1);
      expect(meta.success).toBeTrue();
    });

    test("has 3 k, d, and ref properties when 3 comment refs", () => {
      expect.assertions(4);
      const meta = compile("<div><!-- @a --><!-- @b --><!-- @c --></div>");
      expect(meta.k).toHaveLength(3);
      expect(meta.d).toHaveLength(3);
      expect(Object.keys(meta.ref)).toHaveLength(3);
      expect(meta.success).toBeTrue();
    });

    test("has correct meta ref properties when 3 comment refs", () => {
      expect.assertions(4);
      const meta = compile("<div><!-- @a --><!-- @b --><!-- @c --></div>");
      expect(meta.ref).toHaveProperty("a", 0);
      expect(meta.ref).toHaveProperty("b", 1);
      expect(meta.ref).toHaveProperty("c", 2);
      expect(meta.success).toBeTrue();
    });

    test("returns expected html for template with comment ref", () => {
      expect.assertions(2);
      const meta = compile("<div><!-- @a --></div>");
      expect(meta.html).toBe("<div><!></div>");
      expect(meta.success).toBeTrue();
    });

    test("returns expected html for template with multiline comment ref", () => {
      expect.assertions(2);
      const meta = compile("<div><!--\n@a\n--></div>");
      expect(meta.html).toBe("<div><!></div>");
      expect(meta.success).toBeTrue();
    });

    test("returns expected html for template with no whitespace comment ref", () => {
      expect.assertions(2);
      const meta = compile("<div><!--@a--></div>");
      expect(meta.html).toBe("<div><!></div>");
      expect(meta.success).toBeTrue();
    });

    test("returns expected html for template with only comment ref", () => {
      expect.assertions(2);
      const meta = compile("<!-- @a -->");
      expect(meta.html).toBe("<!>");
      expect(meta.success).toBeTrue();
    });
  });

  describe("keepSpaces option", () => {
    test("removes spaces between tags and text by default", () => {
      expect.assertions(2);
      const meta = compile(
        "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
      );
      expect(meta.html).toBe("<div>x</div>");
      expect(meta.success).toBeTrue();
    });

    test("keeps spaces between tags and text when option is true", () => {
      expect.assertions(2);
      const meta = compile(
        "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
        { keepSpaces: true },
      );
      expect(meta.html).toBe("<div> x </div>");
      expect(meta.success).toBeTrue();
    });

    test("removes spaces between tags and text when option is false", () => {
      expect.assertions(2);
      const meta = compile(
        "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
        { keepSpaces: false },
      );
      expect(meta.html).toBe("<div>x</div>");
      expect(meta.success).toBeTrue();
    });
  });
});
