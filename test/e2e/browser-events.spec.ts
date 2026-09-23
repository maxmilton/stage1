import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const jsPath = path.resolve(import.meta.dirname, "../../dist/browser.js");

// Handlers append to #log rather than counting into a variable, so a failure
// says what happened: "" means the click never reached handleClick, a doubled
// value means it did not stop.
async function setupLog(page: Page): Promise<void> {
  await page.addScriptTag({ path: jsPath });
  await page.evaluate(() => {
    const { h, collect, ONCLICK, setupSyntheticClick } = window.stage1;
    setupSyntheticClick();
    const view = h(
      /* html */ "<div @wrap><button id=target type=button>Click</button><output id=log @log></output></div>",
    );
    const refs = collect<{ wrap: Element; log: Element }>(view, view);
    (refs.wrap as ClickTarget)[ONCLICK] = () => {
      refs.log.textContent += "wrap";
    };
    document.body.append(view);
  });
}

test.describe("a trusted click", () => {
  test("invokes the nearest ancestor's ONCLICK handler", async ({ page }) => {
    await setupLog(page);
    const log = page.locator("#log");
    await page.locator("#target").click();
    await expect(log).toHaveText("wrap");
  });

  test("reaches the handler when the browser synthesizes it from a keypress", async ({ page }) => {
    await setupLog(page);
    const log = page.locator("#log");
    await page.locator("#target").press("Enter");
    await expect(log).toHaveText("wrap");
  });

  test("stops at the first handled node", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    await page.evaluate(() => {
      const { h, collect, ONCLICK, setupSyntheticClick } = window.stage1;
      setupSyntheticClick();
      const view = h(
        /* html */ "<div @outer><div @inner><button id=target type=button>Click</button></div><output id=log @log></output></div>",
      );
      const refs = collect<{ outer: Element; inner: Element; log: Element }>(view, view);
      (refs.inner as ClickTarget)[ONCLICK] = () => {
        refs.log.textContent += "inner";
      };
      (refs.outer as ClickTarget)[ONCLICK] = () => {
        refs.log.textContent += "outer";
      };
      document.body.append(view);
    });
    const log = page.locator("#log");
    await page.locator("#target").click();
    await expect(log).toHaveText("inner");
  });
});
