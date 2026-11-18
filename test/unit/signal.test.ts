// The signal core's contract: ordering, ownership, teardown order, keep-alive computeds,
// consistency, batches, writes in effects, errors, disposal, subs, scope bodies, owner and within,
// depth, memory and dev checks. Run in both modes: `bun test` (dev checks on) and
// `NODE_ENV=production bun test` (the dev checks group skips; the cleanup-error tests expect each
// mode's own outcome).
// Callbacks under test branch on the value they receive.
// oxlint-disable vitest/no-conditional-in-test

import { describe, expect, spyOn, test } from "bun:test";
import { list } from "../../src/reconcile.ts";
import {
  batch,
  type Computed,
  computed,
  defer,
  dispose,
  type Effect,
  effect,
  get,
  owner,
  type Scope,
  scope,
  set,
  type Signal,
  signal,
  sub,
  trigger,
  untracked,
  within,
} from "../../src/signal.ts";

// oxlint-disable-next-line node/no-process-env
const DEV = process.env.NODE_ENV !== "production";

/** Strictly increasing (no repeat, nothing stale after a newer value), ending at `latest`. */
const ordered = (seen: number[], latest: number): boolean =>
  seen.every((value, index) => index === 0 || seen[index - 1] < value) && seen.at(-1) === latest;

/** How many of 20 objects, each held only by what `make` built, survive a full collection. */
const survivors = async (make: () => object): Promise<number> => {
  const refs = Array.from({ length: 20 }, () => new WeakRef(make()));
  await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
  Bun.gc(true);
  return refs.filter((ref) => ref.deref() !== undefined).length;
};

/** Bounds a regression that loops through user code, so the failure is an error, not a hang. */
const bound = (): (() => void) => {
  let calls = 0;
  return () => {
    if (++calls > 10_000) throw new Error("runaway");
  };
};

/** Runs `fn` with console.error silenced (dev builds log cleanup errors). */
const silenced = <T>(fn: () => T): T => {
  using spy = spyOn(console, "error");
  spy.mockImplementation(() => {});
  return fn();
};

/** Runs `fn`, ignoring what it throws, with console.error silenced. */
const ignoring = (fn: () => void): void => {
  try {
    silenced(fn);
  } catch {
    // Where a cleanup's error goes is the "cleanup errors" tests' business
  }
};

/**
 * What became of a cleanup's `error` while `fn` ran: "logged" (passed to console.error), "reached
 * the caller" or "dropped". Dev expects "logged" (whether it also reaches the caller is not
 * pinned), production "dropped". Any other error `fn` throws propagates.
 */
const fate = (error: Error, fn: () => void): string => {
  using spy = spyOn(console, "error").mockImplementation(() => {});
  let thrown: unknown;
  try {
    fn();
  } catch (error_) {
    thrown = error_;
  }
  const logged = spy.mock.calls.some((args) => args.includes(error));
  if (thrown !== undefined && thrown !== error) throw thrown as Error;
  if (logged) return "logged";
  return thrown === error ? "reached the caller" : "dropped";
};
/** What `fate` reports in this mode: cleanup errors are logged in dev and dropped in production. */
const EXPECTED_FATE = DEV ? "logged" : "dropped";

/** What `read` returns, or the error it throws (dev builds may throw on a disposed computed). */
const attempt = (read: () => unknown): unknown => {
  try {
    return read();
  } catch (error) {
    return error;
  }
};

/** Calls of console.warn while `fn` runs (dev heuristics; none expected where this is used). */
const warnings = (fn: () => void): number => {
  using warn = spyOn(console, "warn").mockImplementation(() => {});
  fn();
  return warn.mock.calls.length;
};

/** What `fn` threw, or undefined. */
const thrownBy = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

/** Sibling order is unspecified: tests whose outcome hinges on queue order run both write orders. */
const ORDERS = [
  ["the sub's signal written first", true],
  ["the child's signal written first", false],
] as const;

/** The effect a user writes for a static subscription: the callback runs untracked (but owned). */
const userSub = <T>(source: Signal<T> | Computed<T>, fn: (value: T) => void): Effect =>
  effect(() => {
    const value = get(source);
    untracked(() => {
      fn(value);
    });
  });

describe("ordering", () => {
  test("an effect runs at once; a computed waits for its first read", () => {
    expect.assertions(2);
    const seen: string[] = [];
    const node = computed(() => {
      seen.push("computed");
      return 1;
    });
    const handle = effect(() => {
      seen.push("effect");
    });
    expect(seen).toEqual(["effect"]);
    get(node);
    dispose(handle);
    expect(seen).toEqual(["effect", "computed"]);
  });

  test("a userland sub gets the value now and after each change, never for an equal write", () => {
    expect.assertions(1);
    const source = signal(1);
    const seen: number[] = [];
    const handle = userSub<number>(source, (value) => {
      seen.push(value);
    });
    set(source, 2);
    set(source, 2);
    set(source, 3);
    dispose(handle);
    set(source, 4);
    expect(seen).toEqual([1, 2, 3]);
  });

  test("a cleanup runs before the next run and on dispose", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const value = get<number>(source);
      seen.push(`run ${value}`);
      return () => {
        seen.push(`cleanup ${value}`);
      };
    });
    set(source, 1);
    dispose(handle);
    dispose(handle);
    expect(seen).toEqual(["run 0", "cleanup 0", "run 1", "cleanup 1"]);
  });

  test("a cleanup's reads subscribe nothing", () => {
    expect.assertions(1);
    const source = signal(0);
    const other = signal(0);
    let runs = 0;
    const handle = effect(() => {
      get(source);
      runs++;
      return () => {
        get(other);
      };
    });
    set(source, 1);
    set(other, 1);
    dispose(handle);
    expect(runs).toBe(2);
  });

  test("cleanups a dispose inside an effect's run calls, returned or deferred, subscribe that effect to nothing", () => {
    expect.assertions(1);
    const source = signal(0);
    // An effect and a scope with a returned cleanup, a scope with a deferred one: all read source
    const victims = [
      effect(() => () => {
        get(source);
      }),
      scope(() => () => {
        get(source);
      }),
      scope(() => {
        defer(() => {
          get(source);
        });
      }),
    ];
    const runs = [0, 0, 0];
    const handles = victims.map((victim, index) =>
      effect(() => {
        runs[index]++;
        dispose(victim);
      }),
    );
    set(source, 1);
    for (const handle of handles) dispose(handle);
    expect(runs).toEqual([1, 1, 1]);
  });

  test("a nested effect is disposed before its parent re-runs", () => {
    expect.assertions(1);
    const outer = signal(0);
    const inner = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const round = get<number>(outer);
      effect(() => {
        seen.push(`child ${round} sees ${get<number>(inner)}`);
        return () => {
          seen.push(`child ${round} cleanup`);
        };
      });
    });
    set(outer, 1);
    set(inner, 1);
    dispose(handle);
    expect(seen).toEqual([
      "child 0 sees 0",
      "child 0 cleanup",
      "child 1 sees 0",
      "child 1 cleanup",
      "child 1 sees 1",
      "child 1 cleanup",
    ]);
  });

  test("a parent re-runs before its child when both read the written signal", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const value = get<number>(source);
      seen.push(`parent ${value}`);
      effect(() => {
        seen.push(`child ${get<number>(source)} of ${value}`);
      });
    });
    set(source, 1);
    dispose(handle);
    expect(seen).toEqual(["parent 0", "child 0 of 0", "parent 1", "child 1 of 1"]);
  });

  test("disposing a parent disposes its children", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = effect(() => {
      effect(() => {
        get(source);
        runs++;
      });
    });
    dispose(handle);
    set(source, 1);
    expect(runs).toBe(1);
  });

  test("a parent re-runs before its child when the child subscribed first", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      effect(() => {
        seen.push(`child ${get<number>(source)}`);
      });
      seen.push(`parent ${get<number>(source)}`);
    });
    set(source, 1);
    dispose(handle);
    expect(seen).toEqual(["child 0", "parent 0", "child 1", "parent 1"]);
  });

  test("a grandparent re-runs before its grandchild when both read the written signal", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const value = get<number>(source);
      seen.push(`grandparent ${value}`);
      effect(() => {
        effect(() => {
          seen.push(`grandchild ${get<number>(source)} of ${value}`);
        });
      });
    });
    set(source, 1);
    dispose(handle);
    expect(seen).toEqual([
      "grandparent 0",
      "grandchild 0 of 0",
      "grandparent 1",
      "grandchild 1 of 1",
    ]);
  });

  test("an effect re-runs before an effect in a scope its run created, both reading the written signal", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const value = get<number>(source);
      seen.push(`parent ${value}`);
      scope(() => {
        effect(() => {
          seen.push(`child ${get<number>(source)} of ${value}`);
        });
      });
    });
    set(source, 1);
    dispose(handle);
    expect(seen).toEqual(["parent 0", "child 0 of 0", "parent 1", "child 1 of 1"]);
  });
});

describe("ownership", () => {
  test("an effect created in a userland sub's untracked callback is disposed with the sub", () => {
    expect.assertions(1);
    const source = signal(0);
    const other = signal(0);
    let runs = 0;
    const handle = userSub(source, () => {
      effect(() => {
        get(other);
        runs++;
      });
    });
    dispose(handle);
    set(other, 1);
    expect(runs).toBe(1);
  });

  test("an effect created inside untracked in an effect's run is disposed before that effect re-runs", () => {
    expect.assertions(1);
    const poke = signal(0);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const round = get<number>(poke);
      untracked(() => {
        effect(() => {
          seen.push(`child ${round} sees ${get<number>(source)}`);
        });
      });
    });
    set(poke, 1);
    set(source, 1);
    dispose(handle);
    set(source, 2);
    expect(seen).toEqual(["child 0 sees 0", "child 1 sees 0", "child 1 sees 1"]);
  });

  test("a scope's effects stop with the scope", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = scope(() => {
      effect(() => {
        get(source);
        runs++;
      });
    });
    set(source, 1);
    dispose(handle);
    set(source, 2);
    expect(runs).toBe(2);
  });

  test("a scope's fn subscribes nothing, so the scope never re-runs", () => {
    expect.assertions(1);
    const source = signal(0);
    let calls = 0;
    const handle = scope(() => {
      calls++;
      get(source);
    });
    set(source, 1);
    dispose(handle);
    expect(calls).toBe(1);
  });

  test("a scope made in an effect's run subscribes that effect to nothing its fn reads", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      scope(() => {
        get(source);
      });
    });
    set(source, 1);
    dispose(handle);
    expect(runs).toBe(1);
  });

  test("disposing a scope stops the effects of the scopes nested in it", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = scope(() => {
      scope(() => {
        scope(() => {
          effect(() => {
            get(source);
            runs++;
          });
        });
      });
    });
    dispose(handle);
    set(source, 1);
    expect(runs).toBe(1);
  });

  test("an effect's re-run disposes the scopes its last run created, with their effects and cleanups", () => {
    expect.assertions(1);
    const poke = signal(0);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const round = get<number>(poke);
      scope(() => {
        effect(() => {
          seen.push(`effect ${round} sees ${get<number>(source)}`);
        });
        defer(() => {
          seen.push(`scope ${round} cleanup`);
        });
      });
    });
    set(poke, 1);
    set(source, 1);
    dispose(handle);
    expect(seen).toEqual([
      "effect 0 sees 0",
      "scope 0 cleanup",
      "effect 1 sees 0",
      "effect 1 sees 1",
      "scope 1 cleanup",
    ]);
  });

  test("a scope's cleanup runs once, when the scope is disposed", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const handle = scope(() => {
      defer(() => {
        seen.push("cleanup");
      });
    });
    seen.push("disposing");
    dispose(handle);
    dispose(handle);
    expect(seen).toEqual(["disposing", "cleanup"]);
  });

  test("a cleanup registered in an effect's run runs before the next run and on dispose", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const value = get<number>(source);
      seen.push(`run ${value}`);
      defer(() => {
        seen.push(`cleanup ${value}`);
      });
    });
    set(source, 1);
    dispose(handle);
    expect(seen).toEqual(["run 0", "cleanup 0", "run 1", "cleanup 1"]);
  });

  test("disposal runs every descendant's cleanup before the effect's own, innermost first", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const handle = effect(() => {
      effect(() => {
        effect(() => () => {
          seen.push("grandchild");
        });
        return () => {
          seen.push("child");
        };
      });
      return () => {
        seen.push("parent");
      };
    });
    dispose(handle);
    expect(seen).toEqual(["grandchild", "child", "parent"]);
  });

  test("a child's cleanup disposing its owner during the owner's disposal leaves the owner's cleanup last", () => {
    expect.assertions(1);
    const seen: string[] = [];
    // A logging child between two that dispose the owner: whatever the sibling order, one of
    // those runs before it
    const handle: Effect = effect(() => {
      effect(() => () => {
        dispose(handle);
      });
      effect(() => () => {
        seen.push("child");
      });
      effect(() => () => {
        dispose(handle);
      });
      return () => {
        seen.push("parent");
      };
    });
    dispose(handle);
    expect(seen).toEqual(["child", "parent"]);
  });

  test("a re-run disposes the children of the last run before calling that run's cleanup", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const value = get<number>(source);
      effect(() => () => {
        seen.push(`child ${value}`);
      });
      return () => {
        seen.push(`parent ${value}`);
      };
    });
    set(source, 1);
    dispose(handle);
    expect(seen).toEqual(["child 0", "parent 0", "child 1", "parent 1"]);
  });

  test("a scope disposed twice, then again by its owner's re-run, calls its cleanup once", () => {
    expect.assertions(1);
    const poke = signal(0);
    let calls = 0;
    let inner!: Scope;
    const handle = effect(() => {
      get(poke);
      inner = scope(() => {
        defer(() => {
          calls++;
        });
      });
    });
    dispose(inner);
    dispose(inner);
    // The re-run disposes the disposed scope again and makes a new one, which the last dispose() disposes
    set(poke, 1);
    dispose(handle);
    expect(calls).toBe(2);
  });

  test("an effect in a scope another effect disposes earlier in the flush never runs after the disposal", () => {
    expect.assertions(1);
    const source = signal(0);
    let stopped = false;
    let late = 0;
    // One scope made before the stopping effect and one after: whatever the sibling order, one of
    // them is queued behind it
    const reader = (): Scope =>
      scope(() => {
        effect(() => {
          get(source);
          if (stopped) late++;
        });
      });
    const before = reader();
    const stopper = effect(() => {
      if (get(source) === 1) {
        stopped = true;
        dispose(before);
        // oxlint-disable-next-line no-use-before-define -- made after this effect on purpose
        dispose(after);
      }
    });
    const after = reader();
    set(source, 1);
    dispose(stopper);
    expect(late).toBe(0);
  });

  test("a scope disposed inside a batch runs none of its effects at the batch end", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = scope(() => {
      effect(() => {
        get(source);
        runs++;
      });
    });
    batch(() => {
      set(source, 1);
      dispose(handle);
    });
    expect(runs).toBe(1);
  });

  test("a scope whose fn throws is disposed with what it created, and scope() rethrows", () => {
    expect.assertions(2);
    const source = signal(0);
    let runs = 0;
    expect(() =>
      scope(() => {
        effect(() => {
          get(source);
          runs++;
        });
        throw new Error("body");
      }),
    ).toThrow("body");
    set(source, 1);
    expect(runs).toBe(1);
  });

  test("an effect whose first run throws disposes the scopes it created", () => {
    expect.assertions(2);
    const source = signal(0);
    let runs = 0;
    expect(() =>
      effect(() => {
        scope(() => {
          effect(() => {
            get(source);
            runs++;
          });
        });
        throw new Error("first run");
      }),
    ).toThrow("first run");
    set(source, 1);
    expect(runs).toBe(1);
  });

  test.serial("creating owner-less signals, computeds, effects and scopes warns nothing", () => {
    expect.assertions(1);
    const calls = warnings(() => {
      const source = signal(0);
      const node = computed(() => get<number>(source) + 1);
      get(node);
      const handle = effect(() => {
        get(node);
      });
      const parent = scope(() => {
        get(computed(() => 1));
      });
      set(source, 1);
      dispose(handle);
      dispose(parent);
    });
    expect(calls).toBe(0);
  });

  test.serial("disposing a scope whose effect reads the scope's computed warns nothing", () => {
    expect.assertions(1);
    const source = signal(0);
    const calls = warnings(() => {
      const handle = scope(() => {
        const node = computed(() => get<number>(source) + 1);
        effect(() => {
          get(node);
        });
      });
      dispose(handle);
      set(source, 1);
    });
    expect(calls).toBe(0);
  });

  test("an effect made by a cleanup in the flush after effect()'s first run outlives the new effect", () => {
    expect.assertions(1);
    const source = signal(0);
    const other = signal(0);
    let runs = 0;
    const host = effect(() => {
      const value = get<number>(source);
      return () => {
        if (value === 0)
          effect(() => {
            get(other);
            runs++;
          });
      };
    });
    // Its first run's write re-runs host after the run: no effect body runs then, so the effect
    // host's cleanup makes is owner-less
    const writer = effect(() => {
      set(source, 1);
    });
    dispose(writer);
    set(other, 1);
    dispose(host);
    expect(runs).toBe(2);
  });
});

describe("teardown order", () => {
  test("an effect's disposal tears its children and registered cleanups down newest first, its returned cleanup last", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const handle = effect(() => {
      effect(() => () => {
        seen.push("child 1");
      });
      defer(() => {
        seen.push("cleanup 1");
      });
      effect(() => () => {
        seen.push("child 2");
      });
      defer(() => {
        seen.push("cleanup 2");
      });
      return () => {
        seen.push("own");
      };
    });
    dispose(handle);
    expect(seen).toEqual(["cleanup 2", "child 2", "cleanup 1", "child 1", "own"]);
  });

  test("an effect's re-run tears down what its last run made newest first, its returned cleanup last, then runs", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const value = get<number>(source);
      seen.push(`run ${value}`);
      effect(() => () => {
        seen.push(`child 1 of ${value}`);
      });
      defer(() => {
        seen.push(`cleanup 1 of ${value}`);
      });
      effect(() => () => {
        seen.push(`child 2 of ${value}`);
      });
      defer(() => {
        seen.push(`cleanup 2 of ${value}`);
      });
      return () => {
        seen.push(`own of ${value}`);
      };
    });
    set(source, 1);
    dispose(handle);
    expect(seen.slice(0, 7)).toEqual([
      "run 0",
      "cleanup 2 of 0",
      "child 2 of 0",
      "cleanup 1 of 0",
      "child 1 of 0",
      "own of 0",
      "run 1",
    ]);
  });

  test("a scope's disposal tears its effects, scopes and registered cleanups down newest first, the function its fn returned last", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const handle = scope(() => {
      effect(() => () => {
        seen.push("effect");
      });
      defer(() => {
        seen.push("cleanup 1");
      });
      scope(() => () => {
        seen.push("scope");
      });
      defer(() => {
        seen.push("cleanup 2");
      });
      return () => {
        seen.push("own");
      };
    });
    dispose(handle);
    expect(seen).toEqual(["cleanup 2", "scope", "cleanup 1", "effect", "own"]);
  });

  test("cleanups registered with defer() and as userland effect(() => fn) interleave by registration order", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const handle = effect(() => {
      defer(() => {
        seen.push("registered 1");
      });
      effect(() => () => {
        seen.push("userland 1");
      });
      defer(() => {
        seen.push("registered 2");
      });
      effect(() => () => {
        seen.push("userland 2");
      });
    });
    dispose(handle);
    expect(seen).toEqual(["userland 2", "registered 2", "userland 1", "registered 1"]);
  });

  test("a child's whole teardown runs between its newer and its older siblings", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const handle = effect(() => {
      defer(() => {
        seen.push("older");
      });
      effect(() => {
        defer(() => {
          seen.push("grandchild cleanup");
        });
        effect(() => () => {
          seen.push("grandchild");
        });
        return () => {
          seen.push("child");
        };
      });
      defer(() => {
        seen.push("newer");
      });
    });
    dispose(handle);
    expect(seen).toEqual(["newer", "grandchild", "grandchild cleanup", "child", "older"]);
  });

  test("a registered cleanup disposing its owner during the owner's re-run tears down the rest, the returned cleanup last, without a re-run", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle: Effect = effect(() => {
      seen.push(`run ${get<number>(source)}`);
      effect(() => () => {
        seen.push("child");
      });
      defer(() => {
        seen.push("cleanup");
        dispose(handle);
      });
      return () => {
        seen.push("own");
      };
    });
    set(source, 1);
    expect(seen).toEqual(["run 0", "cleanup", "child", "own"]);
  });

  test("a registered cleanup disposing its owner during the owner's disposal leaves the older child before the returned cleanup", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const handle: Effect = effect(() => {
      effect(() => () => {
        seen.push("child");
      });
      defer(() => {
        dispose(handle);
      });
      return () => {
        seen.push("own");
      };
    });
    dispose(handle);
    expect(seen).toEqual(["child", "own"]);
  });

  test("a scope disposed by its own registered cleanup during its disposal leaves the older effect before the returned cleanup", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const handle: Scope = scope(() => {
      effect(() => () => {
        seen.push("effect");
      });
      defer(() => {
        dispose(handle);
      });
      return () => {
        seen.push("own");
      };
    });
    dispose(handle);
    expect(seen).toEqual(["effect", "own"]);
  });

  test("disposing an ancestor from a cleanup in a child's re-run teardown runs the child's returned cleanup before the ancestor's", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle: Effect = effect(() => {
      effect(() => {
        get(source);
        // Torn down first in this effect's re-run, while its returned cleanup is still due
        effect(() => () => {
          dispose(handle);
        });
        return () => {
          seen.push("child");
        };
      });
      return () => {
        seen.push("owner");
      };
    });
    set(source, 1);
    expect(seen).toEqual(["child", "owner"]);
  });

  test("a grandchild's cleanup disposing the root during the root's disposal finishes the child's teardown before the root's returned cleanup", () => {
    expect.assertions(2);
    const seen: string[] = [];
    const root: Scope = scope(() => {
      defer(() => {
        seen.push("older");
      });
      scope(() => {
        scope(() => {
          defer(() => {
            seen.push("grandchild");
            dispose(root);
          });
        });
        return () => {
          seen.push("child");
        };
      });
      return () => {
        seen.push("root");
      };
    });
    dispose(root);
    // Each once, the root's returned cleanup last; the order among the rest after the re-entry is
    // not pinned
    expect(seen.toSorted()).toEqual(["child", "grandchild", "older", "root"]);
    expect(seen.at(-1)).toBe("root");
  });

  test("a deferred cleanup reads an owned computed made before it live and current, also after writing its source", () => {
    expect.assertions(1);
    const seen: string[] = [];
    /** An owned computed, then a cleanup reading it before and after writing its source. */
    const body = (label: string): void => {
      const source = signal(1);
      const tens = computed(() => get<number>(source) * 10);
      untracked(() => get(tens));
      defer(() => {
        seen.push(`${label} ${String(attempt(() => get(tens)))}`);
        set(source, 2);
        seen.push(`${label} ${String(attempt(() => get(tens)))}`);
      });
    };
    dispose(
      scope(() => {
        body("dispose");
      }),
    );
    const poke = signal(0);
    const handle = effect(() => {
      get(poke);
      body("rerun");
    });
    set(poke, 1);
    dispose(handle);
    expect(seen).toEqual([
      "dispose 10",
      "dispose 20",
      "rerun 10",
      "rerun 20",
      "rerun 10",
      "rerun 20",
    ]);
  });

  test("a dispose inside a deferred cleanup runs none of the outer teardown's pending cleanups", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const other = scope(() => () => {
      seen.push("other");
    });
    const root = scope(() => {
      defer(() => {
        seen.push("older");
      });
      defer(() => {
        dispose(other);
        seen.push("newer");
      });
      return () => {
        seen.push("root");
      };
    });
    dispose(root);
    expect(seen).toEqual(["other", "newer", "older", "root"]);
  });

  test("an effect whose first run throws inside a deferred cleanup runs none of the outer teardown's pending cleanups", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const root = scope(() => {
      defer(() => {
        seen.push("older");
      });
      defer(() => {
        try {
          effect(() => {
            defer(() => {
              seen.push("inner");
            });
            throw new Error("first run");
          });
        } catch {
          seen.push("caught");
        }
      });
      return () => {
        seen.push("root");
      };
    });
    dispose(root);
    expect(seen).toEqual(["inner", "caught", "older", "root"]);
  });
});

describe("keep-alive computeds", () => {
  test("a computed read untracked is not re-evaluated by an unrelated write", () => {
    expect.assertions(1);
    const source = signal(1);
    const other = signal(1);
    let evals = 0;
    const node = computed(() => {
      evals++;
      return get<number>(source) * 2;
    });
    get(node);
    set(other, 2);
    get(node);
    expect(evals).toBe(1);
  });

  test("a computed read untracked re-evaluates once after its source changes, however often it is read", () => {
    expect.assertions(2);
    const source = signal(1);
    let evals = 0;
    const node = computed(() => {
      evals++;
      return get<number>(source) * 2;
    });
    get(node);
    set(source, 2);
    get(node);
    expect(get(node)).toBe(4);
    expect(evals).toBe(2);
  });

  test("an observed computed read untracked after an unrelated write is not re-evaluated", () => {
    expect.assertions(1);
    const source = signal(1);
    const other = signal(1);
    let evals = 0;
    const node = computed(() => {
      evals++;
      return get<number>(source) * 2;
    });
    const handle = effect(() => {
      get(node);
    });
    set(other, 2);
    get(node);
    dispose(handle);
    expect(evals).toBe(1);
  });

  test("a computed whose only reader was disposed is not re-evaluated by a read without a source change", () => {
    expect.assertions(1);
    const source = signal(1);
    let evals = 0;
    const node = computed(() => {
      evals++;
      return get<number>(source);
    });
    const handle = effect(() => {
      get(node);
    });
    dispose(handle);
    get(node);
    expect(evals).toBe(1);
  });

  test("a computed whose only reader was disposed reads its source's later value", () => {
    expect.assertions(1);
    const source = signal(1);
    const node = computed(() => get<number>(source) + 1);
    const handle = effect(() => {
      get(node);
    });
    dispose(handle);
    set(source, 5);
    expect(get(node)).toBe(6);
  });

  test("a computed read untracked is not re-evaluated when a computed it reads keeps its value", () => {
    expect.assertions(2);
    const source = signal(1);
    let evals = 0;
    const parity = computed(() => get<number>(source) % 2);
    const label = computed(() => {
      evals++;
      return get<number>(parity) * 10;
    });
    get(label);
    set(source, 3);
    expect(get(label)).toBe(10);
    expect(evals).toBe(1);
  });

  test("a chain read untracked re-evaluates only the computeds whose sources changed", () => {
    expect.assertions(1);
    const first = signal(1);
    const second = signal(1);
    const evals = { lower: 0, upper: 0 };
    const lower = computed(() => {
      evals.lower++;
      return get<number>(first) + 1;
    });
    const upper = computed(() => {
      evals.upper++;
      return get<number>(lower) + get<number>(second);
    });
    get(upper);
    set(second, 5);
    get(upper);
    expect(evals).toEqual({ lower: 1, upper: 2 });
  });

  test("a scope's computed read untracked after an unrelated write is not re-evaluated", () => {
    expect.assertions(1);
    const source = signal(1);
    const other = signal(1);
    let evals = 0;
    let node!: Computed<number>;
    const handle = scope(() => {
      node = computed(() => {
        evals++;
        return get<number>(source) + 1;
      });
      get(node);
    });
    set(other, 2);
    get(node);
    dispose(handle);
    expect(evals).toBe(1);
  });

  test("an effect's computed read untracked in an event handler re-evaluates only after its source changes", () => {
    expect.assertions(1);
    const source = signal(1);
    const other = signal(1);
    let evals = 0;
    let handler = (): number => 0;
    const handle = effect(() => {
      const node = computed(() => {
        evals++;
        return get<number>(source) + 1;
      });
      handler = () => get(node);
    });
    const seen = [handler()];
    set(other, 2);
    seen.push(handler());
    set(source, 2);
    seen.push(handler(), evals);
    dispose(handle);
    expect(seen).toEqual([2, 2, 3, 2]);
  });
});

describe("consistency", () => {
  test("a diamond's effect runs once per write and sees consistent values", () => {
    expect.assertions(1);
    const source = signal(1);
    const left = computed(() => get<number>(source) + 1);
    const right = computed(() => get<number>(source) * 10);
    const seen: number[][] = [];
    const handle = effect(() => {
      seen.push([get(left), get(right)]);
    });
    set(source, 2);
    dispose(handle);
    expect(seen).toEqual([
      [2, 10],
      [3, 20],
    ]);
  });

  test("an effect on a 10-wide diamond never sees mixed values", () => {
    expect.assertions(1);
    const source = signal(0);
    const parts = Array.from({ length: 10 }, (_, index) =>
      computed(() => get<number>(source) + index),
    );
    const sum = computed(() => parts.reduce<number>((total, part) => total + get<number>(part), 0));
    const seen: number[] = [];
    const handle = effect(() => {
      seen.push(get(sum));
    });
    set(source, 1);
    set(source, 2);
    dispose(handle);
    expect(seen).toEqual([45, 55, 65]);
  });

  test("an effect reading a signal and a computed of it runs once per write", () => {
    expect.assertions(1);
    const source = signal(1);
    const double = computed(() => get<number>(source) * 2);
    const seen: number[][] = [];
    const handle = effect(() => {
      seen.push([get(source), get(double)]);
    });
    set(source, 2);
    dispose(handle);
    expect(seen).toEqual([
      [1, 2],
      [2, 4],
    ]);
  });

  test("an unchanged computed value re-runs no dependent", () => {
    expect.assertions(1);
    const source = signal(1);
    const parity = computed(() => get<number>(source) % 2);
    let runs = 0;
    const handle = effect(() => {
      get(parity);
      runs++;
    });
    set(source, 3);
    set(source, 5);
    dispose(handle);
    expect(runs).toBe(1);
  });

  test("a userland sub on a computed is called only when the computed's value changes", () => {
    expect.assertions(1);
    const source = signal(1);
    const parity = computed(() => get<number>(source) % 2);
    const seen: number[] = [];
    const handle = userSub<number>(parity, (value) => {
      seen.push(value);
    });
    set(source, 3);
    set(source, 4);
    set(source, 6);
    dispose(handle);
    expect(seen).toEqual([1, 0]);
  });

  test("a userland sub reading a computed of its signal sees the computed's new value", () => {
    expect.assertions(1);
    const source = signal(1);
    const double = computed(() => get<number>(source) * 2);
    const seen: number[] = [];
    const keep = effect(() => {
      get(double);
    });
    const handle = userSub(source, () => {
      seen.push(get(double));
    });
    set(source, 2);
    dispose(handle);
    dispose(keep);
    expect(seen).toEqual([2, 4]);
  });

  test("a userland sub's callback subscribes nothing", () => {
    expect.assertions(1);
    const source = signal(1);
    const other = signal(1);
    let calls = 0;
    const handle = userSub(source, () => {
      get(other);
      calls++;
    });
    set(other, 2);
    dispose(handle);
    expect(calls).toBe(1);
  });

  test("an unobserved computed reads its source's new value", () => {
    expect.assertions(2);
    const source = signal(1);
    const plusOne = computed(() => get<number>(source) + 1);
    expect(get(plusOne)).toBe(2);
    set(source, 5);
    expect(get(plusOne)).toBe(6);
  });

  test("an unobserved computed reading another unobserved one sees a write made between reads", () => {
    expect.assertions(2);
    const source = signal(1);
    const inner = computed(() => get<number>(source));
    const outer = computed(() => get<number>(inner) + 1);
    expect(get(outer)).toBe(2);
    set(source, 5);
    expect(get(outer)).toBe(6);
  });

  test("no getter of an unobserved computed runs on a write", () => {
    expect.assertions(1);
    const source = signal(1);
    let runs = 0;
    const node = computed(() => {
      runs++;
      return get<number>(source);
    });
    get(node);
    set(source, 2);
    set(source, 3);
    expect(runs).toBe(1);
  });

  test("an effect stops seeing a branch it switched away from and sees the new one", () => {
    expect.assertions(2);
    const which = signal(0);
    const branches = [signal(10), signal(20)];
    let runs = 0;
    const handle = effect(() => {
      runs++;
      get(branches[get<number>(which)]);
    });
    set(which, 1);
    set(branches[0], 11);
    expect(runs).toBe(2);
    set(branches[1], 21);
    dispose(handle);
    expect(runs).toBe(3);
  });

  test("writing -0 over 0 notifies nothing", () => {
    expect.assertions(1);
    const source = signal(0);
    let calls = 0;
    const handle = userSub(source, () => {
      calls++;
    });
    set(source, -0);
    dispose(handle);
    expect(calls).toBe(1);
  });

  test("writing NaN over NaN notifies again", () => {
    expect.assertions(1);
    const source = signal(Number.NaN);
    let calls = 0;
    const handle = userSub(source, () => {
      calls++;
    });
    set(source, Number.NaN);
    dispose(handle);
    expect(calls).toBe(2);
  });

  test("a signal's v is its value, read without subscribing", () => {
    expect.assertions(2);
    const source = signal(1);
    let runs = 0;
    const handle = effect(() => {
      runs += source.v;
    });
    set(source, 2);
    dispose(handle);
    expect(source.v).toBe(2);
    expect(runs).toBe(1);
  });

  test("an untracked read subscribes nothing", () => {
    expect.assertions(2);
    const tracked = signal(1);
    const other = signal(1);
    let runs = 0;
    const handle = effect(() => {
      get(tracked);
      expect(untracked(() => get(other))).toBe(1);
      runs++;
    });
    set(other, 2);
    dispose(handle);
    expect(runs).toBe(1);
  });

  test("a computed first read by a later effect in the same flush subscribes that effect only", () => {
    expect.assertions(3);
    const s = signal(0);
    const u = signal(0);
    const c = computed(() => get(s) + get(u));
    let firstRuns = 0;
    let secondRuns = 0;
    effect(() => {
      get(s);
      firstRuns++;
    });
    effect(() => {
      if (get(s) === 1) get(c);
      secondRuns++;
    });
    set(s, 1);
    firstRuns = 0;
    secondRuns = 0;
    set(u, 1);
    expect(firstRuns).toBe(0);
    expect(secondRuns).toBe(1);
    expect(get(c)).toBe(2);
  });
});

describe("batch", () => {
  test("defers effects to its end, which sees the final values once", () => {
    expect.assertions(1);
    const left = signal(1);
    const right = signal(2);
    const seen: string[] = [];
    const reader = effect(() => {
      seen.push(`effect ${get<number>(left) + get<number>(right)}`);
    });
    const listener = userSub<number>(left, (value) => {
      seen.push(`sub ${value}`);
    });
    batch(() => {
      set(left, 10);
      set(right, 20);
      set(left, 11);
      seen.push("body");
    });
    dispose(reader);
    dispose(listener);
    expect(seen.toSorted()).toEqual(["body", "effect 3", "effect 31", "sub 1", "sub 11"]);
  });

  test("returns what its body returns", () => {
    expect.assertions(1);
    expect(batch(() => 42)).toBe(42);
  });

  test("a batch body runs before what it deferred", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = userSub<number>(source, (value) => {
      seen.push(`sub ${value}`);
    });
    batch(() => {
      set(source, 1);
      seen.push("body");
    });
    dispose(handle);
    expect(seen).toEqual(["sub 0", "body", "sub 1"]);
  });

  test("a batch that restores a value notifies nothing", () => {
    expect.assertions(1);
    const source = signal(1);
    let calls = 0;
    const reader = effect(() => {
      get(source);
      calls++;
    });
    const listener = userSub(source, () => {
      calls++;
    });
    batch(() => {
      set(source, 2);
      set(source, 1);
    });
    dispose(reader);
    dispose(listener);
    expect(calls).toBe(2);
  });

  test("reads inside a batch see the writes so far, and the effect still re-runs at the end", () => {
    expect.assertions(3);
    const source = signal(1);
    const double = computed(() => get<number>(source) * 2);
    const seen: number[] = [];
    const handle = effect(() => {
      seen.push(get(double));
    });
    batch(() => {
      set(source, 2);
      expect(get(source)).toBe(2);
      expect(get(double)).toBe(4);
    });
    dispose(handle);
    expect(seen).toEqual([2, 4]);
  });

  test("a nested batch waits for the outermost", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = userSub<number>(source, (value) => {
      seen.push(`sub ${value}`);
    });
    batch(() => {
      batch(() => {
        set(source, 1);
      });
      seen.push("inner done");
    });
    dispose(handle);
    expect(seen).toEqual(["sub 0", "inner done", "sub 1"]);
  });

  test("a throwing batch body leaves later writes unbatched", () => {
    expect.assertions(2);
    const source = signal(0);
    const seen: number[] = [];
    const handle = userSub<number>(source, (value) => {
      seen.push(value);
    });
    expect(() => {
      batch(() => {
        throw new Error("body");
      });
    }).toThrow("body");
    set(source, 1);
    dispose(handle);
    expect(seen).toEqual([0, 1]);
  });

  test("an effect disposed during a batch does not run at its end", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = effect(() => {
      get(source);
      runs++;
    });
    batch(() => {
      set(source, 1);
      dispose(handle);
    });
    expect(runs).toBe(1);
  });

  test("an effect two writes of one batch reach still re-runs on the next write", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: number[] = [];
    const handle = effect(() => {
      seen.push(get<number>(source));
    });
    batch(() => {
      set(source, 1);
      set(source, 2);
    });
    set(source, 3);
    dispose(handle);
    expect(seen).toEqual([0, 2, 3]);
  });

  test("a userland sub made in a batch after a write learns when the batch restores the value", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: number[] = [];
    let handle!: Effect;
    batch(() => {
      set(source, 1);
      handle = userSub<number>(source, (value) => {
        seen.push(value);
      });
      set(source, 0);
    });
    dispose(handle);
    expect(seen).toEqual([1, 0]);
  });

  test("a userland sub made in a batch on a signal others watch learns when the batch restores it", () => {
    expect.assertions(1);
    const source = signal(0);
    const watcher = userSub(source, () => {});
    const seen: number[] = [];
    let handle!: Effect;
    batch(() => {
      set(source, 1);
      handle = userSub<number>(source, (value) => {
        seen.push(value);
      });
      set(source, 0);
    });
    dispose(handle);
    dispose(watcher);
    expect(seen).toEqual([1, 0]);
  });
});

describe("writes in effects", () => {
  test("a write an effect makes is seen by an effect that reads it", () => {
    expect.assertions(1);
    const source = signal(1);
    const mirror = signal(0);
    const seen: number[] = [];
    const writer = effect(() => {
      set(mirror, get<number>(source) * 2);
    });
    const reader = effect(() => {
      seen.push(get(mirror));
    });
    set(source, 2);
    dispose(writer);
    dispose(reader);
    expect(seen).toEqual([2, 4]);
  });

  test("an effect incrementing a signal it reads terminates", () => {
    expect.assertions(1);
    const source = signal(0);
    const handle = effect(() => {
      const value = get<number>(source);
      if (value < 5) set(source, value + 1);
    });
    dispose(handle);
    expect(source.v).toBeGreaterThanOrEqual(1);
  });

  test("a userland sub writing its own signal leaves every other sub seeing each value once, in order", () => {
    expect.assertions(1);
    const source = signal(0);
    const firstSeen: number[] = [];
    const lastSeen: number[] = [];
    const first = userSub<number>(source, (value) => {
      firstSeen.push(value);
    });
    const writer = userSub<number>(source, (value) => {
      if (value === 1) set(source, 2);
    });
    const last = userSub<number>(source, (value) => {
      lastSeen.push(value);
    });
    set(source, 1);
    dispose(first);
    dispose(writer);
    dispose(last);
    expect([ordered(firstSeen, 2), ordered(lastSeen, 2)]).toEqual([true, true]);
  });

  test("an effect that increments a signal it reads on every run terminates", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      // Bounds a regression that re-runs it for its own writes, so the failure is a count, not a hang
      if (runs < 1000) set(source, get<number>(source) + 1);
    });
    dispose(handle);
    expect(runs).toBeLessThan(1000);
  });

  test("an effect that read two values of a signal in one run re-runs on its next change", () => {
    expect.assertions(1);
    const source = signal(1);
    const seen: number[] = [];
    let runs = 0;
    const handle = effect(() => {
      runs++;
      seen.push(get(source));
      if (runs === 1) {
        set(source, 0);
        get(source);
        set(source, 1);
      }
    });
    // Its last read saw 0, as this write leaves it; whether its own writes re-ran it is open
    set(source, 0);
    dispose(handle);
    expect(seen.at(-1)).toBe(0);
  });

  test("an effect that writes the source of a computed it reads still re-runs on later writes", () => {
    expect.assertions(1);
    const source = signal(0);
    const double = computed(() => get<number>(source) * 2);
    const seen: number[] = [];
    const handle = effect(() => {
      const value = get<number>(double);
      seen.push(value);
      if (value === 2) set(source, 2);
    });
    set(source, 1);
    set(source, 3);
    dispose(handle);
    expect(seen.at(-1)).toBe(6);
  });

  test("a computed an effect reads, reached by two of the effect's own writes, still sees the next write", () => {
    expect.assertions(1);
    const source = signal(0);
    const double = computed(() => get<number>(source) * 2);
    const seen: number[] = [];
    const handle = effect(() => {
      seen.push(get<number>(double));
      if (get<number>(source) === 0) {
        set(source, 1);
        set(source, 2);
      }
    });
    set(source, 5);
    dispose(handle);
    // Whether the effect re-runs for its own writes is unspecified: only the last value is pinned
    expect(seen.at(-1)).toBe(10);
  });

  test("an effect whose child effect or scope increments a signal the effect read terminates", () => {
    expect.assertions(2);
    // A child's first-run writes count as its owner's run's own
    for (const make of [effect, scope]) {
      const source = signal(0);
      let runs = 0;
      const handle = effect(() => {
        runs++;
        get(source);
        // Bounds a regression that re-runs the owner for its child's writes: a count, not a hang
        if (runs < 1000)
          make(() => {
            set(source, source.v + 1);
          });
      });
      set(source, 10);
      dispose(handle);
      expect(runs).toBeLessThan(1000);
    }
  });

  test("an effect whose child scope increments its source in its first run terminates", () => {
    expect.assertions(1);
    const s = signal(0);
    const tick = bound();
    let runs = 0;
    effect(() => {
      tick();
      runs++;
      get(s);
      scope(() => {
        set(s, untracked(() => get(s)) + 1);
      });
    });
    set(s, 10);
    expect([runs, s.v]).toEqual([2, 11]);
  });

  test("an effect whose cleanup writes its own source re-runs once per outside write", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      get(s);
      get(t);
      return () => {
        set(s, untracked(() => get(s)) + 1);
      };
    });
    set(t, 1);
    set(t, 2);
    expect(runs).toBe(3);
  });

  test("a read after a child's first-run write re-runs the effect when the first value comes back", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[][] = [];
    let once = true;
    effect(() => {
      const first = get(s);
      if (once) {
        once = false;
        effect(() => {
          set(s, 1);
        });
      }
      seen.push([first, get(s)]);
    });
    set(s, 0);
    expect(seen).toEqual([
      [0, 1],
      [0, 0],
    ]);
  });

  test("a source read around a nested effect that reads it too: one re-run per write", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      get(s);
      effect(() => {
        get(s);
      });
      get(s);
    });
    set(s, 1);
    set(s, 2);
    expect(runs).toBe(3);
  });

  test("a computed re-evaluated inside a run that read it: the run sees and keeps the new value", () => {
    expect.assertions(1);
    const s = signal(0);
    const c = computed(() => get(s) * 2);
    const seen: number[][] = [];
    effect(() => {
      const before = get(c);
      if (before === 0) set(s, 1);
      seen.push([before, get(c)]);
    });
    set(s, 0);
    expect(seen).toEqual([
      [0, 2],
      [0, 2],
    ]);
  });

  test("a run reading a source after a child effect, a child sub and a computed read it is subscribed to it", () => {
    expect.assertions(1);
    const b = signal(0);
    const c = computed(() => {
      get(b);
      return 0;
    });
    let runs = 0;
    effect(() => {
      runs++;
      effect(() => {
        get(b);
      });
      sub(signal(0), () => {
        get(b);
        get(c);
      });
      get(c);
      get(b);
    });
    set(b, 1);
    expect(runs).toBe(2);
  });

  test("a run that read a computed, wrote its source in a child's first run and read it again re-runs on restore", () => {
    expect.assertions(1);
    const s = signal(0);
    const c = computed(() => get(s) * 2);
    const seen: number[] = [];
    effect(() => {
      seen.push(get(c));
      if (seen.length === 1) {
        effect(() => {
          set(s, 1);
        });
        seen.push(get(c));
      }
    });
    set(s, 0);
    expect(seen).toEqual([0, 2, 0]);
  });
});

// Dynamic dependencies that flip direction. `middle` reads `bottom` while `gate` is true, `bottom`
// reads `top` (plus `root`, 0) while `flip` is true, and `top` reads `middle` (`top` is `middle` +
// 1 + 10 × `extra`, 0 until a test writes it); an effect keeps `top` observed.
// `swap` clears `gate`, then sets `flip`: the two computeds swap which reads the other, never
// forming a cycle. Bringing `bottom` up to date before that effect re-runs re-evaluates `middle`,
// which drops `bottom`, its only reader so far: `bottom` loses its last reader during its own
// evaluation. Then clearing and setting `flip` makes `bottom` 5, then 1 again.
const trio = (viaLink = false, root = signal(0)) => {
  const tick = bound();
  const gate = signal(true);
  const flip = signal(false);
  const extra = signal(0);
  const evals = { bottom: 0 };
  const link = computed((): number => {
    tick();
    // oxlint-disable-next-line no-use-before-define -- the two computeds swap which reads the other
    return get(bottom);
  });
  const middle = computed((): number => {
    tick();
    // oxlint-disable-next-line no-use-before-define -- as above
    return get(gate) ? get(viaLink ? link : bottom) : 0;
  });
  const top = computed((): number => {
    tick();
    return get<number>(middle) + 1 + 10 * get<number>(extra);
  });
  const bottom = computed((): number => {
    tick();
    evals.bottom++;
    return get(flip) ? get<number>(top) + get<number>(root) : 5;
  });
  const topSeen: number[] = [];
  const handles: Effect[] = [];
  /** An effect logging `node` on each run. */
  const reader = (node: Computed<number>, seen: number[]): void => {
    handles.push(
      effect(() => {
        tick();
        seen.push(get(node));
      }),
    );
  };
  reader(top, topSeen);
  return {
    flip,
    extra,
    bottom,
    topSeen,
    evals,
    tick,
    reader,
    keep: (handle: Effect): void => {
      handles.push(handle);
    },
    swap: (): void => {
      set(gate, false);
      set(flip, true);
    },
    stop: (): void => {
      for (const handle of handles) dispose(handle);
    },
  };
};

describe("computeds that swap which reads the other", () => {
  test("an effect made in the swapping batch reads the computed its read releases, then each change", () => {
    expect.assertions(1);
    const { flip, bottom, topSeen, reader, swap, stop: end } = trio();
    const seen: number[] = [];
    batch(() => {
      swap();
      reader(bottom, seen);
    });
    set(flip, false);
    set(flip, true);
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [1, 5, 1],
    ]);
  });

  test("an effect made in the swapping batch sees changes that reach the released computed through the one it now reads", () => {
    expect.assertions(1);
    const { extra, bottom, topSeen, reader, swap, stop: end } = trio();
    const seen: number[] = [];
    batch(() => {
      swap();
      reader(bottom, seen);
    });
    set(extra, 1);
    set(extra, 2);
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1, 11, 21],
      [1, 11, 21],
    ]);
  });

  test("an effect made after an unbatched swap reads the computed, then each change", () => {
    expect.assertions(1);
    const { flip, bottom, topSeen, reader, swap, stop: end } = trio();
    const seen: number[] = [];
    swap();
    reader(bottom, seen);
    set(flip, false);
    set(flip, true);
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [1, 5, 1],
    ]);
  });

  test("an effect made in the batch before the swap sees each change", () => {
    expect.assertions(1);
    const { flip, bottom, topSeen, reader, swap, stop: end } = trio();
    const seen: number[] = [];
    batch(() => {
      reader(bottom, seen);
      swap();
    });
    set(flip, false);
    set(flip, true);
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [5, 1, 5, 1],
    ]);
  });

  test("an effect made after the swapping batch reads the computed, then each change", () => {
    expect.assertions(1);
    const { flip, bottom, topSeen, reader, swap, stop: end } = trio();
    const seen: number[] = [];
    batch(swap);
    reader(bottom, seen);
    set(flip, false);
    set(flip, true);
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [1, 5, 1],
    ]);
  });

  test("a read in the swapping batch of the computed it releases is current, and so are later reads", () => {
    expect.assertions(1);
    const { flip, bottom, topSeen, swap, stop: end } = trio();
    const seen: number[] = [];
    batch(() => {
      swap();
      seen.push(get(bottom));
    });
    set(flip, false);
    seen.push(get(bottom));
    set(flip, true);
    seen.push(get(bottom));
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [1, 5, 1],
    ]);
  });

  test("an effect made in the swapping batch reads a computed released through a chain, then each change", () => {
    expect.assertions(1);
    // `middle` reads `bottom` through `link`: dropping `link` releases `bottom`
    const { flip, bottom, topSeen, reader, swap, stop: end } = trio(true);
    const seen: number[] = [];
    batch(() => {
      swap();
      reader(bottom, seen);
    });
    set(flip, false);
    set(flip, true);
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [1, 5, 1],
    ]);
  });

  test("an effect made in the swapping batch reads the released computed through another, then each change", () => {
    expect.assertions(1);
    const { flip, bottom, topSeen, tick, reader, swap, stop: end } = trio();
    const outer = computed((): number => {
      tick();
      return get<number>(bottom) * 10;
    });
    const seen: number[] = [];
    batch(() => {
      swap();
      reader(outer, seen);
    });
    set(flip, false);
    set(flip, true);
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [10, 50, 10],
    ]);
  });

  test("an effect made by an effect that swapped the computeds reads the released one, then each change", () => {
    expect.assertions(1);
    const { flip, bottom, topSeen, tick, reader, keep, swap, stop: end } = trio();
    const go = signal(0);
    const seen: number[] = [];
    keep(
      effect(() => {
        tick();
        if (get(go) === 1) {
          swap();
          reader(bottom, seen);
        }
      }),
    );
    set(go, 1);
    set(flip, false);
    set(flip, true);
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [1, 5, 1],
    ]);
  });

  test("a read by a userland sub's callback after its swap is current, and so are later reads", () => {
    expect.assertions(1);
    const { flip, bottom, topSeen, tick, keep, swap, stop: end } = trio();
    const go = signal(0);
    const seen: number[] = [];
    keep(
      userSub<number>(go, (value) => {
        tick();
        if (value === 1) {
          swap();
          seen.push(get(bottom));
        }
      }),
    );
    set(go, 1);
    set(flip, false);
    seen.push(get(bottom));
    set(flip, true);
    seen.push(get(bottom));
    end();
    expect([topSeen, seen]).toEqual([
      [6, 1],
      [1, 5, 1],
    ]);
  });

  test("an effect that switches to a computed on the write that swaps it sees its later changes", () => {
    expect.assertions(1);
    const tick = bound();
    // One signal swaps them: `middle` reads `bottom` while `mode` is 0, `bottom` reads `top` while it is 1
    const mode = signal(0);
    const extra = signal(0);
    const middle = computed((): number => {
      tick();
      // oxlint-disable-next-line no-use-before-define -- the two computeds swap which reads the other
      return get(mode) === 0 ? get(bottom) : 0;
    });
    const top = computed((): number => {
      tick();
      return get<number>(middle) + 1 + 10 * get<number>(extra);
    });
    const bottom = computed((): number => {
      tick();
      return get(mode) === 1 ? get(top) : 5;
    });
    const seen: number[] = [];
    const keeper = effect(() => {
      tick();
      get(top);
    });
    // Sibling order is unspecified: running this one first releases `bottom` in its read
    const switcher = effect(() => {
      tick();
      if (get(mode) === 1) seen.push(get(bottom));
    });
    set(mode, 1);
    set(extra, 1);
    set(extra, 2);
    dispose(keeper);
    dispose(switcher);
    expect(seen).toEqual([1, 11, 21]);
  });

  test("a computed that lost its last reader during its own read is not re-evaluated by later reads without a change", () => {
    expect.assertions(2);
    const { bottom, evals, swap, stop: end } = trio();
    batch(() => {
      swap();
      get(bottom);
    });
    const before = evals.bottom;
    expect(get(bottom)).toBe(1);
    get(bottom);
    end();
    expect(evals.bottom).toBe(before);
  });
});

describe("errors", () => {
  test("a write rethrows an effect's error after the other effects ran", () => {
    expect.assertions(2);
    const source = signal(0);
    const seen: string[] = [];
    const bad = effect(() => {
      if (get<number>(source) === 1) throw new Error("first");
    });
    const worse = effect(() => {
      if (get<number>(source) === 1) throw new Error("second");
    });
    const good = effect(() => {
      seen.push(`good ${get<number>(source)}`);
    });
    // Which of several errors reaches the caller is unspecified
    expect(() => {
      set(source, 1);
    }).toThrow(/^(?:first|second)$/u);
    dispose(bad);
    dispose(worse);
    dispose(good);
    expect(seen).toEqual(["good 0", "good 1"]);
  });

  test("a write rethrows an effect's thrown undefined", () => {
    expect.assertions(1);
    const source = signal(0);
    const handle = effect(() => {
      // oxlint-disable-next-line no-throw-literal typescript/only-throw-error
      if (get<number>(source) === 1) throw undefined;
    });
    let reached = false;
    try {
      set(source, 1);
    } catch {
      reached = true;
    }
    dispose(handle);
    expect(reached).toBe(true);
  });

  test("effects queued on either side of a throwing effect run in that flush and after it", () => {
    expect.assertions(2);
    const source = signal(0);
    const seen: string[] = [];
    const handles = [
      effect(() => {
        seen.push(`a${get<number>(source)}`);
      }),
      effect(() => {
        if (get<number>(source) === 1) throw new Error("b");
      }),
      effect(() => {
        seen.push(`c${get<number>(source)}`);
      }),
    ];
    expect(() => {
      set(source, 1);
    }).toThrow("b");
    set(source, 2);
    for (const handle of handles) dispose(handle);
    expect(seen.toSorted()).toEqual(["a0", "a1", "a2", "c0", "c1", "c2"]);
  });

  test("a batch end rethrows an effect's error after the other effects ran", () => {
    expect.assertions(2);
    const source = signal(0);
    const seen: number[] = [];
    const bad = effect(() => {
      if (get<number>(source) === 1) throw new Error("bad");
    });
    const good = effect(() => {
      seen.push(get(source));
    });
    expect(() => {
      batch(() => {
        set(source, 1);
      });
    }).toThrow("bad");
    dispose(bad);
    dispose(good);
    expect(seen).toEqual([0, 1]);
  });

  test("a throwing effect re-runs on the next change", () => {
    expect.assertions(2);
    const source = signal(0);
    const seen: number[] = [];
    const handle = effect(() => {
      const value = get<number>(source);
      seen.push(value);
      if (value === 1) throw new Error("one");
    });
    expect(() => {
      set(source, 1);
    }).toThrow("one");
    set(source, 2);
    dispose(handle);
    expect(seen).toEqual([0, 1, 2]);
  });

  test("an effect whose first run throws is disposed with its children", () => {
    expect.assertions(2);
    const source = signal(0);
    let runs = 0;
    expect(() => {
      effect(() => {
        effect(() => {
          get(source);
          runs++;
        });
        get(source);
        runs++;
        throw new Error("first run");
      });
    }).toThrow("first run");
    set(source, 1);
    expect(runs).toBe(2);
  });

  test("effect() rethrows the error of another effect its first run's write made throw", () => {
    expect.assertions(1);
    const poke = signal(0);
    const bad = effect(() => {
      if (get<number>(poke) === 1) throw new Error("other");
    });
    // Whether the new effect stays live then is unspecified (only a failed first run is pinned)
    expect(() => {
      effect(() => {
        set(poke, 1);
      });
    }).toThrow("other");
    dispose(bad);
  });

  test("a userland sub whose first call throws is not subscribed", () => {
    expect.assertions(2);
    const source = signal(0);
    let calls = 0;
    expect(() => {
      userSub(source, () => {
        calls++;
        throw new Error("call");
      });
    }).toThrow("call");
    set(source, 1);
    expect(calls).toBe(1);
  });

  test("a throwing computed rethrows on read, also to a reader's try/catch in its run, and recovers when its source does", () => {
    expect.assertions(3);
    const source = signal(1);
    const checked = computed(() => {
      const value = get<number>(source);
      if (value < 0) throw new Error("negative");
      return value;
    });
    const seen: string[] = [];
    const handle = effect(() => {
      try {
        seen.push(`value ${get<number>(checked)}`);
      } catch (error) {
        seen.push(`error ${(error as Error).message}`);
      }
    });
    set(source, -1);
    expect(() => get(checked)).toThrow("negative");
    set(source, 2);
    expect(get(checked)).toBe(2);
    dispose(handle);
    expect(seen).toEqual(["value 1", "error negative", "value 2"]);
  });

  test("an unobserved computed read inside a getter that threw sees a later write", () => {
    expect.assertions(2);
    const source = signal(1);
    const inner = computed(() => get<number>(source));
    const outer = computed(() => {
      if (get<number>(inner) === 1) throw new Error("one");
      return 0;
    });
    expect(() => get(outer)).toThrow("one");
    set(source, 2);
    expect(get(inner)).toBe(2);
  });

  test("untracked restores tracking after its function throws", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      try {
        untracked(() => {
          throw new Error("inner");
        });
      } catch {
        // the read below must still subscribe
      }
      get(source);
    });
    set(source, 1);
    dispose(handle);
    expect(runs).toBe(2);
  });

  test("a write rethrows a userland sub's error after the other subs ran", () => {
    expect.assertions(2);
    const source = signal(0);
    const seen: number[] = [];
    const bad = userSub<number>(source, (value) => {
      if (value === 1) throw new Error("sub");
    });
    const good = userSub<number>(source, (value) => {
      seen.push(value);
    });
    expect(() => {
      set(source, 1);
    }).toThrow("sub");
    dispose(bad);
    dispose(good);
    expect(seen).toEqual([0, 1]);
  });

  // Regression: a re-run that threw left its effect as the owner, so the next top-level effect became its child
  test("after a re-run throws, an effect created at top level is not owned by the thrower", () => {
    expect.assertions(2);
    const source = signal(0);
    const other = signal(0);
    let runs = 0;
    const bad = effect(() => {
      if (get<number>(source) === 1) throw new Error("bad");
    });
    expect(() => {
      set(source, 1);
    }).toThrow("bad");
    const good = effect(() => {
      get(other);
      runs++;
    });
    // Re-runs the thrower: an effect it owned would be disposed now
    set(source, 2);
    set(other, 1);
    dispose(bad);
    dispose(good);
    expect(runs).toBe(2);
  });

  // Regression: a re-run that threw left its effect as the tracker, so the next top-level read subscribed it
  test("after a re-run throws, a top-level read subscribes nothing", () => {
    expect.assertions(2);
    const source = signal(0);
    const other = signal(0);
    let runs = 0;
    const node = computed(() => get<number>(other) + 1);
    const bad = effect(() => {
      runs++;
      if (get<number>(source) === 1) throw new Error("bad");
    });
    expect(() => {
      set(source, 1);
    }).toThrow("bad");
    get(node);
    set(other, 1);
    dispose(bad);
    expect(runs).toBe(2);
  });

  // Regression: a throwing child cleanup aborted the dispose, skipping the other cleanups
  test.serial(
    "a dispose whose child cleanup throws runs the other cleanups and leaves later writes working",
    () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: string[] = [];
      let runs = 0;
      const watcher = effect(() => {
        get(source);
        runs++;
      });
      const parent = effect(() => {
        effect(() => () => {
          seen.push("first");
        });
        effect(() => () => {
          throw new Error("cleanup");
        });
        effect(() => () => {
          seen.push("third");
        });
        return () => {
          seen.push("parent");
        };
      });
      ignoring(() => {
        dispose(parent);
      });
      set(source, 1);
      dispose(watcher);
      expect([seen.toSorted(), runs]).toEqual([["first", "parent", "third"], 2]);
    },
  );

  test.serial(
    "a cleanup that throws as its effect re-runs leaves the re-run and later writes working",
    () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      const handle = effect(() => {
        const value = get<number>(source);
        seen.push(value);
        return () => {
          if (value === 0) throw new Error("cleanup");
        };
      });
      ignoring(() => {
        set(source, 1);
      });
      set(source, 2);
      dispose(handle);
      expect(seen).toEqual([0, 1, 2]);
    },
  );

  test("a computed that throws while an effect validates it: the effect sees the value, the error, then the value", () => {
    expect.assertions(1);
    const s = signal(0);
    const boom = new Error("E");
    const c = computed(() => {
      if (get(s) === 1) throw boom;
      return get(s);
    });
    const seen: unknown[] = [];
    effect(() => {
      try {
        seen.push(get(c));
      } catch (error) {
        seen.push(error);
      }
    });
    set(s, 1);
    set(s, 2);
    expect(seen).toEqual([0, boom, 2]);
  });

  test("three effects, the middle throwing: the next write runs all three", () => {
    expect.assertions(1);
    const s = signal(0);
    const runs = [0, 0, 0];
    for (const i of [0, 1, 2]) {
      effect(() => {
        runs[i]++;
        if (get(s) === 1 && i === 1) throw new Error("middle");
      });
    }
    thrownBy(() => {
      set(s, 1);
    });
    set(s, 2);
    expect(runs).toEqual([3, 3, 3]);
  });

  test("a throwing re-run of an effect queued first leaves the next queued effect running", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    effect(() => {
      if (get(s) === 1) throw new Error("first");
    });
    effect(() => {
      log.push(`second ${get(s)}`);
    });
    log.length = 0;
    const thrown = thrownBy(() => {
      set(s, 1);
    });
    set(s, 2);
    expect([thrown instanceof Error, log]).toEqual([true, ["second 1", "second 2"]]);
  });

  test("an effect's re-run that throws after a nested run: top-level code after it is not owned or tracked", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    effect(() => {
      if (get(s) === 1) {
        effect(() => {
          get(t);
        });
        throw new Error("after a nested run");
      }
    });
    thrownBy(() => {
      set(s, 1);
    });
    let runs = 0;
    effect(() => {
      get(t);
      runs++;
    });
    get(computed(() => get(t)));
    set(s, 2);
    set(t, 1);
    expect(runs).toBe(2);
  });
});

describe("cleanup errors", () => {
  test.serial(
    "a child's cleanup error in a dispose is dropped in production and logged in dev",
    () => {
      expect.assertions(1);
      const error = new Error("cleanup");
      const parent = effect(() => {
        effect(() => () => {
          throw error;
        });
      });
      expect(
        fate(error, () => {
          dispose(parent);
        }),
      ).toBe(EXPECTED_FATE);
    },
  );

  test.serial(
    "an effect's cleanup error as it re-runs is dropped in production and logged in dev",
    () => {
      expect.assertions(1);
      const source = signal(0);
      const error = new Error("cleanup");
      const handle = effect(() => {
        get(source);
        return () => {
          throw error;
        };
      });
      expect(
        fate(error, () => {
          set(source, 1);
        }),
      ).toBe(EXPECTED_FATE);
      ignoring(() => {
        dispose(handle);
      });
    },
  );

  test.serial(
    "a registered cleanup's error at a batch end is dropped in production and logged in dev",
    () => {
      expect.assertions(1);
      const source = signal(0);
      const error = new Error("cleanup");
      const handle = effect(() => {
        get(source);
        defer(() => {
          throw error;
        });
      });
      expect(
        fate(error, () => {
          batch(() => {
            set(source, 1);
          });
        }),
      ).toBe(EXPECTED_FATE);
      ignoring(() => {
        dispose(handle);
      });
    },
  );

  test.serial(
    "a scope's cleanup error on dispose is dropped in production and logged in dev",
    () => {
      expect.assertions(1);
      const error = new Error("cleanup");
      const handle = scope(() => {
        defer(() => {
          throw error;
        });
      });
      expect(
        fate(error, () => {
          dispose(handle);
        }),
      ).toBe(EXPECTED_FATE);
    },
  );

  test.serial(
    "a throwing registered cleanup stops neither the other cleanups nor the re-run",
    () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: string[] = [];
      const handle = effect(() => {
        const value = get<number>(source);
        seen.push(`run ${value}`);
        defer(() => {
          seen.push(`older ${value}`);
        });
        defer(() => {
          throw new Error("cleanup");
        });
        defer(() => {
          seen.push(`newer ${value}`);
        });
        return () => {
          seen.push(`own ${value}`);
        };
      });
      ignoring(() => {
        set(source, 1);
      });
      ignoring(() => {
        dispose(handle);
      });
      // Sorted: the order is the "teardown order" tests' business
      expect(seen.toSorted()).toEqual([
        "newer 0",
        "newer 1",
        "older 0",
        "older 1",
        "own 0",
        "own 1",
        "run 0",
        "run 1",
      ]);
    },
  );

  test.serial("a scope disposal whose cleanup throws still stops the scope's effects", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = scope(() => {
      effect(() => {
        get(source);
        runs++;
      });
      defer(() => {
        throw new Error("cleanup");
      });
    });
    ignoring(() => {
      dispose(handle);
    });
    set(source, 1);
    expect(runs).toBe(1);
  });

  test.serial(
    "a flush in which a cleanup and an effect throw rethrows the effect's error in production",
    () => {
      expect.assertions(1);
      const source = signal(0);
      const handles = [
        effect(() => {
          get(source);
          return () => {
            throw new Error("cleanup");
          };
        }),
        effect(() => {
          if (get<number>(source) === 1) throw new Error("effect");
        }),
      ];
      // Dev may let the cleanup's error through as well (only its logging is pinned)
      expect(() => {
        silenced(() => {
          set(source, 1);
        });
      }).toThrow(DEV ? /^(?:effect|cleanup)$/u : /^effect$/u);
      for (const handle of handles)
        ignoring(() => {
          dispose(handle);
        });
    },
  );

  test.serial(
    "effect() whose failed first run disposes a child with a throwing cleanup rethrows the run's error in production",
    () => {
      expect.assertions(1);
      expect(() => {
        silenced(() => {
          effect(() => {
            effect(() => () => {
              throw new Error("cleanup");
            });
            throw new Error("run");
          });
        });
      }).toThrow(DEV ? /^(?:run|cleanup)$/u : /^run$/u);
    },
  );

  test.serial(
    "a throwing child cleanup during dispose stops no other cleanup and wedges nothing",
    () => {
      expect.assertions(1);
      const s = signal(0);
      const log: string[] = [];
      silenced(() => {
        const handle = effect(() => {
          defer(() => {
            log.push("older");
          });
          effect(() => () => {
            throw new Error("cleanup");
          });
          return () => {
            log.push("parent");
          };
        });
        dispose(handle);
      });
      effect(() => {
        log.push(`after ${get(s)}`);
      });
      set(s, 1);
      expect(log).toEqual(["older", "parent", "after 0", "after 1"]);
    },
  );
});

describe("disposal", () => {
  test("of two userland subs that dispose each other when notified, only the first called runs", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handles: Effect[] = [];
    const disposer = (other: number) => (value: number) => {
      if (value === 1) {
        seen.push(`disposes ${other}`);
        dispose(handles[other]);
      }
    };
    handles.push(userSub(source, disposer(1)), userSub(source, disposer(0)));
    set(source, 1);
    for (const handle of handles) dispose(handle);
    expect(seen).toHaveLength(1);
  });

  test("an effect disposing itself mid-run still gets its returned cleanup called", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle: Effect = effect(() => {
      const value = get<number>(source);
      if (value === 1) dispose(handle);
      return () => {
        seen.push(`cleanup ${value}`);
      };
    });
    set(source, 1);
    set(source, 2);
    expect(seen).toEqual(["cleanup 0", "cleanup 1"]);
  });

  test("of two effects that dispose each other when re-run, only the first run re-runs", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handles: Effect[] = [];
    const disposer = (other: number) => (): void => {
      if (get<number>(source) === 1) {
        seen.push(`disposes ${other}`);
        dispose(handles[other]);
      }
    };
    handles.push(effect(disposer(1)), effect(disposer(0)));
    set(source, 1);
    for (const handle of handles) dispose(handle);
    expect(seen).toHaveLength(1);
  });

  test("a dispose inside a cleanup has run the disposed scope's cleanup when it returns", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const other = scope(() => () => {
      seen.push("other");
    });
    const root = scope(() => () => {
      dispose(other);
      seen.push("after dispose");
    });
    dispose(root);
    expect(seen).toEqual(["other", "after dispose"]);
  });

  test("an effect whose cleanup disposes it does not re-run", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle: Effect = effect(() => {
      get(source);
      runs++;
      return () => {
        dispose(handle);
      };
    });
    set(source, 1);
    set(source, 2);
    expect(runs).toBe(1);
  });

  test("a scope disposed during its own body (its owner effect disposed from it in a re-run)", () => {
    expect.assertions(1);
    const a = signal(0);
    const log: string[] = [];
    const parent: Effect = effect(() => {
      const value = get(a);
      scope(() => {
        if (value === 1) dispose(parent);
        log.push(`body ${value}`);
        defer(() => {
          log.push(`defer ${value}`);
        });
        return () => {
          log.push(`scope cleanup ${value}`);
        };
      });
      log.push(`effect ${value}`);
      return () => {
        log.push(`effect cleanup ${value}`);
      };
    });
    log.length = 0;
    set(a, 1);
    set(a, 2);
    expect(log).toEqual([
      "defer 0",
      "scope cleanup 0",
      "effect cleanup 0",
      "body 1",
      "defer 1",
      "scope cleanup 1",
      "effect 1",
      "effect cleanup 1",
    ]);
  });

  test("a body that disposes its owner effect: a cleanup it registers afterwards runs, and the owner stops", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    let runs = 0;
    const parent: Effect = effect(() => {
      runs++;
      if (get(s) === 1) {
        scope(() => {
          dispose(parent);
          defer(() => {
            log.push("defer after dispose");
          });
        });
      }
    });
    set(s, 1);
    set(s, 2);
    expect([runs, log]).toEqual([2, ["defer after dispose"]]);
  });

  test("the body's returned cleanup and a cleanup it registers after disposing its owner both run, the registered one first", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const parent: Effect = effect(() => {
      if (get(s) === 1) {
        scope(() => {
          dispose(parent);
          defer(() => {
            log.push("defer");
          });
          return () => {
            log.push("cleanup");
          };
        });
      }
    });
    set(s, 1);
    expect(log).toEqual(["defer", "cleanup"]);
  });

  test("siblings whose cleanups dispose each other both die at the first write", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handles: Effect[] = [];
    for (const [i, label] of ["a", "b"].entries()) {
      handles.push(
        effect(() => {
          get(s);
          log.push(label);
          return () => {
            log.push(`cleanup ${label}`);
            dispose(handles[1 - i]);
          };
        }),
      );
    }
    log.length = 0;
    set(s, 1);
    set(s, 2);
    expect(log.toSorted()).toEqual(["cleanup a", "cleanup b"]);
  });

  test("a cleanup registered after an owned computed reads it live at teardown, after a write to its source", () => {
    expect.assertions(1);
    const s = signal(1);
    const seen: number[] = [];
    const handle = scope(() => {
      const c = computed(() => get(s) * 2);
      get(c);
      defer(() => {
        seen.push(get(c));
      });
    });
    set(s, 2);
    dispose(handle);
    expect(seen).toEqual([4]);
  });

  // The teardown in progress finishes, nothing under the root runs again, and the flush gives back
  // the owner it found: none at top level, the scope whose body wrote
  test.each(["top level", "a scope body"])(
    "a re-run's cleanup disposing its root: nothing under it runs again, and the writer's context is clean (%s)",
    (where) => {
      expect.assertions(3);
      const s = signal(0);
      const y = signal(0);
      let childRuns = 0;
      const root: Scope = scope(() => {
        effect(() => {
          get(s);
          return () => {
            dispose(root);
          };
        });
        effect(() => {
          get(y);
          childRuns++;
        });
      });
      let laterRuns = 0;
      const later = (): void => {
        effect(() => {
          get(y);
          laterRuns++;
        });
      };
      let writer: Scope | undefined;
      if (where === "top level") {
        set(s, 1);
        later();
      } else {
        writer = scope(() => {
          set(s, 1);
          later();
        });
      }
      childRuns = 0;
      set(y, 1);
      expect(childRuns).toBe(0);
      expect(laterRuns).toBe(2);
      if (writer !== undefined) dispose(writer);
      set(y, 2);
      // At top level `later` has no owner and lives; in a body it is the body's scope's
      expect(laterRuns).toBe(where === "top level" ? 3 : 2);
    },
  );
});

describe("sub", () => {
  test("calls fn at once with the signal's value", () => {
    expect.assertions(1);
    const seen: number[] = [];
    sub(signal(1), (value) => {
      seen.push(value);
    });
    expect(seen).toEqual([1]);
  });

  test("calls fn after each change with the new value, never for an equal one", () => {
    expect.assertions(1);
    const s = signal(1);
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
    });
    set(s, 1);
    set(s, 2);
    set(s, 2);
    set(s, 3);
    expect(seen).toEqual([1, 2, 3]);
  });

  test("fn's reads subscribe neither the sub nor the effect that made it", () => {
    expect.assertions(1);
    const t = signal(0);
    let runs = 0;
    let calls = 0;
    effect(() => {
      runs++;
      sub(signal(0), () => {
        get(t);
        calls++;
      });
    });
    set(t, 1);
    expect([runs, calls]).toEqual([1, 1]);
  });

  test("a sub made in an effect's run does not subscribe that effect to its signal", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    let calls = 0;
    effect(() => {
      runs++;
      sub(s, () => {
        calls++;
      });
    });
    set(s, 1);
    expect([runs, calls]).toEqual([1, 2]);
  });

  test("what fn creates lives on through later calls", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const runs: string[] = [];
    sub(s, (value) => {
      effect(() => {
        runs.push(`${value}:${get(t)}`);
      });
    });
    set(s, 1);
    runs.length = 0;
    set(t, 1);
    expect(runs.toSorted()).toEqual(["0:1", "1:1"]);
  });

  test("what fn creates is disposed only with the sub, newest first", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handle = sub(s, (value) => {
      defer(() => {
        log.push(`cleanup ${value}`);
      });
    });
    set(s, 1);
    set(s, 2);
    const before = [...log];
    dispose(handle);
    expect([before, log]).toEqual([[], ["cleanup 2", "cleanup 1", "cleanup 0"]]);
  });

  test("what fn creates over several calls is torn down newest first, children and cleanups interleaved", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handle = sub(s, (value) => {
      defer(() => {
        log.push(`defer ${value}`);
      });
      effect(() => () => {
        log.push(`effect ${value}`);
      });
    });
    set(s, 1);
    set(s, 2);
    dispose(handle);
    expect(log).toEqual(["effect 2", "defer 2", "effect 1", "defer 1", "effect 0", "defer 0"]);
  });

  test("a disposed sub calls nothing more and its children's effects stop", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let calls = 0;
    let runs = 0;
    const handle = sub(s, () => {
      calls++;
      effect(() => {
        get(t);
        runs++;
      });
    });
    dispose(handle);
    set(s, 1);
    set(t, 1);
    expect([calls, runs]).toEqual([1, 1]);
  });

  test("disposing a sub twice leaves a later sub on its signal following it", () => {
    expect.assertions(1);
    const s = signal(0);
    const first = sub(s, () => {});
    dispose(first);
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
    });
    dispose(first);
    set(s, 1);
    expect(seen).toEqual([0, 1]);
  });

  test("a sub disposed in a batch after its signal's write is not called", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    const handle = sub(s, (value) => {
      seen.push(value);
    });
    batch(() => {
      set(s, 1);
      dispose(handle);
    });
    expect(seen).toEqual([0]);
  });

  test("in a batch, fn is called once, at its end, with the last value", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
    });
    const inside: number[][] = [];
    batch(() => {
      set(s, 1);
      set(s, 2);
      inside.push([...seen]);
    });
    expect([inside, seen]).toEqual([[[0]], [0, 2]]);
  });

  test("a batch that restores the value calls nothing", () => {
    expect.assertions(1);
    const s = signal(0);
    let calls = 0;
    sub(s, () => {
      calls++;
    });
    batch(() => {
      set(s, 1);
      set(s, 0);
    });
    expect(calls).toBe(1);
  });

  test("a sub made in a batch is called at once, and at the batch end if the value moved since", () => {
    expect.assertions(1);
    const s = signal("a");
    const seen: string[] = [];
    batch(() => {
      set(s, "b");
      sub(s, (value) => {
        seen.push(value);
      });
      set(s, "a");
    });
    expect(seen).toEqual(["b", "a"]);
  });

  test("a sub made in nested batches is called at once, then once at the outer end", () => {
    expect.assertions(2);
    const s = signal(0);
    const seen: number[] = [];
    batch(() => {
      batch(() => {
        sub(s, (value) => {
          seen.push(value);
        });
        set(s, 1);
      });
      expect(seen).toEqual([0]);
      set(s, 2);
    });
    expect(seen).toEqual([0, 2]);
  });

  test("a sub made in an effect's run is disposed, with what fn made, when the effect re-runs", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    effect(() => {
      const round = get(t);
      sub(s, (value) => {
        log.push(`${round}:${value}`);
        defer(() => {
          log.push(`cleanup ${round}:${value}`);
        });
      });
    });
    set(t, 1);
    set(s, 1);
    expect(log).toEqual(["0:0", "cleanup 0:0", "1:0", "1:1"]);
  });

  test("sub() in an effect's run gives back the effect's owner: what the run makes next is disposed at its re-run", () => {
    expect.assertions(1);
    const t = signal(0);
    const log: string[] = [];
    effect(() => {
      const round = get(t);
      sub(signal(0), () => {});
      defer(() => {
        log.push(`cleanup ${round}`);
      });
    });
    set(t, 1);
    expect(log).toEqual(["cleanup 0"]);
  });

  test("sub() in an effect's run gives back its tracking: a read after it subscribes the effect", () => {
    expect.assertions(1);
    const t = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      sub(signal(0), () => {});
      get(t);
    });
    set(t, 1);
    expect(runs).toBe(2);
  });

  test("a top-level sub() leaves no owner: an effect made after it outlives the sub", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: number[] = [];
    const handle = sub(signal(0), () => {});
    effect(() => {
      log.push(get(s));
    });
    dispose(handle);
    set(s, 1);
    expect(log).toEqual([0, 1]);
  });

  test("untracked inside fn keeps the sub as the owner", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handle = sub(s, () => {
      untracked(() => {
        defer(() => {
          log.push("cleanup");
        });
      });
    });
    dispose(handle);
    expect(log).toEqual(["cleanup"]);
  });

  test("a cleanup reads a computed fn made earlier as current at disposal, after a write to its source", () => {
    expect.assertions(1);
    const s = signal(0);
    const a = signal(1);
    const seen: number[] = [];
    const handle = sub(s, () => {
      const double = computed(() => get(a) * 2);
      get(double);
      defer(() => {
        seen.push(get(double));
      });
    });
    set(a, 5);
    dispose(handle);
    expect(seen).toEqual([10]);
  });

  // The source may be a computed, read as get reads it (src/signal.ts: unspecified)
  test("Characterization: a sub on a computed gets each new value, and the computed's error reaches the writer", () => {
    expect.assertions(1);
    const s = signal(1);
    const c = computed(() => {
      if (get(s) === 2) throw new Error("c");
      return get(s) * 10;
    });
    const seen: number[] = [];
    sub(c, (value) => {
      seen.push(value);
    });
    const thrown = thrownBy(() => {
      set(s, 2);
    });
    set(s, 3);
    expect([seen, (thrown as Error).message]).toEqual([[10, 30], "c"]);
  });
});

describe("sub re-delivery and own writes", () => {
  test("a write to the signal in fn calls fn again after it returns, with the latest value", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    let depth = 0;
    sub(s, (value) => {
      depth++;
      log.push(`${value} at depth ${depth}`);
      if (value === 1) {
        set(s, 2);
        set(s, 3);
      }
      depth--;
    });
    set(s, 1);
    expect(log).toEqual(["0 at depth 1", "1 at depth 1", "3 at depth 1"]);
  });

  test("an fn that increments its signal up to a bound is called until the value is stable", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
      if (value < 3) set(s, value + 1);
    });
    expect([seen, s.v]).toEqual([[0, 1, 2, 3], 3]);
  });

  test("a write in fn that restores the value fn got calls nothing more", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
      if (value === 1) {
        set(s, 5);
        set(s, 1);
      }
    });
    set(s, 1);
    expect(seen).toEqual([0, 1]);
  });

  test("a write to its signal in a nested batch inside fn calls fn again after fn returns, latest only", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: string[] = [];
    sub(s, (value) => {
      seen.push(`in ${value}`);
      if (value === 1) {
        batch(() => {
          set(s, 2);
          set(s, 3);
        });
        seen.push(`out ${value}`);
      }
    });
    set(s, 1);
    expect([seen, s.v]).toEqual([["in 0", "in 1", "out 1", "in 3"], 3]);
  });

  test("an effect made in fn whose first run writes the sub's signal is delivered after fn", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
      if (value === 1) {
        effect(() => {
          set(s, untracked(() => get(s)) + 10);
        });
      }
    });
    set(s, 1);
    expect([seen, s.v]).toEqual([[0, 1, 11], 11]);
  });

  test("a write to the signal in a cleanup fn triggers calls fn again after it returns", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    let child!: Effect;
    sub(s, (value) => {
      seen.push(value);
      if (value === 0) {
        child = effect(() => () => {
          set(s, 9);
        });
      }
      if (value === 1) dispose(child);
    });
    set(s, 1);
    expect(seen).toEqual([0, 1, 9]);
  });

  test("an effect does not re-run for the first-call write of a sub it made", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    effect(() => {
      get(s);
      runs++;
      sub(t, () => {
        set(s, untracked(() => get(s)) + 1);
      });
    });
    expect([runs, s.v]).toEqual([1, 1]);
  });

  test("an effect re-runs for a later call's write of a sub it made, and that terminates", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const tick = bound();
    let runs = 0;
    effect(() => {
      tick();
      runs++;
      get(s);
      sub(t, () => {
        set(s, untracked(() => get(s)) + 1);
      });
    });
    set(t, 1);
    expect([runs, s.v]).toEqual([2, 3]);
  });

  test("a child effect fn made does not re-run for its own first-run write", () => {
    expect.assertions(1);
    const s = signal(0);
    const x = signal(0);
    let runs = 0;
    sub(s, () => {
      effect(() => {
        runs++;
        set(x, get(x) + 1);
      });
    });
    expect([runs, x.v]).toEqual([1, 1]);
  });

  test("a sub made in a re-run whose first call writes its signal is called again in that flush, and the re-run still tracks", () => {
    expect.assertions(3);
    const s = signal(0);
    const x = signal(0);
    const t = signal(0);
    const calls: number[] = [];
    let parentRuns = 0;
    effect(() => {
      get(s);
      parentRuns++;
      if (parentRuns === 2) {
        sub(t, (value) => {
          calls.push(value);
          if (value === 0) set(t, 1);
        });
      }
      get(x);
    });
    set(s, 1);
    expect(calls).toEqual([0, 1]);
    set(x, 1);
    expect(parentRuns).toBe(3);
    // The third run disposed the sub, a child of the second
    set(t, 2);
    expect(calls).toEqual([0, 1]);
  });
});

describe("sub parent-first", () => {
  test("an effect fn made re-runs after the sub when one write reaches both", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    sub(s, (value) => {
      log.push(`sub ${value}`);
      if (value === 0) {
        effect(() => {
          log.push(`child ${get(s)}`);
        });
      }
    });
    log.length = 0;
    set(s, 1);
    set(s, 2);
    expect(log).toEqual(["sub 1", "child 1", "sub 2", "child 2"]);
  });

  // fn as a list and the scope as one of its rows
  test.each(ORDERS)(
    "an effect in a scope fn made does not run in the batch whose change makes fn dispose that scope (%s)",
    (_label, subFirst) => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      const runs: string[] = [];
      let page: Scope | undefined;
      sub(s, (value) => {
        if (page !== undefined) dispose(page);
        page = scope(() => {
          effect(() => {
            runs.push(`${value} ${get(t)}`);
          });
        });
      });
      runs.length = 0;
      batch(() => {
        if (subFirst) set(s, 1);
        set(t, 1);
        if (!subFirst) set(s, 1);
      });
      expect(runs).toEqual(["1 1"]);
    },
  );

  test.each(ORDERS)(
    "a child effect does not run in a batch whose re-call of fn disposes it (%s)",
    (_label, subFirst) => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      const log: string[] = [];
      let child!: Effect;
      sub(s, (value) => {
        log.push(`sub ${value}`);
        if (value === 0) {
          child = effect(() => {
            log.push(`child ${get(t)}`);
          });
        }
        if (value === 1) set(s, 2);
        if (value === 2) dispose(child);
      });
      log.length = 0;
      batch(() => {
        if (subFirst) set(s, 1);
        set(t, 1);
        if (!subFirst) set(s, 1);
      });
      expect(log).toEqual(["sub 1", "sub 2"]);
    },
  );

  test.each(ORDERS)(
    "a row effect does not run in a batch whose re-call of fn disposes its row (%s)",
    (_label, subFirst) => {
      expect.assertions(1);
      const items = signal(0);
      const t = signal(0);
      const log: string[] = [];
      let row!: Scope;
      sub(items, (value) => {
        if (value === 0) {
          row = scope(() => {
            effect(() => {
              log.push(`row ${get(t)}`);
            });
          });
        }
        if (value === 1) set(items, 2);
        if (value === 2) dispose(row);
      });
      log.length = 0;
      batch(() => {
        if (!subFirst) set(t, 1);
        set(items, 1);
        if (subFirst) set(t, 1);
      });
      expect(log).toEqual([]);
    },
  );

  test.each([true, false])(
    "a sub's call that writes its owner's source: the sub's child does not run (child's source first: %p)",
    (childFirst) => {
      expect.assertions(1);
      const a = signal(0);
      const s = signal(0);
      const t = signal(0);
      const log: string[] = [];
      effect(() => {
        const round = get(a);
        sub(s, (value) => {
          if (value === 0) {
            effect(() => {
              log.push(`child ${round} ${get(t)}`);
            });
          } else set(a, value);
        });
      });
      log.length = 0;
      batch(() => {
        if (childFirst) set(t, 1);
        set(s, 1);
        if (!childFirst) set(t, 1);
      });
      expect(log).toEqual([]);
    },
  );

  test.each([true, false])(
    "two subs deep: the inner sub's write to the outer's source runs the outer first (inner's source first: %p)",
    (innerFirst) => {
      expect.assertions(1);
      const a = signal(0);
      const s = signal(0);
      const t = signal(0);
      const log: string[] = [];
      sub(a, (round) => {
        log.push(`outer ${round}`);
        sub(s, (value) => {
          if (value === 0) {
            effect(() => {
              log.push(`leaf ${round} ${get(t)}`);
            });
          } else set(a, value);
        });
      });
      log.length = 0;
      batch(() => {
        if (innerFirst) set(t, 1);
        set(s, 1);
        if (!innerFirst) set(t, 1);
      });
      // The outer sub keeps its children: the leaf follows t after the outer got 1
      expect(log).toEqual(["outer 1", "leaf 0 1"]);
    },
  );

  test.each(["sub", "effect"] as const)(
    "an inner sub's call that writes its outer %s's source while its child is queued: the outer runs before the child",
    (outerKind) => {
      expect.assertions(1);
      const s1 = signal(0);
      const s2 = signal(0);
      const log: string[] = [];
      const body = (v2: number): void => {
        log.push(`outer ${v2}`);
        sub(s1, (v1) => {
          log.push(`inner ${v1}`);
          if (v1 === 2) set(s2, 9);
          if (v1 === 0) {
            effect(() => {
              log.push(`child ${get(s1)}`);
            });
          }
        });
      };
      if (outerKind === "sub") {
        sub(s2, (v2) => {
          if (v2 === 0) body(v2);
          else log.push(`outer ${v2}`);
        });
      } else {
        effect(() => {
          body(get(s2));
        });
      }
      log.length = 0;
      set(s1, 2);
      // An effect outer disposes inner and child before they run; its new inner gets 2
      expect(log).toEqual(
        outerKind === "sub" ? ["inner 2", "outer 9", "child 2"] : ["inner 2", "outer 9", "inner 2"],
      );
    },
  );

  test("effect > sub > scope > effect: one batch reaching all three runs only the new leaf", () => {
    expect.assertions(1);
    const a = signal(0);
    const b = signal(0);
    const c = signal(0);
    const log: string[] = [];
    effect(() => {
      const va = get(a);
      sub(b, (vb) => {
        scope(() => {
          effect(() => {
            log.push(`leaf ${va} ${vb} ${get(c)}`);
          });
        });
      });
    });
    log.length = 0;
    batch(() => {
      set(c, 1);
      set(a, 1);
      set(b, 1);
    });
    expect(log).toEqual(["leaf 1 1 1"]);
  });

  test.each(ORDERS)(
    "a grandchild effect does not run in a batch where its parent sub's call makes the outer sub dispose it (%s)",
    (_label, subFirst) => {
      expect.assertions(1);
      const a = signal(0);
      const b = signal(0);
      const t = signal(0);
      const log: string[] = [];
      let inner!: Effect;
      sub(a, (outer) => {
        log.push(`outer ${outer}`);
        if (outer === 0) {
          inner = sub(b, (value) => {
            log.push(`inner ${value}`);
            if (value === 0) {
              effect(() => {
                log.push(`grandchild ${get(t)}`);
              });
            }
            if (value === 1) set(a, 1);
          });
        }
        if (outer === 1) dispose(inner);
      });
      log.length = 0;
      batch(() => {
        if (subFirst) set(b, 1);
        set(t, 1);
        if (!subFirst) set(b, 1);
      });
      expect(log).toEqual(["inner 1", "outer 1"]);
    },
  );

  test.each(ORDERS)(
    "a grandchild effect does not run in a batch whose change makes the outer sub dispose it (%s)",
    (_label, subFirst) => {
      expect.assertions(1);
      const a = signal(0);
      const t = signal(0);
      const log: string[] = [];
      let inner!: Effect;
      sub(a, (outer) => {
        log.push(`outer ${outer}`);
        if (outer === 0) {
          inner = sub(signal(0), () => {
            effect(() => {
              log.push(`grandchild ${get(t)}`);
            });
          });
        }
        if (outer === 1) dispose(inner);
      });
      log.length = 0;
      batch(() => {
        if (subFirst) set(a, 1);
        set(t, 1);
        if (!subFirst) set(a, 1);
      });
      expect(log).toEqual(["outer 1"]);
    },
  );

  test("nothing under a scope an outer sub's call disposes runs in that batch, through nested subs", () => {
    expect.assertions(1);
    const outer = signal(0);
    const inner = signal(0);
    const t = signal(0);
    const log: string[] = [];
    let page: Scope | undefined;
    sub(outer, (o) => {
      if (page !== undefined) dispose(page);
      page = scope(() => {
        sub(inner, (i) => {
          log.push(`inner ${o}:${i}`);
          effect(() => {
            log.push(`effect ${o}:${i}:${get(t)}`);
          });
        });
      });
    });
    log.length = 0;
    batch(() => {
      set(t, 1);
      set(inner, 1);
      set(outer, 1);
    });
    expect(log).toEqual(["inner 1:1", "effect 1:1:1"]);
  });

  test("a child sub on its owner's signal, writing it, is not called again before the owner", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    let child!: Effect;
    sub(s, (value) => {
      log.push(`owner ${value}`);
      if (value === 0) {
        child = sub(s, (seen) => {
          log.push(`child ${seen}`);
          if (seen === 1) set(s, 2);
        });
      }
      if (value === 2) dispose(child);
    });
    log.length = 0;
    set(s, 1);
    expect(log).toEqual(["owner 1", "child 1", "owner 2"]);
  });

  test("a sub's write to its own source that changes its owner effect's computed: the owner re-runs before fn is called again", () => {
    expect.assertions(1);
    const s = signal(0);
    const big = computed(() => get(s) > 5);
    const log: string[] = [];
    effect(() => {
      log.push(`owner ${get(big)}`);
      sub(s, (value) => {
        log.push(`sub ${value}`);
        if (value === 1) set(s, 7);
      });
    });
    log.length = 0;
    set(s, 1);
    expect(log).toEqual(["sub 1", "owner true", "sub 7"]);
  });

  test("a call that writes its signal and what its owner read: the owner re-runs before fn is called again", () => {
    expect.assertions(1);
    const a = signal(0);
    const s = signal(0);
    const log: string[] = [];
    effect(() => {
      log.push(`owner ${get(a)}`);
      sub(s, (value) => {
        log.push(`sub ${value}`);
        if (value === 1) {
          set(a, 1);
          set(s, 2);
        }
      });
    });
    log.length = 0;
    batch(() => {
      set(s, 1);
    });
    // The owner's re-run disposes the sub; the new sub's first call gets 2
    expect(log).toEqual(["sub 1", "owner 1", "sub 2"]);
  });

  test("a call at depth 2 that writes its grandparent sub's signal and its own: the grandparent is called first", () => {
    expect.assertions(1);
    const a = signal(0);
    const b = signal(0);
    const c = signal(0);
    const log: string[] = [];
    let made = false;
    sub(a, (va) => {
      log.push(`a${va}`);
      if (made) return;
      made = true;
      sub(b, (vb) => {
        log.push(`b${vb}`);
        sub(c, (vc) => {
          log.push(`c${vc}`);
          if (vc === 1) {
            set(a, 5);
            set(c, 2);
          }
        });
      });
    });
    log.length = 0;
    set(c, 1);
    expect(log).toEqual(["c1", "a5", "c2"]);
  });

  test.each(ORDERS)(
    "an effect's change that disposes a sub it made stops the old sub's call (%s)",
    (_label, subFirst) => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      const log: string[] = [];
      effect(() => {
        const round = get(t);
        sub(s, (value) => {
          log.push(`${round}:${value}`);
        });
      });
      log.length = 0;
      batch(() => {
        if (subFirst) set(s, 1);
        set(t, 1);
        if (!subFirst) set(s, 1);
      });
      expect(log).toEqual(["1:1"]);
    },
  );

  // Not a timing test: a delivery loop that linked its source once per call would be quadratic
  test.each(ORDERS)(
    "a child's climb settles a sub that writes its signal 100k times before the child runs (%s)",
    (_label, subFirst) => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      const log: string[] = [];
      sub(s, (value) => {
        if (value === 0) {
          effect(() => {
            log.push(`child ${get(t)} sees ${untracked(() => get(s))}`);
          });
        }
        if (value > 0 && value < 100_000) set(s, value + 1);
      });
      log.length = 0;
      batch(() => {
        if (!subFirst) set(t, 1);
        set(s, 1);
        if (subFirst) set(t, 1);
      });
      expect(log).toEqual(["child 1 sees 100000"]);
    },
  );

  test("an effect under a scope under a sub climbs to the sub, which runs first", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    sub(s, (value) => {
      log.push(`sub ${value}`);
      if (value === 0) {
        scope(() => {
          scope(() => {
            effect(() => {
              log.push(`child ${get(t)}`);
            });
          });
        });
      }
    });
    log.length = 0;
    batch(() => {
      set(t, 1);
      set(s, 1);
    });
    expect(log).toEqual(["sub 1", "child 1"]);
  });

  test("an effect that owns a sub owning an effect: the owner's re-run disposes both before they run", () => {
    expect.assertions(1);
    const a = signal(0);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    effect(() => {
      log.push(`owner ${get(a)}`);
      sub(s, (value) => {
        log.push(`sub ${value}`);
        effect(() => {
          log.push(`child ${get(t)}`);
        });
      });
    });
    log.length = 0;
    batch(() => {
      set(t, 1);
      set(s, 1);
      set(a, 1);
    });
    expect(log).toEqual(["owner 1", "sub 1", "child 1"]);
  });

  const LEVELS = ["a", "b", "c", "d"] as const;
  type Level = (typeof LEVELS)[number];
  /** Every order of `items`. */
  const permutations = <T>(items: readonly T[]): T[][] =>
    items.length <= 1
      ? [[...items]]
      : items.flatMap((item, i) =>
          permutations(items.toSpliced(i, 1)).map((rest) => rest.toSpliced(0, 0, item)),
        );
  test.each([
    ["no call disposes", "none", ["a1", "b1", "c1", "d1"]],
    ["a's call disposes b's sub", "a", ["a1"]],
    ["b's call disposes c's sub", "b", ["a1", "b1"]],
    ["c's call disposes the leaf", "c", ["a1", "b1", "c1"]],
  ] as const)(
    "three nested subs over an effect, %s: a batch writing all four signals runs owners first, in every write order",
    (_label, kill, expected) => {
      const orders = permutations(LEVELS);
      expect.assertions(1);
      const wrong: string[] = [];
      for (const order of orders) {
        const src: Record<Level, Signal<number>> = {
          a: signal(0),
          b: signal(0),
          c: signal(0),
          d: signal(0),
        };
        const log: string[] = [];
        const h: { b?: Effect; c?: Effect; d?: Effect } = {};
        const root = sub(src.a, (va) => {
          log.push(`a${va}`);
          if (h.b === undefined) {
            h.b = sub(src.b, (vb) => {
              log.push(`b${vb}`);
              if (h.c === undefined) {
                h.c = sub(src.c, (vc) => {
                  log.push(`c${vc}`);
                  if (h.d === undefined) {
                    h.d = effect(() => {
                      log.push(`d${get(src.d)}`);
                    });
                  } else if (vc === 1 && kill === "c") dispose(h.d);
                });
              } else if (vb === 1 && kill === "b") dispose(h.c);
            });
          } else if (va === 1 && kill === "a") dispose(h.b);
        });
        log.length = 0;
        batch(() => {
          for (const level of order) set(src[level], 1);
        });
        if (log.join(",") !== expected.join(",")) wrong.push(`${order.join("")}: ${log.join(",")}`);
        dispose(root);
      }
      expect(wrong).toEqual([]);
    },
  );
});

describe("sub errors", () => {
  test("a first call that throws disposes what it made, sub() rethrows, and later writes call nothing", () => {
    expect.assertions(1);
    const s = signal(0);
    const error = new Error("first call");
    const log: string[] = [];
    let calls = 0;
    const thrown = thrownBy(() => {
      sub(s, () => {
        calls++;
        defer(() => {
          log.push("cleanup");
        });
        throw error;
      });
    });
    set(s, 1);
    expect([thrown === error, log, calls]).toEqual([true, ["cleanup"], 1]);
  });

  test("a first call that throws disposes its children newest first", () => {
    expect.assertions(1);
    const log: string[] = [];
    thrownBy(() => {
      sub(signal(0), () => {
        effect(() => () => {
          log.push("child cleanup");
        });
        defer(() => {
          log.push("defer");
        });
        throw new Error("first");
      });
    });
    expect(log).toEqual(["defer", "child cleanup"]);
  });

  test("a first call that writes the sub's signal and then throws: disposed, rethrown, never called again", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    const thrown = thrownBy(() => {
      sub(s, (value) => {
        seen.push(value);
        set(s, 1);
        throw new Error("first");
      });
    });
    set(s, 5);
    expect([seen, (thrown as Error).message]).toEqual([[0], "first"]);
  });

  test("a later call that throws reaches the writer, and the sub keeps following", () => {
    expect.assertions(1);
    const s = signal(0);
    const error = new Error("second call");
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
      if (value === 1) throw error;
    });
    const thrown = thrownBy(() => {
      set(s, 1);
    });
    set(s, 2);
    expect([thrown === error, seen]).toEqual([true, [0, 1, 2]]);
  });

  test("a later call that throws keeps what earlier calls and the failed call made", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    sub(s, (value) => {
      effect(() => {
        log.push(`${value}:${get(t)}`);
      });
      if (value === 1) throw new Error("call");
    });
    thrownBy(() => {
      set(s, 1);
    });
    log.length = 0;
    set(t, 1);
    expect(log.toSorted()).toEqual(["0:1", "1:1"]);
  });

  test("three subs on one signal, the middle one throwing on 1: the next write calls all three", () => {
    expect.assertions(2);
    const s = signal(0);
    const seen: string[] = [];
    for (const label of ["a", "b", "c"]) {
      sub(s, (value) => {
        seen.push(`${label}${value}`);
        if (label === "b" && value === 1) throw new Error("b");
      });
    }
    expect(
      (
        thrownBy(() => {
          set(s, 1);
        }) as Error
      ).message,
    ).toBe("b");
    set(s, 2);
    expect(seen.toSorted()).toEqual(["a0", "a1", "a2", "b0", "b1", "b2", "c0", "c1", "c2"]);
  });

  test("fn reading a throwing computed: the throw reaches the writer and the sub keeps following", () => {
    expect.assertions(1);
    const s = signal(0);
    const c = computed(() => {
      if (get(s) === 1) throw new Error("computed");
      return get(s) * 10;
    });
    const seen: number[] = [];
    sub(s, () => {
      seen.push(get(c));
    });
    const thrown = thrownBy(() => {
      set(s, 1);
    });
    set(s, 2);
    expect([thrown instanceof Error, seen]).toEqual([true, [0, 20]]);
  });

  /**
   * A sub on `s` that made (directly, or through `via`) an effect on `t` and throws on 1; a batch
   * writes both. A second reader of `t` keeps a later write from running the child alone.
   */
  const throwingOwner = (
    subFirst: boolean,
    via: "direct" | "scope" | "sub",
  ): { log: string[]; t: Signal<number>; thrown: unknown } => {
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    effect(() => {
      get(t);
    });
    const child = (): void => {
      effect(() => {
        log.push(`child ${get(t)}`);
      });
    };
    sub(s, (value) => {
      if (value === 0) {
        if (via === "direct") child();
        else if (via === "scope") scope(child);
        else sub(signal(0), child);
      }
      if (value === 1) throw new Error("sub threw");
    });
    log.length = 0;
    const thrown = thrownBy(() => {
      batch(() => {
        if (!subFirst) set(t, 1);
        set(s, 1);
        if (subFirst) set(t, 1);
      });
    });
    return { log, t, thrown };
  };

  describe.each(["direct", "scope", "sub"] as const)(
    "a later call that throws, its child made %s",
    (via) => {
      test.each(ORDERS)("its child still runs in that flush (%s)", (_label, subFirst) => {
        expect.assertions(1);
        const { log, thrown } = throwingOwner(subFirst, via);
        expect([log, (thrown as Error).message]).toEqual([["child 1"], "sub threw"]);
      });

      test.each(ORDERS)("its child follows its signal afterwards (%s)", (_label, subFirst) => {
        expect.assertions(1);
        const { log, t } = throwingOwner(subFirst, via);
        log.length = 0;
        set(t, 2);
        set(t, 3);
        expect(log).toEqual(["child 2", "child 3"]);
      });
    },
  );

  test("a sub's child queued before the sub's throwing call still runs in that flush and follows later writes", () => {
    expect.assertions(1);
    const a = signal(0);
    const s = signal(0);
    const error = new Error("sub call");
    const log: string[] = [];
    sub(s, (value) => {
      if (value === 1) throw error;
      effect(() => {
        log.push(`child ${get(a)}`);
      });
    });
    effect(() => {
      get(a);
    });
    log.length = 0;
    const thrown = thrownBy(() => {
      batch(() => {
        set(a, 1);
        set(s, 1);
      });
    });
    set(a, 2);
    expect([thrown === error, log]).toEqual([true, ["child 1", "child 2"]]);
  });

  test.each(ORDERS)("a later call's error reaches the batch's caller (%s)", (_label, subFirst) => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const error = new Error("later call");
    sub(s, (value) => {
      if (value === 0) {
        effect(() => {
          get(t);
        });
      }
      if (value === 1) throw error;
    });
    const thrown = thrownBy(() => {
      batch(() => {
        if (subFirst) set(s, 1);
        set(t, 1);
        if (!subFirst) set(s, 1);
      });
    });
    expect(thrown).toBe(error);
  });

  test.each([true, false])(
    "10k effects a throwing sub made all run once in the batch that makes it throw, and on the next write (children's source first: %p)",
    (childFirst) => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      let runs = 0;
      const child = (): void => {
        get(t);
        runs++;
      };
      sub(s, (value) => {
        if (value !== 0) throw new Error("owner");
        for (let i = 0; i < 10_000; i++) effect(child);
      });
      runs = 0;
      const thrown = thrownBy(() => {
        batch(() => {
          if (childFirst) set(t, 1);
          set(s, 1);
          if (!childFirst) set(t, 1);
        });
      });
      const once = runs;
      set(t, 2);
      expect([once, runs, (thrown as Error).message]).toEqual([10_000, 20_000, "owner"]);
    },
  );

  test("a lone sub that a write calls, throwing after queuing work: the work runs and the writer gets the error", () => {
    expect.assertions(1);
    const s = signal(0);
    const x = signal(0);
    const log: string[] = [];
    effect(() => {
      log.push(`x ${get(x)}`);
    });
    effect(() => {
      log.push(`y ${get(x)}`);
    });
    sub(s, (value) => {
      if (value === 1) {
        set(x, 1);
        throw new Error("sub");
      }
    });
    log.length = 0;
    const thrown = thrownBy(() => {
      set(s, 1);
    });
    expect([log.toSorted(), (thrown as Error).message]).toEqual([["x 1", "y 1"], "sub"]);
  });

  test("after a lone sub's call throws, an effect made at top level is not the sub's", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    const handle = sub(s, (value) => {
      if (value === 1) throw new Error("sub");
    });
    thrownBy(() => {
      set(s, 1);
    });
    effect(() => {
      log.push(`top ${get(t)}`);
    });
    dispose(handle);
    set(t, 1);
    expect(log).toEqual(["top 0", "top 1"]);
  });

  test("after a later call throws, a top-level read subscribes nothing", () => {
    expect.assertions(1);
    const s = signal(0);
    const x = signal(0);
    let calls = 0;
    sub(s, (value) => {
      calls++;
      if (value === 1) throw new Error("last entry");
    });
    thrownBy(() => {
      set(s, 1);
    });
    get(x);
    set(x, 1);
    expect(calls).toBe(2);
  });

  test.serial(
    "a throwing cleanup stops neither the other cleanups nor the disposal, and the core still flushes",
    () => {
      expect.assertions(3);
      using spy = spyOn(console, "error").mockImplementation(() => {});
      const s = signal(0);
      const log: string[] = [];
      const handle = sub(s, (value) => {
        defer(() => {
          log.push(`older ${value}`);
        });
        defer(() => {
          throw new Error("cleanup");
        });
        defer(() => {
          log.push(`newer ${value}`);
        });
      });
      set(s, 1);
      const thrown = thrownBy(() => {
        dispose(handle);
      });
      const errors = spy.mock.calls.length;
      expect([thrown, log]).toEqual([undefined, ["newer 1", "older 1", "newer 0", "older 0"]]);
      let runs = 0;
      const t = signal(0);
      effect(() => {
        get(t);
        runs++;
      });
      set(t, 1);
      expect(runs).toBe(2);
      // Dev builds log each dropped cleanup error; production drops it silently
      expect(errors).toBe(DEV ? 2 : 0);
    },
  );

  // src/signal.ts: unspecified (a throw is no return, so "again after fn returns" does not decide it)
  test("Characterization: a later call that writes its signal, then throws, is called again in the same flush", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    sub(s, (value) => {
      seen.push(value);
      if (value === 1) {
        set(s, 2);
        throw new Error("after the write");
      }
    });
    const thrown = thrownBy(() => {
      set(s, 1);
    });
    const before = [...seen];
    set(s, 3);
    expect([before, seen, thrown instanceof Error]).toEqual([[0, 1, 2], [0, 1, 2, 3], true]);
  });
});

describe("sub disposal and re-entrancy", () => {
  test("a sub that disposes itself in fn, after writing its signal, is not called again", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: number[] = [];
    const handle: Effect = sub(s, (value) => {
      seen.push(value);
      if (value === 1) {
        set(s, 2);
        dispose(handle);
      }
    });
    set(s, 1);
    set(s, 3);
    expect(seen).toEqual([0, 1]);
  });

  test("a sub whose fn disposes it stops, and what it made is disposed once", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handle: Effect = sub(s, (value) => {
      log.push(`call ${value}`);
      if (value === 0) {
        defer(() => {
          log.push("cleanup");
        });
      }
      if (value === 1) dispose(handle);
    });
    set(s, 1);
    set(s, 2);
    dispose(handle);
    expect(log).toEqual(["call 0", "call 1", "cleanup"]);
  });

  test("a sub disposing itself after creating children tears them down newest first, across calls", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handle: Effect = sub(s, (value) => {
      effect(() => () => {
        log.push(`effect ${value}`);
      });
      defer(() => {
        log.push(`defer ${value}`);
      });
      if (value === 2) dispose(handle);
    });
    set(s, 1);
    set(s, 2);
    set(s, 3);
    expect(log).toEqual(["defer 2", "effect 2", "defer 1", "effect 1", "defer 0", "effect 0"]);
  });

  test("a sub disposed by its child's first run is called no more; the child is torn down once", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    const handle: Effect = sub(s, (value) => {
      log.push(`sub ${value}`);
      if (value === 1) {
        effect(() => {
          log.push(`child ${get(t)}`);
          dispose(handle);
          return () => {
            log.push("child cleanup");
          };
        });
      }
    });
    set(s, 1);
    set(s, 2);
    set(t, 1);
    expect(log).toEqual(["sub 0", "sub 1", "child 0", "child cleanup"]);
  });

  test("a sub whose fn disposes its owner effect: no further calls, each cleanup once", () => {
    expect.assertions(1);
    const a = signal(0);
    const s = signal(0);
    const log: string[] = [];
    const parent: Effect = effect(() => {
      get(a);
      sub(s, (value) => {
        log.push(`sub ${value}`);
        defer(() => {
          log.push(`defer ${value}`);
        });
        if (value === 1) {
          set(s, 2);
          dispose(parent);
        }
      });
      return () => {
        log.push("effect cleanup");
      };
    });
    set(s, 1);
    set(s, 3);
    set(a, 1);
    expect(log).toEqual(["sub 0", "sub 1", "defer 1", "defer 0", "effect cleanup"]);
  });

  test("a sub whose later call disposes its owner stops, with its children and the owner's cleanup", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const parent: Effect = effect(() => {
      sub(s, (value) => {
        log.push(`call ${value}`);
        if (value === 0) {
          effect(() => () => {
            log.push("child");
          });
        }
        if (value === 1) dispose(parent);
      });
      return () => {
        log.push("owner");
      };
    });
    set(s, 1);
    set(s, 2);
    expect(log).toEqual(["call 0", "call 1", "child", "owner"]);
  });

  test("of two subs that dispose each other when called, only the first called runs", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: string[] = [];
    const handles: Effect[] = [
      sub(s, (value) => {
        seen.push(`a${value}`);
        if (value === 1) dispose(handles[1]);
      }),
      sub(s, (value) => {
        seen.push(`b${value}`);
        if (value === 1) dispose(handles[0]);
      }),
    ];
    set(s, 1);
    // Sibling order is unspecified: whichever is called first disposes the other
    expect(seen.length).toBe(3);
  });

  test("a child cleanup that disposes the sub during the sub's disposal finishes the teardown, each cleanup once", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handle: Effect = sub(s, (value) => {
      effect(() => () => {
        log.push(`older ${value}`);
      });
      effect(() => () => {
        log.push(`disposer ${value}`);
        dispose(handle);
      });
      defer(() => {
        log.push(`defer ${value}`);
      });
    });
    set(s, 1);
    dispose(handle);
    expect(log).toEqual(["defer 1", "disposer 1", "older 1", "defer 0", "disposer 0", "older 0"]);
  });

  test("a row cleanup that disposes the sub during fn's disposal of the row: no further calls", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    let row!: Scope;
    const handle: Effect = sub(s, (value) => {
      log.push(`call ${value}`);
      if (value === 0) {
        row = scope(() => () => {
          log.push("row cleanup");
          dispose(handle);
        });
      } else {
        dispose(row);
        log.push("after dispose(row)");
        set(s, 9);
      }
    });
    set(s, 1);
    set(s, 2);
    expect(log).toEqual(["call 0", "call 1", "row cleanup", "after dispose(row)"]);
  });

  // A list's reconcile cannot stop when a row's effect disposes its wiring: the rest of the call
  // goes on, and the ends of the runs in progress dispose what it made (dev throws nothing)
  test.each(["in a scope fn made", "in an effect's first run fn made", "directly in fn"] as const)(
    "a sub disposed by a first run, then a creation %s: nothing throws, and nothing it made runs after",
    (site) => {
      expect.assertions(2);
      const s = signal(0);
      const t = signal(0);
      let runs = 0;
      const later = (): void => {
        effect(() => {
          get(t);
          runs++;
        });
      };
      const handle: Effect = sub(s, (value) => {
        if (value !== 1) return;
        const body = (): void => {
          effect(() => {
            dispose(handle);
          });
          if (site !== "in an effect's first run fn made") later();
        };
        if (site === "in a scope fn made") scope(body);
        else if (site === "in an effect's first run fn made") {
          effect(() => {
            body();
            later();
          });
        } else body();
      });
      expect(
        thrownBy(() => {
          set(s, 1);
        }),
      ).toBeUndefined();
      runs = 0;
      set(t, 1);
      expect(runs).toBe(0);
    },
  );
});

describe("scope bodies (not batched)", () => {
  test("a write in the body runs a dependent effect before scope() returns", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    effect(() => {
      log.push(`effect ${get(s)}`);
    });
    scope(() => {
      set(s, 1);
      log.push("body");
    });
    expect(log).toEqual(["effect 0", "effect 1", "body"]);
  });

  test("a body's write runs an effect the body made before the write returns", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    scope(() => {
      effect(() => {
        log.push(`effect ${get(s)}`);
      });
      set(s, 1);
      log.push("after write");
    });
    expect(log).toEqual(["effect 0", "effect 1", "after write"]);
  });

  test("a write in a body inside a batch runs effects at the batch end", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: (number | string)[] = [];
    effect(() => {
      log.push(get(s));
    });
    batch(() => {
      scope(() => {
        set(s, 1);
        log.push("body");
      });
      log.push("batch body");
    });
    expect(log).toEqual([0, "body", "batch body", 1]);
  });

  test("dispose(scope(fn)) is a root: fn's effects follow fn's writes, then stop", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: (number | string)[] = [];
    dispose(
      scope(() => {
        effect(() => {
          log.push(get(s));
        });
        set(s, 1);
        log.push("body end");
      }),
    );
    set(s, 2);
    expect(log).toEqual([0, 1, "body end"]);
  });

  test.each([1, 2])(
    "what the body creates after a write that ran effects is the scope's (%i effects read the signal)",
    (readers) => {
      expect.assertions(1);
      const s = signal(0);
      const t = signal(0);
      for (let i = 0; i < readers; i++) {
        effect(() => {
          get(s);
        });
      }
      let runs = 0;
      const log: string[] = [];
      const handle = scope(() => {
        set(s, 1);
        effect(() => {
          get(t);
          runs++;
        });
        defer(() => {
          log.push("cleanup");
        });
      });
      dispose(handle);
      set(t, 1);
      expect([runs, log]).toEqual([1, ["cleanup"]]);
    },
  );

  test("the body subscribes nothing after a write that ran an effect", () => {
    expect.assertions(1);
    const s = signal(0);
    const x = signal(0);
    let runs = 0;
    effect(() => {
      get(s);
      runs++;
    });
    scope(() => {
      set(s, 1);
      get(x);
    });
    set(x, 1);
    expect(runs).toBe(2);
  });

  test("a body whose write re-ran an effect it made subscribes that effect to nothing it reads afterwards", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    scope(() => {
      effect(() => {
        get(s);
        runs++;
      });
      set(s, 1);
      get(t);
    });
    set(t, 1);
    expect(runs).toBe(2);
  });

  // How a body's write can reach effects at top level: each must give the body back afterwards
  test.each([
    [
      "set, one reader",
      1,
      (s: Signal<number>) => {
        set(s, 1);
      },
    ],
    [
      "set, two readers",
      2,
      (s: Signal<number>) => {
        set(s, 1);
      },
    ],
    [
      "batch end",
      2,
      (s: Signal<number>) => {
        batch(() => {
          set(s, 1);
        });
      },
    ],
    [
      "nested batch end",
      2,
      (s: Signal<number>) => {
        batch(() => {
          batch(() => {
            set(s, 1);
          });
        });
      },
    ],
    [
      "untracked set",
      2,
      (s: Signal<number>) => {
        untracked(() => {
          set(s, 1);
        });
      },
    ],
    [
      "effect() whose first run writes",
      2,
      (s: Signal<number>) => {
        effect(() => {
          set(s, 1);
        });
      },
    ],
    [
      "sub() whose first call writes",
      2,
      (s: Signal<number>, t: Signal<number>) => {
        sub(t, () => {
          set(s, 1);
        });
      },
    ],
    [
      "dispose() whose cleanup writes",
      2,
      (_s: Signal<number>, _t: Signal<number>, writer: Effect) => {
        dispose(writer);
      },
    ],
    [
      "scope() nested, its body writes",
      2,
      (s: Signal<number>) => {
        scope(() => {
          set(s, 1);
        });
      },
    ],
  ] as const)(
    "a body's %s: the effects it reaches run before it returns, and the body still owns and tracks nothing",
    (_kind, readers, write) => {
      expect.assertions(5);
      const s = signal(0);
      const x = signal(0);
      const t = signal(0);
      let readerRuns = 0;
      let otherRuns = 0;
      effect(() => {
        get(s);
        readerRuns++;
      });
      if (readers === 2) {
        effect(() => {
          get(s);
          otherRuns++;
        });
      }
      const writer = effect(() => () => {
        set(s, 1);
      });
      let ranBeforeReturn = 0;
      let laterRuns = 0;
      const root = scope(() => {
        write(s, t, writer);
        ranBeforeReturn = readerRuns;
        effect(() => {
          get(x);
          laterRuns++;
        });
        // A leaked tracker (the last effect the flush ran) would subscribe here
        get(x);
        get(t);
      });
      expect(ranBeforeReturn).toBe(2);
      expect(otherRuns).toBe(readers === 2 ? 2 : 0);
      dispose(root);
      readerRuns = 0;
      otherRuns = 0;
      set(x, 1);
      set(t, 1);
      expect(laterRuns).toBe(1);
      expect(readerRuns).toBe(0);
      expect(otherRuns).toBe(0);
    },
  );

  test("a re-run in a flush a body started owns what it makes; the scope does not adopt it", () => {
    expect.assertions(2);
    const s = signal(0);
    const y = signal(0);
    let childRuns = 0;
    const top = effect(() => {
      if (get(s) === 1) {
        effect(() => {
          get(y);
          childRuns++;
        });
      }
    });
    const root = scope(() => {
      set(s, 1);
    });
    dispose(root);
    set(y, 1);
    // The child belongs to `top`, which lives on
    expect(childRuns).toBe(2);
    dispose(top);
    set(y, 2);
    expect(childRuns).toBe(2);
  });

  test("a body's write re-runs an effect it made at once; what that re-run makes belongs to it", () => {
    expect.assertions(2);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    const handle = scope(() => {
      effect(() => {
        const v = get(s);
        effect(() => {
          log.push(`inner ${v} ${get(t)}`);
        });
      });
      set(s, 1);
    });
    set(t, 1);
    expect(log).toEqual(["inner 0 0", "inner 1 0", "inner 1 1"]);
    dispose(handle);
    set(t, 2);
    expect(log).toHaveLength(3);
  });

  test("a body's write runs an effect that disposes another scope before the write returns", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    const outer = scope(() => {
      defer(() => {
        log.push("outer defer");
      });
    });
    effect(() => {
      if (get(s) === 1) dispose(outer);
    });
    scope(() => {
      effect(() => {
        log.push(`sibling ${get(t)}`);
      });
      set(s, 1);
      log.push("after write");
    });
    expect(log).toEqual(["sibling 0", "outer defer", "after write"]);
  });

  test("a write in the body whose flush throws: the body catches it and stays the owner", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    effect(() => {
      if (get(s) === 1) throw new Error("x");
    });
    const handle = scope(() => {
      log.push(
        `caught ${
          (
            thrownBy(() => {
              set(s, 1);
            }) as Error
          ).message
        }`,
      );
      effect(() => {
        log.push(`made ${get(s)}`);
      });
    });
    dispose(handle);
    set(s, 2);
    expect(log).toEqual(["caught x", "made 1"]);
  });

  test("a body's write that runs a lone throwing effect leaves the body the owner, tracking nothing", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const log: string[] = [];
    effect(() => {
      if (get(s) === 1) throw new Error("lone");
    });
    const handle = scope(() => {
      log.push(
        `caught ${
          (
            thrownBy(() => {
              set(s, 1);
            }) as Error
          ).message
        }`,
      );
      // A leaked tracker would subscribe the thrower here: set(t) would then re-run it
      get(t);
      effect(() => {
        log.push(`made ${get(t)}`);
      });
    });
    const first = thrownBy(() => {
      set(t, 1);
    });
    dispose(handle);
    const second = thrownBy(() => {
      set(t, 2);
    });
    expect([log, first, second]).toEqual([
      ["caught lone", "made 0", "made 1"],
      undefined,
      undefined,
    ]);
  });

  test("after a body caught a throwing flush, a top-level write runs effects at once", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    effect(() => {
      if (get(s) === 1) throw new Error("effect");
    });
    scope(() => {
      thrownBy(() => {
        set(s, 1);
      });
    });
    effect(() => {
      get(t);
      runs++;
    });
    set(t, 1);
    expect(runs).toBe(2);
  });

  test("a re-run that throws in a flush a body started: the body gets the error and still owns", () => {
    expect.assertions(2);
    const s = signal(0);
    const y = signal(0);
    effect(() => {
      if (get(s) === 1) throw new Error("re-run failed");
    });
    let laterRuns = 0;
    let caught: unknown;
    const root = scope(() => {
      caught = thrownBy(() => {
        set(s, 1);
      });
      effect(() => {
        get(y);
        laterRuns++;
      });
      get(y);
    });
    expect(String(caught)).toContain("re-run failed");
    dispose(root);
    set(y, 1);
    expect(laterRuns).toBe(1);
  });

  test("an effect's first run that writes and throws inside a body: it is disposed, the body keeps owning", () => {
    expect.assertions(3);
    const s = signal(0);
    const y = signal(0);
    let readerRuns = 0;
    effect(() => {
      get(s);
      readerRuns++;
    });
    let laterRuns = 0;
    let caught: unknown;
    const root = scope(() => {
      caught = thrownBy(() => {
        effect(() => {
          set(s, 1);
          throw new Error("first run failed");
        });
      });
      effect(() => {
        get(y);
        laterRuns++;
      });
    });
    expect(String(caught)).toContain("first run failed");
    expect(readerRuns).toBe(2);
    dispose(root);
    set(y, 1);
    expect(laterRuns).toBe(1);
  });

  test("a body that throws after its write ran effects: the scope and its effects are disposed, and top level is clean", () => {
    expect.assertions(4);
    const s = signal(0);
    const y = signal(0);
    let childRuns = 0;
    let readerRuns = 0;
    effect(() => {
      get(s);
      readerRuns++;
    });
    const error = thrownBy(() => {
      scope(() => {
        effect(() => {
          get(y);
          childRuns++;
        });
        set(s, 1);
        throw new Error("body failed");
      });
    });
    expect(String(error)).toContain("body failed");
    // Top level after it: no owner (an effect lives on), no tracker (a read subscribes nothing)
    let topRuns = 0;
    effect(() => {
      get(y);
      topRuns++;
    });
    get(y);
    readerRuns = 0;
    set(y, 1);
    expect(childRuns).toBe(1);
    expect(topRuns).toBe(2);
    expect(readerRuns).toBe(0);
  });

  test("nested bodies: after the inner body's write flushed, each body owns what it creates next", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    effect(() => {
      get(s);
    });
    const handle = scope(() => {
      scope(() => {
        set(s, 1);
        effect(() => {
          get(t);
          runs++;
        });
      });
      set(s, 2);
      effect(() => {
        get(t);
        runs++;
      });
    });
    dispose(handle);
    set(t, 1);
    expect(runs).toBe(2);
  });

  test("after an inner body's write ran effects, the outer body owns what it creates next", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    effect(() => {
      get(s);
    });
    let inner!: Scope;
    let runs = 0;
    const outer = scope(() => {
      inner = scope(() => {
        set(s, 1);
      });
      effect(() => {
        get(t);
        runs++;
      });
    });
    dispose(inner);
    set(t, 1);
    const afterInner = runs;
    dispose(outer);
    set(t, 2);
    expect([afterInner, runs]).toEqual([2, 2]);
  });

  test("untracked in a body keeps the scope the owner across a write that ran effects", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    effect(() => {
      get(s);
    });
    let runs = 0;
    const handle = scope(() => {
      untracked(() => {
        set(s, 1);
        effect(() => {
          get(t);
          runs++;
        });
      });
    });
    dispose(handle);
    set(t, 1);
    expect(runs).toBe(1);
  });

  test("a sub made in a body follows the body's later write at once and dies with the scope", () => {
    expect.assertions(2);
    const s = signal(0);
    const seen: string[] = [];
    const handle = scope(() => {
      sub(s, (value) => {
        seen.push(`sub ${value}`);
      });
      set(s, 1);
      seen.push("after write");
    });
    expect(seen).toEqual(["sub 0", "sub 1", "after write"]);
    dispose(handle);
    set(s, 2);
    expect(seen).toHaveLength(3);
  });

  test("a sub made in the body after a flushing write belongs to the scope", () => {
    expect.assertions(1);
    const s = signal(0);
    const t = signal(0);
    const seen: number[] = [];
    effect(() => {
      get(s);
    });
    effect(() => {
      get(s);
    });
    const handle = scope(() => {
      set(s, 1);
      sub(t, (value) => {
        seen.push(value);
      });
    });
    dispose(handle);
    set(t, 1);
    expect(seen).toEqual([0]);
  });

  test("100k effects a body made that throw on its write: the body catches, all ran, and it still owns", () => {
    expect.assertions(4);
    const s = signal(0);
    const y = signal(0);
    let calls = 0;
    let laterRuns = 0;
    let caught: unknown;
    const thrower = (): void => {
      calls++;
      if (get(s) !== 0) throw new Error("boom");
    };
    const root = scope(() => {
      for (let i = 0; i < 100_000; i++) effect(thrower);
      calls = 0;
      caught = thrownBy(() => {
        set(s, 1);
      });
      effect(() => {
        get(y);
        laterRuns++;
      });
    });
    expect(String(caught)).toContain("boom");
    expect(calls).toBe(100_000);
    calls = 0;
    expect(
      thrownBy(() => {
        set(s, 2);
      }),
    ).toBeDefined();
    dispose(root);
    set(y, 1);
    expect(calls + laterRuns).toBe(100_001);
  });
});

describe("components and async callbacks", () => {
  /** A component: a counter text node that `ticks` advances, removed by its owner's disposal. */
  const counter = (parent: Element, ticks: (() => void)[]): void => {
    const count = signal(0);
    const double = computed(() => get(count) * 2);
    const text = document.createTextNode("");
    parent.append(text);
    effect(() => {
      text.data = String(get(double));
    });
    const tick = (): void => {
      set(count, count.v + 1);
    };
    ticks.push(tick);
    defer(() => {
      ticks.splice(ticks.indexOf(tick), 1);
      text.remove();
    });
  };
  /** A component that renders a counter once `load` resolves, in a root scope of its own. */
  const details = (parent: Element, load: () => Promise<string>, ticks: (() => void)[]): void => {
    let alive = true;
    let shown: Scope | undefined;
    defer(() => {
      alive = false;
      if (shown) dispose(shown);
    });
    // oxlint-disable-next-line promise/prefer-await-to-then -- a callback nothing awaits
    void load().then((tag) => {
      if (alive) {
        shown = scope(() => {
          counter(parent.appendChild(document.createElement(tag)), ticks);
        });
      }
    });
  };

  test("an async callback's root scope renders and follows its signals", async () => {
    expect.assertions(1);
    const ticks: (() => void)[] = [];
    const body = document.createElement("div");
    const app = scope(() => {
      counter(body, ticks);
      details(body, () => Promise.resolve("p"), ticks);
    });
    await Promise.resolve();
    ticks[1]();
    expect(body.innerHTML).toBe("0<p>2</p>");
    dispose(app);
  });

  test("disposing the app disposes the async callback's root scope through its component's cleanup", async () => {
    expect.assertions(2);
    const ticks: (() => void)[] = [];
    const body = document.createElement("div");
    const app = scope(() => {
      counter(body, ticks);
      details(body, () => Promise.resolve("p"), ticks);
    });
    await Promise.resolve();
    dispose(app);
    // The <p> is the async callback's own DOM, not a component's: only the texts go
    expect(body.innerHTML).toBe("<p></p>");
    expect(ticks).toEqual([]);
  });

  test("an app disposed before the data arrives makes nothing later", async () => {
    expect.assertions(1);
    const body = document.createElement("div");
    const data = Promise.withResolvers<string>();
    const app = scope(() => {
      details(body, () => data.promise, []);
    });
    dispose(app);
    data.resolve("p");
    await Promise.resolve();
    expect(body.innerHTML).toBe("");
  });

  /** A component that renders a counter once `load` resolves, as its owner's, through `within`. */
  const detailsWithin = (
    parent: Element,
    load: () => Promise<string>,
    ticks: (() => void)[],
  ): void => {
    const self = owner() as Scope;
    // oxlint-disable-next-line promise/prefer-await-to-then -- a callback nothing awaits
    void load().then((tag) => {
      within(self, () => {
        counter(parent.appendChild(document.createElement(tag)), ticks);
      });
    });
  };

  test("an async callback's within renders under the component's owner and follows its signals", async () => {
    expect.assertions(1);
    const ticks: (() => void)[] = [];
    const body = document.createElement("div");
    const app = scope(() => {
      counter(body, ticks);
      detailsWithin(body, () => Promise.resolve("p"), ticks);
    });
    await Promise.resolve();
    ticks[1]();
    expect(body.innerHTML).toBe("0<p>2</p>");
    dispose(app);
  });

  test("disposing the app disposes what the async callback made within it", async () => {
    expect.assertions(2);
    const ticks: (() => void)[] = [];
    const body = document.createElement("div");
    const app = scope(() => {
      counter(body, ticks);
      detailsWithin(body, () => Promise.resolve("p"), ticks);
    });
    await Promise.resolve();
    dispose(app);
    // The <p> is the async callback's own DOM, not a component's: only the texts go
    expect(body.innerHTML).toBe("<p></p>");
    expect(ticks).toEqual([]);
  });

  test("an app disposed before the data arrives: the callback's within makes nothing", async () => {
    expect.assertions(1);
    const body = document.createElement("div");
    const data = Promise.withResolvers<string>();
    const app = scope(() => {
      detailsWithin(body, () => data.promise, []);
    });
    dispose(app);
    data.resolve("p");
    await Promise.resolve();
    expect(body.innerHTML).toBe("");
  });
});

describe("owner and within", () => {
  test("owner is undefined where nothing owns", () => {
    expect.assertions(1);
    expect(owner()).toBeUndefined();
  });

  test("owner in a scope's body is the scope", () => {
    expect.assertions(1);
    let seen: Effect | Scope | undefined;
    const handle = scope(() => {
      seen = owner();
    });
    expect(seen).toBe(handle);
  });

  test("owner in an effect's first run and re-run is the effect", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: (Effect | Scope | undefined)[] = [];
    const handle = effect(() => {
      get(s);
      seen.push(owner());
    });
    set(s, 1);
    expect(seen.map((node) => node === handle)).toEqual([true, true]);
  });

  test("owner in a sub's first and later calls is the sub", () => {
    expect.assertions(1);
    const s = signal(0);
    const seen: (Effect | Scope | undefined)[] = [];
    const handle = sub(s, () => {
      seen.push(owner());
    });
    set(s, 1);
    expect(seen.map((node) => node === handle)).toEqual([true, true]);
  });

  test("owner inside untracked in an effect's run is the effect", () => {
    expect.assertions(1);
    let seen: Effect | Scope | undefined;
    const handle = effect(() => {
      untracked(() => {
        seen = owner();
      });
    });
    expect(seen).toBe(handle);
  });

  test("owner in a scope's body is still the scope after a write there ran an effect", () => {
    expect.assertions(1);
    const s = signal(0);
    effect(() => {
      get(s);
    });
    let seen: Effect | Scope | undefined;
    const handle = scope(() => {
      set(s, 1);
      seen = owner();
    });
    expect(seen).toBe(handle);
  });

  test("owner inside within is its target", () => {
    expect.assertions(1);
    const root = scope(() => {});
    let seen: Effect | Scope | undefined;
    within(root, () => {
      seen = owner();
    });
    expect(seen).toBe(root);
  });

  test("what within makes belongs to its target: disposing the target disposes it", () => {
    expect.assertions(1);
    const log: string[] = [];
    const root = scope(() => {});
    within(root, () => {
      defer(() => {
        log.push("made");
      });
    });
    dispose(root);
    expect(log).toEqual(["made"]);
  });

  test("what within makes in a scope's body belongs to the target, not to that scope", () => {
    expect.assertions(2);
    const log: string[] = [];
    const root = scope(() => {});
    const body = scope(() => {
      within(root, () => {
        defer(() => {
          log.push("made");
        });
      });
    });
    dispose(body);
    expect(log).toEqual([]);
    dispose(root);
    expect(log).toEqual(["made"]);
  });

  test("a target disposes what within made and its own children, newest first", () => {
    expect.assertions(1);
    const log: string[] = [];
    const root = scope(() => {
      defer(() => {
        log.push("own");
      });
    });
    within(root, () => {
      defer(() => {
        log.push("first within");
      });
    });
    within(root, () => {
      defer(() => {
        log.push("second within");
      });
    });
    dispose(root);
    expect(log).toEqual(["second within", "first within", "own"]);
  });

  test("what within makes after a write that ran an effect still belongs to its target", () => {
    expect.assertions(1);
    const s = signal(0);
    effect(() => {
      get(s);
    });
    const log: string[] = [];
    const root = scope(() => {});
    within(root, () => {
      set(s, 1);
      defer(() => {
        log.push("made");
      });
    });
    dispose(root);
    expect(log).toEqual(["made"]);
  });

  test("a nested within gives back the outer within's target", () => {
    expect.assertions(1);
    const outer = scope(() => {});
    const inner = scope(() => {});
    let seen: Effect | Scope | undefined;
    within(outer, () => {
      within(inner, () => {});
      seen = owner();
    });
    expect(seen).toBe(outer);
  });

  test("a within whose fn throws gives back the owner it found", () => {
    expect.assertions(1);
    const root = scope(() => {});
    let seen: Effect | Scope | undefined;
    const body = scope(() => {
      try {
        within(root, () => {
          throw new Error("fn");
        });
      } catch {
        // The throw under test
      }
      seen = owner();
    });
    expect(seen).toBe(body);
  });

  test("reads after a within whose fn threw still subscribe the running effect", () => {
    expect.assertions(1);
    const root = scope(() => {});
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      try {
        within(root, () => {
          throw new Error("fn");
        });
      } catch {
        // The throw under test
      }
      get(s);
    });
    set(s, 1);
    expect(runs).toBe(2);
  });

  test("reads inside within do not subscribe its effect target", () => {
    expect.assertions(1);
    const s = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
    });
    within(handle, () => get(s));
    set(s, 1);
    expect(runs).toBe(1);
  });

  test("a write in fn runs the effects it reaches before within returns (not batched)", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    effect(() => {
      log.push(`effect ${get(s)}`);
    });
    const root = scope(() => {});
    within(root, () => {
      set(s, 1);
      log.push("fn");
    });
    expect(log).toEqual(["effect 0", "effect 1", "fn"]);
  });

  test("reads inside within do not subscribe the running effect", () => {
    expect.assertions(1);
    const root = scope(() => {});
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      within(root, () => get(s));
    });
    set(s, 1);
    expect(runs).toBe(1);
  });

  test("within returns what fn returns", () => {
    expect.assertions(1);
    const root = scope(() => {});
    expect(within(root, () => 5)).toBe(5);
  });

  test("within on a disposed target does not call fn", () => {
    expect.assertions(1);
    const root = scope(() => {});
    dispose(root);
    let called = false;
    within(root, () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  test("within on a disposed target returns undefined", () => {
    expect.assertions(1);
    const root = scope(() => {});
    dispose(root);
    expect(within(root, () => 5)).toBeUndefined();
  });

  test("within on a disposed target gives back the owner it found", () => {
    expect.assertions(1);
    const root = scope(() => {});
    dispose(root);
    let seen: Effect | Scope | undefined;
    const body = scope(() => {
      within(root, () => {});
      seen = owner();
    });
    expect(seen).toBe(body);
  });

  test("a within whose fn makes an effect that disposes the target returns what fn returns", () => {
    expect.assertions(1);
    const root = scope(() => {});
    const x = signal(false);
    expect(
      within(root, () => {
        effect(() => {
          if (get(x)) dispose(root);
        });
        set(x, true);
        return 1;
      }),
    ).toBe(1);
  });

  test("what within makes under an effect is disposed before the effect's next run", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handle = effect(() => {
      get(s);
    });
    within(handle, () => {
      defer(() => {
        log.push("made");
      });
    });
    set(s, 1);
    expect(log).toEqual(["made"]);
  });

  test("what within makes under a sub outlives the sub's later calls", () => {
    expect.assertions(1);
    const s = signal(0);
    const log: string[] = [];
    const handle = sub(s, () => {});
    within(handle, () => {
      defer(() => {
        log.push("made");
      });
    });
    set(s, 1);
    expect(log).toEqual([]);
    dispose(handle);
  });

  test.each([
    ["the parent's signal written first", true],
    ["the child's signal written first", false],
  ] as const)(
    "an effect within made under a scope an effect owns does not run in a batch whose re-run of that effect disposes it (%s)",
    (_label, parentFirst) => {
      expect.assertions(1);
      const x = signal(0);
      const y = signal(0);
      const inners: Scope[] = [];
      effect(() => {
        get(x);
        inners.push(scope(() => {}));
      });
      let runs = 0;
      within(inners[0], () => {
        effect(() => {
          get(y);
          runs++;
        });
      });
      batch(() => {
        if (parentFirst) set(x, 1);
        set(y, 1);
        if (!parentFirst) set(x, 1);
      });
      expect(runs).toBe(1);
    },
  );

  test("after an await inside within's fn, nothing owns", async () => {
    expect.assertions(1);
    const root = scope(() => {});
    let seen: Effect | Scope | undefined = root;
    await within(root, async () => {
      await Promise.resolve();
      seen = owner();
    });
    expect(seen).toBeUndefined();
  });

  test.skipIf(DEV)(
    "Accepted tradeoff: what within makes after fn disposed its target lives on (production)",
    () => {
      expect.assertions(1);
      const s = signal(0);
      let runs = 0;
      const root = scope(() => {});
      within(root, () => {
        dispose(root);
        effect(() => {
          get(s);
          runs++;
        });
      });
      set(s, 1);
      expect(runs).toBe(2);
      dispose(root);
    },
  );
});

describe("first runs give back the context they found", () => {
  test("nested in a re-run: the re-run still tracks and owns after it", () => {
    expect.assertions(3);
    const s = signal(0);
    const x = signal(0);
    const y = signal(0);
    let parentRuns = 0;
    let childRuns = 0;
    let laterRuns = 0;
    effect(() => {
      get(s);
      parentRuns++;
      effect(() => {
        get(y);
        childRuns++;
      });
      effect(() => {
        get(y);
        laterRuns++;
      });
      get(x);
    });
    set(s, 1);
    set(x, 1);
    expect(parentRuns).toBe(3);
    childRuns = 0;
    laterRuns = 0;
    set(y, 1);
    // One live child each: the earlier runs' were disposed by the re-runs
    expect(childRuns).toBe(1);
    expect(laterRuns).toBe(1);
  });

  test("untracked in a re-run keeps the owner and gives tracking back", () => {
    expect.assertions(2);
    const s = signal(0);
    const x = signal(0);
    const y = signal(0);
    let parentRuns = 0;
    let childRuns = 0;
    effect(() => {
      get(s);
      parentRuns++;
      untracked(() => {
        effect(() => {
          get(y);
          childRuns++;
        });
      });
      get(x);
    });
    set(s, 1);
    set(x, 1);
    expect(parentRuns).toBe(3);
    childRuns = 0;
    set(y, 1);
    expect(childRuns).toBe(1);
  });

  test("in a cleanup during a top-level dispose: what it makes has the disposer's owner (none: it lives)", () => {
    expect.assertions(1);
    const y = signal(0);
    let madeRuns = 0;
    const handle = effect(() => () => {
      effect(() => {
        get(y);
        madeRuns++;
      });
    });
    dispose(handle);
    set(y, 1);
    expect(madeRuns).toBe(2);
  });

  test("in a cleanup during a dispose a body runs: what it makes belongs to the body's scope", () => {
    expect.assertions(1);
    const y = signal(0);
    let madeRuns = 0;
    const handle = effect(() => () => {
      effect(() => {
        get(y);
        madeRuns++;
      });
    });
    const root = scope(() => {
      dispose(handle);
    });
    dispose(root);
    set(y, 1);
    expect(madeRuns).toBe(1);
  });
});

describe("a throwing owner strands no child", () => {
  // An app's RangeError (an invalid Date's toISOString, toFixed(101)…) is an ordinary error, unlike
  // a stack overflow's
  describe.each([
    ["an Error", Error],
    ["an app's RangeError", RangeError],
  ] as const)("throwing %s", (_kind, Thrown) => {
    /**
     * A sub G on `s` makes, on its first call, `middle` (a sub or an effect on `s`), which makes a
     * child effect on `t`; one batch writes `s` and `t`, so G, the middle and the child are marked,
     * and the child waits for both. `thrower` throws a `Thrown` on 1.
     */
    const build = (
      middle: "sub" | "effect",
      thrower: "top" | "middle",
      sFirst: boolean,
    ): { log: string[]; t: Signal<number>; thrown: unknown } => {
      const s = signal(0);
      const t = signal(0);
      const log: string[] = [];
      // A second reader of `t`: a later write to `t` does not run the child alone
      effect(() => {
        get(t);
      });
      const child = (): void => {
        effect(() => {
          log.push(`child ${get(t)}`);
        });
      };
      const inner = (): void => {
        if (middle === "sub") {
          let made = false;
          sub(s, (v) => {
            if (!made) child();
            made = true;
            if (thrower === "middle" && v === 1) throw new Thrown("middle threw");
          });
        } else {
          effect(() => {
            child();
            if (thrower === "middle" && get(s) === 1) throw new Thrown("middle threw");
          });
        }
      };
      let made = false;
      sub(s, (value) => {
        if (!made) {
          made = true;
          inner();
        } else if (thrower === "top" && value === 1) throw new Thrown("top threw");
      });
      log.length = 0;
      const thrown = thrownBy(() => {
        batch(() => {
          if (sFirst) set(s, 1);
          set(t, 1);
          if (!sFirst) set(s, 1);
        });
      });
      return { log, t, thrown };
    };
    const CASES = [
      ["sub", "top", true],
      ["sub", "top", false],
      ["sub", "middle", true],
      ["sub", "middle", false],
      ["effect", "top", true],
      ["effect", "top", false],
      ["effect", "middle", true],
      ["effect", "middle", false],
    ] as const;

    test.each(CASES)(
      "a middle %s, the %s throwing (s written first: %p): the child still runs in that flush",
      (middle, thrower, sFirst) => {
        expect.assertions(1);
        const { log, thrown } = build(middle, thrower, sFirst);
        expect([log, thrown instanceof Thrown && thrown.message]).toEqual([
          ["child 1"],
          `${thrower} threw`,
        ]);
      },
    );

    test.each(CASES)(
      "a middle %s, the %s throwing (s written first: %p): the child follows t afterwards",
      (middle, thrower, sFirst) => {
        expect.assertions(1);
        const { log, t } = build(middle, thrower, sFirst);
        log.length = 0;
        set(t, 2);
        set(t, 3);
        expect(log).toEqual(["child 2", "child 3"]);
      },
    );
  });
});

describe("errors at scale", () => {
  // A recursive error continuation overflowed the stack at about 27k throwing effects in Bun
  test("100k effects that throw in one flush all run, all run again on the next write, and an error reaches the writer", () => {
    expect.assertions(1);
    const s = signal(0);
    const error = new Error("thrower");
    let runs = 0;
    const thrower = (): void => {
      if (get(s) !== 0) {
        runs++;
        throw error;
      }
    };
    const root = scope(() => {
      for (let i = 0; i < 100_000; i++) effect(thrower);
    });
    const writes = [1, 2].map((value) => {
      runs = 0;
      const thrown = thrownBy(() => {
        set(s, value);
      });
      return [runs, thrown === error];
    });
    dispose(root);
    expect(writes).toEqual([
      [100_000, true],
      [100_000, true],
    ]);
  });

  test("100k subs that throw in one flush are all called, twice", () => {
    expect.assertions(1);
    const s = signal(0);
    const error = new Error("thrower");
    let calls = 0;
    const thrower = (value: number): void => {
      if (value !== 0) {
        calls++;
        throw error;
      }
    };
    const root = scope(() => {
      for (let i = 0; i < 100_000; i++) sub(s, thrower);
    });
    const writes = [1, 2].map((value) => {
      calls = 0;
      const thrown = thrownBy(() => {
        set(s, value);
      });
      return [calls, thrown === error];
    });
    dispose(root);
    expect(writes).toEqual([
      [100_000, true],
      [100_000, true],
    ]);
  });
});

describe("depth", () => {
  test("updates and disposes a 100k-deep chain without overflowing the stack", () => {
    expect.assertions(2);
    const source = signal(0);
    let last: Signal<number> | Computed<number> = source;
    // Built one observed link at a time, so no first evaluation recurses deeply
    let keep = effect(() => {
      get(source);
    });
    for (let index = 0; index < 100_000; index++) {
      const prev: Signal<number> | Computed<number> = last;
      last = computed(() => get<number>(prev) + 1);
      const node = last;
      const next = effect(() => {
        get(node);
      });
      dispose(keep);
      keep = next;
    }
    let seen = -1;
    const tip = last;
    const handle = effect(() => {
      seen = get(tip);
    });
    dispose(keep);
    set(source, 1);
    expect(seen).toBe(100_001);
    expect(() => {
      dispose(handle);
    }).not.toThrow();
  });

  test("a 100k-deep chain each of whose links was read untracked once updates on a read after a write", () => {
    expect.assertions(1);
    const source = signal(0);
    let last: Signal<number> | Computed<number> = source;
    // Each new link's first evaluation reads a cached one: no evaluation recurses deeply
    for (let index = 0; index < 100_000; index++) {
      const prev: Signal<number> | Computed<number> = last;
      last = computed(() => get<number>(prev) + 1);
      get(last);
    }
    set(source, 1);
    expect(get(last)).toBe(100_001);
  });

  test("a scope is disposed after building a 100k-deep chain of its own computeds", () => {
    expect.assertions(1);
    const source = signal(0);
    const handle = scope(() => {
      let last: Signal<number> | Computed<number> = source;
      for (let index = 0; index < 100_000; index++) {
        const prev: Signal<number> | Computed<number> = last;
        last = computed(() => get<number>(prev) + 1);
        get(last);
      }
    });
    expect(() => {
      dispose(handle);
      set(source, 1);
    }).not.toThrow();
  });
});

describe("memory", () => {
  test("a disposed computed is collectable while its source lives", async () => {
    expect.assertions(1);
    const source = signal(1);
    const alive = await survivors(() => {
      const node = computed(() => get<number>(source) + 1);
      get(node);
      dispose(node);
      return node;
    });
    expect(alive).toBeLessThan(10);
  });

  test("a computed a disposed scope created and read is collectable while its source lives", async () => {
    expect.assertions(1);
    const source = signal(1);
    const alive = await survivors(() => {
      let node: Computed<number> | undefined;
      dispose(
        scope(() => {
          node = computed(() => get<number>(source) + 1);
          get(node);
        }),
      );
      return node as object;
    });
    expect(alive).toBeLessThan(10);
  });

  test("a computed a disposed effect's run created and read is collectable while its source lives", async () => {
    expect.assertions(1);
    const source = signal(1);
    const alive = await survivors(() => {
      let node: Computed<number> | undefined;
      dispose(
        effect(() => {
          node = computed(() => get<number>(source) + 1);
          get(node);
        }),
      );
      return node as object;
    });
    expect(alive).toBeLessThan(10);
  });

  test("a computed an effect's earlier run created and read is collectable after the effect re-runs", async () => {
    expect.assertions(1);
    const source = signal(1);
    const poke = signal(0);
    const handles: Effect[] = [];
    const refs: WeakRef<object>[] = [];
    for (let index = 0; index < 20; index++) {
      handles.push(
        effect(() => {
          const round = get<number>(poke);
          const node = computed(() => get<number>(source) + 1);
          get(node);
          if (round === 0) refs.push(new WeakRef(node));
        }),
      );
    }
    set(poke, 1);
    await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
    Bun.gc(true);
    const alive = refs.filter((ref) => ref.deref() !== undefined).length;
    for (const handle of handles) dispose(handle);
    expect(alive).toBeLessThan(10);
  });

  test("a computed created inside untracked in a disposed effect's run is collectable while its source lives", async () => {
    expect.assertions(1);
    const source = signal(1);
    const alive = await survivors(() => {
      let node: Computed<number> | undefined;
      dispose(
        effect(() => {
          untracked(() => {
            node = computed(() => get<number>(source) + 1);
            get(node);
          });
        }),
      );
      return node as object;
    });
    expect(alive).toBeLessThan(10);
  });

  test("an effect a disposed scope created is collectable while its source lives", async () => {
    expect.assertions(1);
    const source = signal(1);
    const alive = await survivors(() => {
      let fn: (() => void) | undefined;
      dispose(
        scope(() => {
          const run = (): void => {
            get(source);
          };
          fn = run;
          effect(run);
        }),
      );
      return fn as object;
    });
    expect(alive).toBeLessThan(10);
  });

  test("a disposed effect's function is collectable while its source lives", async () => {
    expect.assertions(1);
    const source = signal(1);
    const alive = await survivors(() => {
      // A distinct function per effect, each held only by it
      const fn = (): void => {
        get(source);
      };
      dispose(effect(fn));
      return fn;
    });
    expect(alive).toBeLessThan(10);
  });
});

/**
 * The two ways to write a changed array: `trigger` after an in-place push, and the oracle, a `set`
 * of a copy (a value no reader has seen). Tests run per write against one expected outcome.
 */
const WRITES: [name: string, write: (s: Signal<number[]>, x: number) => void][] = [
  [
    "trigger",
    (s, x) => {
      s.v.push(x);
      trigger(s);
    },
  ],
  [
    "set of a copy",
    (s, x) => {
      set(s, [...s.v, x]);
    },
  ],
];

describe("trigger", () => {
  describe("direct readers", () => {
    test.each(WRITES)("an effect runs again and sees the new contents (%s)", (_name, write) => {
      expect.assertions(1);
      const source = signal([1]);
      const seen: number[][] = [];
      effect(() => {
        seen.push([...get(source)]);
      });
      write(source, 2);
      write(source, 3);
      expect(seen).toEqual([[1], [1, 2], [1, 2, 3]]);
    });

    test.each(WRITES)("every reader runs again (%s)", (_name, write) => {
      expect.assertions(1);
      const source = signal([1]);
      const runs = [0, 0, 0];
      for (const index of runs.keys()) {
        effect(() => {
          runs[index]++;
          get(source);
        });
      }
      write(source, 2);
      expect(runs).toEqual([2, 2, 2]);
    });

    test("a trigger without a change still runs the readers: nothing is compared", () => {
      expect.assertions(1);
      const source = signal([1]);
      let runs = 0;
      effect(() => {
        runs++;
        get(source);
      });
      trigger(source);
      expect(runs).toBe(2);
    });

    test("a signal holding undefined runs its readers", () => {
      expect.assertions(1);
      // oxlint-disable-next-line unicorn/no-useless-undefined -- the value under test
      const source = signal<number[] | undefined>(undefined);
      let runs = 0;
      effect(() => {
        runs++;
        get(source);
      });
      trigger(source);
      expect(runs).toBe(2);
    });

    test("the signal keeps its value", () => {
      expect.assertions(1);
      const value = [1];
      const source = signal(value);
      effect(() => {
        get(source);
      });
      trigger(source);
      expect(source.v).toBe(value);
    });

    test("a signal with no readers keeps its value, in a batch too", () => {
      expect.assertions(1);
      const value = [1];
      const source = signal(value);
      trigger(source);
      batch(() => {
        trigger(source);
      });
      expect(source.v).toBe(value);
    });

    test("an effect reads the same reference again", () => {
      expect.assertions(2);
      const value = [1];
      const source = signal(value);
      const seen: number[][] = [];
      effect(() => {
        seen.push(get(source));
      });
      trigger(source);
      expect(seen).toHaveLength(2);
      expect(seen[1]).toBe(value);
    });

    test("a sub is called again with the same reference", () => {
      expect.assertions(2);
      const value = [1];
      const source = signal(value);
      const seen: number[][] = [];
      sub(source, (got) => {
        seen.push(got);
      });
      trigger(source);
      expect(seen).toHaveLength(2);
      expect(seen[1]).toBe(value);
    });

    test.each(WRITES)(
      "an unobserved computed evaluates again on its next read only (%s)",
      (_name, write) => {
        expect.assertions(3);
        const source = signal([1]);
        let evaluations = 0;
        const length = computed(() => {
          evaluations++;
          return get(source).length;
        });
        get(length);
        write(source, 2);
        expect(evaluations).toBe(1);
        expect(get(length)).toBe(2);
        expect(evaluations).toBe(2);
      },
    );

    test.each(WRITES)(
      "an observed computed evaluates once and its effect runs again (%s)",
      (_name, write) => {
        expect.assertions(2);
        const source = signal([1]);
        let evaluations = 0;
        const length = computed(() => {
          evaluations++;
          return get(source).length;
        });
        const seen: number[] = [];
        effect(() => {
          seen.push(get(length));
        });
        write(source, 2);
        expect(seen).toEqual([1, 2]);
        expect(evaluations).toBe(2);
      },
    );

    test("an untracked read is not triggered", () => {
      expect.assertions(1);
      const source = signal([1]);
      let runs = 0;
      effect(() => {
        runs++;
        untracked(() => get(source));
      });
      trigger(source);
      expect(runs).toBe(1);
    });

    test("a signal whose only reader was disposed runs nothing", () => {
      expect.assertions(1);
      const source = signal([1]);
      let runs = 0;
      const handle = effect(() => {
        runs++;
        get(source);
      });
      dispose(handle);
      trigger(source);
      expect(runs).toBe(1);
    });

    test.each(WRITES)("a reader's throw reaches the writer (%s)", (_name, write) => {
      expect.assertions(1);
      const source = signal([1]);
      effect(() => {
        if (get(source).length === 2) throw new Error("two");
      });
      expect(() => {
        write(source, 2);
      }).toThrow("two");
    });

    test.each(WRITES)("a reader that threw runs again on the next write (%s)", (_name, write) => {
      expect.assertions(1);
      const source = signal([1]);
      const seen: number[] = [];
      effect(() => {
        const { length } = get(source);
        seen.push(length);
        if (length === 2) throw new Error("two");
      });
      thrownBy(() => {
        write(source, 2);
      });
      write(source, 3);
      expect(seen).toEqual([1, 2, 3]);
    });
  });

  // Documented: a trigger reaches direct readers only (a set of a copy goes through)
  describe("shallow: a computed that returns the same reference stops it", () => {
    test("a pass-through computed evaluates again, but its effect does not run", () => {
      expect.assertions(2);
      const source = signal([1]);
      let evaluations = 0;
      const same = computed(() => {
        evaluations++;
        return get(source);
      });
      let runs = 0;
      effect(() => {
        runs++;
        get(same);
      });
      trigger(source);
      expect(evaluations).toBe(2);
      expect(runs).toBe(1);
    });

    test("a sub on a pass-through computed is not called", () => {
      expect.assertions(1);
      const source = signal([1]);
      let calls = 0;
      sub(
        computed(() => get(source)),
        () => {
          calls++;
        },
      );
      trigger(source);
      expect(calls).toBe(1);
    });
  });

  describe("batches", () => {
    test.each(WRITES)("a batch's writes run the readers once (%s)", (_name, write) => {
      expect.assertions(1);
      const source = signal([1]);
      const seen: number[][] = [];
      effect(() => {
        seen.push([...get(source)]);
      });
      batch(() => {
        write(source, 2);
        write(source, 3);
      });
      expect(seen).toEqual([[1], [1, 2, 3]]);
    });

    test.each(WRITES)("each write outside a batch runs the readers (%s)", (_name, write) => {
      expect.assertions(1);
      const source = signal([1]);
      let runs = 0;
      effect(() => {
        runs++;
        get(source);
      });
      write(source, 2);
      write(source, 3);
      write(source, 4);
      expect(runs).toBe(4);
    });

    test("a trigger, then a set: one run, with the set value", () => {
      expect.assertions(1);
      const source = signal([1]);
      const seen: number[][] = [];
      effect(() => {
        seen.push([...get(source)]);
      });
      batch(() => {
        trigger(source);
        set(source, [7]);
      });
      expect(seen).toEqual([[1], [7]]);
    });

    test("a trigger, then a set of the same reference: one run", () => {
      expect.assertions(1);
      const source = signal([1]);
      const seen: number[][] = [];
      effect(() => {
        seen.push([...get(source)]);
      });
      batch(() => {
        source.v.push(2);
        trigger(source);
        set(source, source.v);
      });
      expect(seen).toEqual([[1], [1, 2]]);
    });

    test("a set, then a trigger: one run, with the set value changed", () => {
      expect.assertions(1);
      const source = signal([1]);
      const seen: number[][] = [];
      effect(() => {
        seen.push([...get(source)]);
      });
      batch(() => {
        set(source, [7]);
        source.v.push(8);
        trigger(source);
      });
      expect(seen).toEqual([[1], [7, 8]]);
    });

    test.each(WRITES)(
      "it reaches a reader that an earlier write in the batch marked and undid (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const offset = signal(0);
        const sum = computed(() => get(source).length + get(offset));
        const seen: number[] = [];
        effect(() => {
          seen.push(get(sum));
        });
        batch(() => {
          // Marks sum and leaves offset as sum read it: the trigger's mark stops at sum
          set(offset, 1);
          set(offset, 0);
          write(source, 2);
        });
        expect(seen).toEqual([1, 2]);
      },
    );

    test("Accepted tradeoff: a trigger, then a set back to the value the readers read, in one batch, still runs them", () => {
      expect.assertions(2);
      const value = [1];
      const source = signal(value);
      let runs = 0;
      effect(() => {
        runs++;
        get(source);
      });
      // The model: a set of an unseen value, then back, runs nothing
      batch(() => {
        set(source, [5]);
        set(source, value);
      });
      expect(runs).toBe(1);
      batch(() => {
        const other = [5];
        set(source, other);
        other.push(6);
        trigger(source);
        set(source, value);
      });
      // A trigger forgets every record, also one of a value the signal no longer holds
      expect(runs).toBe(2);
    });
  });

  describe("writes during runs, cleanups and owners", () => {
    test.each(WRITES)("in a scope's body a write runs its readers at once (%s)", (_name, write) => {
      expect.assertions(1);
      const source = signal([1]);
      const seen: number[] = [];
      scope(() => {
        effect(() => {
          seen.push(get(source).length);
        });
        write(source, 2);
        expect(seen).toEqual([1, 2]);
      });
    });

    test.each(WRITES)(
      "an effect that writes its own dep on its first run does not run again for it (%s)",
      (_name, write) => {
        expect.assertions(2);
        const source = signal([1]);
        const seen: number[] = [];
        effect(() => {
          seen.push(get(source).length);
          if (seen.length === 1) write(source, 2);
        });
        expect(seen).toEqual([1]);
        expect(source.v).toEqual([1, 2]);
      },
    );

    test.each(WRITES)(
      "an effect that wrote its own dep runs again on its next check (%s)",
      (_name, write) => {
        expect.assertions(2);
        const source = signal([1]);
        const level = signal(1);
        const positive = computed(() => get(level) > 0);
        const seen: number[] = [];
        effect(() => {
          seen.push(get(source).length);
          get(positive);
          if (seen.length === 1) write(source, 2);
        });
        // positive stays true: only the stale record of source runs it again
        set(level, 2);
        expect(seen).toEqual([1, 2]);
        set(level, 3);
        expect(seen).toEqual([1, 2]);
      },
    );

    test.each(WRITES)(
      "an effect that writes its own dep on a re-run does not run again for it (%s)",
      (_name, write) => {
        expect.assertions(2);
        const source = signal([1]);
        const level = signal(1);
        const positive = computed(() => get(level) > 0);
        const seen: number[] = [];
        effect(() => {
          seen.push(get(source).length);
          get(positive);
          if (seen.length === 2) write(source, 3);
        });
        write(source, 2);
        expect(seen).toEqual([1, 2]);
        set(level, 2);
        expect(seen).toEqual([1, 2, 3]);
      },
    );

    test.each(WRITES)(
      "a run that reads, writes and reads again sees the write and runs again on its next check (%s)",
      (_name, write) => {
        expect.assertions(2);
        const source = signal([1]);
        const level = signal(1);
        const positive = computed(() => get(level) > 0);
        const seen: number[][] = [];
        effect(() => {
          const before = get(source).length;
          if (seen.length === 0) write(source, 2);
          seen.push([before, get(source).length]);
          get(positive);
        });
        expect(seen).toEqual([[1, 2]]);
        set(level, 2);
        expect(seen).toEqual([
          [1, 2],
          [2, 2],
        ]);
      },
    );

    test.each(WRITES)(
      "a sub that writes its own source is called again until it stops (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([0]);
        const seen: number[] = [];
        sub(source, (value) => {
          seen.push(value.length);
          // Bounded: a write on every call never settles
          if (value.length < 4) write(source, value.length);
        });
        expect(seen).toEqual([1, 2, 3, 4]);
      },
    );

    test("a sub that triggers its own source gets the same reference each call", () => {
      expect.assertions(2);
      const value = [0];
      const source = signal(value);
      const seen: number[][] = [];
      sub(source, (got) => {
        seen.push(got);
        if (seen.length < 3) trigger(source);
      });
      expect(seen).toHaveLength(3);
      expect(seen.filter((got) => got !== value)).toEqual([]);
    });

    test.each(WRITES)(
      "an effect's write reaches another effect in the same flush (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const input = signal(0);
        const log: string[] = [];
        effect(() => {
          log.push(`reader ${get(source).length}`);
        });
        effect(() => {
          if (get(input) > 0) write(source, get(input));
          log.push(`writer ${get(input)}`);
        });
        set(input, 1);
        expect(log).toEqual(["reader 1", "writer 0", "writer 1", "reader 2"]);
      },
    );

    test.each(WRITES)(
      "a cleanup's write during a re-run runs the other readers after it (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const input = signal(0);
        const log: string[] = [];
        effect(() => {
          log.push(`reader ${get(source).length}`);
        });
        effect(() => {
          log.push(`owner ${get(input)}`);
          return () => {
            write(source, 9);
          };
        });
        set(input, 1);
        expect(log).toEqual(["reader 1", "owner 0", "owner 1", "reader 2"]);
      },
    );

    test.each(WRITES)(
      "an effect whose own cleanup writes its dep runs once more (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const input = signal(0);
        const seen: number[] = [];
        let cleanups = 0;
        effect(() => {
          seen.push(get(source).length);
          get(input);
          return () => {
            if (cleanups++ === 0) write(source, 2);
          };
        });
        set(input, 1);
        expect(seen).toEqual([1, 2]);
      },
    );

    test.each(WRITES)(
      "an effect that ran after its own cleanup's write is current (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const level = signal(1);
        const positive = computed(() => get(level) > 0);
        const seen: number[] = [];
        let cleanups = 0;
        effect(() => {
          seen.push(get(source).length);
          get(positive);
          return () => {
            if (cleanups++ === 0) write(source, 2);
          };
        });
        write(source, 5);
        // positive stays true: a stale record of source would run it again
        set(level, 2);
        expect(seen).toEqual([1, 3]);
      },
    );

    test.each(WRITES)(
      "a cleanup's write during dispose runs the other readers, not the disposed one (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const log: string[] = [];
        effect(() => {
          log.push(`reader ${get(source).length}`);
        });
        const handle = effect(() => {
          log.push(`disposed ${get(source).length}`);
          return () => {
            write(source, 2);
          };
        });
        dispose(handle);
        expect(log).toEqual(["reader 1", "disposed 1", "reader 2"]);
      },
    );

    test.each(WRITES)(
      "a parent that read the signal before making its child runs first and disposes it (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const log: string[] = [];
        effect(() => {
          log.push(`parent ${get(source).length}`);
          effect(() => {
            log.push(`child ${get(source).length}`);
            return () => {
              log.push("child cleanup");
            };
          });
        });
        write(source, 2);
        expect(log).toEqual(["parent 1", "child 1", "child cleanup", "parent 2", "child 2"]);
      },
    );

    test.each(WRITES)(
      "a parent that read the signal after making its child runs first and disposes it (%s)",
      (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const log: string[] = [];
        effect(() => {
          effect(() => {
            log.push(`child ${get(source).length}`);
            return () => {
              log.push("child cleanup");
            };
          });
          log.push(`parent ${get(source).length}`);
        });
        write(source, 2);
        expect(log).toEqual(["child 1", "parent 1", "child cleanup", "child 2", "parent 2"]);
      },
    );
  });

  // Unsupported (documented): a list keeps the array it rendered and diffs by identity
  describe("a list's items pushed in place, then triggered", () => {
    interface Item {
      readonly id: string;
    }
    /** A list of a, b in a detached ul, wired as sub(items, list(...)). */
    const mount = (): { items: Signal<Item[]>; text: () => string } => {
      const ul = document.createElement("ul");
      const items = signal<Item[]>([{ id: "a" }, { id: "b" }]);
      sub(
        items,
        list(ul, "id", (item: Item) => {
          const li = document.createElement("li");
          li.textContent = item.id;
          return li;
        }),
      );
      return { items, text: () => [...ul.children].map((li) => li.textContent).join("") };
    };

    test.if(DEV)("dev: the trigger throws the list guard's error", () => {
      expect.assertions(1);
      const { items } = mount();
      items.v.push({ id: "c" });
      expect(() => {
        trigger(items);
      }).toThrow(/^stage1: a list's items array was changed in place/u);
    });

    test.if(!DEV)("Characterization (production): no row is added", () => {
      expect.assertions(1);
      const { items, text } = mount();
      items.v.push({ id: "c" });
      trigger(items);
      expect(text()).toBe("ab");
    });

    test.if(!DEV)("Characterization (production): a later copy adds no row either", () => {
      expect.assertions(1);
      const { items, text } = mount();
      items.v.push({ id: "c" });
      trigger(items);
      set(items, [...items.v]);
      expect(text()).toBe("ab");
    });

    test.if(!DEV)("Characterization (production): a later removal of the item throws", () => {
      expect.assertions(1);
      const { items } = mount();
      items.v.push({ id: "c" });
      trigger(items);
      expect(() => {
        set(
          items,
          items.v.filter((item) => item.id !== "c"),
        );
      }).toThrow(TypeError);
    });
  });
});

// Definite misuse throws in dev builds; production behaviour is unspecified (and free)
describe.if(DEV)("dev checks", () => {
  test("a write inside a computed's getter throws on read", () => {
    expect.assertions(1);
    const source = signal(0);
    const other = signal(0);
    const node = computed(() => {
      set(other, 1);
      return get<number>(source);
    });
    expect(() => get(node)).toThrow();
  });

  test("a dispose inside a computed's getter throws on read", () => {
    expect.assertions(1);
    const handle = effect(() => {});
    const node = computed(() => {
      dispose(handle);
      return 0;
    });
    expect(() => get(node)).toThrow();
  });

  test("creating an effect inside a computed's getter throws on read", () => {
    expect.assertions(1);
    const node = computed(() => {
      effect(() => {});
      return 0;
    });
    expect(() => get(node)).toThrow();
  });

  test("creating a computed inside a computed's getter throws on read", () => {
    expect.assertions(1);
    const node = computed(() => {
      computed(() => 1);
      return 0;
    });
    expect(() => get(node)).toThrow();
  });

  test("creating a scope inside a computed's getter throws on read", () => {
    expect.assertions(1);
    const node = computed(() => {
      scope(() => {});
      return 0;
    });
    expect(() => get(node)).toThrow();
  });

  test("a cycle between two computeds throws on read, not by overflowing the stack", () => {
    expect.assertions(2);
    const tick = bound();
    const first: Computed<number> = computed((): number => {
      tick();
      // oxlint-disable-next-line no-use-before-define -- the cycle under test
      return get<number>(second) + 1;
    });
    const second = computed((): number => {
      tick();
      return get<number>(first) + 1;
    });
    let error: unknown;
    try {
      get(first);
    } catch (error_) {
      error = error_;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof RangeError || (error as Error).message === "runaway").toBe(false);
  });

  test("an effect whose function returns a non-function throws", () => {
    expect.assertions(1);
    expect(() => effect((() => 1) as never)).toThrow();
  });

  test("an async effect function throws (it returns a promise)", () => {
    expect.assertions(1);
    expect(() => effect((async () => {}) as never)).toThrow();
  });

  test.serial("disposing a computed an effect still reads warns", () => {
    expect.assertions(1);
    const source = signal(0);
    const node = computed(() => get<number>(source) + 1);
    const handle = effect(() => {
      get(node);
    });
    const calls = warnings(() => {
      dispose(node);
    });
    dispose(handle);
    expect(calls).toBeGreaterThan(0);
  });

  test.serial("a throwing cleanup is logged with its error", () => {
    expect.assertions(1);
    using spy = spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("cleanup");
    dispose(
      effect(() => () => {
        throw error;
      }),
    );
    expect(spy.mock.calls).toEqual([["stage1: a cleanup threw", error]]);
  });

  test("creating a sub inside a computed's getter throws on read, naming sub", () => {
    expect.assertions(1);
    const node = computed(() => {
      sub(signal(0), () => {});
      return 0;
    });
    expect(() => get(node)).toThrow(
      /^stage1: effect, sub, computed, scope, or defer inside a computed$/u,
    );
  });

  test("a sub made inside untracked inside a computed's getter throws on read", () => {
    expect.assertions(1);
    const node = computed(() => {
      untracked(() => sub(signal(0), () => {}));
      return 0;
    });
    expect(() => get(node)).toThrow(/^stage1: /u);
  });

  test("a sub that writes a new value to its signal on every call throws instead of looping", () => {
    expect.assertions(1);
    const s = signal(0);
    let calls = 0;
    expect(() =>
      sub(s, (value) => {
        // Above the dev bound: without it, the loop ends here with the wrong error, not a hang
        if (++calls > 2_000_000) throw new Error("runaway");
        set(s, value + 1);
      }),
    ).toThrow(/^stage1: cycle: a flush ran effects and subs a million times$/u);
  });

  test("after a write loop throws, a later write runs its effects again", () => {
    expect.assertions(2);
    const a = signal(0);
    const b = signal(0);
    const on = signal(false);
    let runs = 0;
    const root = scope(() => {
      effect(() => {
        // Once, above the dev bound: without it, the loop ends here with the wrong error
        if (++runs === 2_000_000) throw new Error("runaway");
        set(b, get(a));
      });
      effect(() => {
        if (get(on)) set(a, get(b) + 1);
      });
    });
    const error = thrownBy(() => {
      set(on, true);
    });
    set(on, false);
    set(a, 7);
    const seen = get(b);
    dispose(root);
    expect(String(error)).toStartWith("Error: stage1: ");
    expect(seen).toBe(7);
  });

  test("a trigger inside a computed's getter throws on read", () => {
    expect.assertions(1);
    const source = signal([1]);
    const node = computed(() => {
      trigger(source);
      return 0;
    });
    expect(() => get(node)).toThrow(/^stage1: trigger inside a computed$/u);
  });

  test("a trigger inside a computed's getter leaves the signal's value as it was", () => {
    expect.assertions(1);
    const value = [1];
    const source = signal(value);
    thrownBy(() => {
      get(
        computed(() => {
          trigger(source);
          return 0;
        }),
      );
    });
    expect(source.v).toBe(value);
  });

  test("a trigger inside a computed's getter leaves the signal's readers current", () => {
    expect.assertions(1);
    const source = signal([1]);
    const level = signal(1);
    const positive = computed(() => get(level) > 0);
    let runs = 0;
    effect(() => {
      runs++;
      get(source);
      get(positive);
    });
    thrownBy(() => {
      get(
        computed(() => {
          trigger(source);
          return 0;
        }),
      );
    });
    // `positive` stays true: only a reader's link to `source` voided by the throw runs it again
    set(level, 2);
    expect(runs).toBe(1);
  });

  test("after a trigger inside a computed's getter threw, a trigger still runs the readers", () => {
    expect.assertions(1);
    const source = signal([1]);
    let runs = 0;
    effect(() => {
      runs++;
      get(source);
    });
    thrownBy(() => {
      get(
        computed(() => {
          trigger(source);
          return 0;
        }),
      );
    });
    trigger(source);
    expect(runs).toBe(2);
  });
});
