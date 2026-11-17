// On Maglev as the top tier, keeping the interrupt-budget checks at its loops' back-edges: there an
// ultralite batch end's drain meets a back-edge throw on most pages; under TurboFan, rarely.
// e2e-only: JSC (bun test) throws stack overflows only at calls.
import { expect, test } from "@playwright/test";
import { bundle, probe } from "./probe.ts";

test.use({
  launchOptions: {
    ignoreDefaultArgs: ["--disable-field-trial-config"],
    args: ["--js-flags=--no-turbofan --force-emit-interrupt-budget-checks"],
  },
});

const ultraliteCode = bundle("src/ultralite/index.ts");
const heldCode = bundle("test/v8/held-pass.ts");

// Maglev runs the gate loop in ~36 ms, Sparkplug in ~72 (Ryzen 7735HS)
const GATE_MS = 54;

test("stage1/ultralite: a batch end cut short by a stack overflow leaves later writes delivered", async ({
  browser,
}) => {
  const result = await probe(browser, ultraliteCode, "batchchain");

  expect(result.loop).toBeLessThan(GATE_MS);
  expect(result.wedged).toBeUndefined();
});

// The flags make the drain wedge: this goes red if a Chromium upgrade drops one
test("Characterization: a batch end holding its state across its drain wedges", async ({
  browser,
}) => {
  const result = await probe(browser, heldCode, "batchchain");

  expect(result.loop).toBeLessThan(GATE_MS);
  expect(result.wedged).toBeDefined();
});
