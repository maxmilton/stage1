// alien-signals' conformance suite (https://github.com/johnsoncodehk/reactive-framework-test-suite)
// run against ng's computed, effect, batch and untracked. Each case runs through the suite's
// runCase or runProbe; titles and expected results depend on which table a case is in.
// oxlint-disable vitest/prefer-each

import { describe, expect, test } from "bun:test";
import {
  behaviors,
  correctness,
  type ReactiveFramework,
  runCase,
  runProbe,
} from "reactive-framework-test-suite";
import * as source from "../../../../src/legacy/ng_OLD/signal.ts";
import { buildSignal } from "./ng-build.ts";

const adapter = (api: typeof source): ReactiveFramework => ({
  name: "ng",
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
    const read = api.computed(fn);
    return { read };
  },
  effect: api.effect,
  // ng has no scope to run cases in
  run: (fn) => {
    fn();
  },
  batch: api.batch,
  untracked: api.untracked,
  effectCleanup: true,
});

const frameworks: [string, ReactiveFramework][] = [
  ["source", adapter(source)],
  ["built with STAGE1_SIGNAL_GRAPH", adapter(await buildSignal(["STAGE1_SIGNAL_GRAPH"]))],
];

// Unobserved computeds don't link to their sources but revalidate against a global
// write count, so any write re-runs them, outermost first. Values stay correct.
const UNOBSERVED = new Set([7, 12, 13, 27, 34, 76, 95, 220, 147, 167]);

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
  // Differs from alien-signals: a failed first run returns no disposer, so it leaves nothing behind
  88: "unsubscribes",
  // Differs: a throwing effect does not stop the others
  106: "continues",
  // Read unobserved, and a throwing evaluation records no write count to revalidate against
  86: "re-evaluates",
  107: "re-evaluates",
  49: "runs once per write",
  62: "no throw",
  175: "unbatched",
  246: "children survive",
  // Differs: disposal cleans up child effects oldest first; a re-run cleans them up in reverse
  244: "FIFO",
  172: "re-evaluates",
  209: "cascades",
  210: "replaced",
  187: "not evaluated",
  188: "skipped",
  248: "skipped",
  193: "skipped",
  132: "skipped",
  // Differs: unobserved, so it re-runs (see UNOBSERVED)
  147: "recomputed",
  241: "deepest first",
  216: "creation order",
};

describe.each(frameworks)("%s", (_, ng) => {
  for (const section of correctness) {
    describe(section.name, () => {
      for (const c of section.cases) {
        const name = `#${c.id} ${c.title}`;
        if (UNOBSERVED.has(c.id)) {
          test(`Accepted tradeoff: ${name}`, () => {
            expect.assertions(1);
            expect(runCase(ng, c)).toEqual({
              status: "fail",
              error: expect.stringMatching(/^Expected /u) as string,
            });
          });
        } else {
          test(name, () => {
            expect.assertions(1);
            expect(runCase(ng, c)).toEqual({ status: "pass" });
          });
        }
      }
    });
  }

  describe(behaviors.name, () => {
    for (const p of behaviors.cases) {
      const label = UNOBSERVED.has(p.id) ? "Accepted tradeoff" : "Characterization";
      test(`${label}: #${p.id} ${p.title}`, () => {
        expect.assertions(1);
        expect(runProbe(ng, p)).toEqual({ status: "variant", variant: BEHAVIOUR[p.id] });
      });
    }
  });
});
