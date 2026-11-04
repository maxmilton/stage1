// alien-signals' conformance suite (https://github.com/johnsoncodehk/reactive-framework-test-suite)
// run against ng's computed, effect, batch and untracked. Each case brings its own assertions.
// Titles and assertions depend on which table a case is in.
// oxlint-disable vitest/prefer-each

import { beforeAll, describe, expect, test } from "bun:test";
import { type ReactiveFramework, setExpect, testSuite } from "reactive-framework-test-suite";
import * as source from "../../src/ng/signal.ts";
import { buildSignal } from "./ng-build.ts";

const adapter = (api: typeof source): ReactiveFramework => ({
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
});

const frameworks: [string, ReactiveFramework][] = [
  ["source", adapter(source)],
  ["built with STAGE1_SIGNAL_GRAPH", adapter(await buildSignal(["STAGE1_SIGNAL_GRAPH"]))],
];

beforeAll(() => {
  setExpect(expect);
});

// Unobserved computeds don't link to their sources but revalidate against a global
// write count, so any write re-runs them, outermost first. Values stay correct.
const UNOBSERVED = new Set([
  "#7 unchanged computed values stop propagation to downstream",
  "#12 active dep triggers, inactive dep does not",
  "#13 switching branches deactivates old deps",
  "#27 downstream not re-evaluated unless value changed",
  "#34 pruning stops at first unchanged node",
  "#95 stale computations evaluated before their dependees",
  "#147 computed not recomputed in batch if dep reverts",
  "#220 computed same object reference — no downstream propagation",
  "#76 untracked read in computed does not create dependency",
  "#167 computed NaN downstream propagation",
]);

// A computed's child effect is cleaned up after the computed re-evaluates; cleaning it
// up before would cost a flag check on every computed update.
const LATE_CLEANUP = new Set([
  "#242 effect in computed: old inner cleanup (if any) before new eval",
]);

// Cases with no assertion of their own: they pass when nothing throws
const NO_THROW = new Set(["#203 computed disposal with unchanged-value sibling computed"]);

// Behavioural cases return a description of a design choice instead of asserting.
// Expected: alien-signals 3.2.1's answers in the suite's README, except where noted.
const BEHAVIOUR: Record<string, string> = {
  "#17 computed evaluation timing": "lazy",
  "#15 unread computed subscription": "no subscription",
  "#146 recompute count on multiple dep changes": "single recompute",
  "#29 NaN equality semantics": "===",
  "#167 computed NaN downstream propagation": "===",
  "#30 same-reference signal write": "skips",
  "#176 batch return value": "returns void",
  "#173 mid-propagation read isolation": "post-write",
  "#174 intra-run read-after-write": "post-write",
  // Differs from alien-signals: a failed first run returns no disposer, so it leaves nothing behind
  "#88 effect subscription after first-run throw": "unsubscribes",
  // A throwing effect does not stop the others
  "#106 effect throw isolation in flush": "continues",
  // Read unobserved, and a throwing evaluation records no write count to revalidate against
  "#86 computed error caching": "re-evaluates",
  "#107 non-Error throw caching": "re-evaluates",
  "#49 inner write re-run through computed chain": "runs 1x per write",
  "#62 infinite loop in effect": "no throw",
  "#175 effect multi-signal write batching": "unbatched (2 runs)",
  "#246 throwing run body child effect cleanup": "children survive",
  // ng's own order, since alien's comes from the suite's adapter; a re-run cleans up in reverse
  "#244 sibling cleanup order on dispose": "FIFO",
};

describe.each(frameworks)("%s", (_, ng) => {
  for (const { section, cases, type } of testSuite) {
    describe(section, () => {
      for (const [name, fn] of Object.entries(cases)) {
        if (type === "behavioral") {
          const label = UNOBSERVED.has(name) ? "Accepted tradeoff" : "Characterization";
          test(`${label}: ${name}`, () => {
            expect.assertions(1);
            expect(fn(ng)).toBe(BEHAVIOUR[name]);
          });
        } else if (UNOBSERVED.has(name) || LATE_CLEANUP.has(name)) {
          test(`Accepted tradeoff: ${name}`, () => {
            expect.hasAssertions();
            expect(() => {
              fn(ng);
            }).toThrow(/^\S*expect\(\S*received/u); // \S* skips ANSI colours on a TTY
          });
        } else if (NO_THROW.has(name)) {
          test(name, () => {
            expect.assertions(1);
            expect(() => {
              fn(ng);
            }).not.toThrow();
          });
        } else {
          test(name, () => {
            expect.hasAssertions();
            fn(ng);
          });
        }
      }
    });
  }
});
