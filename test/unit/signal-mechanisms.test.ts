// Mechanisms and regressions of the signal core (invariants I1-I9 in src/signal.ts's header):
// value-recording links, keep-alive computeds, own writes, superseded reads, validation,
// ownership, disposal during teardowns and runs, errors and dev checks; the "mechanisms" group reads
// node and link fields and the "faults" group runs a copy of src/signal.ts with errors injected at
// its functions' heads (white-box). Run in both modes: `bun test` (dev checks on) and
// `NODE_ENV=production bun test` (the production-only tests run; dev checks skip).
// Callbacks under test branch on the value they receive.
// oxlint-disable vitest/no-conditional-in-test

import { describe, expect, spyOn, test } from "bun:test";
import {
  batch,
  type Computed,
  computed,
  defer,
  dispose,
  effect,
  get,
  owner,
  type Scope,
  scope,
  set,
  type Signal,
  signal,
  sub,
  untracked,
  within,
} from "../../src/signal.ts";

// oxlint-disable-next-line node/no-process-env
const PROD = process.env.NODE_ENV === "production";
type Handle = Parameters<typeof dispose>[0];

/** A computed and a counter of its evaluations. */
const counted = <T>(fn: () => T): [Computed<T>, () => number] => {
  let runs = 0;
  return [
    computed(() => {
      runs++;
      return fn();
    }),
    () => runs,
  ];
};

describe("value-recording links (I2)", () => {
  test("a batch that restores a value runs no effect", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      get(s);
      runs++;
    });
    batch(() => {
      set(s, 1);
      set(s, 0);
    });
    expect(runs).toBe(1);
  });

  test("a computed whose value did not change evaluates nothing below it", () => {
    expect.assertions(1);
    const s = signal(1);
    const parity = computed(() => get(s) % 2);
    const [below, belowRuns] = counted(() => get(parity) * 10);
    effect(() => {
      get(below);
    });
    set(s, 3);
    expect(belowRuns()).toBe(1);
  });

  test("an unobserved computed whose source changed and changed back is not re-evaluated", () => {
    expect.assertions(2);
    const s = signal(1);
    const [c, runs] = counted(() => get(s) * 2);
    get(c);
    set(s, 5);
    set(s, 1);
    expect(get(c)).toBe(2);
    expect(runs()).toBe(1);
  });
});

describe("keep-alive computeds", () => {
  test("an unobserved computed evaluates on read only, once per change", () => {
    expect.assertions(3);
    const s = signal(1);
    const [c, runs] = counted(() => get(s) + 1);
    expect(runs()).toBe(0);
    get(c);
    get(c);
    set(s, 2);
    set(s, 3);
    expect(get(c)).toBe(4);
    get(c);
    expect(runs()).toBe(2);
  });

  test("a computed that lost its last reader stays current without extra evaluations", () => {
    expect.assertions(2);
    const s = signal(1);
    const [c, runs] = counted(() => get(s) * 3);
    dispose(
      effect(() => {
        get(c);
      }),
    );
    set(s, 2);
    expect(get(c)).toBe(6);
    get(c);
    expect(runs()).toBe(2);
  });

  test("an untracked read of a computed in an effect evaluates it once per change", () => {
    expect.assertions(2);
    const s = signal(1);
    const [c, runs] = counted(() => get(s));
    const seen: number[] = [];
    effect(() => {
      get(s);
      seen.push(untracked(() => get(c)));
    });
    set(s, 2);
    expect(seen).toEqual([1, 2]);
    expect(runs()).toBe(2);
  });
});

describe("own writes (I6)", () => {
  test("an effect incrementing what it reads runs once per outside write", () => {
    expect.assertions(2);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      // Bound: a regression that re-runs it for its own writes fails here instead of hanging
      if (++runs > 100) throw new Error("runaway");
      set(s, get(s) + 1);
    });
    set(s, 10);
    expect(s.v).toBe(11);
    expect(runs).toBe(2);
  });

  test("an effect flipping a computed it read, by its own write, terminates", () => {
    expect.assertions(2);
    const s = signal(0);
    const c = computed(() => get(s) % 2);
    let runs = 0;
    effect(() => {
      // Bound: a regression that re-runs it for its own writes fails here instead of hanging
      if (++runs > 100) throw new Error("runaway");
      set(s, get(c) === 0 ? 1 : 2);
    });
    expect(runs).toBe(1);
    expect(s.v).toBe(1);
  });

  test("after its own write through a computed, an effect still re-runs on outside writes", () => {
    expect.assertions(1);
    const s = signal(0);
    const c = computed(() => get(s) % 2);
    const seen: number[] = [];
    effect(() => {
      const value = get(c);
      // Bound: a regression that re-runs it for its own writes fails here instead of hanging
      if (seen.push(value) > 100) throw new Error("runaway");
      set(s, value === 0 ? 1 : 2);
    });
    // The run's end validated the computed its write marked, so marks reach the effect again (I1)
    set(s, 3);
    expect(seen).toEqual([0, 1]);
  });

  // Regression: the links once took the own write's values, so the restoring batch re-ran it
  test("a batch that restores what an effect's own write changed re-runs nothing", () => {
    expect.assertions(1);
    const a = signal(0);
    const b = signal(0);
    const c = computed(() => get(a) + get(b));
    let runs = 0;
    effect(() => {
      get(c);
      if (++runs === 1) set(a, 1);
    });
    batch(() => {
      set(b, -1);
    });
    expect(runs).toBe(1);
  });

  test("an effect whose own write changed what it read re-runs at its next check", () => {
    expect.assertions(1);
    const a = signal(0);
    const t = signal(0);
    const c = computed(() => get(a));
    const seen: number[] = [];
    effect(() => {
      seen.push(get(c));
      get(t);
      if (seen.length === 1) set(a, 1);
    });
    set(t, 1);
    expect(seen).toEqual([0, 1]);
  });

  // Regression: the parent re-ran at once, re-creating the child, which wrote again
  test("a parent whose child effect or scope increments what the parent read terminates", () => {
    expect.assertions(2);
    for (const make of [effect, scope]) {
      const s = signal(0);
      let runs = 0;
      const e = effect(() => {
        // Bound: a regression that re-runs it for its children's writes fails here instead of hanging
        if (++runs > 100) throw new Error("runaway");
        get(s);
        make(() => {
          set(s, untracked(() => get(s)) + 1);
        });
      });
      set(s, 10);
      dispose(e);
      expect(runs).toBe(2);
    }
  });

  test("a write by a child's first run reaches the parent at its next check", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(get(s));
      get(t);
      effect(() => {
        if (untracked(() => get(s)) === 0) set(s, 1);
      });
    });
    set(t, 1);
    expect(seen).toEqual([0, 1]);
  });

  test("a write in an effect's cleanup to what it reads adds no run", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      get(s);
      get(t);
      return () => {
        set(t, untracked(() => get(t)) + 1);
      };
    });
    set(s, 1);
    expect(runs).toBe(2);
  });
});

describe("superseded reads", () => {
  test("a run that read two values of a source runs again on its next check", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const seen: number[][] = [];
    effect(() => {
      get(t);
      const first = get(s);
      effect(() => {
        if (untracked(() => get(s)) === 0) set(s, 1);
      });
      seen.push([first, get(s)]);
    });
    set(t, 1);
    expect(seen).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  test("a run whose last read went stale re-runs though the source is back at its first read", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const seen: number[][] = [];
    let runs = 0;
    effect(() => {
      runs++;
      const first = get(s);
      // Child writes between two consecutive reads: 0, then 1 is read, then 0 again
      if (runs === 1)
        effect(() => {
          set(s, 1);
        });
      const second = get(s);
      if (runs === 1)
        effect(() => {
          set(s, 0);
        });
      get(t);
      seen.push([first, second]);
    });
    // A restore marks it and changes nothing it read: only the link holding itself (I2) re-runs it
    batch(() => {
      set(t, 1);
      set(t, 0);
    });
    expect(seen).toEqual([
      [0, 1],
      [0, 0],
    ]);
  });
});

describe("superseded reads, own writes", () => {
  // No nested run between the reads: only the write itself voids the first read's stamp (I4)
  test("a run that read a signal before and after its own write re-runs when it returns to the first value", () => {
    expect.assertions(1);
    const s = signal(1);
    const seen: number[][] = [];
    effect(() => {
      const first = get(s);
      if (seen.length === 0) set(s, 2);
      seen.push([first, get(s)]);
    });
    set(s, 1);
    expect(seen).toEqual([
      [1, 2],
      [1, 1],
    ]);
  });

  // The direct run of a write's only reader takes no other run's id first
  test("a re-run reading its sources in another order stays subscribed to each", () => {
    expect.assertions(1);
    const flip = signal(false);
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      if (get(flip)) {
        get(b);
        get(a);
      } else {
        get(a);
        get(b);
      }
    });
    set(flip, true);
    set(b, 1);
    set(a, 1);
    expect(runs).toBe(4);
  });
});

describe("validation (I1)", () => {
  test("a 100k-deep chain built incrementally updates and disposes", () => {
    expect.assertions(2);
    const head = signal(0);
    let seen = 0;
    const s = scope(() => {
      let node: Computed<number> = computed(() => get(head));
      for (let i = 0; i < 100_000; i++) {
        const prev = node;
        node = computed(() => get(prev) + 1);
        get(node);
      }
      const last = node;
      effect(() => {
        seen = get(last);
      });
    });
    set(head, 1);
    expect(seen).toBe(100_001);
    dispose(s);
    set(head, 2);
    expect(seen).toBe(100_001);
  });

  test("a diamond's effect sees consistent values once per write", () => {
    expect.assertions(1);
    const s = signal(1);
    const a = computed(() => get(s) + 1);
    const b = computed(() => get(s) * 2);
    const seen: number[][] = [];
    effect(() => {
      seen.push([get(a), get(b)]);
    });
    set(s, 2);
    expect(seen).toEqual([
      [2, 2],
      [3, 4],
    ]);
  });

  // Accepted tradeoff: cycles are unsupported (dev builds throw); marks cleared on descent keep
  // production finite. Only termination is promised, not the value read
  test.skipIf(!PROD)("a cycle between computeds terminates in production", () => {
    expect.assertions(1);
    const s = signal(1);
    const holder: { b?: Computed<number> } = {};
    const a = computed((): number => get(s) + (holder.b === undefined ? 0 : get(holder.b)));
    holder.b = computed(() => get(a));
    get(holder.b);
    set(s, 2);
    expect(() => get(a)).not.toThrow();
  });
});

describe("ownership", () => {
  test("children and defer functions go newest first, interleaved, then the returned cleanup", () => {
    expect.assertions(1);
    const order: string[] = [];
    const s = scope(() => {
      defer(() => {
        order.push("first");
      });
      effect(() => () => {
        order.push("older effect");
      });
      defer(() => {
        order.push("last");
      });
      effect(() => () => {
        order.push("newer effect");
      });
      return () => {
        order.push("scope");
      };
    });
    dispose(s);
    expect(order).toEqual(["newer effect", "last", "older effect", "first", "scope"]);
  });

  test("a nested scope's whole teardown goes between its newer and older siblings", () => {
    expect.assertions(1);
    const order: string[] = [];
    const s = scope(() => {
      defer(() => {
        order.push("older");
      });
      scope(() => {
        defer(() => {
          order.push("inner");
        });
        return () => {
          order.push("inner scope");
        };
      });
      defer(() => {
        order.push("newer");
      });
    });
    dispose(s);
    expect(order).toEqual(["newer", "inner", "inner scope", "older"]);
  });

  test("an effect's defer runs before its re-run and on dispose", () => {
    expect.assertions(1);
    const s = signal(0);
    const order: string[] = [];
    const e = effect(() => {
      const v = get(s);
      order.push(`run ${v}`);
      defer(() => {
        order.push(`cleanup ${v}`);
      });
    });
    set(s, 1);
    dispose(e);
    expect(order).toEqual(["run 0", "cleanup 0", "run 1", "cleanup 1"]);
  });

  test("disposing a middle child twice leaves its siblings owned", () => {
    expect.assertions(1);
    const order: number[] = [];
    const children: Handle[] = [];
    const s = scope(() => {
      for (let i = 0; i < 3; i++)
        children.push(
          scope(() => () => {
            order.push(i);
          }),
        );
    });
    dispose(children[1]);
    dispose(children[1]);
    dispose(s);
    expect(order).toEqual([1, 2, 0]);
  });

  test("an owner re-runs before its child, also through a scope, and the old child never runs", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: string[] = [];
    effect(() => {
      const v = get(s);
      seen.push(`parent ${v}`);
      scope(() => {
        effect(() => {
          seen.push(`child ${get(s)} of ${v}`);
        });
      });
    });
    set(s, 1);
    expect(seen).toEqual(["parent 0", "child 0 of 0", "parent 1", "child 1 of 1"]);
  });

  test("an effect created inside untracked is owned by the running effect", () => {
    expect.assertions(1);
    const s = signal(0);
    let childRuns = 0;
    const e = effect(() => {
      get(s);
      untracked(() => {
        effect(() => {
          childRuns++;
        });
      });
    });
    dispose(e);
    set(s, 1);
    expect(childRuns).toBe(1);
  });

  // Accepted tradeoff: a disposed computed's value freezes in production (dev throws on read)
  test.skipIf(!PROD)("a computed an effect created is disposed when the effect re-runs", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const made: Computed<number>[] = [];
    effect(() => {
      get(s);
      const c = computed(() => get(t));
      get(c);
      made.push(c);
    });
    set(s, 1);
    set(t, 1);
    expect([get(made[0]), get(made[1])]).toEqual([0, 1]);
  });

  // Accepted tradeoff: reading a disposed computed is unsupported; the production build freezes it
  test.skipIf(!PROD)("a disposed computed keeps its last value in production", () => {
    expect.assertions(1);
    const t = signal(1);
    const c = computed(() => get(t));
    get(c);
    dispose(c);
    set(t, 2);
    expect(get(c)).toBe(1);
  });

  test("disposing the newest child twice, with a newer sibling made in between, leaves it owned", () => {
    expect.assertions(1);
    const order: string[] = [];
    const s = scope(() => {
      const older = scope(() => () => {
        order.push("older");
      });
      dispose(older);
      scope(() => () => {
        order.push("newer");
      });
      dispose(older);
    });
    dispose(s);
    expect(order).toEqual(["older", "newer"]);
  });

  test("10k children disposed one by one leave the rest owned", () => {
    expect.assertions(2);
    const handles: Handle[] = [];
    const live = new Set<number>();
    const s = scope(() => {
      for (let i = 0; i < 10_000; i++) {
        handles.push(
          scope(() => {
            live.add(i);
            return () => {
              live.delete(i);
            };
          }),
        );
      }
    });
    for (let i = 0; i < handles.length; i += 2) dispose(handles[i]);
    expect(live.size).toBe(5000);
    dispose(s);
    expect(live.size).toBe(0);
  });

  // Changed contract: a scope's body is no longer batched (it only owns), so at top level its
  // writes run what they reach before the body goes on
  test("a scope's writes reach effects before its fn goes on", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: string[] = [];
    effect(() => {
      seen.push(`effect ${get(s)}`);
    });
    scope(() => {
      set(s, 1);
      seen.push("scope body done");
    });
    expect(seen).toEqual(["effect 0", "effect 1", "scope body done"]);
  });
});

describe("dispose", () => {
  test("effects it tears down do not run for writes its cleanups make", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    const parent = scope(() => {
      effect(() => {
        get(s);
        runs++;
      });
      // Children go newest first: this cleanup runs before the effect above is disposed
      effect(() => () => {
        set(s, 1);
      });
    });
    dispose(parent);
    expect(runs).toBe(1);
  });

  test("cleanups it runs inside an effect subscribe that effect to nothing", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      if (get(s) === 0) {
        const child = untracked(() =>
          scope(() => () => {
            get(t);
          }),
        );
        dispose(child);
      }
    });
    set(t, 1);
    expect(runs).toBe(1);
  });
});

describe("dispose during a teardown", () => {
  test("a dispose inside a cleanup has disposed its node when it returns", () => {
    expect.assertions(1);
    const order: string[] = [];
    const outer = scope(() => {
      defer(() => {
        order.push("outer");
      });
    });
    let inner!: Handle;
    scope(() => {
      inner = scope(() => {
        effect(() => () => {
          dispose(outer);
          order.push("effect");
        });
        defer(() => {
          order.push("inner");
        });
      });
    });
    dispose(inner);
    expect(order).toEqual(["inner", "outer", "effect"]);
  });

  // Regression: the owner's cleanup ran first, before the subtree in progress
  test("a cleanup disposing an ancestor finishes the subtree in progress before the ancestor's cleanup", () => {
    expect.assertions(1);
    const order: string[] = [];
    let child!: Handle;
    const parent = scope(() => {
      child = scope(() => {
        effect(() => () => {
          order.push("older grandchild");
        });
        defer(() => {
          order.push("cleanup");
          dispose(parent);
          order.push("cleanup done");
        });
        return () => {
          order.push("child");
        };
      });
      return () => {
        order.push("owner");
      };
    });
    dispose(child);
    expect(order).toEqual(["cleanup", "older grandchild", "child", "owner", "cleanup done"]);
  });

  test("a cleanup disposing an ancestor during the ancestor's re-run teardown skips the re-run", () => {
    expect.assertions(1);
    const s = signal(0);
    const order: string[] = [];
    const e: Handle = effect(() => {
      const v = get(s);
      order.push(`run ${v}`);
      scope(() => {
        defer(() => {
          order.push(`cleanup ${v}`);
          dispose(e);
        });
        return () => {
          order.push(`scope ${v}`);
        };
      });
      return () => {
        order.push(`own ${v}`);
      };
    });
    set(s, 1);
    set(s, 2);
    expect(order).toEqual(["run 0", "cleanup 0", "scope 0", "own 0"]);
  });
});

describe("disposal during runs", () => {
  test("an effect that disposed itself mid-run is not retained by what it read afterwards", async () => {
    expect.assertions(1);
    const t = signal(0);
    const triggers = Array.from({ length: 20 }, () => signal(0));
    const refs: WeakRef<object>[] = [];
    // One trigger each: links dropped from a shared source would chain, and one conservative
    // stack root (JSC) would then keep most of the effects
    for (const trigger of triggers) {
      const e = effect(() => {
        if (get(trigger) === 1) {
          dispose(e);
          get(t);
        }
      });
      refs.push(new WeakRef(e));
    }
    batch(() => {
      for (const trigger of triggers) set(trigger, 1);
    });
    // A WeakRef keeps its target until the current job ends
    await Bun.sleep(0);
    Bun.gc(true);
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBeLessThan(5);
  });

  test("an effect disposing itself mid-run gets the cleanup that run returns", () => {
    expect.assertions(1);
    const s = signal(0);
    let cleaned = 0;
    const e = effect(() => {
      if (get(s) === 1) dispose(e);
      return () => {
        cleaned++;
      };
    });
    set(s, 1);
    expect(cleaned).toBe(2);
  });

  test("an effect disposing itself mid-run drops the deps it reads afterwards", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    const e = effect(() => {
      runs++;
      if (get(s) === 1) {
        dispose(e);
        get(t);
      }
    });
    set(s, 1);
    set(t, 1);
    set(s, 2);
    expect(runs).toBe(2);
  });

  // Accepted tradeoff: creating under a disposed owner is a dev error; production disposes it
  test.skipIf(!PROD)(
    "an effect disposing itself mid-run disposes what it creates afterwards",
    () => {
      expect.assertions(1);
      const s = signal(0);
      let cleaned = 0;
      const e = effect(() => {
        if (get(s) === 1) {
          dispose(e);
          defer(() => {
            cleaned++;
          });
        }
      });
      set(s, 1);
      expect(cleaned).toBe(1);
    },
  );

  test("an effect whose cleanup disposes it does not run again", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    const e: Handle = effect(() => {
      runs++;
      get(s);
      return () => {
        dispose(e);
      };
    });
    set(s, 1);
    set(s, 2);
    expect(runs).toBe(1);
  });

  test("of two effects that dispose each other on a write, only the first to run does", () => {
    expect.assertions(1);
    const s = signal(0);
    const handles: Handle[] = [];
    const ran: number[] = [];
    for (let i = 0; i < 2; i++) {
      handles.push(
        effect(() => {
          if (get(s) === 1) {
            ran.push(i);
            dispose(handles[1 - i]);
          }
        }),
      );
    }
    set(s, 1);
    expect(ran).toHaveLength(1);
  });
});

describe("errors", () => {
  test("a write runs every effect though they throw, then rethrows one error", () => {
    expect.assertions(2);
    const s = signal(0);
    const seen: string[] = [];
    for (const name of ["a", "b", "c"]) {
      effect(() => {
        if (get(s) === 1) {
          seen.push(name);
          throw new Error(name);
        }
      });
    }
    expect(() => {
      set(s, 1);
    }).toThrow(/^[abc]$/u);
    expect(seen.toSorted()).toEqual(["a", "b", "c"]);
  });

  test("an effect that threw re-runs on the next change", () => {
    expect.assertions(2);
    const s = signal(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(get(s));
      if (get(s) === 1) throw new Error("a");
    });
    expect(() => {
      set(s, 1);
    }).toThrow("a");
    set(s, 2);
    expect(seen).toEqual([0, 1, 2]);
  });

  test.serial(
    "a throwing cleanup leaves the other cleanups run; its error is logged in dev, dropped in production",
    () => {
      expect.assertions(3);
      const order: string[] = [];
      const error = new Error("b");
      const s = scope(() => {
        defer(() => {
          order.push("a");
        });
        defer(() => {
          throw error;
        });
        defer(() => {
          order.push("c");
        });
        return () => {
          order.push("scope");
        };
      });
      using log = spyOn(console, "error");
      log.mockImplementation(() => {});
      dispose(s);
      expect(log.mock.calls.some((args) => args.includes(error))).toBe(!PROD);
      expect(log.mock.calls).toHaveLength(PROD ? 0 : 1);
      expect(order).toEqual(["c", "a", "scope"]);
    },
  );

  test.serial(
    "an effect whose previous cleanup throws still re-runs, and the write does not throw",
    () => {
      expect.assertions(1);
      const s = signal(0);
      const seen: number[] = [];
      effect(() => {
        const v = get(s);
        seen.push(v);
        return () => {
          if (v === 0) throw new Error("cleanup");
        };
      });
      using log = spyOn(console, "error");
      log.mockImplementation(() => {});
      set(s, 1);
      expect(seen).toEqual([0, 1]);
    },
  );

  test.serial("a cleanup throwing undefined is dropped too", () => {
    expect.assertions(1);
    const order: string[] = [];
    const s = scope(() => {
      defer(() => {
        order.push("older");
      });
      defer(() => {
        // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
        throw undefined;
      });
      return () => {
        order.push("own");
      };
    });
    using log = spyOn(console, "error");
    log.mockImplementation(() => {});
    dispose(s);
    expect(order).toEqual(["older", "own"]);
  });

  test("a scope whose fn throws is disposed with its children, and scope() rethrows", () => {
    expect.assertions(2);
    const s = signal(0);
    let runs = 0;
    expect(() =>
      scope(() => {
        effect(() => {
          get(s);
          runs++;
        });
        throw new Error("x");
      }),
    ).toThrow("x");
    set(s, 1);
    expect(runs).toBe(1);
  });

  test("an effect() whose run's write makes another effect throw is disposed", () => {
    expect.assertions(2);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    effect(() => {
      if (get(s) === 1) throw new Error("other");
    });
    expect(() =>
      effect(() => {
        runs++;
        get(t);
        set(s, 1);
      }),
    ).toThrow("other");
    set(t, 1);
    expect(runs).toBe(1);
  });

  test("a computed's error reaches a reader's catch and clears when its source changes", () => {
    expect.assertions(1);
    const s = signal(0);
    const c = computed(() => {
      if (get(s) === 1) throw new Error("bad");
      return get(s);
    });
    const seen: string[] = [];
    effect(() => {
      try {
        seen.push(`ok ${get(c)}`);
      } catch (error) {
        seen.push((error as Error).message);
      }
    });
    set(s, 1);
    set(s, 2);
    expect(seen).toEqual(["ok 0", "bad", "ok 2"]);
  });

  test("an unobserved computed rethrows its error on every read", () => {
    expect.assertions(2);
    const c = computed(() => {
      throw new Error("bad");
    });
    expect(() => get(c)).toThrow("bad");
    expect(() => get(c)).toThrow("bad");
  });

  test("writes after a throwing batch are unbatched again", () => {
    expect.assertions(2);
    const s = signal(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(get(s));
    });
    expect(() => {
      batch(() => {
        set(s, 1);
        throw new Error("x");
      });
    }).toThrow("x");
    set(s, 2);
    expect(seen).toEqual([0, 1, 2]);
  });

  test("an effect stays tracked after untracked's fn threw inside it", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    effect(() => {
      try {
        untracked(() => {
          throw new Error("y");
        });
      } catch {
        // swallowed: only the tracking afterwards matters
      }
      seen.push(get(s));
    });
    set(s, 1);
    expect(seen).toEqual([0, 1]);
  });
});

describe.skipIf(PROD)("dev checks", () => {
  /** The first argument of each console.warn call while `fn` runs. */
  const warned = (fn: () => void): string[] => {
    using warn = spyOn(console, "warn");
    warn.mockImplementation(() => {});
    fn();
    return warn.mock.calls.map((call) => String(call[0]));
  };

  test("a write inside a getter throws", () => {
    expect.assertions(1);
    const s = signal(0);
    expect(() => {
      get(
        computed(() => {
          set(s, 1);
        }),
      );
    }).toThrow(/^stage1: set inside a computed$/u);
  });

  // Regression: the check read the tracker, which untracked clears
  test("a write, creation or dispose inside untracked inside a getter throws", () => {
    expect.assertions(3);
    const s = signal(0);
    const e = effect(() => {});
    expect(() => {
      get(
        computed(() => {
          untracked(() => {
            set(s, 1);
          });
        }),
      );
    }).toThrow("set inside a computed");
    expect(() => get(computed(() => untracked(() => effect(() => {}))))).toThrow(
      "defer inside a computed",
    );
    expect(() => {
      get(
        computed(() => {
          untracked(() => {
            dispose(e);
          });
        }),
      );
    }).toThrow("dispose inside a computed");
  });

  test("an effect created inside a getter throws", () => {
    expect.assertions(1);
    expect(() => get(computed(() => effect(() => {})))).toThrow(
      /^stage1: effect, sub, computed, scope, or defer inside a computed$/u,
    );
  });

  test("dispose inside a getter throws", () => {
    expect.assertions(1);
    const e = effect(() => {});
    expect(() => {
      get(
        computed(() => {
          dispose(e);
        }),
      );
    }).toThrow(/^stage1: dispose inside a computed$/u);
  });

  test("a computed reading itself throws", () => {
    expect.assertions(1);
    const c: Computed<number> = computed((): number => get(c) + 1);
    expect(() => get(c)).toThrow(/^stage1: cycle: a computed read itself$/u);
  });

  test("an effect returning a non-function throws", () => {
    expect.assertions(1);
    expect(() => effect((() => 5) as unknown as () => void)).toThrow(
      /^stage1: an effect or scope returned neither a function nor undefined$/u,
    );
  });

  test("a read of a computed disposed by its owner's re-run throws", () => {
    expect.assertions(1);
    const s = signal(0);
    const made: Computed<number>[] = [];
    effect(() => {
      get(s);
      made.push(computed(() => 1));
    });
    set(s, 1);
    expect(() => get(made[0])).toThrow("disposed computed");
  });

  test("a read of a disposed computed throws", () => {
    expect.assertions(1);
    const c = computed(() => 1);
    get(c);
    dispose(c);
    expect(() => get(c)).toThrow(/^stage1: get of a disposed computed$/u);
  });

  test("creating under an effect that disposed itself throws", () => {
    expect.assertions(1);
    const s = signal(0);
    const e: Handle = effect(() => {
      if (get(s) === 1) {
        dispose(e);
        effect(() => {});
      }
    });
    expect(() => {
      set(s, 1);
    }).toThrow(/^stage1: effect, sub, computed, or scope under a disposed owner$/u);
  });

  test("dispose of a signal throws", () => {
    expect.assertions(1);
    expect(() => {
      dispose(signal(0) as unknown as Handle);
    }).toThrow(/^stage1: dispose of a signal$/u);
  });

  test("get of an effect throws", () => {
    expect.assertions(1);
    const e = effect(() => {});
    expect(() => get(e as never)).toThrow(/^stage1: get of an effect, sub, or scope$/u);
  });

  test("get of a scope throws", () => {
    expect.assertions(1);
    const s = scope(() => {});
    expect(() => get(s as never)).toThrow(/^stage1: get of an effect, sub, or scope$/u);
  });

  test("owner inside a getter throws", () => {
    expect.assertions(1);
    expect(() => get(computed(() => owner()))).toThrow(/^stage1: owner inside a computed$/u);
  });

  test("within inside a getter throws", () => {
    expect.assertions(1);
    const root = scope(() => {});
    expect(() => get(computed(() => within(root, () => 0)))).toThrow(
      /^stage1: within inside a computed$/u,
    );
  });

  test("within of a computed throws", () => {
    expect.assertions(1);
    expect(() => {
      within(computed(() => 0) as unknown as Scope, () => {});
    }).toThrow(/^stage1: within of a signal or computed$/u);
  });

  test("within of a signal throws", () => {
    expect.assertions(1);
    expect(() => {
      within(signal(0) as unknown as Scope, () => {});
    }).toThrow(/^stage1: within of a signal or computed$/u);
  });

  test("a defer within made after fn disposed its target throws when fn returns", () => {
    expect.assertions(1);
    const root = scope(() => {});
    expect(() => {
      within(root, () => {
        dispose(root);
        defer(() => {});
      });
    }).toThrow(
      /^stage1: effect, sub, computed, scope, or defer under a within target disposed during its fn$/u,
    );
  });

  test("an effect within made after fn disposed its target throws at the creation", () => {
    expect.assertions(1);
    const root = scope(() => {});
    expect(() => {
      within(root, () => {
        dispose(root);
        effect(() => {});
      });
    }).toThrow(/^stage1: effect, sub, computed, or scope under a disposed owner$/u);
  });

  test("a within whose fn disposes its target and makes nothing after throws nothing", () => {
    expect.assertions(1);
    const root = scope(() => {
      defer(() => {});
    });
    expect(() => {
      within(root, () => {
        dispose(root);
      });
    }).not.toThrow();
  });

  test("a within whose fn throws after a defer under its disposed target rethrows fn's error", () => {
    expect.assertions(1);
    const root = scope(() => {});
    expect(() => {
      within(root, () => {
        dispose(root);
        defer(() => {});
        throw new Error("fn");
      });
    }).toThrow(/^fn$/u);
  });

  test.serial("within on a disposed target warns nothing", () => {
    expect.assertions(1);
    const root = scope(() => {});
    dispose(root);
    expect(
      warned(() => {
        within(root, () => {});
      }),
    ).toEqual([]);
  });

  // A sub's call exempts creation under a disposed owner from create's own check
  test("an effect within made in a sub's call after fn disposed its target throws when fn returns", () => {
    expect.assertions(1);
    const root = scope(() => {});
    const s = signal(0);
    sub(s, (value) => {
      if (value === 1) {
        within(root, () => {
          dispose(root);
          effect(() => {});
        });
      }
    });
    expect(() => {
      set(s, 1);
    }).toThrow(
      /^stage1: effect, sub, computed, scope, or defer under a within target disposed during its fn$/u,
    );
  });

  test.serial("disposing a computed that has readers warns once, naming the later throw", () => {
    expect.assertions(1);
    const c = computed(() => 1);
    effect(() => {
      get(c);
    });
    expect(
      warned(() => {
        dispose(c);
      }),
    ).toEqual(["stage1: dispose of a computed that still has readers; a later get of it throws"]);
  });

  test.serial("defer without an owner warns, and with one does not", () => {
    expect.assertions(2);
    expect(
      warned(() => {
        defer(() => {});
      }),
    ).toEqual(["stage1: defer outside an effect, sub, or scope; its fn is never called"]);
    expect(
      warned(() => {
        scope(() => {
          defer(() => {});
        });
      }),
    ).toEqual([]);
  });
});

// ── Mechanisms: white-box reads of node and link fields (src/signal.ts's Node and Link) ──

/** A node's fields (src/signal.ts's Node). */
interface Raw {
  f: number;
  v: unknown;
  g: unknown;
  d: RawLink | undefined;
  s: RawLink | Raw | undefined;
  o: unknown;
  n: Raw | undefined;
  p: Raw | undefined;
}
interface RawLink {
  D: Raw;
  S: Raw;
  d: RawLink | undefined;
  n: RawLink | undefined;
}
const raw = (node: unknown): Raw => node as Raw;
/** Whether `node` has flag `bit` set. */
// oxlint-disable-next-line no-bitwise
const flagged = (node: unknown, bit: number): boolean => (raw(node).f & bit) !== 0;
/** The links in a source's subscriber list. */
const subscribers = (node: unknown): RawLink[] => {
  const out: RawLink[] = [];
  for (let l = raw(node).s as RawLink | undefined; l !== undefined; l = l.n) out.push(l);
  return out;
};
/** The links in a reader's dep list. */
const depsOf = (node: unknown): RawLink[] => {
  const out: RawLink[] = [];
  for (let l = raw(node).d; l !== undefined; l = l.d) out.push(l);
  return out;
};
const M_BIT = 8;

describe("mechanisms", () => {
  describe("stamp: a run links a source once (I4)", () => {
    test("a signal read many times in one run, around other reads, is linked once", () => {
      expect.assertions(3);
      const s = signal(1);
      const t = signal(2);
      const e = effect(() => {
        for (let k = 0; k < 5; k++) {
          get(s);
          get(t);
        }
      });
      set(s, 3);
      expect(subscribers(s)).toHaveLength(1);
      expect(subscribers(t)).toHaveLength(1);
      expect(depsOf(e).map((l) => l.D)).toEqual([raw(s), raw(t)]);
    });

    test("a computed read many times in one run is linked once", () => {
      expect.assertions(2);
      const s = signal(1);
      const t = signal(2);
      const c = computed(() => get(s) * 2);
      effect(() => {
        for (let k = 0; k < 5; k++) {
          get(c);
          get(t);
        }
      });
      set(s, 2);
      expect(subscribers(c)).toHaveLength(1);
      expect(subscribers(t)).toHaveLength(1);
    });

    // Changed mechanism: a nested evaluation gives the run its id back when it ends, so the run's
    // older stamps still count (the previous core gave the run a fresh id and linked it again)
    test("a source read again after a nested evaluation is linked once, also on re-runs", () => {
      expect.assertions(4);
      const s = signal(1);
      const other = signal(0);
      const c = computed(() => get(other) + 1);
      let runs = 0;
      const e = effect(() => {
        runs++;
        get(s);
        // A fresh or marked computed evaluates here, inside the effect's run
        get(c);
        get(s);
      });
      expect(depsOf(e).map((l) => l.D)).toEqual([raw(s), raw(c)]);
      set(other, 1);
      set(s, 2);
      expect(runs).toBe(3);
      expect(subscribers(s)).toHaveLength(1);
      expect(subscribers(other)).toHaveLength(1);
    });

    // The nested run stamps what it reads with its own id, not the run's: the run still links it
    test("a run reading a source after an evaluation that read it is subscribed to it", () => {
      expect.assertions(1);
      const b = signal(0);
      // Constant: a write to b reaches the effect only through its own link to b
      const c = computed(() => {
        get(b);
        return 0;
      });
      let runs = 0;
      effect(() => {
        runs++;
        get(c);
        get(b);
      });
      set(b, 1);
      expect(runs).toBe(2);
    });

    test("a run reading a source after a child's first run read it is subscribed to it", () => {
      expect.assertions(1);
      const b = signal(0);
      let runs = 0;
      effect(() => {
        runs++;
        effect(() => {
          get(b);
        });
        get(b);
      });
      set(b, 1);
      expect(runs).toBe(2);
    });

    test("a run reading a source after catching a child's failed first run that read it is subscribed to it", () => {
      expect.assertions(1);
      const b = signal(0);
      let runs = 0;
      effect(() => {
        runs++;
        try {
          effect(() => {
            get(b);
            throw new Error("child");
          });
        } catch {
          // The child is disposed; this run goes on
        }
        get(b);
      });
      set(b, 1);
      expect(runs).toBe(2);
    });

    test("a run reading a source after untracked code evaluated a computed that read it is subscribed to it", () => {
      expect.assertions(1);
      const b = signal(0);
      const c = computed(() => get(b));
      let runs = 0;
      effect(() => {
        runs++;
        untracked(() => get(c));
        get(b);
      });
      set(b, 1);
      expect(runs).toBe(2);
    });

    test("a run reading a source after a cleanup it triggered evaluated a computed that read it is subscribed to it", () => {
      expect.assertions(1);
      const b = signal(0);
      const c = computed(() => get(b));
      let runs = 0;
      effect(() => {
        runs++;
        const child = scope(() => () => {
          get(c);
        });
        // The child's cleanup evaluates c (untracked) inside this run
        dispose(child);
        get(b);
      });
      set(b, 1);
      expect(runs).toBe(2);
    });

    test("a run reading a source after a scope's fn evaluated a computed that read it is subscribed to it", () => {
      expect.assertions(1);
      const b = signal(0);
      const c = computed(() => get(b));
      let runs = 0;
      effect(() => {
        runs++;
        scope(() => {
          get(c);
        });
        get(b);
      });
      set(b, 1);
      expect(runs).toBe(2);
    });

    test("a computed whose source the run wrote is read again with its new value", () => {
      expect.assertions(1);
      const s = signal(1);
      const t = signal(0);
      const c = computed(() => get(s) * 10);
      const seen: number[][] = [];
      effect(() => {
        const first = get(c);
        if (seen.length === 0) set(s, 2);
        seen.push([first, get(c), get(t)]);
      });
      // The run read two values of c: its next check re-runs it (I2), and it reads 20
      set(t, 1);
      expect(seen).toEqual([
        [10, 20, 0],
        [20, 20, 1],
      ]);
    });

    test("a run that read two values of a computed re-runs when the source returns to the first", () => {
      expect.assertions(1);
      const s = signal(1);
      const c = computed(() => get(s) * 10);
      const seen: number[][] = [];
      effect(() => {
        const first = get(c);
        if (seen.length === 0) set(s, 2);
        seen.push([first, get(c)]);
      });
      // It last read 20: the evaluation gave c another stamp, so its second read was linked (I4)
      set(s, 1);
      expect(seen).toEqual([
        [10, 20],
        [10, 10],
      ]);
    });

    test("an unbatched write between two reads of one run gives the second read its value", () => {
      expect.assertions(1);
      const s = signal(1);
      const seen: number[] = [];
      const e = effect(() => {
        const first = get(s);
        untracked(() => {
          if (first === 1) set(s, 2);
        });
        seen.push(first, get(s));
      });
      dispose(e);
      expect(seen).toEqual([1, 2]);
    });
  });

  describe("direct run of a write's only reader", () => {
    test("two effects reading the written signal both run", () => {
      expect.assertions(1);
      const s = signal(0);
      const seen: string[] = [];
      effect(() => {
        seen.push(`a${get(s)}`);
      });
      effect(() => {
        seen.push(`b${get(s)}`);
      });
      set(s, 1);
      expect(seen.toSorted()).toEqual(["a0", "a1", "b0", "b1"]);
    });

    test("an only reader that is a computed runs the effect behind it", () => {
      expect.assertions(1);
      const s = signal(0);
      const c = computed(() => get(s) + 1);
      const seen: number[] = [];
      effect(() => {
        seen.push(get(c));
      });
      set(s, 1);
      expect(seen).toEqual([1, 2]);
    });

    test("a write in a batch runs its only reader at the batch's end", () => {
      expect.assertions(2);
      const s = signal(0);
      const seen: number[] = [];
      effect(() => {
        seen.push(get(s));
      });
      batch(() => {
        set(s, 1);
        expect(seen).toEqual([0]);
      });
      expect(seen).toEqual([0, 1]);
    });

    test("an only reader whose link holds the written value does not run", () => {
      expect.assertions(2);
      const s = signal(1);
      const t = signal(0);
      let runs = 0;
      effect(() => {
        runs++;
        // Reads 1, then its own write makes it 2: its link keeps 1 (I6)
        if (get(s) === 1 && runs === 1) set(s, 2);
        get(t);
      });
      // Back to what it read
      set(s, 1);
      expect(runs).toBe(1);
      set(s, 3);
      expect(runs).toBe(2);
    });

    test("an only reader's run writing what other effects read runs them in the same write", () => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      const seen: string[] = [];
      effect(() => {
        set(t, get(s) * 10);
      });
      effect(() => {
        seen.push(`t${get(t)}`);
      });
      set(s, 1);
      expect(seen).toEqual(["t0", "t10"]);
    });

    test("a nested only reader runs with its owner current", () => {
      expect.assertions(1);
      const s = signal(0);
      const seen: string[] = [];
      effect(() => {
        seen.push("parent");
        effect(() => {
          seen.push(`child ${get(s)}`);
        });
      });
      set(s, 1);
      expect(seen).toEqual(["parent", "child 0", "child 1"]);
    });
  });

  // Changed mechanism (I3): each runner keeps in `o` its climb target, the nearest effect or sub
  // among its owners, instead of an N flag for "an effect among its owners"
  describe("climb target (I3)", () => {
    test("effects, subs and scopes keep the nearest effect or sub above them, through scopes", () => {
      expect.assertions(8);
      let top: unknown;
      let inScope: unknown;
      let inEffect: unknown;
      let inScopeInEffect: unknown;
      let scopeInEffect: unknown;
      let subInEffect: unknown;
      let inSub: unknown;
      const root = scope(() => {
        inScope = effect(() => {});
        top = effect(() => {
          inEffect = effect(() => {});
          scopeInEffect = scope(() => {
            inScopeInEffect = effect(() => {});
          });
          subInEffect = sub(signal(0), () => {
            inSub = effect(() => {});
          });
        });
      });
      expect(raw(root).o).toBeUndefined();
      expect(raw(inScope).o).toBeUndefined();
      expect(raw(top).o).toBeUndefined();
      expect(raw(inEffect).o).toBe(raw(top));
      expect(raw(scopeInEffect).o).toBe(raw(top));
      expect(raw(inScopeInEffect).o).toBe(raw(top));
      expect(raw(subInEffect).o).toBe(raw(top));
      expect(raw(inSub).o).toBe(raw(subInEffect));
    });

    test("an owner that re-ran (or threw) still re-runs before its child", () => {
      expect.assertions(2);
      const g = signal(0);
      const p = signal(0);
      const seen: string[] = [];
      let threw = false;
      effect(() => {
        const gv = get(g);
        seen.push(`G${gv}`);
        effect(() => {
          const pv = get(p);
          seen.push(`P${pv}`);
          effect(() => {
            seen.push(`C${get(g)}`);
          });
          if (pv === 1 && !threw) {
            threw = true;
            throw new Error("P threw");
          }
        });
      });
      // P re-runs twice, the second time throwing; its run id left its owner pointer intact
      set(p, 2);
      expect(() => {
        set(p, 1);
      }).toThrow("P threw");
      seen.length = 0;
      set(g, 1);
      expect(seen).toEqual(["G1", "P1", "C1"]);
    });
  });

  describe("runs", () => {
    test("a static re-run reuses its links", () => {
      expect.assertions(2);
      const a = signal(0);
      const b = signal(0);
      const e = effect(() => {
        get(a);
        get(b);
      });
      const before = depsOf(e);
      set(a, 1);
      expect(depsOf(e)).toEqual(before);
      expect(depsOf(e)[0]).toBe(before[0]);
    });

    test("a re-run that reads less drops the rest of its links", () => {
      expect.assertions(3);
      const flag = signal(true);
      const a = signal(0);
      const b = signal(0);
      const e = effect(() => {
        if (get(flag)) {
          get(a);
          get(b);
        }
      });
      set(flag, false);
      expect(depsOf(e)).toHaveLength(1);
      expect(subscribers(a)).toHaveLength(0);
      expect(subscribers(b)).toHaveLength(0);
    });

    test("a running effect's own write leaves it unmarked when its run ends (I6)", () => {
      expect.assertions(2);
      const s = signal(0);
      const e = effect(() => {
        set(s, get(s) + 1);
      });
      expect(flagged(e, M_BIT)).toBe(false);
      set(s, 10);
      expect(flagged(e, M_BIT)).toBe(false);
    });

    // Changed mechanism: the write voids the stamp, so the second read links again (the previous
    // core kept one link holding itself as a "read two values" sentinel)
    test("two reads of a signal around the run's own write make a link each, holding what each read (I2)", () => {
      expect.assertions(2);
      const s = signal(1);
      const e = effect(() => {
        if (get(s) === 1) set(s, 2);
        get(s);
      });
      expect(depsOf(e).map((l) => l.D)).toEqual([raw(s), raw(s)]);
      expect(depsOf(e).map((l) => (l as RawLink & { v: unknown }).v)).toEqual([1, 2]);
    });

    test("a computed's value is its getter's result or error, never its cursor (I5)", () => {
      expect.assertions(2);
      const s = signal(1);
      const c = computed(() => {
        if (get(s) === 2) throw new Error("two");
        return get(s);
      });
      expect(get(c)).toBe(1);
      set(s, 2);
      expect(() => get(c)).toThrow("two");
    });
  });

  // Object literals made in one place, not class instances: V8 deoptimized every function that
  // used a class Link once a GC had collected the last one
  describe("links", () => {
    test("a link is a plain object", () => {
      expect.assertions(1);
      const s = signal(0);
      const e = effect(() => {
        get(s);
      });
      expect(Object.getPrototypeOf(depsOf(e)[0])).toBe(Object.prototype);
    });

    test("a computed's and an effect's links have the same 6 fields in the same order", () => {
      expect.assertions(2);
      const s = signal(0);
      const c = computed(() => get(s));
      const e = effect(() => {
        get(c);
      });
      const order = ["D", "S", "v", "d", "p", "n"];
      expect(Object.keys(depsOf(c)[0])).toEqual(order);
      expect(Object.keys(depsOf(e)[0])).toEqual(order);
    });
  });

  describe("intrusive owner tree (I3)", () => {
    test("every node has the same 8 fields in the same order", () => {
      expect.assertions(5);
      const order = ["f", "v", "g", "d", "s", "o", "n", "p"];
      let c: unknown;
      const sc = scope(() => {
        c = computed(() => 1);
        defer(() => {});
      });
      expect(Object.keys(signal(0))).toEqual(order);
      expect(Object.keys(c as object)).toEqual(order);
      expect(Object.keys(effect(() => {}))).toEqual(order);
      expect(Object.keys(sc)).toEqual(order);
      // The cleanup node defer made
      expect(Object.keys(raw(sc).s as object)).toEqual(order);
    });

    test("a child's p is its newer sibling, the newest child's its owner", () => {
      expect.assertions(5);
      let first: unknown;
      let second: unknown;
      const parent = scope(() => {
        first = effect(() => {});
        defer(() => {});
        second = computed(() => 1);
      });
      expect(raw(parent).s).toBe(raw(second));
      expect(raw(second).p).toBe(raw(parent));
      expect(raw(first).p).toBe(raw(raw(second).n));
      // Disposing the newest makes the next one the owner's newest
      dispose(second as Computed<number>);
      expect(raw(parent).s).toBe(raw(raw(first).p));
      expect(raw(raw(parent).s).p).toBe(raw(parent));
    });

    test("disposing a child twice, a newer sibling made in between, leaves its owner's lists alone", () => {
      expect.assertions(1);
      const order: string[] = [];
      const root = scope(() => {
        scope(() => () => {
          order.push("Z");
        });
        effect(() => {
          defer(() => {
            order.push("A");
          });
          const b = scope(() => () => {
            order.push("B");
          });
          dispose(b);
          scope(() => () => {
            order.push("C");
          });
          // Its `p` was cleared when it left: the second kill touches no list
          dispose(b);
          return () => {
            order.push("O");
          };
        });
      });
      dispose(root);
      expect(order).toEqual(["B", "C", "A", "O", "Z"]);
    });

    test.skipIf(!PROD)(
      "a computed disposed while marked keeps its last value in production",
      () => {
        expect.assertions(2);
        const s = signal(1);
        const c = computed(() => get(s) * 10);
        expect(get(c)).toBe(10);
        // Marks c (it stays linked until disposed); disposal clears the mark, so nothing re-evaluates it
        set(s, 2);
        dispose(c);
        expect(get(c)).toBe(10);
      },
    );

    // V8 recompiles a computed's getter when its `g` is written after creation; a runner's fn is
    // let go
    test("dispose keeps a computed's getter and clears an effect's or scope's fn", () => {
      expect.assertions(3);
      const s = signal(1);
      const getter = (): number => get(s);
      const c = computed(getter);
      get(c);
      const e = effect(() => {});
      const sc = scope(() => {});
      dispose(c);
      dispose(e);
      dispose(sc);
      expect(raw(c).g).toBe(getter);
      expect(raw(e).g).toBeUndefined();
      expect(raw(sc).g).toBeUndefined();
    });

    // The stamp test compares small integers only (one V8 feedback kind): never undefined
    test("signals and computeds keep a number in o, read or not", () => {
      expect.assertions(3);
      const s = signal(0);
      const c = computed(() => get(s));
      effect(() => {
        get(c);
      });
      expect(typeof raw(s).o).toBe("number");
      expect(typeof raw(c).o).toBe("number");
      expect(typeof raw(signal(0)).o).toBe("number");
    });
  });
});

// ── Characterization: what the core chose where its header leaves the answer open ──

describe("characterization", () => {
  // One reader: the write runs the effect alone; two: another effect ran before it in the same
  // flush, so a stale owner would adopt what the cleanup made
  test.each([1, 2])(
    "Characterization: what a cleanup creates during its effect's re-run is disposed with that effect (%i readers)",
    (readers) => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      if (readers === 2) {
        effect(() => {
          get(s);
        });
      }
      let made = 0;
      let inner = 0;
      const handle = effect(() => {
        get(s);
        return () => {
          if (made++ === 0) {
            effect(() => {
              get(t);
              inner++;
            });
          }
        };
      });
      set(s, 1);
      set(t, 1);
      dispose(handle);
      set(t, 2);
      expect(inner).toBe(2);
    },
  );

  // A sub's run validates its marked computed source at its end and stays marked, so it is called
  // again with the value its own write made
  test("Characterization: a sub on a computed whose fn writes the computed's source is called with each new value", () => {
    expect.assertions(1);
    const s = signal(0);
    const c = computed(() => get(s) * 10);
    const calls: number[] = [];
    sub(c, (value) => {
      calls.push(value);
      if (value < 20) set(s, value / 10 + 1);
    });
    expect(calls).toEqual([0, 10, 20]);
  });
});

// ── Faults: a RangeError at a fixed stack height, injected into a copy of src/signal.ts ──
// Each site's head throws while `FAULT.<site>` > 0, as a stack overflow at one height would:
// nothing changed yet, and the same call fails on every retry. src/signal.ts promises only that
// the call returns by throwing (no hang); each retry of the flush must consume an entry or unmark
// a runner, so a write that marks n runners loses at most n calls to faults.

const SITES = ["changed", "run", "update", "climb"] as const;
type Site = (typeof SITES)[number];
const HEADS: Record<Site, RegExp> = {
  changed: /^const changed = \(n: Node\): boolean => \{\n/mu,
  run: /^const run = \(e: Node\): void => \{\n/mu,
  update: /^const update = \(e: Node\): void => \{\n/mu,
  climb: /^const climb = \(e: Node\): Node => \{\n/mu,
};
const faultSource = await Bun.file(`${import.meta.dir}/../../src/signal.ts`).text();
/** Sites whose head is in src/signal.ts exactly once (a renamed function shows up here). */
const found = SITES.filter(
  (site) => faultSource.match(new RegExp(HEADS[site], "gmu"))?.length === 1,
);
interface Faulty {
  signal: typeof signal;
  get: typeof get;
  set: typeof set;
  effect: typeof effect;
  sub: typeof sub;
  scope: typeof scope;
  dispose: typeof dispose;
  FAULT: Record<Site | "thrown", number>;
}
/** The faulty copy, loaded from a blob URL as JavaScript (no file is written). */
const faulty = await (async (): Promise<Faulty> => {
  let code = faultSource;
  for (const site of found) {
    code = code.replace(
      HEADS[site],
      (line) =>
        `${line}  if (FAULT.${site} > 0) { FAULT.${site}--; FAULT.thrown++; throw new RangeError("simulated"); }\n`,
    );
  }
  code += "\nexport const FAULT = { changed: 0, run: 0, update: 0, climb: 0, thrown: 0 };\n";
  // A blob URL has no directory: its relative imports (./dev.ts) resolve from src/ instead
  code = code.replaceAll(
    /(?<= from ")\.\/(?=[^"]+")/gu,
    `${Bun.pathToFileURL(`${import.meta.dir}/../../src`).href}/`,
  );
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(code);
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  try {
    return (await import(url)) as Faulty;
  } finally {
    URL.revokeObjectURL(url);
  }
})();
// A persistent fault, as a real overflow at one stack height (finite, so a core that retries
// forever still ends)
const PERSISTENT = 200_000;

/**
 * A graph on `s`, built in a root scope: owners make their child, then read `s`, so a child pops
 * first and climbs to its marked owner, `levels` deep, under `roots` roots; `top` "sub" puts each
 * chain under a sub on `s`. `runners`: how many runners one write to `s` marks; `live`: each live
 * runner's last value of `s` (an effect's cleanup removes it).
 */
const nested = (
  roots: number,
  levels: number,
  top: "effect" | "sub",
): { s: Signal<number>; runners: number; root: Scope; live: Map<number, number> } => {
  const c = faulty;
  const s = c.signal(0);
  const live = new Map<number, number>();
  let ids = 0;
  const level = (k: number): void => {
    const id = ids++;
    c.effect(() => {
      if (k < levels) level(k + 1);
      live.set(id, c.get(s));
      return () => {
        live.delete(id);
      };
    });
  };
  const root = c.scope(() => {
    for (let i = 0; i < roots; i++) {
      if (top === "effect") level(1);
      else {
        const id = ids++;
        let made = false;
        c.sub(s, (value) => {
          live.set(id, value);
          if (!made) level(1);
          made = true;
        });
      }
    }
  });
  return { s, runners: roots * (levels + (top === "sub" ? 1 : 0)), root, live };
};
const GRAPHS = [
  ["4 roots × 3 levels of effects", () => nested(4, 3, "effect")],
  ["one 6-level chain of effects", () => nested(1, 6, "effect")],
  ["3 subs on s, each over a 3-level chain", () => nested(3, 3, "sub")],
  ["a sub on s over one child effect", () => nested(1, 1, "sub")],
] as const;

describe("faults (a RangeError at a fixed stack height)", () => {
  test("the copy has every fault site", () => {
    expect.assertions(1);
    expect(found).toEqual([...SITES]);
  });

  describe.each(SITES)("at every %s call", (site) => {
    test.each(GRAPHS)(
      "%s: the write returns by throwing it, at most one fault per marked runner",
      (_label, build) => {
        expect.assertions(2);
        const g = build();
        faulty.FAULT.thrown = 0;
        faulty.FAULT[site] = PERSISTENT;
        let thrown: unknown;
        try {
          faulty.set(g.s, 1);
        } catch (error) {
          thrown = error;
        }
        const faults = faulty.FAULT.thrown;
        faulty.FAULT[site] = 0;
        faulty.dispose(g.root);
        expect(faults).toBeLessThanOrEqual(g.runners);
        expect(thrown).toBeInstanceOf(RangeError);
      },
    );

    test.each(GRAPHS)(
      "Characterization: %s: two clean writes bring every live runner up to date (none stranded)",
      (_label, build) => {
        expect.assertions(1);
        const g = build();
        faulty.FAULT[site] = PERSISTENT;
        try {
          faulty.set(g.s, 1);
        } catch {
          // The faulted write's outcome is the test above's business
        }
        faulty.FAULT[site] = 0;
        faulty.set(g.s, 2);
        faulty.set(g.s, 3);
        const stale = [...g.live].filter(([, value]) => value !== 3);
        faulty.dispose(g.root);
        expect(stale).toEqual([]);
      },
    );
  });
});
