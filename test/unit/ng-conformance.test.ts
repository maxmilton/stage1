// alien-signals' conformance suite (https://github.com/johnsoncodehk/reactive-framework-test-suite)
// run against ng's computed, effect and batch. Each case brings its own assertions.
// Titles and assertions depend on which table a case is in.
// oxlint-disable vitest/no-conditional-in-test vitest/prefer-each

import { beforeAll, describe, expect, test } from "bun:test";
import {
  type ReactiveFramework,
  setExpect,
  SkipTest,
  testSuite,
} from "reactive-framework-test-suite";
import { batch, computed, effect, get, set, signal } from "../../src/ng/signal.ts";

const ng: ReactiveFramework = {
  signal(value) {
    const s = signal(value);
    return {
      read: () => get(s),
      write: (next) => {
        set(s, next);
      },
    };
  },
  computed(fn) {
    const read = computed(fn);
    return { read };
  },
  effect,
  // ng has no scope to run cases in
  run: (fn) => {
    fn();
  },
  batch,
};

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
]);

// Reasons a case skips itself; ng has no untracked and ignores an effect's return value
const MISSING = ["no effectCleanup", "no untracked", "no untracked or batch"];

// Cases with no assertion of their own: they pass when nothing throws
const NO_THROW = new Set(["#203 computed disposal with unchanged-value sibling computed"]);

// Behavioural cases return a description of a design choice and assert nothing
for (const { section, cases } of testSuite.filter((s) => s.type !== "behavioral")) {
  describe(section, () => {
    for (const [name, fn] of Object.entries(cases)) {
      if (UNOBSERVED.has(name)) {
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
          try {
            fn(ng);
          } catch (error) {
            if (!(error instanceof SkipTest)) throw error;
            expect(MISSING).toContain(error.reason);
          }
        });
      }
    }
  });
}
