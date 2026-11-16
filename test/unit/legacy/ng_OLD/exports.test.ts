import { describe, expect, expectTypeOf, test } from "bun:test";
import * as ngExports from "../../../../src/legacy/ng_OLD/index.ts";
import type { List as NgList } from "../../../../src/legacy/ng_OLD/reconcile.ts";
import type { Signal as NgSignal } from "../../../../src/legacy/ng_OLD/signal.ts";
import type { FlatRefs, InferRefs, RefKeys, Refs } from "../../../../src/types.ts";

describe("legacy/ng_OLD", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf<ngExports.Refs>().toEqualTypeOf<Refs>();
    expectTypeOf<ngExports.InferRefs<Refs>>().toEqualTypeOf<InferRefs<Refs>>();
    expectTypeOf<ngExports.FlatRefs<Refs>>().toEqualTypeOf<FlatRefs<Refs>>();
    expectTypeOf<ngExports.RefKeys<Refs>>().toEqualTypeOf<RefKeys<Refs>>();
    expectTypeOf<ngExports.Signal<number>>().toEqualTypeOf<NgSignal<number>>();
    expectTypeOf<ngExports.List<number, Element>>().toEqualTypeOf<NgList<number, Element>>();
  });

  const publicExports = [
    ["h", "Function"],
    ["hh", "Function"],
    ["collect", "Function"],
    ["ONCLICK", "Symbol"],
    ["handleClick", "Function"],
    ["setupSyntheticClick", "Function"],
    ["removeSyntheticClick", "Function"],
    ["list", "Function"],
    ["mark", "Function"],
    ["signal", "Function"],
    ["get", "Function"],
    ["set", "Function"],
    ["sub", "Function"],
    ["batch", "Function"],
    ["untracked", "Function"],
    ["computed", "Function"],
    ["effect", "Function"],
    ["noop", "Function"],
    ["fragment", "Function"],
    ["text", "Function"],
    ["create", "Function"],
    ["clone", "Function"],
    ["append", "Function"],
    ["prepend", "Function"],
    ["insert", "Function"],
    ["replace", "Function"],
  ] as const;

  test.each(publicExports)('exports public "%s" %s', (name, type) => {
    expect.assertions(2);
    expect(ngExports).toHaveProperty(name);
    // oxlint-disable-next-line import/namespace
    expect(ngExports[name]).toHaveObjectType(`[object ${type}]`);
  });

  test("does not export any private internals", () => {
    expect.assertions(publicExports.length + 1);
    const publicExportNames: string[] = publicExports.map(([name, _type]) => name);
    // oxlint-disable-next-line guard-for-in
    for (const name in ngExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(ngExports).length);
  });

  test("has no default export", () => {
    expect.assertions(1);
    expect(ngExports).not.toHaveProperty("default");
  });
});
