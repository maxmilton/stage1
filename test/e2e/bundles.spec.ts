import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const jsPath = path.resolve(import.meta.dirname, "../../dist/browser.js");
const [esmCode, precompiledCode] = await Promise.all([
  readFile(path.resolve(import.meta.dirname, "../../dist/browser.mjs"), "utf8"),
  readFile(path.resolve(import.meta.dirname, "../../dist/index.js"), "utf8"),
]);

// Browser bundle is a deliberate subset to keep the bundle small.
const BROWSER_EXPORTS = [
  "ONCLICK",
  "append",
  "clone",
  "collect",
  "create",
  "fragment",
  "h",
  "html",
  "setupSyntheticClick",
  "text",
];
const PRECOMPILED_EXPORTS = [
  "ONCLICK",
  "append",
  "clone",
  "collect",
  "create",
  "fragment",
  "h",
  "handleClick",
  "insert",
  "noop",
  "prepend",
  "removeSyntheticClick",
  "replace",
  "setupSyntheticClick",
  "store",
  "text",
];

/** Code-unit order, as a module namespace has; `localeCompare` would put ONCLICK mid-list. */
function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

test.describe("the IIFE browser build", () => {
  test("exposes exactly the documented exports", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });

    const result = await page.evaluate(() => Object.keys(window.stage1));

    // Sorted: a plain object's key order is rollup's insertion order, which matches only by chance.
    expect(result.toSorted(byCodeUnit)).toEqual(BROWSER_EXPORTS);
  });

  test("compiles a view", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });

    const result = await page.evaluate(
      () => window.stage1.h(/* html */ "<ul id=root><li>A</li></ul>").nodeName,
    );

    expect(result).toBe("UL");
  });
});

test.describe("the ESM browser build", () => {
  test("exposes exactly the documented exports", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      return Object.keys((await import(url)) as object);
    }, esmCode);

    expect(result.toSorted(byCodeUnit)).toEqual(BROWSER_EXPORTS);
  });

  test("compiles a view", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      // oxlint-disable-next-line typescript/consistent-type-imports
      const { h } = (await import(url)) as typeof import("../../src/browser/index.ts");
      return h(/* html */ "<ul id=root><li>A</li></ul>").nodeName;
    }, esmCode);

    expect(result).toBe("UL");
  });
});

test.describe("the precompiled build", () => {
  test("exposes exactly the documented exports", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      return Object.keys((await import(url)) as object);
    }, precompiledCode);

    expect(result.toSorted(byCodeUnit)).toEqual(PRECOMPILED_EXPORTS);
  });

  test("compiles a view", async ({ page }) => {
    // Same template as the browser builds: both h() variants take a string and return its root.
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      // oxlint-disable-next-line typescript/consistent-type-imports
      const { h } = (await import(url)) as typeof import("../../src/index.ts");
      return h(/* html */ "<ul id=root><li>A</li></ul>").nodeName;
    }, precompiledCode);

    expect(result).toBe("UL");
  });
});
