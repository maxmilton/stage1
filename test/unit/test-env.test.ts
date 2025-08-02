/**
 * @file Validate the test environment is setup correctly.
 */

import { describe, expect, test } from "bun:test";

describe("globals", () => {
  // @see https://github.com/maxmilton/test-utils/blob/master/src/dom.ts#L34
  const globals = [
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
  ];

  test.each(globals)("has window.%s mapped to global", (globalName) => {
    expect.assertions(3);
    // @ts-expect-error - TODO: Fix index type.
    expect(global[globalName]).toBeDefined();
    // @ts-expect-error - TODO: Fix index type.
    expect(window[globalName]).toBeDefined();
    // @ts-expect-error - TODO: Fix index type.
    expect(global[globalName]).toBe(window[globalName]);
  });
});
