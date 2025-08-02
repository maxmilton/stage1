import { describe, expect, test } from "bun:test";
import { reconcile as reconcileKeyed } from "../../src/reconcile/keyed.ts";
import { reconcile as reconcileNonKeyed } from "../../src/reconcile/non-keyed.ts";
import { reconcile as reconcileReuseNodes } from "../../src/reconcile/reuse-nodes.ts";

describe("keyed", () => {
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
