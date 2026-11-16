// alien-signals' conformance suite (https://github.com/johnsoncodehk/reactive-framework-test-suite)
// run against stage1's signals (src/signal.ts): from source, whose dev checks follow NODE_ENV, and
// built for production as dist is, so `bun test` covers both modes. Each case runs through the
// suite's runCase or runProbe; titles and expected results depend on which table a case is in.
// The cycle cases (`mayNotTerminate`) run in-process too: dev builds throw at their bound and
// production builds reach the suite's guard, both in ms.
// oxlint-disable vitest/prefer-each node/no-process-env

import { describe, expect, test } from "bun:test";
import {
  behaviors,
  correctness,
  type ReactiveFramework,
  runCase,
  runProbe,
} from "reactive-framework-test-suite";
import * as source from "../../src/signal.ts";

/** src/signal.ts built as dist builds it (production: no dev checks), loaded as a module. */
const buildProduction = async (): Promise<typeof source> => {
  const out = await Bun.build({
    entrypoints: [`${import.meta.dir}/../../src/signal.ts`],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
  });
  const code = await out.outputs[0].text();
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return (await import(url)) as typeof source;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const adapter = (api: typeof source): ReactiveFramework => ({
  name: "stage1",
  effectCleanup: true,
  signal(value) {
    const s = api.signal(value);
    return {
      read: () => api.get(s),
      write: (next) => {
        api.set(s, next);
      },
    };
  },
  computed(fn) {
    const c = api.computed(fn);
    return { read: () => api.get(c) };
  },
  effect(fn) {
    const e = api.effect(fn);
    return () => {
      api.dispose(e);
    };
  },
  // A root scope: its body is not batched, so the case's writes run effects as at top level; it
  // owns what the case makes and disposes it, also when fn throws (scope() rethrows).
  run(fn) {
    api.dispose(api.scope(fn));
  },
  batch: api.batch,
  untracked: api.untracked,
});

const frameworks: [string, ReactiveFramework, boolean][] = [
  ["source", adapter(source), process.env.NODE_ENV !== "production"],
  ["production build", adapter(await buildProduction()), false],
];

// Writing inside a computed's getter, which dev builds refuse with a throw ("set inside a
// computed"). These cases then take their "computed side effects forbidden" branch, which the
// suite accepts: they return early, asserting nothing of their own.
const DEV_REFUSED = new Set([52, 57, 112, 135, 136, 137, 138, 179, 181, 182, 184, 185, 186]);

// Cases that fail at one of their own assertions in production builds, which have no cycle bound:
// effects that write each other's sources loop until the suite's guard trips. Dev builds throw at
// a flush's millionth run, which the suite accepts.
const PRODUCTION_UNSUPPORTED = new Set([64, 221, 223]);

// Probes report a design choice instead of asserting.
// Expected: alien-signals 3.2.1's answers in the suite's README, except where noted.
const BEHAVIOUR: Record<number, string> = {
  17: "lazy",
  15: "no subscription",
  146: "single recompute",
  29: "===",
  167: "===",
  30: "skips",
  176: "returns void",
  173: "post-write",
  174: "post-write",
  // Differs from alien-signals: an effect whose first run throws is disposed and `effect` rethrows
  88: "unsubscribes",
  // Differs: a throwing effect does not stop the others; the flush finishes, then rethrows
  106: "continues",
  // Differs: a computed that throws keeps the error and rethrows it until a source changes
  86: "caches error",
  107: "caches error",
  49: "runs once per write",
  62: "no throw",
  // Differs: writes an effect makes in a flush only queue what they reach, which runs once after
  175: "batched",
  // Differs: the adapter's `run` disposes what it made when fn throws, as a scope does
  246: "disposes children",
  244: "LIFO",
  172: "re-evaluates",
  209: "cascades",
  210: "replaced",
  187: "not evaluated",
  188: "skipped",
  248: "skipped",
  193: "skipped",
  132: "skipped",
  147: "skipped",
  241: "deepest first",
  // Sibling order is unspecified; today a write runs its effects in creation order
  216: "creation order",
};

// Dev builds refuse the probe's write inside a computed's getter (see DEV_REFUSED)
const DEV_BEHAVIOUR: Record<number, string> = { 172: "throws" };

describe.each(frameworks)("%s", (_, ng, dev) => {
  for (const section of correctness) {
    describe(section.name, () => {
      for (const c of section.cases) {
        const name = `#${c.id} ${c.title}`;
        const quiet = dev && DEV_REFUSED.has(c.id) ? `Characterization: ${name}` : name;
        if (!dev && PRODUCTION_UNSUPPORTED.has(c.id)) {
          test(`Accepted tradeoff: ${name}`, () => {
            expect.assertions(1);
            expect(runCase(ng, c)).toEqual({
              status: "fail",
              error: expect.stringMatching(/^Expected /u) as string,
            });
          });
        } else {
          test(quiet, () => {
            expect.assertions(1);
            expect(runCase(ng, c)).toEqual({ status: "pass" });
          });
        }
      }
    });
  }

  describe(behaviors.name, () => {
    for (const p of behaviors.cases) {
      const variant = (dev ? DEV_BEHAVIOUR[p.id] : undefined) ?? BEHAVIOUR[p.id];
      test(`Characterization: #${p.id} ${p.title}`, () => {
        expect.assertions(1);
        expect(runProbe(ng, p)).toEqual({ status: "variant", variant });
      });
    }
  });
});
