import { describe, expect, expectTypeOf, spyOn, test } from "bun:test";
import { compile } from "../../src/macro.ts" with { type: "macro" };
import { compile as compileNoMacro } from "../../src/macro.ts";

describe("compile", () => {
  test("types", () => {
    expectTypeOf(compileNoMacro).not.toBeAny();
    expectTypeOf(compileNoMacro).toBeFunction();
    // @ts-expect-error - TODO: Fix this type instead of using parameter(n).
    expectTypeOf(compileNoMacro).parameters.toEqualTypeOf<
      [template: string, opts: { keepSpaces?: boolean } | undefined]
    >();
    // FIXME: The following type checks are broken on the latest bun versions.
    // expectTypeOf(compileNoMacro).parameter(0).toBeString();
    // expectTypeOf(compileNoMacro).parameter(1).toEqualTypeOf<{ keepSpaces?: boolean } | undefined>();
    // expectTypeOf(compileNoMacro).returns.not.toBeAny();
    // expectTypeOf(compileNoMacro).returns.omit("ref").toEqualTypeOf<{
    //   html: string;
    //   k: readonly string[];
    //   d: readonly number[];
    //   success: boolean;
    // }>();
    // expectTypeOf(compileNoMacro)
    //   .returns.toHaveProperty("ref")
    //   .toExtend<Record<string, `${number}`>>();
  });

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
    const meta = compile(/* html */ "<div></div>");
    expect(meta).toBePlainObject();
  });

  test('returns "html" property with string value', () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div></div>");
    expect(meta).toHaveProperty("html");
    expect(meta.html).toBeString();
  });

  test('returns "k" property with array value', () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div></div>");
    expect(meta).toHaveProperty("k");
    expect(meta.k).toBeArray();
  });

  test('returns "d" property with array value', () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div></div>");
    expect(meta).toHaveProperty("d");
    expect(meta.d).toBeArray();
  });

  test('returns "ref" property with object value', () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div></div>");
    expect(meta).toHaveProperty("ref");
    expect(meta.ref).toBePlainObject();
  });

  test('returns "success" property with boolean value', () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div></div>");
    expect(meta).toHaveProperty("success");
    expect(meta.success).toBeBoolean();
  });

  test("does not return any other properties", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div></div>");
    const properties = Object.keys(meta);
    expect(properties).toEqual(["html", "k", "d", "ref", "success"]);
    expect(properties).toHaveLength(5);
  });

  test("has empty k, d, and ref properties when no node refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
  });

  test("has 3 k, d, and ref properties when 3 node refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div @a><div @b></div><div @c></div></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 3 k, d, and ref properties when 3 node refs with whitespace", () => {
    expect.assertions(4);
    const meta = compile(/* html */ `
      <div>
        <div @a></div>
        <div @b></div>
        <div @c></div>
      </div>
    `);
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 3 k, d, and ref properties when 3 node refs with messy whitespace", () => {
    expect.assertions(4);
    const meta = compile(
      /* html */ "\n\n\t<div><div     @a  ></div> \t\t\n\n\n<div \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF @b></  div> <div @c></\n\tdiv>\n\n</div>\n",
    );
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 1 k, d, and ref properties when 1 text ref", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div>@a</div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  // TODO: Add documentation about this since it differs from the default compile.ts h() behaviour
  test("has 1 k, d, and ref properties when 1 text ref with whitespace", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div> @a</div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  // NOTE: Escaping is emergent, not implemented. A ref marker is only recognised
  // when "@" is the FIRST character, so a leading "\" is enough to opt out — but
  // nothing strips it, and the backslash survives verbatim into the output HTML.
  // The html assertions below pin that; see SPEC V4.

  test("has empty k, d, and ref properties when escaped node ref", () => {
    expect.assertions(5);
    const meta = compile(/* html */ "<div \\@a></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ "<div \\@a></div>");
  });

  test("has empty k, d, and ref properties when escaped text ref", () => {
    expect.assertions(5);
    const meta = compile(/* html */ "<div>\\@a</div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ "<div>\\@a</div>");
  });

  test("has empty k, d, and ref properties when escaped node ref with value", () => {
    expect.assertions(3);
    const meta = compile(/* html */ '<div \\@a="x"></div>');
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toBeEmpty();
    expect(meta.html).toBe(/* html */ '<div \\@a="x"></div>');
  });

  test("has empty k, d, and ref properties when marker is not the first character", () => {
    expect.assertions(3);
    const meta = compile(/* html */ "<div a\\@b></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.k).toBeEmpty();
    expect(meta.html).toBe(/* html */ "<div a\\@b></div>");
  });

  // NOTE: Several markers on one element is an error, but the first is still
  // used as the ref and every marker is stripped so none leaks into the output.
  test("uses the first ref marker when an element has several", () => {
    expect.assertions(3);
    const meta = compile(/* html */ "<div @a @b></div>");
    expect(meta.k).toEqual(["a"]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.html).toBe(/* html */ "<div></div>");
  });

  test("has correct meta ref properties when 3 node refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div @a><div @b></div><div @c></div></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
  });

  test("has correct meta ref properties when 3 node refs with whitespace", () => {
    expect.assertions(4);
    const meta = compile(/* html */ `
      <div>
        <div @a></div>
        <div @b></div>
        <div @c></div>
      </div>
    `);
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
  });

  test("has correct meta ref properties when 3 node refs with messy whitespace", () => {
    expect.assertions(4);
    const meta = compile(
      /* html */ "\n\n\t<div><div     @a  ></div> \t\t\n\n\n<div \f\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF @b></  div> <div @c></\n\tdiv>\n\n</div>\n",
    );
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
  });

  test("has correct meta ref properties when 1 text ref", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div>@a</div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.ref).toHaveProperty("a", 0);
  });

  test("has correct meta ref properties when 1 text ref with whitespace", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div> @a</div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.ref).toHaveProperty("a", 0);
  });

  // NOTE: A SINGLE backslash here is a JS useless-escape, so the string literal
  // is just "<div>@a</div>" — the escape never reaches compile(). This documents
  // that escaping must be written "\\@" in source to survive into the template;
  // the escape that does reach compile() is covered above. That is why this
  // otherwise reads as a duplicate of "…when 1 text ref".
  test("has correct meta ref properties when escaped node ref", () => {
    expect.assertions(2);
    // biome-ignore lint/suspicious/noUselessEscapeInString: explicitly testing
    const meta = compile(/* html */ "<div>\@a</div>"); // eslint-disable-line no-useless-escape
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.ref).toHaveProperty("a", 0);
  });

  test("has no meta ref properties when escaped text ref", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div>\\@a</div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.ref).toBeEmptyObject();
  });

  test("has no meta ref properties when html escaped @ text", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div>&#64;</div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.ref).toBeEmptyObject();
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
    expect(meta.html).toBe(
      /* html */ "<div><pre>\n          a\n           b\n          c\n\n\n          &lt;span&gt; Foo  &lt;/span&gt;\n        </pre><span>Bar</span><code>\n          &lt;span&gt;\n            Baz\n          &lt;/span&gt;\n        </code></div>",
    );
  });

  test("does not minify after a nested whitespace-sensitive block closes", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div><pre>a  b<code>c  d</code>  e  f</pre></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.html).toBe(/* html */ "<div><pre>a  b<code>c  d</code>  e  f</pre></div>");
  });

  // NOTE: Whitespace-only text is kept inside pre/code, so unlike elsewhere it
  // is a real node at runtime and must count towards the walk distance.
  test("counts kept whitespace-only text in a whitespace-sensitive block", () => {
    expect.assertions(3);
    const meta = compile(/* html */ "<div><pre>   </pre><!-- @a --></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.html).toBe(/* html */ "<div><pre>   </pre><!></div>");
    expect(meta.d).toEqual([3]);
  });

  test("does not minify in a textarea", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div><textarea>  a   b</textarea></div>");
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.html).toBe(/* html */ "<div><textarea>  a   b</textarea></div>");
  });

  // NOTE: Whitespace-sensitive blocks keep their text verbatim but are still
  // scanned for ref markers; only the raw text elements below opt out of refs.
  describe("refs in whitespace-sensitive blocks", () => {
    test("collects a text ref in a pre", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div><pre>@a</pre></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><pre> </pre></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([2]);
    });

    test("collects a text ref in a nested whitespace-sensitive block", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div><pre><code>@a</code></pre></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><pre><code> </code></pre></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([3]);
    });

    test("collects a text ref in a textarea", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div><textarea>@a</textarea></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><textarea> </textarea></div>");
      expect(meta.k).toEqual(["a"]);
    });

    test("collects a comment ref in a pre", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div><pre><!-- @a --></pre></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><pre><!></pre></div>");
      expect(meta.k).toEqual(["a"]);
    });
  });

  // NOTE: script/style content is raw text — it must never be minified, and a
  // leading "@" is a CSS at-rule or a JS decorator, never a ref marker.
  describe("raw text elements", () => {
    test("does not treat style text as a ref", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div><style>@a</style></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><style>@a</style></div>");
      expect(meta.k).toBeEmpty();
    });

    test("does not treat script text as a ref", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div><script>@a</script></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><script>@a</script></div>");
      expect(meta.k).toBeEmpty();
    });

    test("keeps style content verbatim", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div><style>@media print{a{color:red}}</style></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><style>@media print{a{color:red}}</style></div>");
      expect(meta.k).toBeEmpty();
    });

    test("keeps script content verbatim", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div><script>const a = 1;  const b = 2;</script></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><script>const a = 1;  const b = 2;</script></div>");
      expect(meta.k).toBeEmpty();
    });

    test("does not treat a script comment as a ref", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div><script><!-- @a --></script></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><script><!-- @a --></script></div>");
      expect(meta.k).toBeEmpty();
    });
  });

  // NOTE: A bare "<" which does not start a tag makes the tokenizer split one
  // Text node into several chunks, so each of these is a single node at runtime
  // and must be handled — and counted — exactly once.
  describe("text split across chunks", () => {
    test("keeps text either side of a bare less-than", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div>a < b</div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div>a < b</div>");
    });

    test("counts split text as one node", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div>a < b<!-- @x --></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div>a < b<!></div>");
      expect(meta.d).toEqual([2]);
    });

    test("counts split text in a nested element as one node", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<div><b>i < 10</b><!-- @x --></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><b>i < 10</b><!></div>");
      expect(meta.d).toEqual([3]);
    });
  });

  // NOTE: Void and self-closing elements have no end tag, so the root element
  // check must not try to hook one — it used to throw "No end tag.".
  describe("void root element", () => {
    test("compiles a void root element with a ref", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<input @a>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<input>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([0]);
    });

    test("compiles a self-closing root element", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<svg/>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<svg/>");
    });
  });

  // NOTE: A DOM <template> keeps its children in .content, so the collect()
  // walk cannot enter it and every distance past it would be wrong. Rejecting
  // it here turns a runtime crash into a build error. Empty templates are not
  // special-cased — they only happen to work.
  describe("template element", () => {
    test("logs error for a nested template element", () => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div><template><span @a></span></template><b @b></b></div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith(
        "Found unsupported <template> element in template:",
        template,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    test("returns success false for a nested template element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div><template><span @a></span></template><b @b></b></div>");
      expect(meta.success).toBeFalse();
    });

    test("returns success false for a root template element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<template><div @a></div></template>");
      expect(meta.success).toBeFalse();
    });

    test("returns success false for an empty template element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div><template></template></div>");
      expect(meta.success).toBeFalse();
    });

    test("returns success true without a template element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div><span @a></span><b @b></b></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    });
  });

  // NOTE: In HTML content the parser IGNORES a self-closing slash, so <div/> is
  // an open <div> and whatever follows is its child, not a second root. Only
  // foreign content (e.g. <svg/>) really self-closes. HTMLRewriter reports
  // selfClosing true for both, so it must not be treated as "has no end tag".
  describe("self-closing slash in HTML content", () => {
    test("does not treat a slashed element as a closed root", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div/><span></span>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div/><span></span>");
    });

    test("collects refs across a slashed element", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div @a/><span @b></span>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div/><span></span>");
      expect(meta.k).toEqual(["a", "b"]);
      expect(meta.d).toEqual([0, 1]);
    });

    test("does not treat a slashed unknown element as a closed root", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<circle/><div></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    });

    test("keeps whitespace after a slashed pre", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<pre/>a  b");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<pre/>a  b");
    });

    test("keeps a slashed script raw", () => {
      expect.assertions(3);
      const meta = compile(/* html */ "<script/>@media a  b");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<script/>@media a  b");
      expect(meta.k).toBeEmpty();
    });

    // ↳ Foreign content DOES self-close, so this must still be two roots.
    test("still reports multiple roots for a self-closing foreign element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<svg/><span></span>");
      expect(meta.success).toBeFalse();
    });
  });

  // FIXME: Uncomment once bun string handling in macros bug is fixed.
  // ↳ Currently blocked by bun bug; https://github.com/oven-sh/bun/issues/3832
  // test("does not escape HTML entities", () => {
  //   expect.assertions(2);
  //   const template = /* html */ "<div>&lt;span&gt;Foo&lt;/span&gt;</div>";
  //   const meta = compile(template);
  //   expect(meta.html).toBe(template);
  //   expect(meta.success).toBeTrue();
  // });

  describe("errors", () => {
    test("logs error when more than one root element", () => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div></div><div></div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith(
        "Expected template to have a single root element:",
        template,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    // NOTE: Only one end tag handler can be registered per element, so the root
    // element check and the whitespace-sensitive block check have to share one.
    test("logs error when more than one root element and the root is a pre", () => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<pre>a</pre><div>b</div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith(
        "Expected template to have a single root element:",
        template,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    test("logs error when more than one root element and the root is void", () => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<input><input>";
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
      const template = /* html */ "<!DOCTYPE html><div></div>";
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
      const template = /* html */ "<div><span>@a</span><span>@a</span></div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith('Duplicate ref name "a" in template:', template);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    test("logs error for each duplicate ref key", () => {
      expect.assertions(3);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div>@a<span>@a</span><span @b-two></span><span>@a</span></div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith('Duplicate ref name "a" in template:', template);
      expect(spy).not.toHaveBeenCalledWith('Duplicate ref name "b-two" in template:', template);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    test("logs error when an element has multiple ref markers", () => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div @a @b></div>";
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith(
        "Found multiple ref markers on a single element in template:",
        template,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    // NOTE: Ref names must be lowercase because browsers normalise element
    // attribute names when rendering HTML (README:72). Attribute names reach
    // the macro already lowercased by HTMLRewriter, so a non-lowercase name can
    // only be caught in text and comment position.
    const invalidRefNames: [template: string, name: string][] = [
      /* eslint-disable array-bracket-spacing */
      [/* html */ "<div @></div>", ""],
      [/* html */ "<div>@</div>", ""],
      [/* html */ "<!-- @ -->", ""],
      [/* html */ "<div>@a and more</div>", "a and more"],
      [/* html */ "<div><!-- @a extra --></div>", "a extra"],
      [/* html */ "<div>@Foo</div>", "Foo"],
      [/* html */ "<div>@1a</div>", "1a"],
      /* eslint-enable array-bracket-spacing */
    ];

    test.each(invalidRefNames)("logs error for invalid ref name in %j", (template, name) => {
      expect.assertions(2);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      compileNoMacro(template);
      expect(spy).toHaveBeenCalledWith(`Invalid ref name "${name}" in template:`, template);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    test.each(invalidRefNames)("returns success false for invalid ref name in %j", (template) => {
      expect.assertions(1);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      expect(compileNoMacro(template).success).toBeFalse();
      spy.mockRestore();
    });

    test("returns success false when more than one root element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div></div><div></div>");
      expect(meta.success).toBeFalse();
    });

    test("returns success false when an element has multiple ref markers", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div @a @b></div>");
      expect(meta.success).toBeFalse();
    });

    test("returns success false when doctype found", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<!DOCTYPE html><div></div>");
      expect(meta.success).toBeFalse();
    });

    test("returns success false when duplicate ref keys found", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div><span>@a</span><span>@a</span></div>");
      expect(meta.success).toBeFalse();
    });
  });

  test("returns expected html for basic template", () => {
    expect.assertions(2);
    const meta = compile(/* html */ `
      <ul>
        <li>A</li>
        <li>B</li>
        <li>C</li>
      </ul>
    `);
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.html).toBe(/* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>");
  });

  // TODO: Test once lol-html (which powers bun's HTMLRewriter) fix their whitespace handling.
  // biome-ignore lint/suspicious/noSkippedTests: blocked on the lol-html bug noted above
  test.skip("returns expected html for basic template with messy whitespace", () => {
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
    expect(meta.html).toBe(/* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>");
  });

  test("returns expected html for SVG template", () => {
    expect.assertions(2);
    const meta = compile(/* html */ `
      <svg>
        <circle cx=10 cy='10' r="10" />
      </svg>
    `);
    expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
    expect(meta.html).toBe(/* html */ "<svg><circle cx=10 cy='10' r=\"10\" /></svg>");
  });

  describe("comments", () => {
    test("removes comments", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div><!-- comment --></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div></div>");
    });

    test("removes multiple comments", () => {
      expect.assertions(2);
      const meta = compile(
        /* html */ "<div><!-- comment --><!-- comment --><!-- comment --></div>",
      );
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div></div>");
    });

    test("removes comment when template is only comment", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<!-- comment -->");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "");
    });

    test.each([
      /* html */ "<div><!-- comment --></div>",
      /* html */ "<div><!-- --></div>",
      /* html */ "<div><!--  --></div>",
      /* html */ "<div><!--   --></div>",
      /* html */ "<div><!-----></div>",
      /* html */ "<div><!----></div>",
      /* html */ "<div><!---></div>",
      /* html */ "<div><!--></div>",
      /* html */ "<div><!-></div>",
      /* html */ "<div><!></div>",
      /* html */ "<div><!-- <!-- --></div>",
      /* html */ "<div><!--  \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF --></div>",
      /* html */ "<div><!-- comment --!></div>",
      /* html */ "<div><!--   --!></div>",
      /* html */ "<div><!--  --!></div>",
      /* html */ "<div><!-- --!></div>",
      /* html */ "<div><!-----!></div>",
      /* html */ "<div><!----!></div>",
      // /* html */ "<div><!---!></div>", // TODO: Broken; bug in lol-html.
      // /* html */ "<div><!--!></div>", // TODO: Broken; bug in lol-html.
      /* html */ "<div><!-!></div>",
      /* html */ "<div><!!></div>",
      /* html */ "<div><!-- !-----></div>",
      /* html */ "<div><!-- !----></div>",
      /* html */ "<div><!-- !---></div>",
      /* html */ "<div><!-- !--></div>",
      /* html */ "<div><!-- <div> --></div>",
      /* html */ "<div><!-- </div> --></div>",
      /* html */ "<div><!-- <div></div> --></div>",
      /* html */ "<div><!--<div>--></div>",
      /* html */ "<div><!--</div>--></div>",
      /* html */ "<div><!--<div></div>--></div>",
      /* html */ "<div><!bogus></div>", // https://html.spec.whatwg.org/#bogus-comment-state
    ])("removes comment for %j", (template) => {
      expect.assertions(2);
      const meta = compileNoMacro(template);
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div></div>");
    });

    test("removes comments for complex mixed template", () => {
      expect.assertions(2);
      const meta = compile(/* html */ `
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
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><span></span><span></span></div>");
    });

    test("has 1 k, d, and ref properties when 1 comment ref", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div><!-- @a --></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.k).toHaveLength(1);
      expect(meta.d).toHaveLength(1);
      expect(Object.keys(meta.ref)).toHaveLength(1);
    });

    test("has 3 k, d, and ref properties when 3 comment refs", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div><!-- @a --><!-- @b --><!-- @c --></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.k).toHaveLength(3);
      expect(meta.d).toHaveLength(3);
      expect(Object.keys(meta.ref)).toHaveLength(3);
    });

    test("has correct meta ref properties when 3 comment refs", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div><!-- @a --><!-- @b --><!-- @c --></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.ref).toHaveProperty("a", 0);
      expect(meta.ref).toHaveProperty("b", 1);
      expect(meta.ref).toHaveProperty("c", 2);
    });

    test("returns expected html for template with comment ref", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div><!-- @a --></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><!></div>");
    });

    test("returns expected html for template with multiline comment ref", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div><!--\n@a\n--></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><!></div>");
    });

    test("returns expected html for template with no whitespace comment ref", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div><!--@a--></div>");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div><!></div>");
    });

    test("returns expected html for template with only comment ref", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<!-- @a -->");
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<!>");
    });
  });

  describe("keepSpaces option", () => {
    test("removes spaces between tags and text by default", () => {
      expect.assertions(2);
      const meta = compile(
        /* html */ "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
      );
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div>x</div>");
    });

    test("keeps spaces between tags and text when option is true", () => {
      expect.assertions(2);
      const meta = compile(
        /* html */ "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
        { keepSpaces: true },
      );
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div> x </div>");
    });

    test("removes spaces between tags and text when option is false", () => {
      expect.assertions(2);
      const meta = compile(
        /* html */ "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
        { keepSpaces: false },
      );
      expect(meta.success).toBeTrue(); // guard: assertions below mean nothing if compile failed
      expect(meta.html).toBe(/* html */ "<div>x</div>");
    });
  });
});

// These tests do not exercise compile(); they pin the bun/lol-html HTMLRewriter
// behaviours src/macro.ts is built around. None of them are documented by bun,
// so each test names the code which depends on it — when one fails after a bun
// upgrade it points straight at what needs revisiting.
describe("HTMLRewriter", () => {
  describe("text chunking", () => {
    // ↳ macro.ts buffers text chunks because of this; see SPEC V6b.
    test("splits a text node on a bare less-than", () => {
      expect.assertions(1);
      const chunks: [text: string, lastInTextNode: boolean][] = [];
      new HTMLRewriter()
        .onDocument({
          text(chunk) {
            chunks.push([chunk.text, chunk.lastInTextNode]);
          },
        })
        .transform(/* html */ "<div>a < b</div>");
      expect(chunks).toEqual([
        ["a ", false],
        ["<", false],
        [" b", false],
        ["", true],
      ]);
    });

    // NOTE: Splitting is tokenizer driven, not size or stream driven, so a big
    // template does not make it more likely — and buffering cannot be skipped
    // for small ones.
    test("does not split on size", () => {
      expect.assertions(1);
      let chunks = 0;
      new HTMLRewriter()
        .onDocument({
          text(chunk) {
            if (!chunk.lastInTextNode) chunks++;
          },
        })
        .transform(/* html */ `<div>${"y".repeat(1e6)}</div>`);
      expect(chunks).toBe(1);
    });

    test.each([
      /* eslint-disable array-bracket-spacing */
      [/* html */ "<div>a &lt; b</div>"],
      [/* html */ "<div>a && b</div>"],
      [/* html */ "<div>a --> b</div>"],
      [/* html */ "<div>a </ b</div>"],
      [/* html */ "<div>a <! b</div>"],
      /* eslint-enable array-bracket-spacing */
    ])("does not split %j", (template) => {
      expect.assertions(1);
      let chunks = 0;
      new HTMLRewriter()
        .onDocument({
          text(chunk) {
            if (!chunk.lastInTextNode) chunks++;
          },
        })
        .transform(template);
      expect(chunks).toBe(1);
    });

    // ↳ macro.ts flushes its buffer on the last chunk, so there must be exactly
    // one per text node.
    test("terminates every text node with one empty last chunk", () => {
      expect.assertions(1);
      const flags: boolean[] = [];
      new HTMLRewriter()
        .onDocument({
          text(chunk) {
            flags.push(chunk.lastInTextNode);
          },
        })
        .transform(/* html */ "<div>a<span>b</span>c</div>");
      expect(flags).toEqual([false, true, false, true, false, true]);
    });

    // ↳ macro.ts uses a single shared buffer; interleaving would corrupt it.
    test("flushes all chunks of a text node before the next element", () => {
      expect.assertions(1);
      const sequence: string[] = [];
      new HTMLRewriter()
        .onDocument({
          text(chunk) {
            sequence.push(chunk.lastInTextNode ? "END" : `t:${chunk.text}`);
          },
        })
        .on("*", {
          element(node) {
            sequence.push(`el:${node.tagName}`);
          },
        })
        .transform(/* html */ "<div>a < b<span>c</span></div>");
      expect(sequence).toEqual(["el:div", "t:a ", "t:<", "t: b", "END", "el:span", "t:c", "END"]);
    });

    // ↳ macro.ts removes every non-last chunk then writes the whole node to the
    // last one, which is empty; the replacement must land in the right place.
    test("reinserts at the right position when replacing the last chunk", () => {
      expect.assertions(1);
      let buffer = "";
      const html = new HTMLRewriter()
        .onDocument({
          text(chunk) {
            buffer += chunk.text;
            if (!chunk.lastInTextNode) {
              chunk.remove();
              return;
            }
            const text = buffer;
            buffer = "";
            chunk.replace(`[${text}]`, { html: true });
          },
        })
        .transform(/* html */ "<div>a < b<span>c</span></div>");
      expect(html).toBe(/* html */ "<div>[a < b]<span>[c]</span></div>");
    });
  });

  describe("end tag handlers", () => {
    // ↳ macro.ts unwinds the root, verbatim and raw state in ONE shared handler
    // because of this.
    test("replaces a previously registered handler", () => {
      expect.assertions(1);
      const fired: string[] = [];
      new HTMLRewriter()
        .on("*", {
          element(node) {
            node.onEndTag(() => {
              fired.push("first");
            });
            node.onEndTag(() => {
              fired.push("second");
            });
          },
        })
        .transform(/* html */ "<div>x</div>");
      expect(fired).toEqual(["second"]);
    });

    // ↳ ...and it clobbers across separate .on() calls too, which is why the
    // per-concern handler split is not possible.
    test("replaces a handler registered by another on() handler", () => {
      expect.assertions(1);
      const fired: string[] = [];
      new HTMLRewriter()
        .on("*", {
          element(node) {
            node.onEndTag(() => {
              fired.push("star");
            });
          },
        })
        .on("pre", {
          element(node) {
            node.onEndTag(() => {
              fired.push("pre");
            });
          },
        })
        .transform(/* html */ "<pre>x</pre>");
      expect(fired).toEqual(["pre"]);
    });

    // ↳ macro.ts guards onEndTag with `canHaveContent`; without it a void root
    // element throws "No end tag." and fails the build. Throwing correlates
    // with `canHaveContent` ALONE — `selfClosing` plays no part, as the last
    // two rows show — which is why the guard must not consult it.
    test.each([
      /* eslint-disable array-bracket-spacing */
      [/* html */ "<div></div>", true, false, false],
      [/* html */ "<input>", false, false, true],
      [/* html */ "<br>", false, false, true],
      [/* html */ "<svg/>", false, true, true],
      [/* html */ "<div/>", true, true, false],
      [/* html */ "<p/>", true, true, false],
      /* eslint-enable array-bracket-spacing */
    ])(
      "throws for %j when it has no end tag",
      (template, canHaveContent, selfClosing, shouldThrow) => {
        expect.assertions(3);
        let didThrow = false;
        new HTMLRewriter()
          .on("*", {
            element(node) {
              expect(node.canHaveContent).toBe(canHaveContent);
              expect(node.selfClosing).toBe(selfClosing);
              try {
                node.onEndTag(() => {});
              } catch {
                didThrow = true;
              }
            },
          })
          .transform(template);
        expect(didThrow).toBe(shouldThrow);
      },
    );

    // NOTE: An element written with a self-closing slash accepts an end tag
    // handler but never fires it, since no end tag follows. That leaves
    // macro.ts's insideRoot set for the rest of the template — which is
    // CORRECT, because the HTML parser ignores "/>" here and keeps the element
    // open too, making everything after it a child rather than a second root.
    test("never fires for an element written with a self-closing slash", () => {
      expect.assertions(3);
      let wasFired = false;
      new HTMLRewriter()
        .on("*", {
          element(node) {
            expect(node.canHaveContent).toBeTrue();
            expect(node.selfClosing).toBeTrue();
            node.onEndTag(() => {
              wasFired = true;
            });
          },
        })
        .transform(/* html */ "<div/>");
      expect(wasFired).toBeFalse();
    });

    // ↳ macro.ts decrements verbatimDepth in an end tag handler, so an unclosed
    // <pre> must not leak the state to the rest of the template.
    test("fires for implied end tags", () => {
      expect.assertions(1);
      const fired: string[] = [];
      new HTMLRewriter()
        .on("*", {
          element(node) {
            const { tagName } = node;
            if (node.canHaveContent && !node.selfClosing) {
              node.onEndTag(() => {
                fired.push(tagName);
              });
            }
          },
        })
        .transform(/* html */ "<div><pre>a</div>");
      expect(fired).toEqual(["pre", "div"]);
    });
  });

  describe("attributes", () => {
    // ↳ macro.ts collects ref markers into an array BEFORE removing any,
    // because removing one aborts the iteration.
    test("truncates iteration when an attribute is removed", () => {
      expect.assertions(2);
      const iterated: string[] = [];
      const html = new HTMLRewriter()
        .on("*", {
          element(node) {
            for (const [name] of node.attributes) {
              iterated.push(name);
              if (name[0] === "@") node.removeAttribute(name);
            }
          },
        })
        .transform(/* html */ "<div @a x=1 @b y=2 @c></div>");
      expect(iterated).toEqual(["@a"]);
      expect(html).toBe(/* html */ "<div x=1 @b y=2 @c></div>");
    });

    // NOTE: This is why REF_NAME_RE's lowercase rule can only be violated in
    // text or comment position; see SPEC V19.
    test("lowercases attribute names", () => {
      expect.assertions(1);
      let names: string[] = [];
      new HTMLRewriter()
        .on("*", {
          element(node) {
            names = [...node.attributes].map(([name]) => name);
          },
        })
        .transform(/* html */ '<div @Foo DATA-Bar="x"></div>');
      expect(names).toEqual(["@foo", "data-bar"]);
    });
  });

  describe("comments and doctype", () => {
    // ↳ macro.ts turns a comment ref into <!> this way.
    test("allows after() on a removed comment", () => {
      expect.assertions(1);
      const html = new HTMLRewriter()
        .onDocument({
          comments(node) {
            node.remove();
            node.after(/* html */ "<!>", { html: true });
          },
        })
        .transform(/* html */ "<div><!-- @a --></div>");
      expect(html).toBe(/* html */ "<div><!></div>");
    });

    // ↳ A doctype is reported wherever it appears, so macro.ts cannot swap the
    // handler for a regex anchored to the start of the template.
    test.each([
      /* eslint-disable array-bracket-spacing */
      [/* html */ "<!DOCTYPE html><div></div>"],
      [/* html */ "<div><!DOCTYPE html></div>"],
      [/* html */ "<div></div><!DOCTYPE html>"],
      /* eslint-enable array-bracket-spacing */
    ])("reports a doctype in %j", (template) => {
      expect.assertions(1);
      let found = 0;
      new HTMLRewriter()
        .onDocument({
          doctype() {
            found++;
          },
        })
        .transform(template);
      expect(found).toBe(1);
    });
  });
});
