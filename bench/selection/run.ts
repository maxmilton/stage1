// Usage: bun bench/selection/run.ts [--layout] [--rounds=6] [variant...]
// Ratios are against the first variant. List a variant twice for an A/A control.
// More rounds narrow the page-to-page spread; each costs about 2 s per variant.

// A script, never imported; pages run one at a time so they never compete for the CPU.
// oxlint-disable node/no-top-level-await no-await-in-loop

import { chromium } from "@playwright/test";

const WARMUP = 3;
const SAMPLES = 8;

const args = Bun.argv.slice(2);
const layout = args.includes("--layout");
const roundsArg = args.find((arg) => arg.startsWith("--rounds="));
const ROUNDS = roundsArg ? Number(roundsArg.slice("--rounds=".length)) : 6;
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) throw new Error(`Invalid ${roundsArg}`);
const variants = args.filter((arg) => !arg.startsWith("--"));
if (variants.length === 0) variants.push("none", "mark");

const start = performance.now();
const out = await Bun.build({ entrypoints: [`${import.meta.dir}/page.ts`], minify: true });
const js = await out.outputs[0].text();
const html = `<!doctype html><html><head></head><body><script>${js}</script></body></html>`;

const browser = await chromium.launch({ channel: "chromium", args: ["--js-flags=--expose-gc"] });
// Per variant position: op -> [script, total], each a list of samples per round
const results = variants.map((): Record<string, [number[][], number[][]]> => ({}));

for (let round = 0; round < ROUNDS; round++) {
  const order = variants.map((_variant, index) => index).toSorted(() => Math.random() - 0.5);
  for (const index of order) {
    const page = await browser.newPage();
    // Cross-origin isolation lifts performance.now() from 100 µs to 5 µs resolution
    await page.route("http://localhost:9/", (route) =>
      route.fulfill({
        contentType: "text/html",
        headers: {
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
        },
        body: html,
      }),
    );
    await page.goto("http://localhost:9/");
    if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error("Not isolated");
    const samples = await page.evaluate(
      ([variant, withLayout, warmup, count]) => {
        const bench = globalThis as unknown as {
          setup: (variant: string, withLayout: boolean) => void;
          ops: Record<string, () => [number, number]>;
        };
        bench.setup(variant, withLayout);
        const res: Record<string, [number, number][]> = {};
        for (const [name, op] of Object.entries(bench.ops)) {
          for (let run = 0; run < warmup; run++) op();
          res[name] = Array.from({ length: count }, op);
        }
        return res;
      },
      [variants[index], layout, WARMUP, SAMPLES] as const,
    );
    await page.close();
    for (const [op, list] of Object.entries(samples)) {
      results[index][op] ??= [[], []];
      const acc = results[index][op];
      acc[0][round] = list.map(([script]) => script);
      acc[1][round] = list.map(([, total]) => total);
    }
  }
}
await browser.close();

// Interquartile mean: drops outliers like a median, but averaging the middle half
// resolves differences finer than the 5 µs timer step
const center = (xs: number[]): number => {
  const quarter = Math.floor(xs.length / 4);
  const middle = xs.toSorted((left, right) => left - right).slice(quarter, xs.length - quarter);
  return middle.reduce((sum, value) => sum + value, 0) / middle.length;
};
const metrics = layout ? (["script", "script + style/layout"] as const) : (["script"] as const);
const lines: string[] = [];
for (const [metric, label] of metrics.entries()) {
  lines.push(
    "",
    `${label}: ${variants[0]} interquartile mean ms, others × ${variants[0]} (range of per-round ratios)`,
    [
      "op".padEnd(15),
      variants[0].padStart(9),
      ...variants.slice(1).map((variant) => variant.padStart(22)),
    ].join(""),
  );
  for (const [op, baseOps] of Object.entries(results[0])) {
    const base = baseOps[metric];
    const cells = results.slice(1).map((byOp) => {
      const samples = byOp[op][metric];
      const perRound = samples.map((xs, round) => center(xs) / center(base[round]));
      const overall = center(samples.flat()) / center(base.flat());
      const low = Math.min(...perRound).toFixed(2);
      const high = Math.max(...perRound).toFixed(2);
      return `${overall.toFixed(3)} (${low}–${high})`.padStart(22);
    });
    lines.push([op.padEnd(15), center(base.flat()).toFixed(3).padStart(9), ...cells].join(""));
  }
}
lines.push("", `${((performance.now() - start) / 1000).toFixed(0)} s`);
process.stdout.write(`${lines.join("\n")}\n`);
