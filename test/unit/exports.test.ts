import { describe, expect, expectTypeOf, test } from "bun:test";
import * as browserExports from "../../src/browser/index.ts";
import * as indexExports from "../../src/index.ts";
import * as legacyExports from "../../src/legacy/index.ts";
import * as keyedExports from "../../src/legacy/reconcile/keyed.ts";
import * as nonKeyedExports from "../../src/legacy/reconcile/non-keyed.ts";
import * as reuseLiteExports from "../../src/legacy/reconcile/reuse-lite.ts";
import * as reuseNodesExports from "../../src/legacy/reconcile/reuse-nodes.ts";
import * as liteExports from "../../src/lite/index.ts";
import type { Effect as LiteEffect, Signal as LiteSignal } from "../../src/lite/signal.ts";
import * as macroExports from "../../src/macro.ts";
import type { Marked, Rows } from "../../src/reconcile.ts";
import type { Computed, Effect, Scope, Signal } from "../../src/signal.ts";
import type { FlatRefs, InferRefs, RefKeys, Refs } from "../../src/types.ts";
import * as ultraliteExports from "../../src/ultralite/index.ts";
import type {
  Effect as UltraliteEffect,
  Signal as UltraliteSignal,
} from "../../src/ultralite/signal.ts";

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
    expectTypeOf<indexExports.Rows<number, string, Element>>().toEqualTypeOf<
      Rows<number, string, Element>
    >();
    expectTypeOf<indexExports.Marked<string, Element>>().toEqualTypeOf<Marked<string, Element>>();
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
    ["sub", "Function"],
    ["batch", "Function"],
    ["untracked", "Function"],
    ["trigger", "Function"],
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
    expectTypeOf<liteExports.Effect>().toEqualTypeOf<LiteEffect>();
    // One list module serves every tier
    expectTypeOf<liteExports.Rows<number, string, Element>>().toEqualTypeOf<
      Rows<number, string, Element>
    >();
    expectTypeOf<liteExports.Marked<string, Element>>().toEqualTypeOf<Marked<string, Element>>();
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
    ["get", "Function"],
    ["set", "Function"],
    ["sub", "Function"],
    ["dispose", "Function"],
    ["batch", "Function"],
    ["trigger", "Function"],
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
  test("shares list and mark with stage1 (one list module for every tier)", () => {
    expect.assertions(2);
    expect(liteExports.list).toBe(indexExports.list);
    expect(liteExports.mark).toBe(indexExports.mark);
  });
});

describe("ultralite", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf<ultraliteExports.Refs>().toEqualTypeOf<Refs>();
    expectTypeOf<ultraliteExports.InferRefs<Refs>>().toEqualTypeOf<InferRefs<Refs>>();
    expectTypeOf<ultraliteExports.FlatRefs<Refs>>().toEqualTypeOf<FlatRefs<Refs>>();
    expectTypeOf<ultraliteExports.RefKeys<Refs>>().toEqualTypeOf<RefKeys<Refs>>();
    expectTypeOf<ultraliteExports.Signal<number>>().toEqualTypeOf<UltraliteSignal<number>>();
    expectTypeOf<ultraliteExports.Effect>().toEqualTypeOf<UltraliteEffect>();
    // One list module serves every tier
    expectTypeOf<ultraliteExports.Rows<number, string, Element>>().toEqualTypeOf<
      Rows<number, string, Element>
    >();
    expectTypeOf<ultraliteExports.Marked<string, Element>>().toEqualTypeOf<
      Marked<string, Element>
    >();
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
    expect(ultraliteExports).toHaveProperty(name);
    // oxlint-disable-next-line import/namespace
    expect(ultraliteExports[name]).toHaveObjectType(`[object ${type}]`);
  });

  test("does not export any private internals", () => {
    expect.assertions(publicExports.length + 1);
    const publicExportNames: string[] = publicExports.map(([name, _type]) => name);
    // oxlint-disable-next-line guard-for-in
    for (const name in ultraliteExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(ultraliteExports).length);
  });

  test("has no default export", () => {
    expect.assertions(1);
    expect(ultraliteExports).not.toHaveProperty("default");
  });
  test("shares list and mark with stage1 (one list module for every tier)", () => {
    expect.assertions(2);
    expect(ultraliteExports.list).toBe(indexExports.list);
    expect(ultraliteExports.mark).toBe(indexExports.mark);
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
