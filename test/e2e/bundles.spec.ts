import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/** stage1 and its lite tiers ship as source: bundle one as an app's production build does. */
function bundle(entry: string): string {
  return execFileSync("bun", ["build", entry, "--production", "--target=browser"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
    // An inherited NODE_ENV (other than "production") beats --production and keeps the dev checks.
    // oxlint-disable-next-line node/no-process-env
    env: { ...process.env, NODE_ENV: "production" },
  });
}

const jsPath = path.resolve(import.meta.dirname, "../../dist/browser.js");
const rootCode = bundle("src/index.ts");
const liteCode = bundle("src/lite/index.ts");
const ultraliteCode = bundle("src/ultralite/index.ts");
const [esmCode, precompiledCode] = await Promise.all([
  readFile(path.resolve(import.meta.dirname, "../../dist/browser.mjs"), "utf8"),
  readFile(path.resolve(import.meta.dirname, "../../dist/legacy/index.js"), "utf8"),
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
const DOM_EXPORTS = [
  "$",
  "$$",
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
  "text",
];
const ROOT_EXPORTS = [
  ...DOM_EXPORTS,
  "batch",
  "computed",
  "defer",
  "dispose",
  "effect",
  "get",
  "list",
  "mark",
  "owner",
  "scope",
  "set",
  "signal",
  "sub",
  "trigger",
  "untracked",
  "within",
];
/** stage1/ultralite's; stage1/lite also has `trigger`. */
const ULTRALITE_EXPORTS = [
  ...DOM_EXPORTS,
  "batch",
  "dispose",
  "get",
  "list",
  "mark",
  "set",
  "signal",
  "sub",
];
const LITE_EXPORTS = [...ULTRALITE_EXPORTS, "trigger"];
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

test.describe("a production build of stage1", () => {
  test("exposes exactly the documented exports", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      return Object.keys((await import(url)) as object);
    }, rootCode);

    expect(result.toSorted(byCodeUnit)).toEqual(ROOT_EXPORTS.toSorted(byCodeUnit));
  });

  test("keeps a list's rows in step with its items", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      // oxlint-disable-next-line typescript/consistent-type-imports
      const root = (await import(url)) as typeof import("../../src/index.ts");
      const { h, list, set, signal, sub } = root;
      const parent = h(/* html */ "<ul></ul>");
      const items = signal([
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ]);
      sub(
        items,
        list(parent, "id", (item: { id: number; label: string }) => {
          const row = h(/* html */ "<li></li>");
          row.textContent = item.label;
          return row;
        }),
      );
      set(items, [
        { id: 2, label: "b" },
        { id: 3, label: "c" },
      ]);
      return parent.textContent;
    }, rootCode);

    expect(result).toBe("bc");
  });
});

test.describe("a production build of stage1/lite", () => {
  test("exposes exactly the documented exports", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      return Object.keys((await import(url)) as object);
    }, liteCode);

    expect(result.toSorted(byCodeUnit)).toEqual(LITE_EXPORTS.toSorted(byCodeUnit));
  });

  test("keeps a list's rows in step with its items", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      // oxlint-disable-next-line typescript/consistent-type-imports
      const lite = (await import(url)) as typeof import("../../src/lite/index.ts");
      const { h, list, set, signal, sub } = lite;
      const parent = h(/* html */ "<ul></ul>");
      const items = signal([
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ]);
      sub(
        items,
        list(parent, "id", (item: { id: number; label: string }) => {
          const row = h(/* html */ "<li></li>");
          row.textContent = item.label;
          return row;
        }),
      );
      set(items, [
        { id: 2, label: "b" },
        { id: 3, label: "c" },
      ]);
      return parent.textContent;
    }, liteCode);

    expect(result).toBe("bc");
  });
});

test.describe("a production build of stage1/ultralite", () => {
  test("exposes exactly the documented exports", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      return Object.keys((await import(url)) as object);
    }, ultraliteCode);

    expect(result.toSorted(byCodeUnit)).toEqual(ULTRALITE_EXPORTS.toSorted(byCodeUnit));
  });

  test("keeps a list's rows in step with its items", async ({ page }) => {
    const result = await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      // oxlint-disable-next-line typescript/consistent-type-imports
      const lite = (await import(url)) as typeof import("../../src/ultralite/index.ts");
      const { h, list, set, signal, sub } = lite;
      const parent = h(/* html */ "<ul></ul>");
      const items = signal([
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ]);
      sub(
        items,
        list(parent, "id", (item: { id: number; label: string }) => {
          const row = h(/* html */ "<li></li>");
          row.textContent = item.label;
          return row;
        }),
      );
      set(items, [
        { id: 2, label: "b" },
        { id: 3, label: "c" },
      ]);
      return parent.textContent;
    }, ultraliteCode);

    expect(result).toBe("bc");
  });
});

test.describe("the legacy precompiled build", () => {
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
      const { h } = (await import(url)) as typeof import("../../src/legacy/index.ts");
      return h(/* html */ "<ul id=root><li>A</li></ul>").nodeName;
    }, precompiledCode);

    expect(result).toBe("UL");
  });
});
