/** @file Validate the test environment is setup correctly. */

import { describe, expect, test } from "bun:test";

describe("globals", () => {
  // @see https://github.com/maxmilton/test-utils/blob/master/src/dom.ts#L34
  const usedGlobals = [
    "window",
    "document",
    "console",
    "navigator",
    "location",
    "history",
    "localStorage",
    "fetch",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "queueMicrotask",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "postMessage",
    "dispatchEvent",
    "addEventListener",
    "removeEventListener",
    "DocumentFragment",
    "MutationObserver",
    "CSSStyleSheet",
    "Text",
    "Node",
  ] as const;

  test.each(usedGlobals)("has window.%s mapped to global", (globalName) => {
    expect.assertions(3);
    expect(global[globalName]).toBeDefined();
    expect(window[globalName]).toBeDefined();
    expect(global[globalName]).toBe(window[globalName]);
  });

  describe("performance", () => {
    test("mark is a noop function", () => {
      expect.assertions(2);
      // oxlint-disable-next-line typescript/unbound-method
      expect(performance.mark).toBeFunction();
      expect(performance.mark.toString()).toBe("() => {}");
    });

    test("measure is a noop function", () => {
      expect.assertions(2);
      // oxlint-disable-next-line typescript/unbound-method
      expect(performance.measure).toBeFunction();
      expect(performance.measure.toString()).toBe("() => {}");
    });
  });
});

// Characterization: dist.test.ts leaves .resolves unawaited, which is safe only while its failure fails the test.
describe("unawaited .resolves", () => {
  test("passes a test when it passes", () => {
    expect.assertions(1);
    expect(Bun.file(import.meta.path).exists()).resolves.toBeTrue();
  });

  // No expect.assertions: a count mismatch would also fail this body and hide an ignored matcher.
  test.failing("fails a test when it fails", () => {
    expect(Bun.file("missing").exists()).resolves.toBeTrue();
  });
});

// Characterization (Bun 1.4.4), behind src/signal.ts's const enums: it imports ./dev.ts
describe("Bun.build minify of a module's constants", () => {
  /** Minifies (names kept) a module declaring `decl` and returning `id(n & use)`. */
  const build = async (decl: string, use: string, imported: boolean): Promise<string> => {
    const id = imported ? 'import { id } from "./id.ts";' : "const id = (n: number): number => n;";
    const out = await Bun.build({
      entrypoints: ["/virtual/entry.ts"],
      files: {
        "/virtual/entry.ts": `${id}\n${decl}\nexport const f = (n: number): number => id(n & ${use});\n`,
        "/virtual/id.ts": "export const id = (n: number): number => n;\n",
      },
      minify: { syntax: true, whitespace: true },
    });
    return out.outputs[0].text();
  };

  test("keeps a top-level const as a var once the module has an import", async () => {
    expect.assertions(2);
    expect(await build("const M = 8;", "M", true)).toContain("id(n&M)");
    // Guards the assertion above: without the import, the const is inlined
    expect(await build("const M = 8;", "M", false)).toContain("id(n&8)");
  });

  test("inlines a const enum member in a module with an import", async () => {
    expect.assertions(1);
    expect(await build("const enum F { M = 8 }", "F.M", true)).toContain("id(n&8)");
  });
});
