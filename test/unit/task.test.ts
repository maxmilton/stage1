// What task promises (src/task.ts: header comment and JSDoc; README "Async data"). Loads are
// settled by hand; `after` waits for the callbacks chained on a load's promise. bun test fails the
// running test on an unhandled rejection (Bun 1.4.4), so every test also checks that it leaves
// none; whether a reader's throw is reported as one is observed in a subprocess
// (test/fixtures/reader-error.ts). Run in both modes: `bun test` (development checks on) and
// `NODE_ENV=production bun test`.
// Loaders and readers under test branch on what they get, and status narrows the state:
// oxlint-disable vitest/no-conditional-in-test

import { describe, expect, expectTypeOf, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  computed,
  defer,
  dispose,
  effect,
  get,
  scope,
  set,
  type Signal,
  signal,
} from "../../src/signal.ts";
import { type Task, task, type TaskState, TaskStatus, WAIT } from "../../src/task.ts";
import { after, Caught, loader, noop, report } from "../fixtures/async.ts";

// oxlint-disable-next-line node/no-process-env
const DEV = process.env.NODE_ENV !== "production";

/** A state's status as a reader names it, by comparing it to TaskStatus's members. */
const named = (s: TaskState<unknown>): string => {
  if (s.status === TaskStatus.Pending) return "pending";
  return s.status === TaskStatus.Ready ? "ready" : "error";
};

describe("task", () => {
  /** What `fn` makes in a scope of its own; disposed at the end of the block (`using`). */
  const own = <T>(fn: () => T): { r: T } & Disposable => {
    let r!: T;
    const sc = scope(() => {
      r = fn();
    });
    return {
      r,
      [Symbol.dispose]: () => {
        dispose(sc);
      },
    };
  };

  /** Each state a reader effect of `t` sees, as "status:value". */
  const seen = (t: Signal<TaskState<unknown>>): string[] => {
    const log: string[] = [];
    effect(() => {
      const s = get(t);
      log.push(`${named(s)}:${String(s.value)}`);
    });
    return log;
  };

  /** A task with the abort header comment's pattern: abort in a `defer`, only while pending. */
  const abortable = (
    load: (id: number, signal?: AbortSignal) => Promise<string>,
    id: Signal<number>,
  ): Signal<TaskState<string>> => {
    // oxlint-disable-next-line oxclippy/let-and-return -- the binding is the self-reference
    const user: Signal<TaskState<string>> = task(() => {
      const ac = new AbortController();
      defer(() => {
        if (user.v.status === TaskStatus.Pending) ac.abort();
      });
      return load(get(id), ac.signal);
    });
    return user;
  };

  test("a first load is pending with no value", () => {
    expect.assertions(1);
    const l = loader<number, string>();
    using t = own(() => task(() => l.load(1)));
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: undefined });
  });

  test("a resolved load is ready with its value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    using t = own(() => task(() => l.load(1)));
    await l.calls[0].resolve("a");
    expect(t.r.v).toEqual({ status: TaskStatus.Ready, value: "a" });
  });

  test("a rejected load is an error with its reason and no value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const boom = new Error("x");
    using t = own(() => task(() => l.load(1)));
    await l.calls[0].reject(boom);
    expect(t.r.v).toEqual({ status: TaskStatus.Error, value: undefined, error: boom });
  });

  test("a reader comparing status to TaskStatus's members tells the states apart", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => {
      const u = task(() => l.load(get(id)));
      const log: string[] = [];
      effect(() => {
        log.push(named(get(u)));
      });
      return log;
    });
    await l.calls[0].resolve("a");
    set(id, 2);
    await l.calls[1].reject(new Error("x"));
    expect(t.r).toEqual(["pending", "ready", "pending", "error"]);
  });

  test("a new load keeps the last value while pending", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => task(() => l.load(get(id))));
    await l.calls[0].resolve("a");
    set(id, 2);
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: "a" });
  });

  test("a rejection keeps the last value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => task(() => l.load(get(id))));
    await l.calls[0].resolve("a");
    set(id, 2);
    await l.calls[1].reject(new Error("x"));
    expect(t.r.v.value).toBe("a");
  });

  test("a synchronous throw keeps the last value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() =>
      task(() => {
        const key = get(id);
        if (key === 2) throw new Error("bad");
        return l.load(key);
      }),
    );
    await l.calls[0].resolve("a");
    set(id, 2);
    expect(t.r.v.value).toBe("a");
  });

  test("a plain value lands at once, with no pending state", () => {
    expect.assertions(1);
    using t = own(() => seen(task(() => 1)));
    expect(t.r).toEqual(["ready:1"]);
  });

  test("a thenable that is not a promise lands when it calls back", () => {
    expect.assertions(1);
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable -- a thenable that is no promise is the input
      then: (ok: (value: number) => void) => {
        ok(1);
      },
    } as PromiseLike<number>;
    using t = own(() => task(() => thenable));
    expect(t.r.v).toEqual({ status: TaskStatus.Ready, value: 1 });
  });

  test("a synchronous throw becomes the error state", () => {
    expect.assertions(1);
    const boom = new Error("bad");
    using t = own(() =>
      task(() => {
        throw boom;
      }),
    );
    expect(t.r.v).toEqual({ status: TaskStatus.Error, value: undefined, error: boom });
  });

  test("a task whose load threw synchronously reloads when its input changes", () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(0);
    using _ = own(() =>
      task(() => {
        const key = get(id);
        if (key === 0) throw new Error("bad");
        return l.load(key);
      }),
    );
    set(id, 1);
    expect(l.calls.map((c) => c.arg)).toEqual([1]);
  });

  test("a load superseded while pending never lands", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => task(() => l.load(get(id))));
    set(id, 2);
    await l.calls[0].resolve("a");
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: undefined });
  });

  test("a superseded load resolving after the latest leaves the latest's value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => task(() => l.load(get(id))));
    set(id, 2);
    await l.calls[1].resolve("b");
    await l.calls[0].resolve("a");
    expect(t.r.v).toEqual({ status: TaskStatus.Ready, value: "b" });
  });

  test("a superseded load's rejection never lands", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => task(() => l.load(get(id))));
    set(id, 2);
    await l.calls[0].reject(new Error("x"));
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: undefined });
  });

  test("a load settling after its owner is disposed never lands", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const t = own(() => task(() => l.load(1)));
    t[Symbol.dispose]();
    await l.calls[0].resolve("a");
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: undefined });
  });

  test("a local set wins over the load in flight", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    using t = own(() => task(() => l.load(1)));
    set(t.r, { status: TaskStatus.Ready, value: "local" });
    await l.calls[0].resolve("a");
    expect(t.r.v).toEqual({ status: TaskStatus.Ready, value: "local" });
  });

  test("a local set wins over a rejection in flight", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    using t = own(() => task(() => l.load(1)));
    set(t.r, { status: TaskStatus.Ready, value: "local" });
    await l.calls[0].reject(new Error("x"));
    expect(t.r.v).toEqual({ status: TaskStatus.Ready, value: "local" });
  });

  test("a load started after a local set lands", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => task(() => l.load(get(id))));
    set(t.r, { status: TaskStatus.Ready, value: "local" });
    set(id, 2);
    await l.calls[1].resolve("b");
    expect(t.r.v).toEqual({ status: TaskStatus.Ready, value: "b" });
  });

  test("a reader's throw while a load lands is not the task's error", async () => {
    expect.assertions(1);
    const user = Caught.resolve({
      get name(): string {
        throw new Error("reader");
      },
    });
    using t = own(() => {
      const u = task(() => user);
      const el = document.createElement("p");
      effect(() => {
        el.textContent = get(u).value?.name ?? "…";
      });
      return u;
    });
    await after(user);
    expect(t.r.v.status).toBe(TaskStatus.Ready);
  });

  test("a reader's throw while a load lands is reported as an unhandled rejection", async () => {
    expect.assertions(1);
    expect(await report("task")).toBe("Error: reader");
  });

  test("a landing does not run the load again", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    using _ = own(() => task(() => l.load(1)));
    await l.calls[0].resolve("a");
    expect(l.calls).toHaveLength(1);
  });

  test("superseding a pending load does not run its readers", () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => seen(task(() => l.load(get(id)))));
    set(id, 2);
    expect(t.r).toEqual(["pending:undefined"]);
  });

  test("an input read before the first await reloads it when it changes", () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using _ = own(() =>
      task(async () => {
        const key = get(id);
        return `${key}:${await l.load(key)}`;
      }),
    );
    set(id, 2);
    expect(l.calls.map((c) => c.arg)).toEqual([1, 2]);
  });

  test("an input read after an await does not reload it", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using _ = own(() => task(async () => `${await l.load(1)}:${get(id)}`));
    await l.calls[0].resolve("a");
    const loads = l.calls.length;
    set(id, 2);
    expect(l.calls).toHaveLength(loads);
  });

  test("the documented abort aborts a load superseded while pending", () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using _ = own(() => abortable(l.load, id));
    set(id, 2);
    expect(l.calls.map((c) => c.signal?.aborted)).toEqual([true, false]);
  });

  test("the documented abort leaves a settled load alone", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using _ = own(() => abortable(l.load, id));
    await l.calls[0].resolve("a");
    set(id, 2);
    expect(l.calls[0].signal?.aborted).toBe(false);
  });

  test("a tick read in fn loads the same input again", () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const tick = signal(0);
    using _ = own(() =>
      task(() => {
        get(tick);
        return l.load(1);
      }),
    );
    set(tick, tick.v + 1);
    expect(l.calls.map((c) => c.arg)).toEqual([1, 1]);
  });

  /** A task over `id` whose fn, for id 2, writes `local` to its own state and then calls `next`. */
  const selfWriting = (
    load: (id: number) => Promise<string>,
    id: Signal<number>,
    local: TaskState<string>,
    next: () => Promise<string>,
  ): Task<string> => {
    // oxlint-disable-next-line oxclippy/let-and-return -- the binding is the self-reference
    const t: Task<string> = task(() => {
      const key = get(id);
      if (key !== 2) return load(key);
      set(t, local);
      return next();
    });
    return t;
  };

  test("a load after fn writes its own state is pending with the written value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() =>
      selfWriting(l.load, id, { status: TaskStatus.Ready, value: "local" }, () => l.load(2)),
    );
    await l.calls[0].resolve("a");
    set(id, 2);
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: "local" });
  });

  test("a rejection after fn writes its own pending state keeps the written value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() =>
      selfWriting(l.load, id, { status: TaskStatus.Pending, value: "local" }, () => l.load(2)),
    );
    await l.calls[0].resolve("a");
    set(id, 2);
    await l.calls[1].reject(new Error("x"));
    expect(t.r.v.value).toBe("local");
  });

  test("a synchronous throw after fn writes its own state keeps the written value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    const boom = new Error("bad");
    using t = own(() =>
      selfWriting(l.load, id, { status: TaskStatus.Ready, value: "local" }, () => {
        throw boom;
      }),
    );
    await l.calls[0].resolve("a");
    set(id, 2);
    expect(t.r.v).toEqual({ status: TaskStatus.Error, value: "local", error: boom });
  });

  test("a first load with a fallback is pending with it", () => {
    expect.assertions(1);
    const l = loader<number, string>();
    using t = own(() => task(() => l.load(1), "none"));
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: "none" });
  });

  test("a null fallback is the value until the first landing", () => {
    expect.assertions(1);
    const l = loader<number, string>();
    using t = own(() => task(() => l.load(1), null));
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: null });
  });

  test("a resolved load replaces the fallback", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    using t = own(() => task(() => l.load(1), "none"));
    await l.calls[0].resolve("a");
    expect(t.r.v).toEqual({ status: TaskStatus.Ready, value: "a" });
  });

  test("a rejection before any value landed keeps the fallback", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const boom = new Error("x");
    using t = own(() => task(() => l.load(1), "none"));
    await l.calls[0].reject(boom);
    expect(t.r.v).toEqual({ status: TaskStatus.Error, value: "none", error: boom });
  });

  test("a plain value with a fallback lands at once, with no pending state", () => {
    expect.assertions(1);
    using t = own(() => seen(task(() => 1, 0)));
    expect(t.r).toEqual(["ready:1"]);
  });

  test("a task that returns WAIT stays pending with its last value", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(1);
    using t = own(() => task(() => (get(id) === 2 ? WAIT : l.load(get(id)))));
    await l.calls[0].resolve("a");
    set(id, 2);
    // Sleeps to show that nothing lands
    await Bun.sleep(0);
    expect(t.r.v).toEqual({ status: TaskStatus.Pending, value: "a" });
  });

  test("a load that supersedes a WAIT lands", async () => {
    expect.assertions(1);
    const l = loader<number, string>();
    const id = signal(0);
    using t = own(() => task(() => (get(id) === 0 ? WAIT : l.load(get(id)))));
    set(id, 1);
    await l.calls[0].resolve("a");
    expect(t.r.v).toEqual({ status: TaskStatus.Ready, value: "a" });
  });

  // Held here, as an app holds a shared one: one only the tasks reached would go with them
  /** One promise that never settles, for the guard below. */
  // oxlint-disable-next-line promise/avoid-new -- a promise that never settles is the input
  const NEVER = new Promise<never>(noop);

  /** How many of 200 tasks that returned `wait`, each disposed with its scope, are reachable. */
  const kept = async (wait: PromiseLike<never>): Promise<number> => {
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < 200; i++) {
      const sc = scope(() => {
        refs.push(new WeakRef(task(() => wait)));
      });
      dispose(sc);
    }
    // A WeakRef keeps its object until the job that made it ends
    await Bun.sleep(0);
    Bun.gc(true);
    return refs.filter((r) => r.deref() !== undefined).length;
  };

  // A bound, not 0: a conservative stack scan can keep a few
  test("tasks disposed while they wait with WAIT can be collected", async () => {
    expect.assertions(1);
    expect(await kept(WAIT)).toBeLessThan(20);
  });

  // Guards the test above: it would see tasks a never-settling promise keeps
  test("tasks disposed while they wait on one never-settling promise stay reachable", async () => {
    expect.assertions(1);
    expect(await kept(NEVER)).toBe(200);
  });

  test("types", () => {
    expect.assertions(0);
    expectTypeOf(task).not.toBeAny();
    expectTypeOf(task).toBeFunction();
    expectTypeOf(task<number>).parameters.toEqualTypeOf<[fn: () => number | PromiseLike<number>]>();
    expectTypeOf(task<number, string>).parameters.toEqualTypeOf<
      [fn: () => number | PromiseLike<number>, fallback: string]
    >();
    // Regression: a Fallback named in the type needs a fallback (else the value is undefined)
    expectTypeOf((load: () => Promise<number>) => {
      // @ts-expect-error - no fallback for a Fallback of number
      const t: Task<number, number> = task(load);
      // @ts-expect-error - no fallback for a Fallback of number
      task<number, number>(load);
      return t;
    }).toBeFunction();
    expectTypeOf(task<number>).returns.toEqualTypeOf<Signal<TaskState<number>>>();
    expectTypeOf(task<number, string>).returns.toEqualTypeOf<Signal<TaskState<number, string>>>();
    // A promise's or a thenable's value, or a plain value, is the state's value
    expectTypeOf(() => task(() => Promise.resolve(1))).returns.toEqualTypeOf<
      Signal<TaskState<number>>
    >();
    expectTypeOf(() => task(() => "a")).returns.toEqualTypeOf<Signal<TaskState<string>>>();
    // WAIT adds nothing to the value: the loader's is the state's
    expectTypeOf((cond: boolean) =>
      task(() => (cond ? WAIT : Promise.resolve(1))),
    ).returns.toEqualTypeOf<Signal<TaskState<number>>>();
    expectTypeOf(WAIT).toEqualTypeOf<Pick<PromiseLike<never>, "then">>();
    // A fallback of the loader's type makes the value exactly that type in every state
    expectTypeOf(() => task(() => Promise.resolve(1), 0)).returns.toEqualTypeOf<
      Signal<TaskState<number, number>>
    >();
    expectTypeOf<TaskState<number, number>["value"]>().toEqualTypeOf<number>();
    expectTypeOf<TaskState<number>["value"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<TaskState<number>>().toEqualTypeOf<
      | { readonly status: TaskStatus.Pending; readonly value: number | undefined }
      | { readonly status: TaskStatus.Ready; readonly value: number }
      | {
          readonly status: TaskStatus.Error;
          readonly value: number | undefined;
          readonly error: unknown;
        }
    >();
    expectTypeOf<TaskState<number, string>>().toEqualTypeOf<
      | { readonly status: TaskStatus.Pending; readonly value: number | string }
      | { readonly status: TaskStatus.Ready; readonly value: number }
      | {
          readonly status: TaskStatus.Error;
          readonly value: number | string;
          readonly error: unknown;
        }
    >();
    // What task returns, by name
    expectTypeOf<Task<number>>().toEqualTypeOf<Signal<TaskState<number>>>();
    expectTypeOf<Task<number, string>>().toEqualTypeOf<Signal<TaskState<number, string>>>();
    // The three members are a status's only values
    expectTypeOf<TaskStatus>().toEqualTypeOf<
      TaskStatus.Pending | TaskStatus.Ready | TaskStatus.Error
    >();
    expectTypeOf((s: TaskState<number>) => {
      // @ts-expect-error - only the error state has an error
      expectTypeOf(s.error).toBeUnknown();
      // @ts-expect-error - a status is a TaskStatus member, not a string
      expectTypeOf(s.status === "ready").toBeBoolean();
      if (s.status === TaskStatus.Ready) expectTypeOf(s.value).toEqualTypeOf<number>();
      else if (s.status === TaskStatus.Error) expectTypeOf(s.error).toBeUnknown();
      else expectTypeOf(s.value).toEqualTypeOf<number | undefined>();
    }).toBeFunction();
  });
});

describe("task: development checks", () => {
  const SELF =
    "stage1: task run inside its own landing, or one it led to; its fn reads the task with get (use .v), or a reader writes what fn reads";
  const CHURN =
    "stage1: 10 tasks in a row, each made inside the landing of the one before; an effect that makes a task reads it (read it in an effect of its own)";

  test.serial.if(DEV)(
    "a task whose fn reads it with get warns once, at its first reload",
    async () => {
      expect.assertions(2);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const id = signal(0);
      const loads: Promise<number>[] = [];
      let t: Signal<TaskState<number>> | undefined;
      const sc = scope(() => {
        t = task(() => {
          get(id);
          if (t !== undefined) get(t);
          // Five landings, then a load that never settles ends the reload loop
          const p =
            loads.length < 5
              ? Promise.resolve(loads.length)
              : Promise.withResolvers<number>().promise;
          loads.push(p);
          return p;
        });
      });
      await after(loads[0]);
      // The first run ran before t was assigned: only a later run reads it
      set(id, 1);
      // oxlint-disable-next-line no-await-in-loop -- each load exists once the one before it lands
      for (let i = 1; i < 5; i++) await after(loads[i]);
      dispose(sc);
      expect(warn.mock.calls).toEqual([[SELF]]);
      expect(loads).toHaveLength(6);
    },
  );

  test.serial.if(DEV)("a reader that writes what fn reads during a landing warns", async () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(noop);
    const page = signal(0);
    const loads: Promise<number>[] = [];
    const sc = scope(() => {
      const t = task(() => {
        const p = Promise.resolve(get(page));
        loads.push(p);
        return p;
      });
      // Loads the next page as each lands, up to page 1
      effect(() => {
        const s = get(t);
        if (s.status === TaskStatus.Ready && s.value < 1) set(page, s.value + 1);
      });
    });
    await after(loads[0]);
    await after(loads[1]);
    dispose(sc);
    expect(warn.mock.calls).toEqual([[SELF]]);
  });

  test.serial.if(DEV)(
    "a task whose fn reads it with get warns when a rejection lands",
    async () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const id = signal(0);
      const loads: Promise<number>[] = [];
      let t: Signal<TaskState<number>> | undefined;
      const sc = scope(() => {
        t = task(() => {
          get(id);
          if (t !== undefined) get(t);
          const p =
            loads.length < 2
              ? Promise.reject(new Error("x"))
              : Promise.withResolvers<number>().promise;
          loads.push(p);
          return p;
        });
      });
      // The first run ran before t was assigned: only a later run reads it
      set(id, 1);
      await after(loads[1]);
      dispose(sc);
      expect(warn.mock.calls).toEqual([[SELF]]);
    },
  );

  test.serial.if(DEV)(
    "a task that reads another re-runs at its landing without warning",
    async () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const user = Promise.resolve(1);
      const sc = scope(() => {
        const u = task(() => user);
        task(() => {
          const v = get(u).value;
          return v === undefined ? Promise.withResolvers<number>().promise : Promise.resolve(v);
        });
      });
      await after(user);
      dispose(sc);
      expect(warn.mock.calls).toEqual([]);
    },
  );

  test.serial.if(DEV)(
    "two tasks whose readers write each other's input warn once each",
    async () => {
      expect.assertions(2);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const a = signal(0);
      const b = signal(0);
      const loads: Promise<number>[] = [];
      const load = (v: number): Promise<number> => {
        // Eight landings, then loads that never settle end the ping-pong
        const p = loads.length < 8 ? Promise.resolve(v) : Promise.withResolvers<number>().promise;
        loads.push(p);
        return p;
      };
      const sc = scope(() => {
        const ta = task(() => load(get(a)));
        const tb = task(() => load(get(b)));
        effect(() => {
          const s = get(ta);
          if (s.status === TaskStatus.Ready) set(b, s.value + 1);
        });
        effect(() => {
          const s = get(tb);
          if (s.status === TaskStatus.Ready) set(a, s.value + 1);
        });
      });
      // oxlint-disable-next-line no-await-in-loop -- each load exists once the one before it lands
      for (let i = 0; i < 8; i++) await after(loads[i]);
      dispose(sc);
      expect(warn.mock.calls).toEqual([[SELF], [SELF]]);
      expect(loads.length).toBeGreaterThan(8);
    },
  );

  test.serial.if(DEV)(
    "a landing that runs another task, whose landing runs nothing back, does not warn",
    async () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const a = signal(0);
      const b = signal(0);
      const loads: Promise<number>[] = [];
      const load = (v: number): Promise<number> => {
        const p = Promise.resolve(v);
        loads.push(p);
        return p;
      };
      const sc = scope(() => {
        const ta = task(() => load(get(a)));
        task(() => load(get(b)));
        effect(() => {
          const s = get(ta);
          if (s.status === TaskStatus.Ready) set(b, s.value + 1);
        });
      });
      set(a, 1);
      // oxlint-disable-next-line no-await-in-loop -- each load exists once the one before it lands
      for (const p of loads) await after(p);
      dispose(sc);
      expect(warn.mock.calls).toEqual([]);
    },
  );

  test.serial.if(DEV)("landings and input changes between them do not warn", async () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(noop);
    const id = signal(0);
    const loads: Promise<number>[] = [];
    const sc = scope(() => {
      const t = task(() => {
        const p = Promise.resolve(get(id));
        loads.push(p);
        return p;
      });
      effect(() => {
        get(t);
      });
    });
    await after(loads[0]);
    set(id, 1);
    await after(loads[1]);
    dispose(sc);
    expect(warn.mock.calls).toEqual([]);
  });

  test.serial.if(DEV)("a reload after a landing whose reader threw does not warn", async () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(noop);
    const id = signal(0);
    const first = Caught.resolve(0) as Caught<number>;
    const sc = scope(() => {
      const t = task(() => (get(id) === 0 ? first : Promise.withResolvers<number>().promise));
      effect(() => {
        if (get(t).status === TaskStatus.Ready) throw new Error("reader");
      });
    });
    await first.rejected;
    set(id, 1);
    dispose(sc);
    expect(warn.mock.calls).toEqual([]);
  });

  test.serial.if(DEV)(
    "an effect that makes a task and reads it warns after 10 landings",
    async () => {
      expect.assertions(2);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const loads: Promise<number>[] = [];
      const sc = scope(() => {
        effect(() => {
          get(
            task(() => {
              // Twelve landings, then a load that never settles ends the loop
              const p =
                loads.length < 12
                  ? Promise.resolve(loads.length)
                  : Promise.withResolvers<number>().promise;
              loads.push(p);
              return p;
            }),
          );
        });
      });
      // oxlint-disable-next-line no-await-in-loop -- each load exists once the one before it lands
      for (let i = 0; i < 12; i++) await after(loads[i]);
      dispose(sc);
      expect(warn.mock.calls).toEqual([[CHURN]]);
      expect(loads).toHaveLength(13);
    },
  );

  test.serial.if(DEV)(
    "a landing that makes one task (a page shown on landing) does not warn",
    async () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const loads: Promise<number>[] = [];
      const load = (): Promise<number> => {
        const p = Promise.resolve(loads.length);
        loads.push(p);
        return p;
      };
      const sc = scope(() => {
        const t = task(load);
        // The details page appears when the list lands and loads its own data
        effect(() => {
          if (get(t).status === TaskStatus.Ready) task(load);
        });
      });
      await after(loads[0]);
      await after(loads[1]);
      dispose(sc);
      expect(warn.mock.calls).toEqual([]);
    },
  );

  // Regression: one count for all landings warned here, at the 10th row
  test.serial.if(DEV)(
    "landings of 10 rows that each make a task (details shown on landing) do not warn",
    async () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const rows = Array.from({ length: 10 }, (_, i) => Promise.resolve(i));
      const sc = scope(() => {
        for (const row of rows) {
          const t = task(() => row);
          effect(() => {
            if (get(t).status === TaskStatus.Ready) {
              task(() => Promise.withResolvers<number>().promise);
            }
          });
        }
      });
      await after(rows[9]);
      dispose(sc);
      expect(warn.mock.calls).toEqual([]);
    },
  );

  // Regression: one count for all landings missed it, reset by every landing that made no task
  test.serial.if(DEV)(
    "an effect that makes a task and reads it warns though other landings come between",
    async () => {
      expect.assertions(2);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      const loads: Promise<number>[] = [];
      const sc = scope(() => {
        effect(() => {
          // Lands before the task the effect reads, each time; its reader makes no task
          const side = task(() => Promise.resolve(0));
          effect(() => {
            get(side);
          });
          get(
            task(() => {
              const p =
                loads.length < 12
                  ? Promise.resolve(loads.length)
                  : Promise.withResolvers<number>().promise;
              loads.push(p);
              return p;
            }),
          );
        });
      });
      // oxlint-disable-next-line no-await-in-loop -- each load exists once the one before it lands
      for (let i = 0; i < 12; i++) await after(loads[i]);
      dispose(sc);
      expect(warn.mock.calls).toEqual([[CHURN]]);
      expect(loads).toHaveLength(13);
    },
  );

  test.serial.if(DEV)(
    "an effect that makes a task and reads it warns though it first makes one that lands at once",
    async () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(noop);
      // Its landing runs inside the landing that made it
      const now = {
        // oxlint-disable-next-line unicorn/no-thenable -- a thenable that calls back at once
        then: (ok: (value: number) => void) => {
          ok(0);
        },
      } as PromiseLike<number>;
      const loads: Promise<number>[] = [];
      const sc = scope(() => {
        effect(() => {
          task(() => now);
          get(
            task(() => {
              const p =
                loads.length < 12
                  ? Promise.resolve(loads.length)
                  : Promise.withResolvers<number>().promise;
              loads.push(p);
              return p;
            }),
          );
        });
      });
      // oxlint-disable-next-line no-await-in-loop -- each load exists once the one before it lands
      for (let i = 0; i < 12; i++) await after(loads[i]);
      dispose(sc);
      expect(warn.mock.calls).toEqual([[CHURN]]);
    },
  );

  test.if(DEV)("a stage1 development error thrown in fn is rethrown, not the error state", () => {
    expect.assertions(1);
    const c = computed(() => 1);
    dispose(c);
    expect(() =>
      scope(() => {
        task(() => get(c));
      }),
    ).toThrow("stage1: get of a disposed computed");
  });

  test.if(DEV)(
    "a stage1 development error a load rejects with is rethrown, not the error state",
    async () => {
      expect.assertions(2);
      const error = new Error("stage1: get of a disposed computed");
      const load = Caught.reject(error) as Caught<number>;
      let t!: Signal<TaskState<number>>;
      const sc = scope(() => {
        t = task(() => load);
      });
      const rethrown = await load.rejected;
      dispose(sc);
      expect(rethrown).toBe(error);
      expect(t.v.status).toBe(TaskStatus.Pending);
    },
  );

  // Regression: it was rethrown (a get, after an await, of a computed the disposed owner owned)
  test.if(DEV)(
    "a stage1 development error a load rejects with after disposal is dropped like the load",
    async () => {
      expect.assertions(1);
      const load = Caught.reject(new Error("stage1: get of a disposed computed")) as Caught<number>;
      const sc = scope(() => {
        task(() => load);
      });
      dispose(sc);
      expect(await load.rejected).toBeUndefined();
    },
  );
});

describe("task in an app's build", () => {
  /**
   * Bundles an app whose entry is `export <names> from "stage1"`, unminified, as its build would in
   * `nodeEnv`.
   */
  const bundle = async (names: string, nodeEnv: string): Promise<string> => {
    const dir = await mkdtemp(`${tmpdir()}/task-test-`);
    try {
      await Bun.write(
        `${dir}/entry.ts`,
        `export ${names} from "${import.meta.dir}/../../src/index.ts";`,
      );
      const out = await Bun.build({
        entrypoints: [`${dir}/entry.ts`],
        target: "browser",
        define: { "process.env.NODE_ENV": JSON.stringify(nodeEnv) },
      });
      return await out.outputs[0].text();
    } finally {
      await rm(dir, { recursive: true });
    }
  };

  // Unminified, Bun heads each bundled module's code with a comment naming its path
  const TASK_MODULE = /^\/\/ (?:.*\/)?src\/task\.ts$/mu;

  test("a production build of stage1 keeps none of task's check messages", async () => {
    expect.assertions(2);
    const code = await bundle("*", "production");
    expect(code).not.toContain("task run inside its own landing");
    expect(code).not.toContain("tasks in a row");
  });

  // Guards the test above: the strings find the checks when they are bundled
  test("a development build of stage1 keeps task's check messages", async () => {
    expect.assertions(2);
    const code = await bundle("*", "development");
    expect(code).toContain("task run inside its own landing");
    expect(code).toContain("tasks in a row");
  });

  test("a production app that uses no task bundles nothing of src/task.ts", async () => {
    expect.assertions(1);
    expect(TASK_MODULE.exec(await bundle("{ effect, get, set, signal }", "production"))).toBeNull();
  });

  // Guards the test above: the pattern finds the module when it is bundled
  test("a production app that uses task bundles src/task.ts", async () => {
    expect.assertions(1);
    expect(TASK_MODULE.test(await bundle("{ task }", "production"))).toBe(true);
  });
});
