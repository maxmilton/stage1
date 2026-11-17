// On V8's default tiers. e2e-only: JSC (bun test) throws stack overflows only at calls.
import { expect, test } from "@playwright/test";
import { bundle, probe } from "./probe.ts";

const liteCode = bundle("src/lite/index.ts");
const fullCode = bundle("src/index.ts");
const heldCode = bundle("test/v8/held-pass.ts");

// TurboFan runs the gate loop in ~2 ms, Maglev in ~36
const GATE_MS = 10;

// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each
for (const op of ["walk", "subchain"] as const) {
  test(`stage1/lite: a ${op} cut short by a stack overflow leaves later writes delivered`, async ({
    browser,
  }) => {
    const result = await probe(browser, liteCode, op);

    expect(result.loop).toBeLessThan(GATE_MS);
    expect(result.wedged).toBeUndefined();
  });
}

test("Characterization: a pass holding its state across its loop wedges", async ({ browser }) => {
  const result = await probe(browser, heldCode, "walk");

  expect(result.loop).toBeLessThan(GATE_MS);
  expect(result.wedged).toBeDefined();
});

// Its flush holds `depth` across the pass: flip this once it raises `depth` per call
test("Accepted tradeoff: a full-tier subchain cut short by a stack overflow stops later writes", async ({
  browser,
}) => {
  const result = await probe(browser, fullCode, "subchain", 500);

  expect(result.loop).toBeLessThan(GATE_MS);
  expect(result.wedged).toBeDefined();
});
