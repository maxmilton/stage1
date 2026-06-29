import { describe, expect, expectTypeOf, test } from "bun:test";
import { reconcile as reconcileKeyed } from "../../src/reconcile/keyed.ts";
import { reconcile as reconcileNonKeyed } from "../../src/reconcile/non-keyed.ts";
import { reconcile as reconcileReuseNodes } from "../../src/reconcile/reuse-nodes.ts";

describe("keyed", () => {
  test("types", () => {
    expectTypeOf(reconcileKeyed).not.toBeAny();
    expectTypeOf(reconcileKeyed).toBeFunction();
    expectTypeOf(reconcileKeyed).parameters.toEqualTypeOf<
      [
        key: never, // TODO: Fix inferred key type.
        // key: string | number | symbol,
        parent: Element,
        renderedData: unknown[],
        data: unknown[],
        createFn: (itemData: unknown) => Node,
        updateFn?: ((node: Node, itemData: unknown) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    // @ts-expect-error - TODO: Fix inferred return type.
    expectTypeOf(reconcileKeyed).returns.not.toBeAny();
    // @ts-expect-error - TODO: Fix inferred return type.
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    expectTypeOf(reconcileKeyed).returns.toEqualTypeOf<void>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(reconcileKeyed).toBeFunction();
    expect(reconcileKeyed).not.toBeClass();
  });

  test("expects 8 parameters (3 optional)", () => {
    expect.assertions(1);
    expect(reconcileKeyed).toHaveParameters(5, 3);
  });

  test("returns undefined", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const create = () => document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(reconcileKeyed("id", parent, [], [], create)).toBeUndefined();
  });
});

describe("non-keyed", () => {
  test("types", () => {
    expectTypeOf(reconcileNonKeyed).not.toBeAny();
    expectTypeOf(reconcileNonKeyed).toBeFunction();
    expectTypeOf(reconcileNonKeyed).parameters.toEqualTypeOf<
      [
        parent: Element,
        renderedData: unknown[],
        data: unknown[],
        createFn: (itemData: unknown) => Node,
        updateFn?: ((node: Node, itemData: unknown) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    expectTypeOf(reconcileNonKeyed).returns.not.toBeAny();
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    expectTypeOf(reconcileNonKeyed).returns.toEqualTypeOf<void>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(reconcileNonKeyed).toBeFunction();
    expect(reconcileNonKeyed).not.toBeClass();
  });

  test("expects 7 parameters (3 optional)", () => {
    expect.assertions(1);
    expect(reconcileNonKeyed).toHaveParameters(4, 3);
  });

  test("returns undefined", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const create = () => document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(reconcileNonKeyed(parent, [], [], create)).toBeUndefined();
  });
});

describe("reuse-nodes", () => {
  test("types", () => {
    expectTypeOf(reconcileReuseNodes).not.toBeAny();
    expectTypeOf(reconcileReuseNodes).toBeFunction();
    expectTypeOf(reconcileReuseNodes).parameters.toEqualTypeOf<
      [
        parent: Element,
        renderedData: unknown[],
        data: unknown[],
        createFn: (itemData: unknown) => Node,
        updateFn?: ((node: Node, itemData: unknown) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    expectTypeOf(reconcileReuseNodes).returns.not.toBeAny();
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    expectTypeOf(reconcileReuseNodes).returns.toEqualTypeOf<void>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(reconcileReuseNodes).toBeFunction();
    expect(reconcileReuseNodes).not.toBeClass();
  });

  test("expects 7 parameters (3 optional)", () => {
    expect.assertions(1);
    expect(reconcileReuseNodes).toHaveParameters(4, 3);
  });

  test("returns undefined", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const create = () => document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(reconcileReuseNodes(parent, [], [], create)).toBeUndefined();
  });
});
