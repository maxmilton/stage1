// The signal core's contract: ordering, ownership, teardown order, keep-alive computeds,
// consistency, batches, writes in effects, errors, disposal, depth, memory and dev checks. Run in
// both modes: `bun test` (dev checks on) and `NODE_ENV=production bun test` (the dev checks group
// skips; the cleanup-error tests expect each mode's own outcome).
// Callbacks under test branch on the value they receive.
// oxlint-disable vitest/no-conditional-in-test

import { describe, expect, spyOn, test } from "bun:test";
import {
  batch,
  type Computed,
  computed,
  defer,
  dispose,
  type Effect,
  effect,
  get,
  type Scope,
  scope,
  set,
  type Signal,
  signal,
  untracked,
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

/** The effect a user writes for a static subscription: the callback runs untracked (but owned). */
const sub = <T>(source: Signal<T> | Computed<T>, fn: (value: T) => void): Effect =>
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
    const handle = sub<number>(source, (value) => {
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
    const handle = sub(source, () => {
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
    const trigger = signal(0);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const round = get<number>(trigger);
      untracked(() => {
        effect(() => {
          seen.push(`child ${round} sees ${get<number>(source)}`);
        });
      });
    });
    set(trigger, 1);
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
    const trigger = signal(0);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const round = get<number>(trigger);
      scope(() => {
        effect(() => {
          seen.push(`effect ${round} sees ${get<number>(source)}`);
        });
        defer(() => {
          seen.push(`scope ${round} cleanup`);
        });
      });
    });
    set(trigger, 1);
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
    const trigger = signal(0);
    let calls = 0;
    let inner!: Scope;
    const handle = effect(() => {
      get(trigger);
      inner = scope(() => {
        defer(() => {
          calls++;
        });
      });
    });
    dispose(inner);
    dispose(inner);
    // The re-run disposes the disposed scope again and makes a new one, which the last dispose() disposes
    set(trigger, 1);
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
      const owner = scope(() => {
        get(computed(() => 1));
      });
      set(source, 1);
      dispose(handle);
      dispose(owner);
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
    const trigger = signal(0);
    const handle = effect(() => {
      get(trigger);
      body("rerun");
    });
    set(trigger, 1);
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
    const handle = sub<number>(parity, (value) => {
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
    const handle = sub(source, () => {
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
    const handle = sub(source, () => {
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
    const handle = sub(source, () => {
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
    const handle = sub(source, () => {
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
    const listener = sub<number>(left, (value) => {
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

  test("a batch body runs before what it deferred", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = sub<number>(source, (value) => {
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
    const listener = sub(source, () => {
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
    const handle = sub<number>(source, (value) => {
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
    const handle = sub<number>(source, (value) => {
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
      handle = sub<number>(source, (value) => {
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
    const watcher = sub(source, () => {});
    const seen: number[] = [];
    let handle!: Effect;
    batch(() => {
      set(source, 1);
      handle = sub<number>(source, (value) => {
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
    const first = sub<number>(source, (value) => {
      firstSeen.push(value);
    });
    const writer = sub<number>(source, (value) => {
      if (value === 1) set(source, 2);
    });
    const last = sub<number>(source, (value) => {
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
      sub<number>(go, (value) => {
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
    const trigger = signal(0);
    const bad = effect(() => {
      if (get<number>(trigger) === 1) throw new Error("other");
    });
    // Whether the new effect stays live then is unspecified (only a failed first run is pinned)
    expect(() => {
      effect(() => {
        set(trigger, 1);
      });
    }).toThrow("other");
    dispose(bad);
  });

  test("a userland sub whose first call throws is not subscribed", () => {
    expect.assertions(2);
    const source = signal(0);
    let calls = 0;
    expect(() => {
      sub(source, () => {
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
    const bad = sub<number>(source, (value) => {
      if (value === 1) throw new Error("sub");
    });
    const good = sub<number>(source, (value) => {
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
    handles.push(sub(source, disposer(1)), sub(source, disposer(0)));
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
    const trigger = signal(0);
    const handles: Effect[] = [];
    const refs: WeakRef<object>[] = [];
    for (let index = 0; index < 20; index++) {
      handles.push(
        effect(() => {
          const round = get<number>(trigger);
          const node = computed(() => get<number>(source) + 1);
          get(node);
          if (round === 0) refs.push(new WeakRef(node));
        }),
      );
    }
    set(trigger, 1);
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
});
