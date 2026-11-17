// The stack-edge probe for the V8 specs here. V8 throws RangeError at a loop's back-edge or OSR
// entry, outside every `try`; JSC (bun test) throws only at calls. So whether a pass or batch end
// cut short there leaves its "calling back" state raised, which queues every later write forever,
// shows only in Chromium.
import { execFileSync } from "node:child_process";
import path from "node:path";
// oxlint-disable unicorn/consistent-function-scoping -- the page function is sent as source
import type { Browser } from "@playwright/test";
import type * as Tier from "../../src/lite/signal.ts";

type Op = "walk" | "subchain" | "batchchain";

/** A production bundle, as an app's build makes it. */
export function bundle(entry: string): string {
  return execFileSync("bun", ["build", entry, "--production", "--target=browser"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
    // oxlint-disable-next-line node/no-process-env
    env: { ...process.env, NODE_ENV: "production" },
  });
}

// Fresh pages (own isolate each): under load a page misses an ultralite-shaped wedge ~1 in 8
const PAGES = 4;

/**
 * Runs `op` at the stack edge in up to PAGES fresh pages, each until a wedge: recurses to the stack
 * limit and, in 48 frames from the first where a call fits, calls `op` with 0 to 127 padding
 * arguments; once cold, then again after 300 calls. After each frame, and after each sweep, an
 * unbatched write that returns without calling its sub means the state stayed raised (wedged).
 * Returns the first page's loop time (the tier-up gate) and how the first wedge was found.
 */
export async function probe(
  browser: Browser,
  src: string,
  op: Op,
  subs = 4000,
): Promise<{ loop: number; wedged: string | undefined }> {
  let loop = Infinity;
  // One page at a time: each stops the probe at its wedge
  for (let attempt = 0; attempt < PAGES; attempt++) {
    // oxlint-disable-next-line no-await-in-loop
    await using page = await browser.newPage();
    // oxlint-disable-next-line no-await-in-loop
    const result = await page.evaluate(
      async (args) => {
        const url = URL.createObjectURL(new Blob([args.src], { type: "text/javascript" }));
        const { batch, dispose, set, signal, sub } = (await import(url)) as typeof Tier;

        // The gate: a 1e7-add loop, ~2 ms in TurboFan code, ~36 ms in Maglev's, ~72 ms in Sparkplug's
        let best = Infinity;
        let sum = 0;
        for (let run = 0; run < 5; run++) {
          const start = performance.now();
          // oxlint-disable-next-line no-bitwise unicorn/prefer-math-trunc
          for (let step = 0; step < 1e7; step++) sum = (sum + step) | 0;
          best = Math.min(best, performance.now() - start);
        }

        const noop = (): void => {};
        let value = 0;
        let run: () => void;
        if (args.op === "walk") {
          const big = signal(0);
          for (let count = 0; count < args.subs; count++) sub(big, noop);
          run = () => {
            set(big, ++value);
          };
        } else if (args.op === "subchain") {
          // A first call whose write starts a 64-signal chain, each sub writing the next
          const chain = Array.from({ length: 64 }, () => signal(0));
          for (const [link, each] of chain.entries()) {
            if (link < 63) {
              const to = chain[link + 1];
              sub(each, (next) => {
                set(to, next);
              });
            }
            for (let count = 0; count < args.subs / 64; count++) sub(each, noop);
          }
          const [first] = chain;
          run = () => {
            dispose(
              sub(signal(0), () => {
                set(first, ++value);
              }),
            );
          };
        } else {
          // A batch whose end calls a sub that writes `subs` signals, drained in the same loop
          const many = Array.from({ length: args.subs }, () => signal(0));
          for (const each of many) sub(each, noop);
          const source = signal(0);
          sub(source, (next) => {
            for (const each of many) set(each, next);
          });
          run = () => {
            batch(() => {
              set(source, ++value);
            });
          };
        }

        const target = signal(0);
        let seen = 0;
        sub(target, (next) => {
          seen = next;
        });
        let probes = 0;
        /** A write that returned without calling its sub: the state is raised at rest. */
        const raised = (): boolean => {
          const next = ++probes;
          try {
            set(target, next);
          } catch {
            return false;
          }
          return seen !== next;
        };

        const pads = Array.from({ length: 128 }, (_item, slots) =>
          Array.from<number>({ length: slots }).fill(0),
        );
        const call = (): void => {
          run();
        };
        const tiny = (): number => 0;
        let started = false;
        let swept = 0;
        let wedged = false;
        // try/catch in place: a helper's own call could overflow outside the `try`
        const deeper = (): void => {
          try {
            deeper();
          } catch {
            // the stack limit
          }
          if (wedged) return;
          if (!started) {
            try {
              tiny();
              started = true;
            } catch {
              // not yet below the limit
            }
          }
          if (started && swept < 48) {
            swept++;
            // An index loop: an iterator's calls could overflow outside the `try`
            for (let slots = 0; slots < 128; slots++) {
              try {
                Reflect.apply(call, undefined, pads[slots]);
              } catch {
                // what `run` threw, an overflow included
              }
            }
            // Stops the sweep at a wedge: each later call would only grow the queue
            try {
              wedged = raised();
            } catch {
              // an overflow
            }
          }
        };
        const sweep = (): boolean => {
          started = false;
          swept = 0;
          deeper();
          return wedged || raised();
        };

        let found: string | undefined;
        if (sweep()) found = "cold";
        else {
          for (let count = 0; count < 300; count++) {
            try {
              run();
            } catch {
              // a callback's error
            }
          }
          if (sweep()) found = "warm";
        }
        // `sum` returned, so the gate loop is not dead code
        return { loop: best, sum, wedged: found };
      },
      { src, op, subs },
    );
    loop = Math.min(loop, result.loop);
    if (result.wedged !== undefined) return { loop, wedged: `page ${attempt}, ${result.wedged}` };
  }
  return { loop, wedged: undefined };
}
