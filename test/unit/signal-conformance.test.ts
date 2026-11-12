// alien-signals' conformance suite (https://github.com/johnsoncodehk/reactive-framework-test-suite)
// run against stage1's signals (src/signal.ts): from source, whose dev checks follow NODE_ENV, and
// built for production as dist is, so `bun test` covers both modes. Each case brings its own
// assertions. Titles and assertions depend on which table a case is in.
// oxlint-disable vitest/prefer-each node/no-process-env

import { beforeAll, describe, expect, test } from "bun:test";
import { type ReactiveFramework, setExpect, testSuite } from "reactive-framework-test-suite";
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
  // A scope is the root owner: what the cases create in `run` belongs to it
  run: (fn) => {
    api.scope(() => {
      fn();
    });
  },
  batch: api.batch,
  untracked: api.untracked,
});

const frameworks: [string, ReactiveFramework, boolean][] = [
  ["source", adapter(source), process.env.NODE_ENV !== "production"],
  ["production build", adapter(await buildProduction()), false],
];

beforeAll(() => {
  setExpect(expect);
});

// Dev builds throw on misuse inside a computed's getter (unsupported: computeds own nothing, and
// writes or disposals there are not part of the contract); production builds run it unchecked.
// The message each throws, after "stage1: ".
const DEV_ERRORS: Record<string, string> = {
  "#201 computed-triggered disposal: effect skipped and no subscription leak":
    "dispose inside a computed",
  "#202 computed-triggered disposal: sibling effects still notified": "dispose inside a computed",
  "#203 computed disposal with unchanged-value sibling computed": "dispose inside a computed",
  "#242 effect in computed: old inner cleanup (if any) before new eval":
    "effect, computed, scope or defer created inside a computed",
  "#57 computed side effect triggers downstream": "set inside a computed",
  "#179 computed self-increment: intra-run read-after-write values correct":
    "set inside a computed",
};

// Writing inside a computed's getter, which dev builds refuse with a throw (see DEV_ERRORS). These
// cases then take their "computed side effects forbidden" branch, which the suite accepts: they
// return early, asserting nothing of their own.
const DEV_REFUSED = new Set([
  "#52 computed writing to signal",
  "#112 computed side-effect doesn't affect sibling computeds",
  "#135 chained computed inner write: downstream only sees settled",
  "#136 computed inner write unchanged: no downstream notification",
  "#137 computed inner write changed: downstream notified",
  "#138 independent computeds sharing source, one inner-writes",
  "#172 computed writing to own dep: never caches",
  "#181 computed writes multiple signals: downstream sees consistent pair",
  "#182 computed side effect + batch: writes visible after flush",
  "#183 branch switch stops computed side effect",
  "#184 nested computeds: outer reads inner, both have side effects",
  "#185 computed side effect write visible despite later throw",
  "#186 effect observes computed side-channel write during propagation",
]);

const UNSUPPORTED = new Set([
  // Order among sibling effects is unspecified: a write runs its effects newest first
  "#216 effects fire in creation order on shared signal",
  // Creating an effect inside a computed's getter is unsupported (see DEV_ERRORS): in production
  // it belongs to the owner current when the getter runs (here the reading effect), which cleans
  // it up when it re-runs, after the re-evaluation
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
  // Differs from alien-signals: an effect whose first run throws is disposed and `effect` rethrows
  "#88 effect subscription after first-run throw": "unsubscribes",
  // Differs: a throwing effect does not stop the others; the flush finishes, then rethrows
  "#106 effect throw isolation in flush": "continues",
  // Differs: a computed that throws keeps the error and rethrows it until a source changes
  "#86 computed error caching": "caches error",
  "#107 non-Error throw caching": "caches error",
  "#49 inner write re-run through computed chain": "runs 1x per write",
  "#62 infinite loop in effect": "no throw",
  // Differs: writes an effect makes in a flush only queue what they reach, which runs once after
  "#175 effect multi-signal write batching": "batched",
  // Differs: a scope (the adapter's `run`) whose fn throws is disposed with what it made
  "#246 throwing run body child effect cleanup": "disposes children",
  "#244 sibling cleanup order on dispose": "LIFO",
};

/** What a deviating case throws in this mode: a dev check's error, or its own failed assertion. */
const deviation = (name: string, dev: boolean): string | RegExp | undefined => {
  if (dev && name in DEV_ERRORS) return `stage1: ${DEV_ERRORS[name]}`;
  // \S* skips ANSI colours on a TTY
  return UNSUPPORTED.has(name) ? /^\S*expect\(\S*received/u : undefined;
};

describe.each(frameworks)("%s", (_, ng, dev) => {
  for (const { section, cases, type } of testSuite) {
    describe(section, () => {
      for (const [name, fn] of Object.entries(cases)) {
        const thrown = deviation(name, dev);
        const refused = dev && DEV_REFUSED.has(name);
        const quiet = refused ? `Characterization: ${name}` : name;
        if (type === "behavioral") {
          test(`Characterization: ${name}`, () => {
            expect.assertions(1);
            expect(fn(ng)).toBe(BEHAVIOUR[name]);
          });
        } else if (thrown) {
          test(`Accepted tradeoff: ${name}`, () => {
            expect.hasAssertions();
            expect(() => {
              fn(ng);
            }).toThrow(thrown);
          });
        } else if (refused || NO_THROW.has(name)) {
          // Exactly one: the case itself asserts nothing
          test(quiet, () => {
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
