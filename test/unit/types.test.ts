import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Refs } from "../../src/types.ts";

describe("Refs", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf<Refs<{ foo: string }>>().toEqualTypeOf<{ foo: Node }>();
    // The `foo: never` twin makes the constraint error say "Property 'foo' is missing", naming the fix.
    expectTypeOf<Refs<{ Foo: Text }>>().toEqualTypeOf<{ Foo: never; foo: never }>();
    expectTypeOf<Refs>().toEqualTypeOf<Record<string, Node>>();
    // Bad keys map to `never`, so a generic `R` stays assignable to `Refs`.
    expectTypeOf(<R extends Refs<R>>(refs: R): Refs => refs).toBeFunction();
  });
});
