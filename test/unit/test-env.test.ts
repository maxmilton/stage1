/**
 * @file Validate the test environment is setup correctly.
 */

import { describe, expect, test } from "bun:test";

type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
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
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(performance.mark).toBeFunction();
      expect(performance.mark.toString()).toBe("() => {}");
    });

    test("measure is a noop function", () => {
      expect.assertions(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(performance.measure).toBeFunction();
      expect(performance.measure.toString()).toBe("() => {}");
    });
  });
});
