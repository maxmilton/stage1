import path from "node:path";
import { expect, test } from "@playwright/test";

type Stage1 = typeof import("../../src/browser/index.ts");

declare global {
  interface Window {
    stage1: Stage1;
  }
}

const jsPath = path.resolve(import.meta.dirname, "../../dist/browser.js");

test("exports", async ({ page }) => {
  // await page.goto('about:blank');
  await page.addScriptTag({ path: jsPath });

  const result = await page.evaluate(() => Object.keys(window.stage1));

  expect(result).toEqual([
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
  ]);
  expect(result).toHaveLength(10);
});

// test("onRemove WIP", async ({ page }) => {
//   // await page.goto("about:blank");
//   await page.addScriptTag({ path: jsPath });

//   const result = await page.evaluate(async () => {
//     let calls = 0;

//     const root = document.createElement("div");
//     document.body.appendChild(root);
//     window.stage1.onRemove(root, () => calls++);
//     root.remove();

//     await Promise.resolve(); // wait for MutationObserver to trigger
//     return calls;
//   });

//   expect(result).toBe(1);
// });
