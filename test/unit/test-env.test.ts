/** @file Validate the test environment is setup correctly. */

import { describe, expect, test } from "bun:test";

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

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

  test.each(
    // HACK: Workaround for bun types; should work with `readonly unknown[]`.
    usedGlobals as Mutable<typeof usedGlobals>,
  )("has window.%s mapped to global", (globalName) => {
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
