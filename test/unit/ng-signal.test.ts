// Callbacks under test branch on the value they receive.
// oxlint-disable vitest/no-conditional-in-test

import { beforeAll, describe, expect, expectTypeOf, test } from "bun:test";
import * as graphApi from "../../src/ng/signal.ts";
import {
  batch,
  computed,
  effect,
  get,
  set,
  signal,
  type Signal,
  sub,
  untracked,
} from "../../src/ng/signal.ts";
import { buildSignal } from "./ng-build.ts";

type Api = typeof graphApi;

// A separate module instance on which only tier 1 ever runs: no computed or effect installs the graph.
const aloneSpecifier = "../../src/ng/signal.ts?alone";
const aloneApi = (await import(aloneSpecifier)) as Api;

// Two more, on each of which a batch runs before any computed or effect installs the graph.
const earlyBatchSpecifier1 = "../../src/ng/signal.ts?early-batch-1";
const earlyBatchApi1 = (await import(earlyBatchSpecifier1)) as Api;
const earlyBatchSpecifier2 = "../../src/ng/signal.ts?early-batch-2";
const earlyBatchApi2 = (await import(earlyBatchSpecifier2)) as Api;

// Bundles of this module with the tier fixed by a Bun feature flag.
const liteApi = await buildSignal(["STAGE1_SIGNAL_LITE"]);
const graphBuildApi = await buildSignal(["STAGE1_SIGNAL_GRAPH"]);

/** Runs a batched write with a sink on `ng` before the graph installs, then adds an effect. */
const afterEarlyBatch = (ng: Api) => {
  const s = ng.signal(0);
  const seen: string[] = [];
  ng.sub(s, (v) => {
    seen.push(`sink ${v}`);
  });
  ng.batch(() => {
    ng.set(s, 1);
  });
  ng.effect(() => {
    seen.push(`effect ${ng.get(s)}`);
  });
  seen.length = 0;
  return { s, seen };
};

beforeAll(() => {
  // Fixture: an effect has run on this instance before any test, whatever the test order
  effect(() => {})();
});

/** How many of 20 getters, each held only by what `make` built, survive a full collection. */
const survivors = async (make: () => () => unknown): Promise<number> => {
  const refs = Array.from({ length: 20 }, () => new WeakRef(make()));
  await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
  Bun.gc(true);
  return refs.filter((ref) => ref.deref()).length;
};

describe("signal", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(signal).not.toBeAny();
    expectTypeOf(signal).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(signal).parameters.toEqualTypeOf<[value: unknown]>();
    expectTypeOf(signal).returns.toEqualTypeOf<Signal<unknown>>();
    expectTypeOf(signal<number>).returns.toEqualTypeOf<Signal<number>>();
    expectTypeOf<Signal<number>>().toEqualTypeOf<{ readonly v: number }>();
    expectTypeOf(signal(1)).toEqualTypeOf<Signal<number>>();
    expectTypeOf(get).not.toBeAny();
    expectTypeOf(get<number>).parameters.toEqualTypeOf<[s: Signal<number>]>();
    expectTypeOf(get<number>).returns.toEqualTypeOf<number>();
    expectTypeOf(set).not.toBeAny();
    expectTypeOf(set<number>).parameters.toEqualTypeOf<[s: Signal<number>, value: number]>();
    expectTypeOf(set<number>).returns.toBeVoid();
    expectTypeOf(set<number>).returns.not.toBeUndefined();
    expectTypeOf(() => {
      // @ts-expect-error - a number signal takes numbers
      set(signal(1), "1");
      // @ts-expect-error - v is read-only; writes go through set
      signal(1).v = 2;
    }).toBeFunction();
  });
});

describe("sub", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(sub).not.toBeAny();
    expectTypeOf(sub).toBeFunction();
    expectTypeOf(sub<number>).parameters.toEqualTypeOf<
      [s: Signal<number>, fn: (value: number) => void]
    >();
    expectTypeOf(sub<number>).returns.toEqualTypeOf<() => void>();
    expectTypeOf(() => {
      sub(signal(""), (value) => {
        expectTypeOf(value).toEqualTypeOf<string>();
      });
      // @ts-expect-error - a string signal passes strings
      sub(signal(""), (_value: number) => {});
    }).toBeFunction();
  });
});

describe.each([
  ["without the graph", aloneApi],
  ["with the graph", graphApi],
  ["built with STAGE1_SIGNAL_LITE", liteApi],
  ["built with STAGE1_SIGNAL_GRAPH", graphBuildApi],
])("signal and sub, %s", (_, ng: Api) => {
  test("get returns the initial value", () => {
    expect.assertions(1);
    expect(ng.get(ng.signal(1))).toBe(1);
  });

  test("get returns the last value set", () => {
    expect.assertions(1);
    const s = ng.signal(1);
    ng.set(s, 2);
    expect(ng.get(s)).toBe(2);
  });

  test("v holds the last value set", () => {
    expect.assertions(1);
    const s = ng.signal(1);
    ng.set(s, 2);
    expect(s.v).toBe(2);
  });

  test("calls a new sink at once with the current value", () => {
    expect.assertions(1);
    const seen: number[] = [];
    ng.sub(ng.signal(1), (value) => {
      seen.push(value);
    });
    expect(seen).toEqual([1]);
  });

  test("calls a sink with each changed value", () => {
    expect.assertions(1);
    const s = ng.signal(1);
    const seen: number[] = [];
    ng.sub(s, (value) => {
      seen.push(value);
    });
    ng.set(s, 2);
    ng.set(s, 3);
    expect(seen).toEqual([1, 2, 3]);
  });

  test("skips sinks when the value is unchanged", () => {
    expect.assertions(1);
    const s = ng.signal(1);
    const seen: number[] = [];
    ng.sub(s, (value) => {
      seen.push(value);
    });
    ng.set(s, 1);
    expect(seen).toEqual([1]);
  });

  // Values compare with ===, as in alien-signals (was Object.is until 2026-11)
  test("treats NaN as a change", () => {
    expect.assertions(1);
    const s = ng.signal(Number.NaN);
    let calls = 0;
    ng.sub(s, () => {
      calls++;
    });
    ng.set(s, Number.NaN);
    expect(calls).toBe(2);
  });

  test("treats -0 as unchanged from 0", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    let calls = 0;
    ng.sub(s, () => {
      calls++;
    });
    ng.set(s, -0);
    expect(calls).toBe(1);
  });

  test("does not call a disposed sink", () => {
    expect.assertions(1);
    const s = ng.signal(1);
    const seen: number[] = [];
    const dispose = ng.sub(s, (value) => {
      seen.push(value);
    });
    dispose();
    ng.set(s, 2);
    expect(seen).toEqual([1]);
  });

  test("a repeated dispose leaves the other sinks subscribed", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const calls = [0, 0];
    // Sinks subscribed before and after the first dispose
    ng.sub(s, () => {
      calls[0]++;
    });
    const dispose = ng.sub(s, () => {});
    dispose();
    ng.sub(s, () => {
      calls[1]++;
    });
    dispose();
    ng.set(s, 1);
    expect(calls).toEqual([2, 2]);
  });

  test("calls each of 100 sinks once per write", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const calls = Array.from({ length: 100 }, () => 0);
    for (let i = 0; i < 100; i++)
      ng.sub(s, () => {
        calls[i]++;
      });
    ng.set(s, 1);
    expect(calls).toEqual(Array.from({ length: 100 }, () => 2));
  });

  test("a sink disposing itself does not skip the other sinks", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const calls = [0, 0];
    // Sinks on both sides, since the notification order is unspecified
    ng.sub(s, () => {
      calls[0]++;
    });
    const dispose = ng.sub(s, (value) => {
      if (value) dispose();
    });
    ng.sub(s, () => {
      calls[1]++;
    });
    ng.set(s, 1);
    expect(calls).toEqual([2, 2]);
  });

  test("a sink disposed during a notification is not called by it", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    let calls = 0;
    // Whichever sink runs first disposes the other, since the order is unspecified
    let disposeB = (): void => {};
    const disposeA = ng.sub(s, (value) => {
      if (!value) return;
      calls++;
      disposeB();
    });
    disposeB = ng.sub(s, (value) => {
      if (!value) return;
      calls++;
      disposeA();
    });
    ng.set(s, 1);
    expect(calls).toBe(1);
  });

  test("a sink subscribed during a notification is called once for it", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const seen: number[] = [];
    ng.sub(s, (value) => {
      if (value === 1)
        ng.sub(s, (inner) => {
          seen.push(inner);
        });
    });
    ng.set(s, 1);
    expect(seen).toEqual([1]);
  });

  test("a sink writing its signal during its first call gets the new value", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const seen: number[] = [];
    ng.sub(s, (value) => {
      seen.push(value);
      if (value === 0) ng.set(s, 1);
    });
    expect(seen).toEqual([0, 1]);
  });

  test("a sink whose first call throws is not subscribed", () => {
    expect.assertions(2);
    const s = ng.signal(0);
    let calls = 0;
    expect(() => {
      ng.sub(s, () => {
        calls++;
        throw new Error("sink failed");
      });
    }).toThrow("sink failed");
    ng.set(s, 1);
    expect(calls).toBe(1);
  });

  test("set rethrows a sink's error", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    ng.sub(s, (value) => {
      if (value) throw new Error("sink failed");
    });
    expect(() => {
      ng.set(s, 1);
    }).toThrow("sink failed");
  });

  test("a throwing sink does not stop the other sinks", () => {
    expect.assertions(2);
    const s = ng.signal(0);
    const calls = [0, 0];
    // Sinks on both sides, since the notification order is unspecified
    ng.sub(s, () => {
      calls[0]++;
    });
    ng.sub(s, (value) => {
      if (value) throw new Error("sink failed");
    });
    ng.sub(s, () => {
      calls[1]++;
    });
    expect(() => {
      ng.set(s, 1);
    }).toThrow();
    expect(calls).toEqual([2, 2]);
  });

  test("set throws the first error when several sinks throw", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    let calls = 0;
    const fail = (value: number): void => {
      if (value) throw new Error(calls++ ? "later sink failed" : "first sink failed");
    };
    ng.sub(s, fail);
    ng.sub(s, fail);
    expect(() => {
      ng.set(s, 1);
    }).toThrow("first sink failed");
  });

  test("a set inside a sink throws that set's first error into the sink", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const t = ng.signal(0);
    ng.sub(t, (value) => {
      if (value) throw new Error("t failed");
    });
    // On both sides and throwing once, so a sink has thrown before the nested set in either order
    let failed = false;
    const fail = (value: number): void => {
      if (!value || failed) return;
      failed = true;
      throw new Error("s failed");
    };
    ng.sub(s, fail);
    let caught: unknown;
    ng.sub(s, (value) => {
      if (!value) return;
      try {
        ng.set(t, value);
      } catch (error) {
        caught = error;
      }
    });
    ng.sub(s, fail);
    try {
      ng.set(s, 1);
    } catch {
      // "s failed", the next test's subject
    }
    expect(caught).toHaveProperty("message", "t failed");
  });

  test("set throws its first error after a sink catches one from a nested set", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const t = ng.signal(0);
    ng.sub(t, (value) => {
      if (value) throw new Error("t failed");
    });
    // On both sides and throwing once, so a sink has thrown before the nested set in either order
    let failed = false;
    const fail = (value: number): void => {
      if (!value || failed) return;
      failed = true;
      throw new Error("s failed");
    };
    ng.sub(s, fail);
    ng.sub(s, (value) => {
      if (!value) return;
      try {
        ng.set(t, value);
      } catch {
        // Handled here, so it must not surface from the outer set
      }
    });
    ng.sub(s, fail);
    expect(() => {
      ng.set(s, 1);
    }).toThrow("s failed");
  });
});

describe("untracked", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(untracked).not.toBeAny();
    expectTypeOf(untracked).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(untracked).parameters.toEqualTypeOf<[fn: () => unknown]>();
    expectTypeOf(untracked<number>).parameters.toEqualTypeOf<[fn: () => number]>();
    expectTypeOf(untracked<number>).returns.toEqualTypeOf<number>();
  });

  test("returns fn's value", () => {
    expect.assertions(1);
    expect(untracked(() => 1)).toBe(1);
  });

  test("returns fn's value in a STAGE1_SIGNAL_LITE build", () => {
    expect.assertions(1);
    expect(liteApi.untracked(() => 1)).toBe(1);
  });

  test("reads inside it do not subscribe the effect running it", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      untracked(() => get(s));
    });
    set(s, 1);
    expect(runs).toBe(1);
  });

  test("an effect subscribes what it reads after an untracked fn throws", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      try {
        untracked(() => {
          throw new Error("fn failed");
        });
      } catch {
        // the effect carries on
      }
      get(s);
    });
    set(s, 1);
    expect(runs).toBe(2);
  });
});

describe("effect", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(effect).not.toBeAny();
    expectTypeOf(effect).toBeFunction();
    // oxlint-disable-next-line typescript/no-invalid-void-type
    expectTypeOf(effect).parameters.toEqualTypeOf<[fn: () => (() => void) | void]>();
    expectTypeOf(effect).returns.toEqualTypeOf<() => void>();
  });

  test("throws in a STAGE1_SIGNAL_LITE build, naming the flag", () => {
    expect.assertions(1);
    expect(() => liteApi.effect(() => {})).toThrow("STAGE1_SIGNAL_LITE");
  });

  test("runs at once", () => {
    expect.assertions(1);
    let runs = 0;
    effect(() => {
      runs++;
    });
    expect(runs).toBe(1);
  });

  test("re-runs when a signal it read changes", () => {
    expect.assertions(1);
    const s = signal(1);
    const seen: number[] = [];
    effect(() => {
      seen.push(get(s));
    });
    set(s, 2);
    expect(seen).toEqual([1, 2]);
  });

  test("does not re-run for a signal it no longer reads", () => {
    expect.assertions(1);
    const useA = signal(true);
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      if (get(useA)) get(a);
      else get(b);
    });
    set(useA, false);
    set(a, 1);
    expect(runs).toBe(2);
  });

  test("does not re-run once disposed", () => {
    expect.assertions(1);
    const s = signal(1);
    let runs = 0;
    const dispose = effect(() => {
      runs++;
      get(s);
    });
    dispose();
    set(s, 2);
    expect(runs).toBe(1);
  });

  test("calls the cleanup its last run returned before re-running", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    effect(() => {
      const value = get(s);
      log.push(`run ${value}`);
      return () => {
        log.push(`cleanup ${value}`);
      };
    });
    set(s, 1);
    expect(log).toEqual(["run 0", "cleanup 0", "run 1"]);
  });

  test("calls the cleanup once when disposed twice", () => {
    expect.assertions(1);
    let cleanups = 0;
    const dispose = effect(() => () => {
      cleanups++;
    });
    dispose();
    dispose();
    expect(cleanups).toBe(1);
  });

  test("a cleanup's reads do not subscribe the effect disposing it", () => {
    expect.assertions(1);
    const other = signal(0);
    const stop = signal(false);
    const dispose = effect(() => () => {
      get(other);
    });
    let runs = 0;
    effect(() => {
      runs++;
      if (get(stop)) dispose();
    });
    set(stop, true);
    set(other, 1);
    expect(runs).toBe(2);
  });

  test("does not re-run for a value read through v", () => {
    expect.assertions(1);
    const s = signal(1);
    let runs = 0;
    effect(() => {
      runs++;
      // oxlint-disable-next-line no-unused-expressions
      s.v;
    });
    set(s, 2);
    expect(runs).toBe(1);
  });

  test("runs once per write when it reads a signal and a computed of it", () => {
    expect.assertions(1);
    const s = signal(0);
    const double = computed(() => get(s) * 2);
    let runs = 0;
    effect(() => {
      runs++;
      get(s);
      double();
    });
    set(s, 1);
    expect(runs).toBe(2);
  });

  test("a nested effect is disposed when its parent re-runs", () => {
    expect.assertions(1);
    const outer = signal(0);
    const inner = signal(0);
    let innerRuns = 0;
    effect(() => {
      get(outer);
      effect(() => {
        get(inner);
        innerRuns++;
      });
    });
    set(outer, 1);
    innerRuns = 0;
    set(inner, 1);
    expect(innerRuns).toBe(1);
  });

  test("a nested effect is disposed before its parent re-runs", () => {
    expect.assertions(1);
    const outer = signal(0);
    const inner = signal(0);
    let innerRuns = 0;
    effect(() => {
      set(inner, get(outer));
      effect(() => {
        get(inner);
        innerRuns++;
      });
    });
    innerRuns = 0;
    set(outer, 1);
    expect(innerRuns).toBe(1);
  });

  test("a parent effect re-runs before its nested effects", () => {
    expect.assertions(1);
    const a = signal(0);
    const double = computed(() => get(a) * 2);
    let innerRuns = 0;
    effect(() => {
      // The nested effect subscribes to `a` before the parent's computed does
      effect(() => {
        get(a);
        innerRuns++;
      });
      double();
    });
    innerRuns = 0;
    set(a, 1);
    expect(innerRuns).toBe(1);
  });

  // Adapted from reactive-framework-test-suite #212.
  test("a write it makes through a computed leaves later writes propagating", () => {
    expect.assertions(1);
    const s = signal(0);
    const c = computed(() => get(s));
    effect(() => {
      if (c() > 0) set(s, 0);
    });
    const seen: number[] = [];
    for (const value of [1, 2, 3]) {
      set(s, value);
      seen.push(s.v);
    }
    expect(seen).toEqual([0, 0, 0]);
  });

  // Adapted from reactive-framework-test-suite #224.
  test("sees a computed refreshed by a sibling effect's write in the same flush", () => {
    expect.assertions(1);
    const a = signal(0);
    const b = signal(0);
    const sum = computed(() => get(a) + get(b));
    effect(() => {
      if (get(a) === 1) set(b, 10);
    });
    const seen: number[] = [];
    effect(() => {
      seen.push(sum());
    });
    set(a, 1);
    expect(seen.at(-1)).toBe(11);
  });

  test("a nested effect is disposed with its parent", () => {
    expect.assertions(1);
    const inner = signal(0);
    let innerRuns = 0;
    const dispose = effect(() => {
      effect(() => {
        get(inner);
        innerRuns++;
      });
    });
    dispose();
    set(inner, 1);
    expect(innerRuns).toBe(1);
  });

  test("set rethrows an effect's error", () => {
    expect.assertions(1);
    const s = signal(0);
    effect(() => {
      if (get(s)) throw new Error("effect failed");
    });
    expect(() => {
      set(s, 1);
    }).toThrow("effect failed");
  });

  test("a throwing effect does not stop the effects after it", () => {
    expect.assertions(2);
    const s = signal(0);
    effect(() => {
      if (get(s)) throw new Error("effect failed");
    });
    const seen: number[] = [];
    effect(() => {
      seen.push(get(s));
    });
    expect(() => {
      set(s, 1);
    }).toThrow();
    expect(seen).toEqual([0, 1]);
  });

  test("a throwing effect re-runs on the next change", () => {
    expect.assertions(2);
    const s = signal(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(get(s));
      if (get(s) === 1) throw new Error("effect failed");
    });
    expect(() => {
      set(s, 1);
    }).toThrow();
    set(s, 2);
    expect(seen).toEqual([0, 1, 2]);
  });

  test("set throws the first error when several effects throw", () => {
    expect.assertions(1);
    const s = signal(0);
    let calls = 0;
    const fail = (): void => {
      if (get(s)) throw new Error(calls++ ? "later effect failed" : "first effect failed");
    };
    effect(fail);
    effect(fail);
    expect(() => {
      set(s, 1);
    }).toThrow("first effect failed");
  });

  test("a throwing sink does not stop the effects", () => {
    expect.assertions(2);
    const s = signal(0);
    sub(s, (value) => {
      if (value) throw new Error("sink failed");
    });
    const seen: number[] = [];
    effect(() => {
      seen.push(get(s));
    });
    expect(() => {
      set(s, 1);
    }).toThrow("sink failed");
    expect(seen).toEqual([0, 1]);
  });

  const writes: [string, (s: Signal<number>, value: number) => void][] = [
    ["set", set],
    [
      "batch",
      (s, value) => {
        batch(() => {
          set(s, value);
        });
      },
    ],
  ];

  test.each(writes)("a %s inside it throws its own first error into it", (_, write) => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    sub(t, (value) => {
      if (value) throw new Error("t failed");
    });
    // On both sides and throwing once, so an effect has thrown before the nested write in either order
    let failed = false;
    const fail = (): void => {
      const value = get(s);
      if (!value || failed) return;
      failed = true;
      throw new Error("s failed");
    };
    effect(fail);
    let caught: unknown;
    effect(() => {
      const value = get(s);
      if (!value) return;
      try {
        write(t, value);
      } catch (error) {
        caught = error;
      }
    });
    effect(fail);
    try {
      set(s, 1);
    } catch {
      // "s failed", the next test's subject
    }
    expect(caught).toHaveProperty("message", "t failed");
  });

  test.each(writes)(
    "set throws its first error after it catches one from a nested %s",
    (_, write) => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      sub(t, (value) => {
        if (value) throw new Error("t failed");
      });
      // On both sides and throwing once, so an effect has thrown before the nested write in either order
      let failed = false;
      const fail = (): void => {
        const value = get(s);
        if (!value || failed) return;
        failed = true;
        throw new Error("s failed");
      };
      effect(fail);
      effect(() => {
        const value = get(s);
        if (!value) return;
        try {
          write(t, value);
        } catch {
          // Handled here, so it must not surface from the outer set
        }
      });
      effect(fail);
      expect(() => {
        set(s, 1);
      }).toThrow("s failed");
    },
  );

  test.each(writes)("subscribes what it reads after a %s to a signal with sinks", (_, write) => {
    expect.assertions(1);
    const relay = signal(0);
    const other = signal(0);
    sub(relay, () => {});
    let runs = 0;
    effect(() => {
      runs++;
      write(relay, 1);
      get(other);
    });
    set(other, 1);
    expect(runs).toBe(2);
  });

  test("a sink's reads do not subscribe the effect whose write triggered it", () => {
    expect.assertions(1);
    const trigger = signal(0);
    const relay = signal(0);
    const other = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      set(relay, get(trigger));
    });
    sub(relay, () => {
      get(other);
    });
    set(trigger, 1);
    set(other, 1);
    expect(runs).toBe(2);
  });

  test("a sink subscribed inside it does not subscribe it to the sink's reads", () => {
    expect.assertions(1);
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      sub(a, () => {
        get(b);
      });
    });
    set(b, 1);
    expect(runs).toBe(1);
  });

  test("Characterization: an effect writing a signal it read does not re-run itself", () => {
    expect.assertions(2);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      set(s, get(s) + 1);
    });
    expect(runs).toBe(1);
    expect(s.v).toBe(1);
  });

  // Conservative stack scanning can keep the odd one alive; a leak keeps all of them.
  test("Regression: a re-run releases the signal's previous value", async () => {
    expect.assertions(3);
    const live: Signal<() => number>[] = [];
    let runs = 0;
    const kept = await survivors(() => {
      const previous = () => 0;
      const s = signal(previous);
      effect(() => {
        runs++;
        get(s);
      });
      set(s, () => 1);
      live.push(s);
      return previous;
    });
    expect(kept).toBeLessThan(10);
    expect(runs).toBe(40); // each effect re-ran, so the graph saw the write
    // Keeps each signal and its effect alive past the collection
    expect(live.map((s) => s.v())).toEqual(Array.from({ length: 20 }, () => 1));
  });

  describe.each([
    ["with the graph", graphApi],
    ["built with STAGE1_SIGNAL_GRAPH", graphBuildApi],
  ])("%s", (_, ng: Api) => {
    // Conservative stack scanning can keep the odd one alive; a leak keeps all of them.
    test("Regression: a re-run that stops reading a written signal releases its previous value", async () => {
      expect.assertions(3);
      const live: Signal<() => number>[] = [];
      let runs = 0;
      const kept = await survivors(() => {
        const previous = () => 0;
        const s = ng.signal(previous);
        const read = ng.signal(true);
        // Reads `read` first, so the re-run is decided before `s` is checked
        ng.effect(() => {
          runs++;
          if (ng.get(read)) ng.get(s);
        });
        ng.batch(() => {
          ng.set(s, () => 1);
          ng.set(read, false);
        });
        live.push(s);
        return previous;
      });
      expect(kept).toBeLessThan(10);
      expect(runs).toBe(40); // each effect re-ran without reading `s`
      // Keeps each signal alive past the collection
      expect(live.map((s) => s.v())).toEqual(Array.from({ length: 20 }, () => 1));
    });

    // Conservative stack scanning can keep the odd one alive; a leak keeps all of them.
    test("Regression: a cleanup that throws releases its effect", async () => {
      expect.assertions(3);
      const live: Signal<number>[] = [];
      let errors = 0;
      const kept = await survivors(() => {
        const s = ng.signal(0);
        const fn = () => {
          ng.get(s);
          return () => {
            throw new Error("cleanup failed");
          };
        };
        ng.effect(fn);
        try {
          ng.set(s, 1);
        } catch {
          errors++;
        }
        live.push(s);
        return fn;
      });
      expect(kept).toBeLessThan(10);
      expect(errors).toBe(20); // each cleanup threw
      expect(live).toHaveLength(20); // keeps each signal alive past the collection
    });

    test("Regression: a child's throwing cleanup does not stop its parent re-running", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      let runs = 0;
      ng.effect(() => {
        runs++;
        ng.get(s);
        ng.effect(() => () => {
          throw new Error("cleanup failed");
        });
      });
      expect(() => {
        ng.set(s, 1);
      }).toThrow("cleanup failed");
      expect(runs).toBe(2);
    });

    test("Regression: disposing an effect disposes every child when one's cleanup throws", () => {
      expect.assertions(2);
      let cleanups = 0;
      const dispose = ng.effect(() => {
        ng.effect(() => () => {
          throw new Error("cleanup failed");
        });
        ng.effect(() => () => {
          cleanups++;
        });
      });
      expect(dispose).toThrow("cleanup failed");
      expect(cleanups).toBe(1);
    });

    test("disposing during a write that already caught an error does not throw that error", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      // Subscribed first, so it throws before the effect below disposes
      ng.effect(() => {
        if (ng.get(s)) throw new Error("effect failed");
      });
      const dispose = ng.effect(() => {});
      let threw: unknown = "nothing";
      ng.effect(() => {
        if (!ng.get(s)) return;
        try {
          dispose();
        } catch (error) {
          threw = error;
        }
      });
      expect(() => {
        ng.set(s, 1);
      }).toThrow("effect failed");
      expect(threw).toBe("nothing");
    });

    test("Regression: calls the cleanup returned by the run that disposed the effect", () => {
      expect.assertions(1);
      const s = ng.signal(0);
      const log: string[] = [];
      const dispose = ng.effect(() => {
        const value = ng.get(s);
        if (value) dispose();
        return () => {
          log.push(`cleanup ${value}`);
        };
      });
      ng.set(s, 1);
      expect(log).toEqual(["cleanup 0", "cleanup 1"]);
    });

    test("Regression: a child created after its effect disposed itself is disposed with it", () => {
      expect.assertions(1);
      const stop = ng.signal(false);
      const s = ng.signal(0);
      let runs = 0;
      const dispose = ng.effect(() => {
        if (!ng.get(stop)) return;
        dispose();
        ng.effect(() => {
          runs++;
          ng.get(s);
        });
      });
      ng.set(stop, true);
      ng.set(s, 1);
      expect(runs).toBe(1);
    });

    // Conservative stack scanning can keep the odd one alive; a leak keeps all of them.
    test("Regression: an effect that disposes itself is released by what it reads afterwards", async () => {
      expect.assertions(2);
      const live: Signal<number>[] = [];
      const kept = await survivors(() => {
        const stop = ng.signal(false);
        const s = ng.signal(0);
        let dispose = (): void => {};
        const fn = () => {
          if (ng.get(stop)) dispose();
          ng.get(s);
        };
        dispose = ng.effect(fn);
        ng.set(stop, true);
        live.push(s);
        return fn;
      });
      expect(kept).toBeLessThan(10);
      expect(live).toHaveLength(20); // keeps each signal alive past the collection
    });

    // Reads only the computed, so it throws while the effect is checked, before the effect runs
    test("Regression: an effect re-runs once a computed that threw while it was checked recovers", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      const c = ng.computed(() => {
        if (ng.get(s) === 1) throw new Error("computed failed");
        return ng.get(s);
      });
      const seen: number[] = [];
      ng.effect(() => {
        seen.push(c());
      });
      expect(() => {
        ng.set(s, 1);
      }).toThrow("computed failed");
      ng.set(s, 2);
      expect(seen).toEqual([0, 2]);
    });

    test("Regression: an effect re-runs once a computed between it and one that threw recovers", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      const inner = ng.computed(() => {
        if (ng.get(s) === 1) throw new Error("computed failed");
        return ng.get(s);
      });
      const outer = ng.computed(() => inner() * 10);
      const seen: number[] = [];
      ng.effect(() => {
        seen.push(outer());
      });
      expect(() => {
        ng.set(s, 1);
      }).toThrow("computed failed");
      ng.set(s, 2);
      expect(seen).toEqual([0, 20]);
    });

    test("Regression: an effect re-runs once two computeds that threw while it was checked recover", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      const a = ng.computed(() => {
        if (ng.get(s) === 1) throw new Error("computed failed");
        return ng.get(s);
      });
      const b = ng.computed(() => {
        if (ng.get(s) === 1) throw new Error("computed failed");
        return ng.get(s) * 10;
      });
      const seen: number[] = [];
      ng.effect(() => {
        seen.push(a() + b());
      });
      expect(() => {
        ng.set(s, 1);
      }).toThrow("computed failed");
      ng.set(s, 2);
      expect(seen).toEqual([0, 22]);
    });

    // Reads t first, so t's change runs the effect, and the run reads the computed as it throws
    test("Regression: an effect stays subscribed to a computed that threw while it ran", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      const t = ng.signal(0);
      const c = ng.computed(() => {
        if (ng.get(s) === 1) throw new Error("computed failed");
        return ng.get(s);
      });
      const seen: number[] = [];
      ng.effect(() => {
        seen.push(ng.get(t) + c());
      });
      expect(() => {
        ng.batch(() => {
          ng.set(t, 1);
          ng.set(s, 1);
        });
      }).toThrow("computed failed");
      ng.set(s, 2);
      expect(seen).toEqual([0, 3]);
    });

    test("Regression: an effect stays subscribed to a computed whose first evaluation threw", () => {
      expect.assertions(1);
      const s = ng.signal(0);
      const c = ng.computed(() => {
        if (ng.get(s) === 0) throw new Error("computed failed");
        return ng.get(s);
      });
      const seen: (number | string)[] = [];
      ng.effect(() => {
        try {
          seen.push(c());
        } catch (error) {
          seen.push((error as Error).message);
        }
      });
      ng.set(s, 1);
      expect(seen).toEqual(["computed failed", 1]);
    });

    test("Regression: an effect whose first run throws is disposed, with its children", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      let runs = 0;
      let childRuns = 0;
      expect(() => {
        ng.effect(() => {
          runs++;
          ng.effect(() => {
            childRuns++;
            ng.get(s);
          });
          if (!ng.get(s)) throw new Error("effect failed");
        });
      }).toThrow("effect failed");
      ng.set(s, 1);
      expect([runs, childRuns]).toEqual([1, 1]);
    });

    test("a write throws a failed first run's error, not its children's cleanup errors", () => {
      expect.assertions(1);
      const s = ng.signal(0);
      // Re-runs on the write and creates an effect whose first run fails after creating a child
      ng.effect(() => {
        if (!ng.get(s)) return;
        ng.effect(() => {
          ng.effect(() => () => {
            throw new Error("cleanup failed");
          });
          throw new Error("first run failed");
        });
      });
      expect(() => {
        ng.set(s, 1);
      }).toThrow("first run failed");
    });

    test("Regression: an effect that queues its own child as a batch ends keeps running", () => {
      expect.assertions(1);
      const x = ng.signal(0);
      const y = ng.signal(0);
      const trigger = ng.signal(0);
      let runs = 0;
      ng.effect(() => {
        runs++;
        const value = ng.get(x);
        ng.effect(() => {
          ng.get(y);
        });
        // y has no sinks, so this write queues the child, and this effect with it, without a flush
        if (value) ng.set(y, value);
      });
      // x has sinks, so the batch end's write to it notifies and flushes at once
      ng.sub(x, () => {});
      ng.sub(trigger, (value) => {
        if (value) ng.set(x, 1);
      });
      ng.batch(() => {
        ng.set(trigger, 1);
      });
      ng.set(x, 2);
      expect(runs).toBe(3);
    });

    test("Regression: an effect re-runs and gets the error when a computed it reads starts throwing", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      const c = ng.computed(() => {
        if (ng.get(s) === 1) throw new Error("computed failed");
        return ng.get(s);
      });
      const seen: (number | string)[] = [];
      ng.effect(() => {
        try {
          seen.push(c());
        } catch (error) {
          seen.push((error as Error).message);
        }
      });
      expect(() => {
        ng.set(s, 1);
      }).not.toThrow(); // the effect handles it
      expect(seen).toEqual([0, "computed failed"]);
    });
  });
});

describe("computed", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(computed).not.toBeAny();
    expectTypeOf(computed).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(computed).parameters.toEqualTypeOf<[fn: () => unknown]>();
    expectTypeOf(computed).returns.toEqualTypeOf<() => unknown>();
    expectTypeOf(computed<number>).parameters.toEqualTypeOf<[fn: () => number]>();
    expectTypeOf(computed<number>).returns.toEqualTypeOf<() => number>();
    expectTypeOf(computed(() => "")).toEqualTypeOf<() => string>();
  });

  test("throws in a STAGE1_SIGNAL_LITE build, naming the flag", () => {
    expect.assertions(1);
    expect(() => liteApi.computed(() => 1)).toThrow("STAGE1_SIGNAL_LITE");
  });

  test("returns its getter's value", () => {
    expect.assertions(1);
    const s = signal(2);
    expect(computed(() => get(s) * 2)()).toBe(4);
  });

  test("does not run its getter before it is read", () => {
    expect.assertions(1);
    let runs = 0;
    computed(() => runs++);
    expect(runs).toBe(0);
  });

  test("returns a new value after a source changes", () => {
    expect.assertions(1);
    const s = signal(1);
    const double = computed(() => get(s) * 2);
    double();
    set(s, 2);
    expect(double()).toBe(4);
  });

  test("does not re-run its getter when read again with nothing written", () => {
    expect.assertions(1);
    let runs = 0;
    const s = signal(1);
    const c = computed(() => {
      runs++;
      return get(s);
    });
    c();
    c();
    expect(runs).toBe(1);
  });

  test("runs a diamond's join once per write", () => {
    expect.assertions(1);
    const a = signal(0);
    const mids = Array.from({ length: 10 }, (_, i) => computed(() => get(a) + i));
    let joinRuns = 0;
    const join = computed(() => {
      joinRuns++;
      return mids.reduce((total, mid) => total + mid(), 0);
    });
    effect(() => {
      join();
    });
    joinRuns = 0;
    set(a, 1);
    expect(joinRuns).toBe(1);
  });

  test("runs an effect on a diamond once per write", () => {
    expect.assertions(1);
    const a = signal(0);
    const mids = Array.from({ length: 10 }, (_, i) => computed(() => get(a) + i));
    let runs = 0;
    effect(() => {
      runs++;
      for (const mid of mids) mid();
    });
    set(a, 1);
    expect(runs).toBe(2);
  });

  test("an effect on a diamond never sees old and new values mixed", () => {
    expect.assertions(1);
    const a = signal(0);
    const mids = Array.from({ length: 10 }, (_, i) => computed(() => get(a) + i));
    const sums: number[] = [];
    effect(() => {
      sums.push(mids.reduce((total, mid) => total + mid(), 0));
    });
    set(a, 1);
    set(a, 2);
    // Sum of (a + i) for i in 0..9 is 10a + 45.
    expect(sums).toEqual([45, 55, 65]);
  });

  test("runs no getter of an unobserved chain on write", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    let tail = (): number => get(s);
    for (let i = 0; i < 50; i++) {
      const prev = tail;
      // oxlint-disable-next-line no-loop-func
      tail = computed(() => {
        runs++;
        return prev() + 1;
      });
    }
    tail();
    runs = 0;
    set(s, 1);
    expect(runs).toBe(0);
  });

  test("an unchanged result does not re-run its effect", () => {
    expect.assertions(1);
    const s = signal(1);
    const positive = computed(() => get(s) > 0);
    let runs = 0;
    effect(() => {
      runs++;
      positive();
    });
    set(s, 2);
    expect(runs).toBe(1);
  });

  // Values compare with ===, as in alien-signals (was Object.is until 2026-11)
  test("a NaN result again re-runs its effect", () => {
    expect.assertions(1);
    const s = signal(1);
    const nan = computed(() => get(s) * Number.NaN);
    let runs = 0;
    effect(() => {
      runs++;
      nan();
    });
    set(s, 2);
    expect(runs).toBe(2);
  });

  // Conservative stack scanning can keep the odd one alive; a leak keeps all of them.
  test("is garbage collected after an untracked read", async () => {
    expect.assertions(2);
    const s = signal(1);
    const kept = await survivors(() => {
      const getter = () => get(s);
      computed(getter)();
      return getter;
    });
    expect(kept).toBeLessThan(10);
    expect(s.v).toBe(1); // keeps the source alive past the collection
  });

  test("is garbage collected after its last effect is disposed", async () => {
    expect.assertions(2);
    const s = signal(1);
    const kept = await survivors(() => {
      const getter = () => get(s);
      const c = computed(getter);
      effect(() => {
        c();
      })();
      return getter;
    });
    expect(kept).toBeLessThan(10);
    expect(s.v).toBe(1); // keeps the source alive past the collection
  });

  test("is garbage collected after an untracked read once its effects are gone", async () => {
    expect.assertions(2);
    const s = signal(1);
    const kept = await survivors(() => {
      const getter = () => get(s);
      const c = computed(getter);
      effect(() => {
        c();
      })();
      c();
      return getter;
    });
    expect(kept).toBeLessThan(10);
    expect(s.v).toBe(1); // keeps the source alive past the collection
  });

  test("updates through a 100k-deep chain", () => {
    expect.assertions(1);
    const s = signal(0);
    let tail = (): number => get(s);
    let dispose = effect(() => {
      tail();
    });
    // Each link is observed as it is built, so only the update walks the whole chain.
    for (let i = 0; i < 100_000; i++) {
      const prev = tail;
      const next = computed(() => prev() + 1);
      const disposeNext = effect(() => {
        next();
      });
      dispose();
      dispose = disposeNext;
      tail = next;
    }
    const end = tail;
    let seen = 0;
    effect(() => {
      seen = end();
    });
    dispose();
    set(s, 1);
    expect(seen).toBe(100_001);
  });

  describe.each([
    ["with the graph", graphApi],
    ["built with STAGE1_SIGNAL_GRAPH", graphBuildApi],
  ])("%s", (_, ng: Api) => {
    // Reads t first, so t's change re-evaluates it, and that evaluation reads the other as it throws
    test("Regression: a computed stays subscribed to a computed that threw while it evaluated", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      const t = ng.signal(0);
      const inner = ng.computed(() => {
        if (ng.get(s) === 1) throw new Error("computed failed");
        return ng.get(s);
      });
      const outer = ng.computed(() => ng.get(t) + inner());
      const seen: number[] = [];
      ng.effect(() => {
        seen.push(outer());
      });
      expect(() => {
        ng.batch(() => {
          ng.set(t, 1);
          ng.set(s, 1);
        });
      }).toThrow("computed failed");
      ng.set(s, 2);
      expect(seen).toEqual([0, 3]);
    });

    test("a computed that writes its own source and throws does not re-evaluate in a loop", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      const count = ng.signal(0);
      const c = ng.computed(() => {
        const n = ng.get(count);
        // Throws only below the cap, so a loop ends there instead of hanging
        if (ng.get(s) === 1 && n < 50) {
          ng.set(count, n + 1);
          throw new Error("computed failed");
        }
        return ng.get(s);
      });
      ng.effect(() => {
        c();
      });
      expect(() => {
        ng.set(s, 1);
      }).toThrow("computed failed");
      expect(ng.get(count)).toBeLessThan(50);
    });

    test("Regression: reading a computed that threw rethrows its error without evaluating it again", () => {
      expect.assertions(2);
      const s = ng.signal(0);
      let evaluations = 0;
      const c = ng.computed(() => {
        evaluations++;
        if (ng.get(s) === 1) throw new Error("computed failed");
        return ng.get(s);
      });
      // Reads s first, so it runs and catches the throw itself, and keeps c watched
      ng.effect(() => {
        ng.get(s);
        try {
          c();
        } catch {
          // ignored: this effect only keeps c watched
        }
      });
      ng.set(s, 1);
      const after = evaluations;
      // A block body: Bun's toThrow also passes when the function returns an Error
      expect(() => {
        c();
      }).toThrow("computed failed");
      expect(evaluations).toBe(after);
    });
  });
});

describe("batch", () => {
  test("bundles without the graph when nothing else uses it", async () => {
    expect.assertions(1);
    const entry = "/virtual/entry.ts";
    const source = JSON.stringify(`${import.meta.dir}/../../src/ng/signal.ts`);
    const out = await Bun.build({
      entrypoints: [entry],
      files: { [entry]: `export { batch, get, set, signal, sub, untracked } from ${source};` },
      minify: true,
      target: "browser",
    });
    const code = await out.outputs[0].text();
    // Tier 1 with batch is about 1 KB; the graph adds over 2 KB
    expect(code.length).toBeLessThan(1500);
  });

  test("throws in a STAGE1_SIGNAL_LITE build, naming the flag", () => {
    expect.assertions(1);
    expect(() => {
      liteApi.batch(() => {});
    }).toThrow("STAGE1_SIGNAL_LITE");
  });

  test("types", () => {
    expect.assertions(0);
    expectTypeOf(batch).not.toBeAny();
    expectTypeOf(batch).toBeFunction();
    expectTypeOf(batch).parameters.toEqualTypeOf<[fn: () => void]>();
    expectTypeOf(batch).returns.toBeVoid();
    expectTypeOf(batch).returns.not.toBeUndefined();
  });

  test("defers effects until it ends", () => {
    expect.assertions(2);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      get(s);
    });
    batch(() => {
      set(s, 1);
      expect(runs).toBe(1);
    });
    expect(runs).toBe(2);
  });

  test("rethrows an effect's error when it ends", () => {
    expect.assertions(1);
    const s = signal(0);
    effect(() => {
      if (get(s)) throw new Error("effect failed");
    });
    expect(() => {
      batch(() => {
        set(s, 1);
      });
    }).toThrow("effect failed");
  });

  describe.each([
    ["with the graph", graphApi],
    ["built with STAGE1_SIGNAL_GRAPH", graphBuildApi],
  ])("%s", (_, ng: Api) => {
    test("rethrows a cleanup's error raised inside it when it ends", () => {
      expect.assertions(1);
      const s = ng.signal(0);
      // Each evaluation replaces the child effect, disposing the last one
      const c = ng.computed(() => {
        ng.effect(() => () => {
          throw new Error("cleanup failed");
        });
        return ng.get(s);
      });
      ng.effect(() => {
        c();
      });
      expect(() => {
        ng.batch(() => {
          ng.set(s, 1);
          c();
        });
      }).toThrow("cleanup failed");
    });
  });

  test("a computed read inside it leaves each sink one notification", () => {
    expect.assertions(1);
    const s = signal(0);
    const double = computed(() => get(s) * 2);
    effect(() => {
      double();
    });
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
    });
    batch(() => {
      set(s, 1);
      double();
      set(s, 2);
    });
    expect(seen).toEqual([0, 2]);
  });

  test("disposing a signal's last effect inside it leaves each sink one notification", () => {
    expect.assertions(1);
    const s = signal(0);
    const dispose = effect(() => {
      get(s);
    });
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
    });
    batch(() => {
      set(s, 1);
      dispose();
      set(s, 2);
    });
    expect(seen).toEqual([0, 2]);
  });

  test("skips an effect when the batch restores the value", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      get(s);
    });
    batch(() => {
      set(s, 1);
      set(s, 0);
    });
    expect(runs).toBe(1);
  });

  test("runs deferred effects when the outermost batch ends", () => {
    expect.assertions(2);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      get(s);
    });
    batch(() => {
      batch(() => {
        set(s, 1);
      });
      expect(runs).toBe(1);
    });
    expect(runs).toBe(2);
  });

  test("does not run an effect disposed during it", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      runs++;
      get(s);
    });
    batch(() => {
      set(s, 1);
      dispose();
    });
    expect(runs).toBe(1);
  });

  test("an effect created during it re-runs when the value later changes back", () => {
    expect.assertions(1);
    const s = signal(0);
    const disposeFirst = effect(() => {
      get(s);
    });
    const seen: number[] = [];
    batch(() => {
      set(s, 1);
      effect(() => {
        seen.push(get(s));
      });
      disposeFirst();
    });
    set(s, 0);
    expect(seen).toEqual([1, 0]);
  });

  test("a computed read inside it reflects the writes so far", () => {
    expect.assertions(1);
    const s = signal(1);
    const double = computed(() => get(s) * 2);
    effect(() => {
      double();
    });
    batch(() => {
      set(s, 2);
      expect(double()).toBe(4);
    });
  });

  test("an effect on a computed read during it still re-runs when it ends", () => {
    expect.assertions(1);
    const s = signal(1);
    const double = computed(() => get(s) * 2);
    const seen: number[] = [];
    effect(() => {
      seen.push(double());
    });
    batch(() => {
      set(s, 2);
      double();
    });
    expect(seen).toEqual([2, 4]);
  });

  test("a throwing function does not leave later writes deferred", () => {
    expect.assertions(2);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      get(s);
    });
    expect(() => {
      batch(() => {
        throw new Error("batch failed");
      });
    }).toThrow("batch failed");
    set(s, 1);
    expect(runs).toBe(2);
  });

  test("a deferred sink's reads do not subscribe the effect whose batch ended", () => {
    expect.assertions(1);
    const trigger = signal(0);
    const relay = signal(0);
    const other = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      const value = get(trigger);
      batch(() => {
        set(relay, value);
      });
    });
    sub(relay, () => {
      get(other);
    });
    set(trigger, 1);
    set(other, 1);
    expect(runs).toBe(2);
  });

  test("defers sinks and effects to its end after one ran before the graph installed", () => {
    expect.assertions(2);
    const { s, seen } = afterEarlyBatch(earlyBatchApi1);
    earlyBatchApi1.batch(() => {
      earlyBatchApi1.set(s, 2);
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual(["sink 2", "effect 2"]);
  });

  test("leaves unbatched writes running effects after it ran before the graph installed", () => {
    expect.assertions(1);
    const { s, seen } = afterEarlyBatch(earlyBatchApi2);
    earlyBatchApi2.set(s, 3);
    expect(seen).toEqual(["sink 3", "effect 3"]);
  });
});

describe.each([
  ["without the graph", aloneApi],
  ["with the graph", graphApi],
  ["built with STAGE1_SIGNAL_GRAPH", graphBuildApi],
])("batch with sinks, %s", (_, ng: Api) => {
  test("defers sinks until it ends", () => {
    expect.assertions(2);
    const s = ng.signal(0);
    let calls = 0;
    ng.sub(s, () => {
      calls++;
    });
    ng.batch(() => {
      ng.set(s, 1);
      expect(calls).toBe(1);
    });
    expect(calls).toBe(2);
  });

  test("calls a sink once with the final value", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const seen: number[] = [];
    ng.sub(s, (value) => {
      seen.push(value);
    });
    ng.batch(() => {
      ng.set(s, 1);
      ng.set(s, 2);
    });
    expect(seen).toEqual([0, 2]);
  });

  test("Regression: a sink subscribed during it after a write is called once for that value", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    const seen: number[] = [];
    ng.batch(() => {
      ng.set(s, 1);
      ng.sub(s, (value) => {
        seen.push(value);
      });
    });
    expect(seen).toEqual([1]);
  });

  test("Regression: a sink subscribed during it after a write learns when it restores the value", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    ng.sub(s, () => {});
    const seen: number[] = [];
    ng.batch(() => {
      ng.set(s, 1);
      ng.sub(s, (value) => {
        seen.push(value);
      });
      ng.set(s, 0);
    });
    expect(seen).toEqual([1, 0]);
  });

  test("a batch started by a sink as it ends notifies each write once", () => {
    expect.assertions(1);
    const a = ng.signal(0);
    const b = ng.signal(0);
    ng.sub(a, (value) => {
      if (value) {
        ng.batch(() => {
          ng.set(b, value);
        });
      }
    });
    const seen: number[] = [];
    ng.sub(b, (value) => {
      seen.push(value);
    });
    ng.batch(() => {
      ng.set(a, 1);
    });
    expect(seen).toEqual([0, 1]);
  });

  test("a sink's write as it ends is not delivered again by the batch", () => {
    expect.assertions(1);
    const a = ng.signal(0);
    const b = ng.signal(0);
    ng.sub(a, (value) => {
      if (value) ng.set(b, 2);
    });
    const seen: number[] = [];
    ng.sub(b, (value) => {
      seen.push(value);
    });
    ng.batch(() => {
      ng.set(b, 1);
      ng.set(a, 1);
    });
    expect(seen).toEqual([0, 2]);
  });

  test("skips a sink when a sink restores the value as it ends", () => {
    expect.assertions(1);
    const a = ng.signal(0);
    const b = ng.signal(0);
    ng.sub(a, (value) => {
      if (value) ng.set(b, 0);
    });
    const seen: number[] = [];
    ng.sub(b, (value) => {
      seen.push(value);
    });
    ng.batch(() => {
      ng.set(b, 1);
      ng.set(a, 1);
    });
    expect(seen).toEqual([0]);
  });

  test("a write in a batch a sink starts as it ends is not delivered twice", () => {
    expect.assertions(1);
    const a = ng.signal(0);
    const b = ng.signal(0);
    ng.sub(a, (value) => {
      if (value) {
        ng.batch(() => {
          ng.set(b, 2);
        });
      }
    });
    const seen: number[] = [];
    ng.sub(b, (value) => {
      seen.push(value);
    });
    ng.batch(() => {
      ng.set(b, 1);
      ng.set(a, 1);
    });
    expect(seen).toEqual([0, 2]);
  });

  test("a write by the sink of a signal a nested batch wrote is not delivered twice", () => {
    expect.assertions(1);
    const a = ng.signal(0);
    const b = ng.signal(0);
    const c = ng.signal(0);
    ng.sub(a, (value) => {
      if (value) {
        ng.batch(() => {
          ng.set(c, 1);
        });
      }
    });
    ng.sub(c, (value) => {
      if (value) ng.set(b, 2);
    });
    const seen: number[] = [];
    ng.sub(b, (value) => {
      seen.push(value);
    });
    ng.batch(() => {
      ng.set(a, 1);
      ng.set(b, 1);
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  test("a batch a sink starts as it ends notifies when the outermost ends", () => {
    expect.assertions(2);
    const a = ng.signal(0);
    const c = ng.signal(0);
    const seen: number[] = [];
    ng.sub(c, (value) => {
      seen.push(value);
    });
    let seenOnReturn: number[] = [];
    ng.sub(a, (value) => {
      if (value) {
        ng.batch(() => {
          ng.set(c, 1);
        });
        seenOnReturn = [...seen];
      }
    });
    ng.batch(() => {
      ng.set(a, 1);
    });
    expect(seenOnReturn).toEqual([0]);
    expect(seen).toEqual([0, 1]);
  });

  test("a sink's write to a signal the batch end already notified is delivered at once", () => {
    expect.assertions(1);
    const a = ng.signal(0);
    const b = ng.signal(0);
    const seen: number[] = [];
    ng.sub(b, (value) => {
      seen.push(value);
    });
    let seenBySink: number[] = [];
    ng.sub(a, (value) => {
      if (value) {
        ng.set(b, 2);
        seenBySink = [...seen];
      }
    });
    ng.batch(() => {
      ng.set(a, 1);
      ng.set(b, 1);
    });
    expect(seenBySink).toEqual([0, 1, 2]);
  });

  test("a sink subscribed as it ends learns when a sink then restores the value", () => {
    expect.assertions(1);
    const a = ng.signal(0);
    const b = ng.signal(0);
    const seen: number[] = [];
    ng.sub(a, (value) => {
      if (value) {
        ng.sub(b, (next) => {
          seen.push(next);
        });
        ng.set(b, 0);
      }
    });
    ng.sub(b, () => {});
    ng.batch(() => {
      ng.set(a, 1);
      ng.set(b, 1);
    });
    expect(seen).toEqual([1, 0]);
  });

  test("skips a sink when the batch restores the value", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    let calls = 0;
    ng.sub(s, () => {
      calls++;
    });
    ng.batch(() => {
      ng.set(s, 1);
      ng.set(s, 0);
    });
    expect(calls).toBe(1);
  });

  test("get inside it returns the last value set", () => {
    expect.assertions(1);
    const s = ng.signal(0);
    ng.batch(() => {
      ng.set(s, 1);
      expect(ng.get(s)).toBe(1);
    });
  });

  test("a throwing sink does not stop the other deferred sinks", () => {
    expect.assertions(2);
    const a = ng.signal(0);
    const b = ng.signal(0);
    const called: string[] = [];
    // Both throw, since the notification order is unspecified
    for (const [name, s] of [
      ["a", a],
      ["b", b],
    ] as const) {
      ng.sub(s, (value) => {
        if (!value) return;
        called.push(name);
        throw new Error(`${name} failed`);
      });
    }
    expect(() => {
      ng.batch(() => {
        ng.set(a, 1);
        ng.set(b, 1);
      });
    }).toThrow();
    expect(called.toSorted((x, y) => x.localeCompare(y))).toEqual(["a", "b"]);
  });

  test("throws the first error when several deferred sinks throw", () => {
    expect.assertions(1);
    const a = ng.signal(0);
    const b = ng.signal(0);
    let calls = 0;
    // Whichever sink runs first throws the first error: the order is unspecified
    const fail = (value: number): void => {
      if (value) throw new Error(calls++ ? "later sink failed" : "first sink failed");
    };
    ng.sub(a, fail);
    ng.sub(b, fail);
    expect(() => {
      ng.batch(() => {
        ng.set(a, 1);
        ng.set(b, 1);
      });
    }).toThrow("first sink failed");
  });

  test("a throwing function does not leave later writes deferred", () => {
    expect.assertions(2);
    const s = ng.signal(0);
    let calls = 0;
    ng.sub(s, () => {
      calls++;
    });
    expect(() => {
      ng.batch(() => {
        throw new Error("batch failed");
      });
    }).toThrow("batch failed");
    ng.set(s, 1);
    expect(calls).toBe(2);
  });
});

describe("tier flags", () => {
  test("a build with STAGE1_SIGNAL_LITE and STAGE1_SIGNAL_GRAPH throws as it loads", async () => {
    expect.assertions(1);
    // await expect(buildSignal(["STAGE1_SIGNAL_LITE", "STAGE1_SIGNAL_GRAPH"])).rejects.toThrow(
    //   "set at most one",
    // );
    let error: unknown;
    try {
      await buildSignal(["STAGE1_SIGNAL_LITE", "STAGE1_SIGNAL_GRAPH"]);
    } catch (error_) {
      error = error_;
    }
    expect(String(error)).toContain("set at most one");
  });
});
