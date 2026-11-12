import { describe, expect, expectTypeOf, test } from "bun:test";
import * as browserExports from "../../src/browser/index.ts";
import * as indexExports from "../../src/index.ts";
import * as legacyExports from "../../src/legacy/index.ts";
import * as keyedExports from "../../src/legacy/reconcile/keyed.ts";
import * as nonKeyedExports from "../../src/legacy/reconcile/non-keyed.ts";
import * as reuseLiteExports from "../../src/legacy/reconcile/reuse-lite.ts";
import * as reuseNodesExports from "../../src/legacy/reconcile/reuse-nodes.ts";
import * as liteExports from "../../src/lite/index.ts";
import type { List as LiteList } from "../../src/lite/reconcile.ts";
import type { Signal as LiteSignal, Sub } from "../../src/lite/signal.ts";
import * as macroExports from "../../src/macro.ts";
import * as ngExports from "../../src/ng_OLD/index.ts";
import type { List as NgList } from "../../src/ng_OLD/reconcile.ts";
import type { Signal as NgSignal } from "../../src/ng_OLD/signal.ts";
import type { List } from "../../src/reconcile.ts";
import type { Computed, Effect, Holder, Scope, Signal } from "../../src/signal.ts";
import type { FlatRefs, InferRefs, RefKeys, Refs } from "../../src/types.ts";

describe("browser", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf<browserExports.Refs>().toEqualTypeOf<Refs>();
    expectTypeOf<browserExports.InferRefs<Refs>>().toEqualTypeOf<InferRefs<Refs>>();
    expectTypeOf<browserExports.FlatRefs<Refs>>().toEqualTypeOf<FlatRefs<Refs>>();
    expectTypeOf<browserExports.RefKeys<Refs>>().toEqualTypeOf<RefKeys<Refs>>();
  });

  const publicExports = [
    ["h", "Function"],
    ["html", "Function"],
    ["collect", "Function"],
    ["ONCLICK", "Symbol"],
    ["setupSyntheticClick", "Function"],
    ["fragment", "Function"],
    ["text", "Function"],
    ["create", "Function"],
    ["clone", "Function"],
    ["append", "Function"],
  ] as const;

  test.each(publicExports)('exports public "%s" %s', (name, type) => {
    expect.assertions(2);
    expect(browserExports).toHaveProperty(name);
    // oxlint-disable-next-line import/namespace
    expect(browserExports[name]).toHaveObjectType(`[object ${type}]`);
  });

  test("does not export any private internals", () => {
    expect.assertions(publicExports.length + 1);
    const publicExportNames: string[] = publicExports.map(([name, _type]) => name);
    // oxlint-disable-next-line guard-for-in
    for (const name in browserExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(browserExports).length);
  });

  test("has no default export", () => {
    expect.assertions(1);
    expect(browserExports).not.toHaveProperty("default");
  });
});

describe("index", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf<indexExports.Refs>().toEqualTypeOf<Refs>();
    expectTypeOf<indexExports.InferRefs<Refs>>().toEqualTypeOf<InferRefs<Refs>>();
    expectTypeOf<indexExports.FlatRefs<Refs>>().toEqualTypeOf<FlatRefs<Refs>>();
    expectTypeOf<indexExports.RefKeys<Refs>>().toEqualTypeOf<RefKeys<Refs>>();
    expectTypeOf<indexExports.Signal<number>>().toEqualTypeOf<Signal<number>>();
    expectTypeOf<indexExports.Computed<number>>().toEqualTypeOf<Computed<number>>();
    expectTypeOf<indexExports.Effect>().toEqualTypeOf<Effect>();
    expectTypeOf<indexExports.Scope>().toEqualTypeOf<Scope>();
    expectTypeOf<indexExports.Holder>().toEqualTypeOf<Holder>();
    expectTypeOf<indexExports.List<number, Element>>().toEqualTypeOf<List<number, Element>>();
  });

  const publicExports = [
    ["h", "Function"],
    ["collect", "Function"],
    ["ONCLICK", "Symbol"],
    ["handleClick", "Function"],
    ["setupSyntheticClick", "Function"],
    ["removeSyntheticClick", "Function"],
    ["list", "Function"],
    ["mark", "Function"],
    ["signal", "Function"],
    ["computed", "Function"],
    ["effect", "Function"],
    ["scope", "Function"],
    ["defer", "Function"],
    ["get", "Function"],
    ["set", "Function"],
    ["dispose", "Function"],
    ["batch", "Function"],
    ["untracked", "Function"],
    ["within", "Function"],
    ["holder", "Function"],
    ["own", "Function"],
    ["owns", "Function"],
    ["release", "Function"],
    ["noop", "Function"],
    ["fragment", "Function"],
    ["text", "Function"],
    ["create", "Function"],
    ["clone", "Function"],
    ["append", "Function"],
    ["prepend", "Function"],
    ["insert", "Function"],
    ["replace", "Function"],
    ["$", "Function"],
    ["$$", "Function"],
  ] as const;

  test.each(publicExports)('exports public "%s" %s', (name, type) => {
    expect.assertions(2);
    expect(indexExports).toHaveProperty(name);
    // oxlint-disable-next-line import/namespace
    expect(indexExports[name]).toHaveObjectType(`[object ${type}]`);
  });

  test("does not export any private internals", () => {
    expect.assertions(publicExports.length + 1);
    const publicExportNames: string[] = publicExports.map(([name, _type]) => name);
    // oxlint-disable-next-line guard-for-in
    for (const name in indexExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(indexExports).length);
  });

  test("has no default export", () => {
    expect.assertions(1);
    expect(indexExports).not.toHaveProperty("default");
  });
});

describe("lite", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf<liteExports.Refs>().toEqualTypeOf<Refs>();
    expectTypeOf<liteExports.InferRefs<Refs>>().toEqualTypeOf<InferRefs<Refs>>();
    expectTypeOf<liteExports.FlatRefs<Refs>>().toEqualTypeOf<FlatRefs<Refs>>();
    expectTypeOf<liteExports.RefKeys<Refs>>().toEqualTypeOf<RefKeys<Refs>>();
    expectTypeOf<liteExports.Signal<number>>().toEqualTypeOf<LiteSignal<number>>();
    expectTypeOf<liteExports.Sub>().toEqualTypeOf<Sub>();
    expectTypeOf<liteExports.List<number, Element>>().toEqualTypeOf<LiteList<number, Element>>();
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
    ["dispose", "Function"],
    ["batch", "Function"],
    ["noop", "Function"],
    ["fragment", "Function"],
    ["text", "Function"],
    ["create", "Function"],
    ["clone", "Function"],
    ["append", "Function"],
    ["prepend", "Function"],
    ["insert", "Function"],
    ["replace", "Function"],
    ["$", "Function"],
    ["$$", "Function"],
  ] as const;

  test.each(publicExports)('exports public "%s" %s', (name, type) => {
    expect.assertions(2);
    expect(liteExports).toHaveProperty(name);
    // oxlint-disable-next-line import/namespace
    expect(liteExports[name]).toHaveObjectType(`[object ${type}]`);
  });

  test("does not export any private internals", () => {
    expect.assertions(publicExports.length + 1);
    const publicExportNames: string[] = publicExports.map(([name, _type]) => name);
    // oxlint-disable-next-line guard-for-in
    for (const name in liteExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(liteExports).length);
  });

  test("has no default export", () => {
    expect.assertions(1);
    expect(liteExports).not.toHaveProperty("default");
  });
});

describe("legacy", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf<legacyExports.Refs>().toEqualTypeOf<Refs>();
    expectTypeOf<legacyExports.InferRefs<Refs>>().toEqualTypeOf<InferRefs<Refs>>();
    expectTypeOf<legacyExports.FlatRefs<Refs>>().toEqualTypeOf<FlatRefs<Refs>>();
    expectTypeOf<legacyExports.RefKeys<Refs>>().toEqualTypeOf<RefKeys<Refs>>();
  });

  const publicExports = [
    ["h", "Function"],
    ["collect", "Function"],
    ["ONCLICK", "Symbol"],
    ["handleClick", "Function"],
    ["setupSyntheticClick", "Function"],
    ["removeSyntheticClick", "Function"],
    ["noop", "Function"],
    ["fragment", "Function"],
    ["text", "Function"],
    ["create", "Function"],
    ["clone", "Function"],
    ["append", "Function"],
    ["prepend", "Function"],
    ["insert", "Function"],
    ["replace", "Function"],
    ["store", "Function"],
  ] as const;

  test.each(publicExports)('exports public "%s" %s', (name, type) => {
    expect.assertions(2);
    expect(legacyExports).toHaveProperty(name);
    // oxlint-disable-next-line import/namespace
    expect(legacyExports[name]).toHaveObjectType(`[object ${type}]`);
  });

  test("does not export any private internals", () => {
    expect.assertions(publicExports.length + 1);
    const publicExportNames: string[] = publicExports.map(([name, _type]) => name);
    // oxlint-disable-next-line guard-for-in
    for (const name in legacyExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(legacyExports).length);
  });

  test("has no default export", () => {
    expect.assertions(1);
    expect(legacyExports).not.toHaveProperty("default");
  });
});

describe("ng_OLD", () => {
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
    ["$", "Function"],
    ["$$", "Function"],
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

describe("macro", () => {
  const publicExports = [["compile", "Function"]] as const;

  test.each(publicExports)('exports public "%s" %s', (name, type) => {
    expect.assertions(2);
    expect(macroExports).toHaveProperty(name);
    // oxlint-disable-next-line import/namespace
    expect(macroExports[name]).toHaveObjectType(`[object ${type}]`);
  });

  test("does not export any private internals", () => {
    expect.assertions(publicExports.length + 1);
    const publicExportNames: string[] = publicExports.map(([name, _type]) => name);
    // oxlint-disable-next-line guard-for-in
    for (const name in macroExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(macroExports).length);
  });

  test("has no default export", () => {
    expect.assertions(1);
    expect(macroExports).not.toHaveProperty("default");
  });
});

const reconcilers = [
  ["keyed", keyedExports],
  ["non-keyed", nonKeyedExports],
  ["reuse-lite", reuseLiteExports],
  ["reuse-nodes", reuseNodesExports],
] as const;

describe.each(reconcilers)("legacy/reconcile/%s", (_reconciler, exports) => {
  test('exports public "reconcile" Function', () => {
    expect.assertions(2);
    expect(exports).toHaveProperty("reconcile");
    expect(exports.reconcile).toBeInstanceOf(Function);
  });

  test("does not export any private internals", () => {
    expect.assertions(2);
    const publicExportNames = ["reconcile"];
    // oxlint-disable-next-line guard-for-in
    for (const name in exports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(exports).length);
  });

  test("has no default export", () => {
    expect.assertions(1);
    expect(exports).not.toHaveProperty("default");
  });
});
