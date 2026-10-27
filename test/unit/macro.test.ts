/* eslint-disable unicorn/prefer-literal-ascii */

import { describe, expect, expectTypeOf, onTestFinished, spyOn, test } from "bun:test";
import { compile } from "../../src/macro.ts" with { type: "macro" };
import {
  compile as compileNoMacro,
  type CompileOptions,
  type CompileResult,
} from "../../src/macro.ts";
import type { InferRefs, Refs } from "../../src/types.ts";

describe("compile", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(compileNoMacro).not.toBeAny();
    expectTypeOf(compileNoMacro).toBeFunction();
    // `?:` and `| undefined` are both required under `exactOptionalPropertyTypes`.
    expectTypeOf(compileNoMacro).parameters.toEqualTypeOf<
      [template: string, options?: CompileOptions | undefined]
    >();
    expectTypeOf(compileNoMacro).returns.not.toBeAny();
    expectTypeOf(compileNoMacro).returns.not.toBeNever();
    // Erased: `R` resolves to its `Refs<R>` constraint.
    expectTypeOf(compileNoMacro).returns.toEqualTypeOf<CompileResult<Refs>>();
    expectTypeOf(compileNoMacro).returns.toEqualTypeOf<{
      html: string;
      k: readonly string[];
      d: readonly number[] & InferRefs<Refs>;
      ref: Readonly<Record<string, `@${string}`>>;
      success: boolean;
    }>();
    // The `= object` default applies only at a call site.
    expectTypeOf(() => compileNoMacro("")).returns.toEqualTypeOf<CompileResult<object>>();

    // Interfaces have no implicit index signature, so `R extends Refs` alone would reject them.
    interface FooBar {
      foo: HTMLDivElement;
      bar: Text;
    }
    expectTypeOf(compileNoMacro<FooBar>).returns.toEqualTypeOf<CompileResult<FooBar>>();
    // `d` carries `R` so `collect()` can infer it.
    expectTypeOf<CompileResult<FooBar>["d"]>().toEqualTypeOf<
      readonly number[] & InferRefs<FooBar>
    >();
    // Name-keyed, not ordinal, so `Refs` key order cannot leak into the type.
    expectTypeOf<CompileResult<FooBar>["ref"]>().toEqualTypeOf<{
      readonly bar: "@bar";
      readonly foo: "@foo";
    }>();
    // @ts-expect-error - ref values must be Nodes
    expectTypeOf(compileNoMacro<{ foo: string }>);
    // @ts-expect-error - ref names must be lowercase; browsers normalise attribute names
    expectTypeOf(compileNoMacro<{ Foo: HTMLDivElement }>);
    // @ts-expect-error - regression: a lowercase twin key must not let an uppercase one pass
    expectTypeOf(compileNoMacro<{ foo: Text; Foo: Comment }>);
    // @ts-expect-error - regression: ref names must be strings; numeric keys were dropped
    expectTypeOf(compileNoMacro<{ 1: Text }>);
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
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
  });

  test("has empty k, d, and ref properties when no text refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div>a</div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
  });

  test("has empty k, d, and ref properties when no comment refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div><!-- a --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
  });

  test("has 1 k, d, and ref properties when 1 node ref", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div @a></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test("has 1 k, d, and ref properties when 1 text ref", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div>@a</div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test("has 1 k, d, and ref properties when 1 comment ref", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div><!-- @a --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test("has 1 k, d, and ref properties when 1 text ref with whitespace", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div> @a</div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test("has 1 k, d, and ref properties when 1 comment ref with whitespace", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div><!--  @a --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(1);
    expect(meta.d).toHaveLength(1);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test("has 3 k, d, and ref properties when 3 node refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div @a><div @b></div><div @c></div></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 3 k, d, and ref properties when 3 text refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div>@a<div>@b</div><div>@c</div></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 3 k, d, and ref properties when 3 comment refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div><!-- @a --><!-- @b --><!-- @c --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 3 k, d, and ref properties when node + text + comment refs", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div @a><div>@b</div><!-- @c --></div>");
    expect(meta.success).toBeTrue();
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
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 3 k, d, and ref properties when 3 text refs with whitespace", () => {
    expect.assertions(4);
    const meta = compile(/* html */ `
      <div>
        <div> @a</div>
        <div>@b </div>
        <div>
          @c
        </div>
      </div>
    `);
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 3 k, d, and ref properties when 3 comment refs with whitespace", () => {
    expect.assertions(4);
    const meta = compile(/* html */ `
      <div>
        <div><!--  @a --></div>
        <div><!-- @b  --></div>
        <div><!--
          @c
        --></div>
      </div>
    `);
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has 3 k, d, and ref properties when 3 node refs with messy whitespace", () => {
    expect.assertions(4);
    const meta = compile(
      /* html */ "\n\n\t<div><div     @a  ></div> \t\t\n\n\n<div \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF @b></  div> <div @c></\n\tdiv>\n\n</div>\n",
    );
    expect(meta.success).toBeTrue();
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  // Escaping is emergent: "@" is a marker only as the first character, and nothing strips the backslash.

  test("has empty k, d, and ref properties when escaped node ref", () => {
    expect.assertions(5);
    const meta = compile(/* html */ "<div \\@a></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ "<div \\@a></div>");
  });

  test("has empty k, d, and ref properties when escaped text ref", () => {
    expect.assertions(5);
    const meta = compile(/* html */ "<div>\\@a</div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ "<div>\\@a</div>");
  });

  test("has empty k, d, and ref properties when escaped comment ref", () => {
    expect.assertions(5);
    const meta = compile(/* html */ "<div><!-- \\@a --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ "<div></div>");
  });

  test("has empty k, d, and ref properties when escaped node ref with value", () => {
    expect.assertions(5);
    const meta = compile(/* html */ '<div \\@a="x"></div>');
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ '<div \\@a="x"></div>');
  });

  test("has empty k, d, and ref properties when html escaped @ text", () => {
    expect.assertions(5);
    const meta = compile(/* html */ "<div>&#64;</div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ "<div>&#64;</div>");
  });

  test("has empty k, d, and ref properties when node marker is not the first character", () => {
    expect.assertions(5);
    const meta = compile(/* html */ "<div a@b></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ "<div a@b></div>");
  });

  test("has empty k, d, and ref properties when text marker is not the first character", () => {
    expect.assertions(5);
    const meta = compile(/* html */ "<div>a@b</div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.ref).toBeEmptyObject();
    expect(meta.html).toBe(/* html */ "<div>a@b</div>");
  });

  test("has empty k, d, and ref properties when comment marker is not the first character", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div><!-- a@b --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toBeEmpty();
    expect(meta.d).toBeEmpty();
    expect(meta.html).toBe(/* html */ "<div></div>");
  });

  test("uses the last node ref when an element has several", () => {
    expect.assertions(4);
    const meta = compile(/* html */ "<div @a @b></div>");
    expect(meta.k).toEqual(["b"]);
    expect(meta.d).toEqual([0]);
    expect(meta.ref).toHaveProperty("b", 0);
    expect(meta.html).toBe(/* html */ "<div></div>");
  });

  // HTMLRewriter lowercases attribute names, so a node ref name can't be non-lowercase.
  // eslint-disable-next-line array-bracket-spacing
  test.each([/* html */ "<div @Foo></div>", /* html */ "<div @fOo></div>"])(
    "lowercases the node ref name in %j",
    (template) => {
      expect.assertions(2);
      const meta = compileNoMacro(template);
      expect(meta.success).toBeTrue();
      expect(meta.k).toEqual(["foo"]);
    },
  );

  const invalidRefNames = ["", "1", "_", "-", "@", "🙂"];
  const validRefNames = ["a1", "a_", "a-", "a1_-"];

  // Invalid names still compile fully, with success false, so the output can be debugged.
  // Serial: spies on the global console.error.
  describe.serial.each(invalidRefNames)('invalid ref name "%s"', (refName) => {
    test("collects node ref", () => {
      expect.assertions(5);
      // oxlint-disable-next-line no-underscore-dangle
      using _consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const meta = compileNoMacro(/* html */ `<div @${refName}></div>`);
      expect(meta.success).toBeFalse();
      expect(meta.k).toEqual([refName]);
      expect(meta.d).toEqual([0]);
      expect(meta.ref).toEqual({ [refName]: 0 });
      expect(meta.html).toBe(/* html */ "<div></div>");
    });

    test("collects text ref", () => {
      expect.assertions(5);
      // oxlint-disable-next-line no-underscore-dangle
      using _consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const meta = compileNoMacro(/* html */ `<div>@${refName}</div>`);
      expect(meta.success).toBeFalse();
      expect(meta.k).toEqual([refName]);
      expect(meta.d).toEqual([1]);
      expect(meta.ref).toEqual({ [refName]: 0 });
      expect(meta.html).toBe(/* html */ "<div> </div>");
    });

    test("collects comment ref", () => {
      expect.assertions(5);
      // oxlint-disable-next-line no-underscore-dangle
      using _consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const meta = compileNoMacro(/* html */ `<div><!-- @${refName} --></div>`);
      expect(meta.success).toBeFalse();
      expect(meta.k).toEqual([refName]);
      expect(meta.d).toEqual([1]);
      expect(meta.ref).toEqual({ [refName]: 0 });
      expect(meta.html).toBe(/* html */ "<div><!></div>");
    });
  });

  describe.each(validRefNames)('valid ref name "%s"', (refName) => {
    test("collects node ref", () => {
      expect.assertions(5);
      const meta = compileNoMacro(/* html */ `<div @${refName}></div>`);
      expect(meta.success).toBeTrue();
      expect(meta.k).toEqual([refName]);
      expect(meta.d).toEqual([0]);
      expect(meta.ref).toEqual({ [refName]: 0 });
      expect(meta.html).toBe(/* html */ "<div></div>");
    });

    test("collects text ref", () => {
      expect.assertions(5);
      const meta = compileNoMacro(/* html */ `<div>@${refName}</div>`);
      expect(meta.success).toBeTrue();
      expect(meta.k).toEqual([refName]);
      expect(meta.d).toEqual([1]);
      expect(meta.ref).toEqual({ [refName]: 0 });
      expect(meta.html).toBe(/* html */ "<div> </div>");
    });

    test("collects comment ref", () => {
      expect.assertions(5);
      const meta = compileNoMacro(/* html */ `<div><!-- @${refName} --></div>`);
      expect(meta.success).toBeTrue();
      expect(meta.k).toEqual([refName]);
      expect(meta.d).toEqual([1]);
      expect(meta.ref).toEqual({ [refName]: 0 });
      expect(meta.html).toBe(/* html */ "<div><!></div>");
    });
  });

  test("collects node ref with value", () => {
    expect.assertions(5);
    const meta = compileNoMacro(/* html */ '<div @a="x"></div>');
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a"]);
    expect(meta.d).toEqual([0]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.html).toBe(/* html */ "<div></div>");
  });

  test("has correct meta properties when 3 node refs", () => {
    expect.assertions(7);
    const meta = compile(/* html */ "<div @a><div @b></div><div @c></div></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a", "b", "c"]);
    expect(meta.d).toEqual([0, 1, 1]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has correct meta properties when 3 text refs", () => {
    expect.assertions(7);
    const meta = compile(/* html */ "<div>@a<div>@b</div><div>@c</div></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a", "b", "c"]);
    expect(meta.d).toEqual([1, 2, 2]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has correct meta properties when 3 comment refs", () => {
    expect.assertions(7);
    const meta = compile(/* html */ "<div><!-- @a --><!-- @b --><!-- @c --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a", "b", "c"]);
    expect(meta.d).toEqual([1, 1, 1]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has correct meta properties when node + text + comment refs", () => {
    expect.assertions(7);
    const meta = compile(/* html */ "<div @a><div>@b</div><!-- @c --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a", "b", "c"]);
    expect(meta.d).toEqual([0, 2, 1]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has correct meta properties when 3 node refs with whitespace", () => {
    expect.assertions(7);
    const meta = compile(/* html */ `
      <div>
        <div @a></div>
        <div @b></div>
        <div @c></div>
      </div>
    `);
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a", "b", "c"]);
    expect(meta.d).toEqual([1, 1, 1]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has correct meta properties when 3 text refs with whitespace", () => {
    expect.assertions(7);
    const meta = compile(/* html */ `
      <div>
        <div> @a</div>
        <div>@b </div>
        <div>
          @c
        </div>
      </div>
    `);
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a", "b", "c"]);
    expect(meta.d).toEqual([2, 2, 2]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has correct meta properties when 3 comment refs with whitespace", () => {
    expect.assertions(7);
    const meta = compile(/* html */ `
      <div>
        <div><!--  @a --></div>
        <div><!-- @b  --></div>
        <div><!--
          @c
        --></div>
      </div>
    `);
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a", "b", "c"]);
    expect(meta.d).toEqual([2, 2, 2]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  test("has correct meta properties when 3 node refs with messy whitespace", () => {
    expect.assertions(7);
    const meta = compile(
      /* html */ "\n\n\t<div><div     @a  ></div> \t\t\n\n\n<div \f\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF @b></  div> <div @c></\n\tdiv>\n\n</div>\n",
    );
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a", "b", "c"]);
    expect(meta.d).toEqual([1, 1, 1]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(meta.ref).toHaveProperty("b", 1);
    expect(meta.ref).toHaveProperty("c", 2);
    expect(Object.keys(meta.ref)).toHaveLength(3);
  });

  // A single backslash is a useless JS escape, so these templates contain a plain "@a".
  test("has correct meta properties when wrong escaped node ref", () => {
    expect.assertions(5);
    // oxlint-disable-next-line no-useless-escape
    const meta = compile(/* html */ "<div \@a></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a"]);
    expect(meta.d).toEqual([0]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test("has correct meta properties when wrong escaped text ref", () => {
    expect.assertions(5);
    // oxlint-disable-next-line no-useless-escape
    const meta = compile(/* html */ "<div>\@a</div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a"]);
    expect(meta.d).toEqual([1]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  test("has correct meta properties when wrong escaped comment ref", () => {
    expect.assertions(5);
    // oxlint-disable-next-line no-useless-escape
    const meta = compile(/* html */ "<div><!-- \@a --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.k).toEqual(["a"]);
    expect(meta.d).toEqual([1]);
    expect(meta.ref).toHaveProperty("a", 0);
    expect(Object.keys(meta.ref)).toHaveLength(1);
  });

  describe("comments", () => {
    test("removes comments", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div><!-- comment --></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div></div>");
    });

    test("removes multiple comments", () => {
      expect.assertions(2);
      const meta = compile(
        /* html */ "<div><!-- comment --><!-- comment --><!-- comment --></div>",
      );
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div></div>");
    });

    test("removes comment when template is only comment", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<!-- comment -->");
      expect(meta.success).toBeFalse(); // empty html string is invalid
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
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div></div>");
    });

    // Characterization: per the WHATWG comment start states these never close, so the comment runs to the end.
    // eslint-disable-next-line array-bracket-spacing
    test.each([/* html */ "<div><!---!></div>", /* html */ "<div><!--!></div>"])(
      "removes the rest of the template after the unclosed comment in %j",
      (template) => {
        expect.assertions(2);
        const meta = compileNoMacro(template);
        expect(meta.success).toBeTrue();
        expect(meta.html).toBe(/* html */ "<div>");
      },
    );

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
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><span></span><span></span></div>");
    });

    test("returns expected html for template with comment ref", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div><!-- @a --></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><!></div>");
    });

    test("returns expected html for template with multiline comment ref", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div><!--\n@a\n--></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><!></div>");
    });

    test("returns expected html for template with no whitespace comment ref", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div><!--@a--></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><!></div>");
    });

    test("returns expected html for template with only comment ref", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<!-- @a -->");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<!>");
    });

    // Regression: a second top-level comment ref was accepted as a second root.
    test("returns success false for two top-level comment refs", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<!-- @a --><!-- @b -->");
      expect(meta.success).toBeFalse();
    });
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
    expect(meta.success).toBeTrue();
    expect(meta.html).toBe(
      /* html */ "<div><pre>\n          a\n           b\n          c\n\n\n          &lt;span&gt; Foo  &lt;/span&gt;\n        </pre><span>Bar</span><code>\n          &lt;span&gt;\n            Baz\n          &lt;/span&gt;\n        </code></div>",
    );
  });

  // Regression: an inner </code> re-enabled minification for the rest of the <pre>.
  test("does not minify after a nested whitespace-sensitive block closes", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div><pre>a  b<code>c  d</code>  e  f</pre></div>");
    expect(meta.success).toBeTrue();
    expect(meta.html).toBe(/* html */ "<div><pre>a  b<code>c  d</code>  e  f</pre></div>");
  });

  test("does not minify in a textarea", () => {
    expect.assertions(2);
    const meta = compile(/* html */ "<div><textarea>  a   b</textarea></div>");
    expect(meta.success).toBeTrue();
    expect(meta.html).toBe(/* html */ "<div><textarea>  a   b</textarea></div>");
  });

  // Regression: whitespace-only text kept in <pre> wasn't counted towards the walk distance.
  test("counts kept whitespace-only text in a whitespace-sensitive block", () => {
    expect.assertions(3);
    const meta = compile(/* html */ "<div><pre>   </pre><!-- @a --></div>");
    expect(meta.success).toBeTrue();
    expect(meta.html).toBe(/* html */ "<div><pre>   </pre><!></div>");
    expect(meta.d).toEqual([3]);
  });

  // Regression: text refs in pre/code/textarea stopped being collected; only script/style opt out.
  describe("refs in whitespace-sensitive blocks", () => {
    test("collects a node ref on a script", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><script @a></script></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><script></script></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([1]);
      expect(meta.ref).toHaveProperty("a", 0);
    });

    test("collects a node ref on a style", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><style @a></style></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><style></style></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([1]);
      expect(meta.ref).toHaveProperty("a", 0);
    });

    test("collects a text ref in a pre", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><pre>@a</pre></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><pre> </pre></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([2]);
      expect(meta.ref).toHaveProperty("a", 0);
    });

    test("collects a comment ref in a pre", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><pre><!-- @a --></pre></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><pre><!></pre></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([2]);
      expect(meta.ref).toHaveProperty("a", 0);
    });

    test("collects a node ref in a nested whitespace-sensitive block", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><pre><code @a></code></pre></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><pre><code></code></pre></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([2]);
      expect(meta.ref).toHaveProperty("a", 0);
    });

    test("collects a text ref in a nested whitespace-sensitive block", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><pre><code>@a</code></pre></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><pre><code> </code></pre></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([3]);
      expect(meta.ref).toHaveProperty("a", 0);
    });

    test("collects a comment ref in a nested whitespace-sensitive block", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><pre><code><!-- @a --></code></pre></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><pre><code><!></code></pre></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([3]);
      expect(meta.ref).toHaveProperty("a", 0);
    });

    test("collects a text ref in a textarea", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><textarea>@a</textarea></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><textarea> </textarea></div>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([2]);
      expect(meta.ref).toHaveProperty("a", 0);
    });

    test("does not collect a comment ref in a textarea", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><textarea><!-- @a --></textarea></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><textarea><!-- @a --></textarea></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("does not collect a node ref in a script", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><script>// <div @a></div></script></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><script>// <div @a></div></script></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("does not collect a comment ref in a script", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><script>// <!-- @a --></script></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><script>// <!-- @a --></script></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("does not collect a node ref in a style", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><style>// <div @a></div></style></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><style>// <div @a></div></style></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("does not collect a comment ref in a style", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><style>/* <!-- @a --> */</style></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><style>/* <!-- @a --> */</style></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });
  });

  // Regression: script/style text was minified and read as refs, though "@" there is CSS or JS.
  describe("raw text elements", () => {
    test("does not treat style text as a ref", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><style>@a</style></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><style>@a</style></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("does not treat script text as a ref", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><script>@a</script></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><script>@a</script></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("keeps style content verbatim", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><style>@media print{a{color:red}}</style></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><style>@media print{a{color:red}}</style></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("keeps script content verbatim", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><script>const a = 1;  const b = 2;</script></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><script>const a = 1;  const b = 2;</script></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("does not treat a script comment as a ref", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<div><script><!-- @a --></script></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><script><!-- @a --></script></div>");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });
  });

  // Regression: a bare "<" splits one Text node into chunks, which compile() counted as several nodes.
  describe("text split across chunks", () => {
    test("keeps text either side of a bare less-than", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div>a < b</div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div>a < b</div>");
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("counts split text as one node", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div>a < b<!-- @x --></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div>a < b<!></div>");
      expect(meta.k).toEqual(["x"]);
      expect(meta.d).toEqual([2]);
    });

    test("counts split text in a nested element as one node", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<div><b>i < 10</b><!-- @x --></div>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div><b>i < 10</b><!></div>");
      expect(meta.k).toEqual(["x"]);
      expect(meta.d).toEqual([3]);
    });
  });

  // Regression: a root with no end tag threw "No end tag." while compiling.
  describe("void root element", () => {
    test("compiles a void root element with a ref", () => {
      expect.assertions(4);
      const meta = compile(/* html */ "<input @a>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<input>");
      expect(meta.k).toEqual(["a"]);
      expect(meta.d).toEqual([0]);
    });

    test("compiles a self-closing root element", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<svg/>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<svg/>");
    });
  });

  // Regression: collect() can't walk into <template> content, so templates crashed at runtime; now rejected.
  describe("template element", () => {
    // Serial: spies on the global console.error.
    test.serial("logs error for a nested template element", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div><template><span @a></span></template><b @b></b></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(
        `Unsupported <template> element in template:\n${template}`,
      );
      expect(consoleSpy).toHaveBeenCalledTimes(1);
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

    // Rejected too: an empty <template> only worked by accident.
    test("returns success false for an empty template element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div><template></template></div>");
      expect(meta.success).toBeFalse();
    });

    test("returns success true without a template element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div><span @a></span><b @b></b></div>");
      expect(meta.success).toBeTrue();
    });
  });

  // Regression: "/>" on an HTML element was taken as closing it, but the parser ignores it and keeps it open.
  describe("self-closing slash in HTML content", () => {
    test("does not treat a slashed element as a closed root", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<div/><span></span>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div/><span></span>");
    });

    test("collects refs across a slashed element", () => {
      expect.assertions(7);
      const meta = compile(/* html */ "<div @a/><span @b></span>");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div/><span></span>");
      expect(meta.k).toEqual(["a", "b"]);
      expect(meta.d).toEqual([0, 1]);
      expect(meta.ref).toHaveProperty("a", 0);
      expect(meta.ref).toHaveProperty("b", 1);
      expect(Object.keys(meta.ref)).toHaveLength(2);
    });

    test("does not treat a slashed unknown element as a closed root", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<circle/><div></div>");
      expect(meta.success).toBeTrue();
    });

    test("keeps whitespace after a slashed pre", () => {
      expect.assertions(2);
      const meta = compile(/* html */ "<pre/>a  b");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<pre/>a  b");
    });

    test("keeps a slashed script raw", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<script/>@media a  b");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<script/>@media a  b");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    test("keeps a slashed style raw", () => {
      expect.assertions(5);
      const meta = compile(/* html */ "<style/>@media a  b");
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<style/>@media a  b");
      expect(meta.k).toBeEmpty();
      expect(meta.d).toBeEmpty();
      expect(meta.ref).toBeEmptyObject();
    });

    // Foreign content DOES self-close, so this must still be two roots.
    test("still reports multiple roots for a self-closing foreign element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<svg/><span></span>");
      expect(meta.success).toBeFalse();
    });
  });

  test("does not escape HTML entities", () => {
    expect.assertions(2);
    const template = /* html */ "<div>&lt;span&gt;Foo&lt;/span&gt;</div>";
    const meta = compileNoMacro(template); // TODO: use compile() once bun supports passing UTF8 into macros.
    expect(meta.html).toBe(template);
    expect(meta.success).toBeTrue();
  });

  // Serial: spies on the global console.error and toggles Bun.enableANSIColors.
  describe.serial("errors", () => {
    test("throws when input template is not a string", () => {
      expect.assertions(10);
      const expectedError = new TypeError("Template must be a string literal");
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro(123)).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro(123n)).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro(true)).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro()).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro(null)).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro(Symbol("test"))).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro(["<div></div>"])).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro(() => "<div></div>")).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro({ template: "<div></div>" })).toThrowError(expectedError);
      // @ts-expect-error - template must be a string
      expect(() => compileNoMacro(String)).toThrowError(expectedError);
    });

    test("logs error when empty string", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Empty html string in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test("logs error when template compiles to empty string", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "  <!-- comment -->\n\n";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Empty html string in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test("logs error when more than one root element", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div></div><div></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Multiple root nodes in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    // Regression: the pre's end tag handler replaced the root's, hiding the second root.
    test("logs error when more than one root element and the root is a pre", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<pre>a</pre><div>b</div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Multiple root nodes in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test("logs error when more than one root element and the root is void", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<input><input>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Multiple root nodes in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    // Regression: every element after the first root logged its own error.
    test("logs error once when a second root element has children", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div></div><div><span></span><b></b></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Multiple root nodes in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test("logs error once when there are three top-level root elements", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div></div><div></div><div></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Multiple root nodes in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test("logs error for text before the root element", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "lead text<div @a></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Multiple root nodes in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test("returns success false for empty string", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "");
      expect(meta.success).toBeFalse();
    });

    test("returns success false for whitespace-only string", () => {
      expect.assertions(1);
      const meta = compile(
        /* html */ " \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF",
      );
      expect(meta.success).toBeFalse();
    });

    test("returns success false for template that compiles to empty string", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "  <!-- comment -->\n\n");
      expect(meta.success).toBeFalse();
    });

    test("returns success false for text after the root element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div></div>tail text");
      expect(meta.success).toBeFalse();
    });

    test("returns success false for a ref comment after the root element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div></div><!-- @after -->");
      expect(meta.success).toBeFalse();
    });

    // Guard: a non-ref comment is removed before render, so it can't become a second root.
    test("returns success true for a plain comment after the root element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "<div></div><!-- hi -->");
      expect(meta.success).toBeTrue();
    });

    // Guard: a lone text ref is the root itself, not a stray node.
    test("returns success true for a template with only a text ref", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "@a");
      expect(meta.success).toBeTrue();
    });

    // Regression: leading text was silently dropped, with the element taken as root.
    test("returns success false for text before the root element", () => {
      expect.assertions(1);
      const meta = compile(/* html */ "lead text<div @a></div>");
      expect(meta.success).toBeFalse();
    });

    test("logs error when doctype found", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<!DOCTYPE html><div></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Doctype not allowed in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test("logs error when duplicate ref keys found", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div><span>@a</span><span>@a</span></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Duplicate ref name "a" in template:\n${template}`);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test("logs error for each duplicate ref key", () => {
      expect.assertions(3);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div>@a<span>@a</span><span @b-two></span><span>@a</span></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Duplicate ref name "a" in template:\n${template}`);
      expect(consoleSpy).not.toHaveBeenCalledWith(
        `Duplicate ref name "b-two" in template:\n${template}`,
      );
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test("logs error when an element has multiple ref markers", () => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<div @a @b></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(
        `Multiple ref markers on one element in template:\n${template}`,
      );
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    const invalidRefs: [template: string, name: string][] = [
      /* eslint-disable array-bracket-spacing */
      // spaces
      [/* html */ "<div>@a and more</div>", "a and more"],
      [/* html */ "<div><!-- @a and more --></div>", "a and more"],

      // no name
      [/* html */ "<div @></div>", ""],
      [/* html */ "<div>@</div>", ""],
      [/* html */ "@", ""],
      [/* html */ "<div><!-- @ --></div>", ""],
      [/* html */ "<!-- @ -->", ""],

      // double @
      [/* html */ "<div @@></div>", "@"],
      [/* html */ "<div>@@</div>", "@"],
      [/* html */ "@@", "@"],
      [/* html */ "<div><!-- @@ --></div>", "@"],
      [/* html */ "<!-- @@ -->", "@"],

      [/* html */ "<div @@a></div>", "@a"],
      [/* html */ "<div>@@a</div>", "@a"],
      [/* html */ "@@a", "@a"],
      [/* html */ "<div><!-- @@a --></div>", "@a"],
      [/* html */ "<!-- @@a -->", "@a"],

      // capital character; attribute names arrive lowercased, so only text and comment refs can fail
      [/* html */ "<div>@Foo</div>", "Foo"],
      [/* html */ "@Foo", "Foo"],
      [/* html */ "<div><!-- @Foo --></div>", "Foo"],
      [/* html */ "<!-- @Foo -->", "Foo"],

      [/* html */ "<div>@fOo</div>", "fOo"],
      [/* html */ "@fOo", "fOo"],
      [/* html */ "<div><!-- @fOo --></div>", "fOo"],
      [/* html */ "<!-- @fOo -->", "fOo"],

      // number as first character
      [/* html */ "<div @1></div>", "1"],
      [/* html */ "<div>@1</div>", "1"],
      [/* html */ "@1", "1"],
      [/* html */ "<div><!-- @1 --></div>", "1"],
      [/* html */ "<!-- @1 -->", "1"],

      [/* html */ "<div @1a></div>", "1a"],
      [/* html */ "<div>@1a</div>", "1a"],
      [/* html */ "@1a", "1a"],
      [/* html */ "<div><!-- @1a --></div>", "1a"],
      [/* html */ "<!-- @1a -->", "1a"],

      // underscore as first character
      [/* html */ "<div @_></div>", "_"],
      [/* html */ "<div>@_</div>", "_"],
      [/* html */ "@_", "_"],
      [/* html */ "<div><!-- @_ --></div>", "_"],
      [/* html */ "<!-- @_ -->", "_"],

      [/* html */ "<div @_a></div>", "_a"],
      [/* html */ "<div>@_a</div>", "_a"],
      [/* html */ "@_a", "_a"],
      [/* html */ "<div><!-- @_a --></div>", "_a"],
      [/* html */ "<!-- @_a -->", "_a"],

      // dash as first character
      [/* html */ "<div @-></div>", "-"],
      [/* html */ "<div>@-</div>", "-"],
      [/* html */ "@-", "-"],
      [/* html */ "<div><!-- @- --></div>", "-"],
      [/* html */ "<!-- @- -->", "-"],

      [/* html */ "<div @-a></div>", "-a"],
      [/* html */ "<div>@-a</div>", "-a"],
      [/* html */ "@-a", "-a"],
      [/* html */ "<div><!-- @-a --></div>", "-a"],
      [/* html */ "<!-- @-a -->", "-a"],

      // non-alphanumeric/dash/underscore character
      [/* html */ "<div @.></div>", "."],
      [/* html */ "<div>@.</div>", "."],
      [/* html */ "@.", "."],
      [/* html */ "<div><!-- @. --></div>", "."],
      [/* html */ "<!-- @. -->", "."],

      [/* html */ "<div @!></div>", "!"],
      [/* html */ "<div>@!</div>", "!"],
      [/* html */ "@!", "!"],
      [/* html */ "<div><!-- @! --></div>", "!"],
      [/* html */ "<!-- @! -->", "!"],

      [/* html */ "<div @$></div>", "$"],
      [/* html */ "<div>@$</div>", "$"],
      [/* html */ "@$", "$"],
      [/* html */ "<div><!-- @$ --></div>", "$"],
      [/* html */ "<!-- @$ -->", "$"],

      [/* html */ "<div @=></div>", ""], // parsed as empty ref key + empty "" attribute
      [/* html */ "<div>@=</div>", "="],
      [/* html */ "@=", "="],
      [/* html */ "<div><!-- @= --></div>", "="],
      [/* html */ "<!-- @= -->", "="],

      [/* html */ "<div @🙂></div>", "🙂"],
      [/* html */ "<div>@🙂</div>", "🙂"],
      [/* html */ "@🙂", "🙂"],
      [/* html */ "<div><!-- @🙂 --></div>", "🙂"],
      [/* html */ "<!-- @🙂 -->", "🙂"],
      /* eslint-enable array-bracket-spacing */
    ];

    test.each(invalidRefs)("logs error for invalid ref name in %j", (template, name) => {
      expect.assertions(2);
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(
        `Invalid ref name "${name}" in template:\n${template}`,
      );
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    test.each(invalidRefs)("returns success false for invalid ref name in %j", (template) => {
      expect.assertions(1);
      // oxlint-disable-next-line no-underscore-dangle
      using _consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      expect(compileNoMacro(template).success).toBeFalse();
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

    test("wraps the template in dim escape codes when colors are enabled", () => {
      expect.assertions(1);
      const { enableANSIColors } = Bun;
      // @ts-expect-error - writable at runtime despite readonly type
      Bun.enableANSIColors = true;
      onTestFinished(() => {
        // @ts-expect-error - writable at runtime despite readonly type
        Bun.enableANSIColors = enableANSIColors;
      });
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<!DOCTYPE html><div></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(
        `Doctype not allowed in template:\n\u001B[2m${template}\u001B[0m`,
      );
    });

    test("does not wrap the template when colors are disabled", () => {
      expect.assertions(1);
      const { enableANSIColors } = Bun;
      // @ts-expect-error - writable at runtime despite readonly type
      Bun.enableANSIColors = false;
      onTestFinished(() => {
        // @ts-expect-error - writable at runtime despite readonly type
        Bun.enableANSIColors = enableANSIColors;
      });
      using consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const template = /* html */ "<!DOCTYPE html><div></div>";
      compileNoMacro(template);
      expect(consoleSpy).toHaveBeenCalledWith(`Doctype not allowed in template:\n${template}`);
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
    expect(meta.success).toBeTrue();
    expect(meta.html).toBe(/* html */ "<ul><li>A</li><li>B</li><li>C</li></ul>");
  });

  test("returns expected html for basic template with messy whitespace", () => {
    expect.assertions(2);
    const meta = compile(/* html */ `
      <ul  >
        <li\f\n\r\t\u0020
          data-whitespace="\f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
            >A</li>
        <li
          >
            B</li>
        <li data-value = "test"   >C
          </li>
      </ul>
    `);
    expect(meta.success).toBeTrue();
    expect(meta.html).toBe(
      `<ul  ><li\f\n\r\t\u0020
          data-whitespace="\f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
            >A</li><li
          >B</li><li data-value = "test"   >C</li></ul>`,
    );
  });

  test("returns expected html for SVG template", () => {
    expect.assertions(2);
    const meta = compile(/* html */ `
      <svg>
        <circle cx=10 cy='10' r="10" />
      </svg>
    `);
    expect(meta.success).toBeTrue();
    expect(meta.html).toBe(/* html */ "<svg><circle cx=10 cy='10' r=\"10\" /></svg>");
  });

  describe("keepSpaces option", () => {
    test("removes spaces between tags and text by default", () => {
      expect.assertions(2);
      const meta = compile(
        /* html */ "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
      );
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div>x</div>");
    });

    test("keeps spaces between tags and text when option is true", () => {
      expect.assertions(2);
      const meta = compile(
        /* html */ "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
        { keepSpaces: true },
      );
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div> x </div>");
    });

    test("removes spaces between tags and text when option is false", () => {
      expect.assertions(2);
      const meta = compile(
        /* html */ "<div> x   \f\n\r\t\v\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF  </div>",
        { keepSpaces: false },
      );
      expect(meta.success).toBeTrue();
      expect(meta.html).toBe(/* html */ "<div>x</div>");
    });
  });
});

// Characterization: HTMLRewriter behaviour that compile() relies on.
describe("HTMLRewriter", () => {
  describe("text chunking", () => {
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

    // Splitting is tokenizer driven, not size or stream driven.
    test("does not split on size", () => {
      expect.assertions(1);
      let chunks = 0;
      new HTMLRewriter()
        .onDocument({
          text(chunk) {
            // oxlint-disable-next-line vitest/no-conditional-in-test
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
            // oxlint-disable-next-line vitest/no-conditional-in-test
            if (!chunk.lastInTextNode) chunks++;
          },
        })
        .transform(template);
      expect(chunks).toBe(1);
    });

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

    test("flushes all chunks of a text node before the next element", () => {
      expect.assertions(1);
      const sequence: string[] = [];
      new HTMLRewriter()
        .onDocument({
          text(chunk) {
            // oxlint-disable-next-line vitest/no-conditional-in-test
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

    test("reinserts at the right position when replacing the last chunk", () => {
      expect.assertions(1);
      let buffer = "";
      const html = new HTMLRewriter()
        .onDocument({
          text(chunk) {
            buffer += chunk.text;
            // oxlint-disable-next-line vitest/no-conditional-in-test
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

    // compile() guards onEndTag on canHaveContent alone; the last two rows show selfClosing doesn't predict the throw.
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
      "%j: canHaveContent %p, selfClosing %p, onEndTag throws %p",
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

    // Correct for compile(): the parser also keeps <div/> open, so what follows is a child, not a second root.
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

    test("fires for implied end tags", () => {
      expect.assertions(1);
      const fired: string[] = [];
      new HTMLRewriter()
        .on("*", {
          element(node) {
            const { tagName } = node;
            // oxlint-disable-next-line vitest/no-conditional-in-test
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
    test("truncates iteration when an attribute is removed", () => {
      expect.assertions(2);
      const iterated: string[] = [];
      const html = new HTMLRewriter()
        .on("*", {
          element(node) {
            for (const [name] of node.attributes) {
              iterated.push(name);
              // oxlint-disable-next-line vitest/no-conditional-in-test
              if (name[0] === "@") node.removeAttribute(name);
            }
          },
        })
        .transform(/* html */ "<div @a x=1 @b y=2 @c></div>");
      expect(iterated).toEqual(["@a"]);
      expect(html).toBe(/* html */ "<div x=1 @b y=2 @c></div>");
    });

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
