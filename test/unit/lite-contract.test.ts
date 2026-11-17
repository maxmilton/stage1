// The subs-only signal contract stage1/lite promises, run on both tiers (stage1's sub keeps it
// too, apart from ownership) and, where a test keeps one sub per signal, on stage1/ultralite: sub,
// set, dispose, batch, errors and memory. Order among subs is unspecified, so the sub under test
// gets observers on both sides of it and each observer is checked on its own. Callbacks write at
// most once, so a failure is a count, not a hang. Tests that keep several subs on one signal run
// only where `subs` is "many".
// oxlint-disable vitest/no-conditional-in-test

import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import * as lite from "../../src/lite/signal.ts";
import * as full from "../../src/signal.ts";
import * as ultralite from "../../src/ultralite/signal.ts";

/** A tier's signal, loosely typed: the tests drive every tier through one interface. */
interface Source<T> {
  readonly v: T;
}
/** A sub's handle, for `dispose`. */
type Handle = unknown;
interface Tier {
  /** Whether a sub owns what its callback creates (disposed with it). */
  readonly owns: boolean;
  /** "one": a signal holds at most one live sub (a second is a dev error). */
  readonly subs: "many" | "one";
  readonly signal: <T>(value: T) => Source<T>;
  readonly get: <T>(source: Source<T>) => T;
  readonly set: <T>(source: Source<T>, value: T) => void;
  readonly sub: <T>(source: Source<T>, fn: (value: T) => void) => Handle;
  readonly dispose: (handle: Handle) => void;
  readonly batch: <T>(fn: () => T) => T;
}

const TIERS: readonly (readonly [name: string, tier: Tier])[] = [
  [
    "stage1/lite",
    {
      owns: false,
      subs: "many",
      signal: lite.signal,
      get: lite.get as Tier["get"],
      set: lite.set as Tier["set"],
      sub: lite.sub as Tier["sub"],
      dispose: lite.dispose as Tier["dispose"],
      batch: lite.batch,
    },
  ],
  [
    "stage1",
    {
      owns: true,
      subs: "many",
      signal: full.signal,
      get: full.get as Tier["get"],
      set: full.set as Tier["set"],
      sub: full.sub as Tier["sub"],
      dispose: full.dispose as Tier["dispose"],
      batch: full.batch,
    },
  ],
  [
    "stage1/ultralite",
    {
      owns: false,
      subs: "one",
      signal: ultralite.signal,
      get: ultralite.get as Tier["get"],
      set: ultralite.set as Tier["set"],
      sub: ultralite.sub as Tier["sub"],
      dispose: ultralite.dispose as Tier["dispose"],
      batch: ultralite.batch,
    },
  ],
];

/** How many of 20 objects, each held only by what `make` built, survive a full collection. */
const survivors = async (make: () => object): Promise<number> => {
  const refs = Array.from({ length: 20 }, () => new WeakRef(make()));
  await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
  Bun.gc(true);
  return refs.filter((ref) => ref.deref() !== undefined).length;
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

/** Whether `fn` threw (anything, undefined included). */
const throws = (fn: () => void): boolean => {
  try {
    fn();
  } catch {
    return true;
  }
  return false;
};

const heap = (): number => {
  Bun.gc(true);
  return heapStats().heapSize;
};

/** One callback for many subs, so they allocate no function each. */
const noop = (): void => {};

/** Live objects after a full collection. */
const objects = (): number => {
  Bun.gc(true);
  return heapStats().objectCount;
};

const inOrder = (seen: number[]): boolean =>
  seen.every((value, index) => index === 0 || seen[index - 1] <= value);
const repeats = (seen: unknown[]): boolean =>
  seen.some((value, index) => index > 0 && seen[index - 1] === value);

describe.each(TIERS)("on %s", (_name, t) => {
  /** A sub that records every value it is called with. */
  const watch = <T = number>(source: Source<T>): { seen: T[]; handle: Handle } => {
    const seen: T[] = [];
    const handle = t.sub<T>(source, (value) => {
      seen.push(value);
    });
    return { seen, handle };
  };

  /** Observers on both sides of a sub that writes 2 when called with 1; returns what each saw. */
  const writeMidNotification = (): number[][] => {
    const source = t.signal(0);
    const before = watch(source);
    let wrote = false;
    const writer = t.sub<number>(source, (value) => {
      if (value === 1 && !wrote) {
        wrote = true;
        t.set(source, 2);
      }
    });
    const after = watch(source);
    t.set(source, 1);
    t.dispose(before.handle);
    t.dispose(writer);
    t.dispose(after.handle);
    return [before.seen, after.seen];
  };

  /**
   * Observers on both sides of a sub that writes 2 when called with 1, after a write of 1 (in a
   * batch when `batched`); whether each observer's every call got the signal's value then held.
   */
  const currentAtEachCall = (batched: boolean): boolean[] => {
    const source = t.signal(0);
    const observer = (): boolean[] => {
      const current: boolean[] = [];
      t.sub<number>(source, (value) => {
        current.push(value === t.get(source));
      });
      return current;
    };
    const before = observer();
    let wrote = false;
    t.sub<number>(source, (value) => {
      if (value === 1 && !wrote) {
        wrote = true;
        t.set(source, 2);
      }
    });
    const after = observer();
    if (batched)
      t.batch(() => {
        t.set(source, 1);
      });
    else t.set(source, 1);
    return [before.every(Boolean), after.every(Boolean)];
  };

  /** A sub that throws a fresh error, logged in `log`, whenever it is called with `on`. */
  const thrower = (source: Source<number>, on: number, log: unknown[]): Handle =>
    t.sub<number>(source, (value) => {
      if (value === on) {
        const error = new Error(`throws on ${on}`);
        log.push(error);
        throw error;
      }
    });

  describe("signal", () => {
    test("get and .v give the value last set", () => {
      expect.assertions(1);
      const source = t.signal(1);
      t.set(source, 2);
      expect([t.get(source), source.v]).toEqual([2, 2]);
    });
  });

  describe("sub", () => {
    test("calls back with the current value before returning", () => {
      expect.assertions(1);
      const source = t.signal(1);
      t.set(source, 2);
      const { seen } = watch(source);
      expect(seen).toEqual([2]);
    });

    test("calls back after each change with the value then held", () => {
      expect.assertions(1);
      const source = t.signal(1);
      const { seen } = watch(source);
      t.set(source, 2);
      t.set(source, 3);
      expect(seen).toEqual([1, 2, 3]);
    });

    test("an equal write calls back nothing", () => {
      expect.assertions(1);
      const source = t.signal(1);
      const { seen } = watch(source);
      t.set(source, 1);
      t.set(source, 2);
      t.set(source, 2);
      expect(seen).toEqual([1, 2]);
    });

    test("objects compare by identity", () => {
      expect.assertions(1);
      const first = { id: 1 };
      const source = t.signal(first);
      const { seen } = watch(source);
      t.set(source, first);
      t.set(source, { id: 1 });
      expect(seen).toHaveLength(2);
    });

    test("NaN written over NaN calls back again", () => {
      expect.assertions(1);
      const source = t.signal(Number.NaN);
      const { seen } = watch(source);
      t.set(source, Number.NaN);
      expect(seen).toHaveLength(2);
    });

    test("-0 written over 0 calls back nothing", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen } = watch(source);
      t.set(source, -0);
      expect(seen).toHaveLength(1);
    });

    test.if(t.subs === "many")("loosely equal values are changes: === compares", () => {
      expect.assertions(1);
      const source = t.signal<unknown>(1);
      const seen: unknown[][] = [[], []];
      for (const each of seen) {
        t.sub(source, (value) => {
          each.push(value);
        });
      }
      for (const value of ["1", 1, null, undefined]) t.set(source, value);
      expect(seen).toEqual([
        [1, "1", 1, null, undefined],
        [1, "1", 1, null, undefined],
      ]);
    });

    test("a write the first call makes to its own signal is delivered", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const seen: number[] = [];
      t.sub<number>(source, (value) => {
        seen.push(value);
        if (value === 0) t.set(source, 1);
      });
      expect(seen.at(-1)).toBe(1);
    });
  });

  describe("writes in callbacks", () => {
    test.if(t.subs === "many")(
      "other subs see values in write order, never an older one after a newer",
      () => {
        expect.assertions(1);
        // The writes were 0, 1, 2
        expect(writeMidNotification().map((seen) => inOrder(seen))).toEqual([true, true]);
      },
    );

    test.if(t.subs === "many")("other subs end with the latest value", () => {
      expect.assertions(1);
      expect(writeMidNotification().map((seen) => seen.at(-1))).toEqual([2, 2]);
    });

    test.if(t.subs === "many")("no other sub is called twice in a row with one value", () => {
      expect.assertions(1);
      expect(writeMidNotification().map((seen) => repeats(seen))).toEqual([false, false]);
    });

    test.if(t.subs === "many")("every call gets the signal's value at the time of the call", () => {
      expect.assertions(1);
      expect(currentAtEachCall(false)).toEqual([true, true]);
    });

    // Two on each side, so some observer comes after the writer in any walk order
    test.if(t.subs === "many")(
      "every call gets the signal's value at the time of the call, two observers on each side of a writer",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        const current: boolean[] = [];
        const observe = (): void => {
          t.sub<number>(source, (value) => {
            current.push(value === source.v);
          });
        };
        observe();
        observe();
        let wrote = false;
        t.sub<number>(source, (value) => {
          if (value === 1 && !wrote) {
            wrote = true;
            t.set(source, 2);
          }
        });
        observe();
        observe();
        t.set(source, 1);
        expect(current).not.toContain(false);
      },
    );

    test.if(t.subs === "many")(
      "every call at a batch end gets the signal's value at the time of the call",
      () => {
        expect.assertions(1);
        expect(currentAtEachCall(true)).toEqual([true, true]);
      },
    );

    test("a sub writing another signal notifies that signal's subs", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const target = t.signal(0);
      const writer = t.sub<number>(source, (value) => {
        t.set(target, value * 10);
      });
      const { seen } = watch(target);
      t.set(source, 1);
      t.dispose(writer);
      expect(seen).toEqual([0, 10]);
    });
  });

  describe("subs created mid-notification", () => {
    test.if(t.subs === "many")(
      "a sub created while its signal notifies is called once, at creation",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        let made: { seen: number[] } | undefined;
        const maker = t.sub<number>(source, (value) => {
          if (value === 1 && made === undefined) made = watch(source);
        });
        t.set(source, 1);
        t.dispose(maker);
        expect(made?.seen).toEqual([1]);
      },
    );

    test.if(t.subs === "many")(
      "a sub created while its signal notifies at a batch end is called once, at creation",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        let made: { seen: number[] } | undefined;
        const maker = t.sub<number>(source, (value) => {
          if (value === 1 && made === undefined) made = watch(source);
        });
        t.batch(() => {
          t.set(source, 1);
        });
        t.dispose(maker);
        expect(made?.seen).toEqual([1]);
      },
    );
  });

  describe("dispose", () => {
    /** A sub on `outer` whose first call subs `inner`; returns what the inner sub saw. */
    const nested = (outer: Source<number>, inner: Source<number>): [Handle, number[]] => {
      const seen: number[] = [];
      const handle = t.sub<number>(outer, (value) => {
        if (value === 0) {
          t.sub<number>(inner, (each) => {
            seen.push(each);
          });
        }
      });
      return [handle, seen];
    };

    // On every tier: stage1's sub keeps what its callback creates across its calls
    test("a sub created in another sub's callback outlives that sub's re-calls", () => {
      expect.assertions(1);
      const [outer, inner] = [t.signal(0), t.signal(0)];
      const [, seen] = nested(outer, inner);
      t.set(outer, 1);
      t.set(inner, 1);
      expect(seen).toEqual([0, 1]);
    });

    // The lite tiers have no owners (no scope, defer or effect)
    test.if(!t.owns)("a sub created in another sub's callback outlives that sub's disposal", () => {
      expect.assertions(1);
      const [outer, inner] = [t.signal(0), t.signal(0)];
      const [handle, seen] = nested(outer, inner);
      t.dispose(handle);
      t.set(inner, 1);
      expect(seen).toEqual([0, 1]);
    });

    test.if(t.owns)("a sub created in another sub's callback is disposed with that sub", () => {
      expect.assertions(1);
      const [outer, inner] = [t.signal(0), t.signal(0)];
      const [handle, seen] = nested(outer, inner);
      t.dispose(handle);
      t.set(inner, 1);
      expect(seen).toEqual([0]);
    });

    test("a disposed sub is never called again", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen, handle } = watch(source);
      t.dispose(handle);
      t.set(source, 1);
      expect(seen).toEqual([0]);
    });

    test.if(t.subs === "many")("disposing again leaves every other sub as it was", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const subs = [watch(source), watch(source), watch(source), watch(source)];
      t.dispose(subs[1].handle);
      t.dispose(subs[2].handle);
      // Made after the first disposals, so it may reuse what they freed
      subs.push(watch(source));
      t.dispose(subs[1].handle);
      t.dispose(subs[2].handle);
      t.set(source, 1);
      expect(subs.map(({ seen }) => seen)).toEqual([[0, 1], [0], [0], [0, 1], [0, 1]]);
    });

    test.if(t.subs === "many")(
      "of two subs that dispose each other when called, only the first called runs",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        let runs = 0;
        const handles: Handle[] = [];
        const disposer = (other: number) => (value: number) => {
          if (value === 1) {
            runs++;
            t.dispose(handles[other]);
          }
        };
        handles.push(t.sub(source, disposer(1)), t.sub(source, disposer(0)));
        t.set(source, 1);
        for (const handle of handles) t.dispose(handle);
        expect(runs).toBe(1);
      },
    );

    test.if(t.subs === "many")(
      "disposing other subs mid-notification skips none of the rest",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        const first = watch(source);
        const victims = [watch(source)];
        const killer = t.sub<number>(source, (value) => {
          if (value === 1) for (const victim of victims) t.dispose(victim.handle);
        });
        victims.push(watch(source));
        const last = watch(source);
        t.set(source, 1);
        t.dispose(killer);
        expect([first.seen, last.seen]).toEqual([
          [0, 1],
          [0, 1],
        ]);
      },
    );

    test("a sub disposing itself mid-notification is not called again", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const seen: number[] = [];
      const handle: Handle = t.sub<number>(source, (value) => {
        seen.push(value);
        if (value === 1) t.dispose(handle);
      });
      t.set(source, 1);
      t.set(source, 2);
      expect(seen).toEqual([0, 1]);
    });

    test.if(t.subs === "many")(
      "a sub disposing itself mid-notification skips none of the rest",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        const first = watch(source);
        const handle: Handle = t.sub<number>(source, (value) => {
          if (value === 1) t.dispose(handle);
        });
        const last = watch(source);
        t.set(source, 1);
        expect([first.seen, last.seen]).toEqual([
          [0, 1],
          [0, 1],
        ]);
      },
    );

    test("a sub disposed in a batch body is not called at its end", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen, handle } = watch(source);
      t.batch(() => {
        t.set(source, 1);
        t.dispose(handle);
      });
      expect(seen).toEqual([0]);
    });

    test("of two subs that dispose each other at a batch end, only the first called runs", () => {
      expect.assertions(1);
      const left = t.signal(0);
      const right = t.signal(0);
      let runs = 0;
      const handles: Handle[] = [];
      const disposer = (other: number) => (value: number) => {
        if (value === 1) {
          runs++;
          t.dispose(handles[other]);
        }
      };
      handles.push(t.sub(left, disposer(1)), t.sub(right, disposer(0)));
      t.batch(() => {
        t.set(left, 1);
        t.set(right, 1);
      });
      for (const handle of handles) t.dispose(handle);
      expect(runs).toBe(1);
    });
  });

  describe("batch", () => {
    test("defers notifications until it ends", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen, handle } = watch(source);
      let during: number[] = [];
      t.batch(() => {
        t.set(source, 1);
        during = [...seen];
      });
      t.dispose(handle);
      expect(during).toEqual([0]);
    });

    test("returns what its body returns", () => {
      expect.assertions(1);
      expect(t.batch(() => 42)).toBe(42);
    });

    test.if(t.subs === "many")(
      "calls each sub of a changed signal once, with the final value",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        const first = watch(source);
        const second = watch(source);
        t.batch(() => {
          t.set(source, 1);
          t.set(source, 2);
          t.set(source, 3);
        });
        expect([first.seen, second.seen]).toEqual([
          [0, 3],
          [0, 3],
        ]);
      },
    );

    test("a nested batch waits for the outermost", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen } = watch(source);
      let afterInner: number[] = [];
      t.batch(() => {
        t.batch(() => {
          t.set(source, 1);
        });
        afterInner = [...seen];
      });
      expect(afterInner).toEqual([0]);
    });

    test("reads inside see the writes so far", () => {
      expect.assertions(1);
      const source = t.signal(0);
      watch(source);
      let read: number[] = [];
      t.batch(() => {
        t.set(source, 1);
        read = [t.get(source), source.v];
      });
      expect(read).toEqual([1, 1]);
    });

    test("a value restored before the end notifies nothing", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen } = watch(source);
      t.batch(() => {
        t.set(source, 1);
        t.set(source, 0);
      });
      expect(seen).toEqual([0]);
    });

    test("a sub created after a write learns when the batch restores the value", () => {
      expect.assertions(1);
      const source = t.signal(0);
      let seen: number[] = [];
      t.batch(() => {
        t.set(source, 1);
        ({ seen } = watch(source));
        t.set(source, 0);
      });
      expect(seen).toEqual([1, 0]);
    });

    test.if(t.subs === "many")(
      "a sub created after a write learns of the restore when another sub watches too",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        watch(source);
        let seen: number[] = [];
        t.batch(() => {
          t.set(source, 1);
          ({ seen } = watch(source));
          t.set(source, 0);
        });
        expect(seen).toEqual([1, 0]);
      },
    );

    test("a sub created before the writes is not told of a restore", () => {
      expect.assertions(1);
      const source = t.signal(0);
      let seen: number[] = [];
      t.batch(() => {
        ({ seen } = watch(source));
        t.set(source, 1);
        t.set(source, 0);
      });
      expect(seen).toEqual([0]);
    });

    // "Never called twice in a row with one value" over "each sub of a changed signal is called"
    test.if(t.subs === "many")(
      "a sub created after the last write is not called again with the value it got",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        watch(source);
        let seen: number[] = [];
        t.batch(() => {
          t.set(source, 1);
          ({ seen } = watch(source));
        });
        expect(seen).toEqual([1]);
      },
    );

    test("a throwing body's error propagates", () => {
      expect.assertions(1);
      const error = new Error("body");
      expect(() => {
        t.batch(() => {
          throw error;
        });
      }).toThrow(error);
    });

    test("a throwing body still delivers the notifications it deferred", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen } = watch(source);
      thrownBy(() => {
        t.batch(() => {
          t.set(source, 1);
          throw new Error("body");
        });
      });
      expect(seen).toEqual([0, 1]);
    });

    test("a throwing body leaves later writes unbatched", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen } = watch(source);
      thrownBy(() => {
        t.batch(() => {
          throw new Error("body");
        });
      });
      t.set(source, 1);
      expect(seen).toEqual([0, 1]);
    });

    test("a nested body's throw, caught inside the outer body, still defers to the outer end", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const { seen } = watch(source);
      let afterThrow: number[] = [];
      t.batch(() => {
        thrownBy(() => {
          t.batch(() => {
            throw new Error("inner");
          });
        });
        t.set(source, 1);
        afterThrow = [...seen];
      });
      expect(afterThrow).toEqual([0]);
    });

    test("a write a callback makes at the batch end is delivered", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const target = t.signal(0);
      const writer = t.sub<number>(source, (value) => {
        t.set(target, value * 10);
      });
      const { seen } = watch(target);
      t.batch(() => {
        t.set(source, 1);
      });
      t.dispose(writer);
      expect(seen).toEqual([0, 10]);
    });

    test("a callback's write at the batch end to a signal it also wrote leaves its subs at that write", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const target = t.signal(0);
      const writer = t.sub<number>(source, (value) => {
        if (value === 1) t.set(target, 5);
      });
      const { seen } = watch(target);
      t.batch(() => {
        t.set(source, 1);
        t.set(target, 1);
      });
      t.dispose(writer);
      expect(seen.at(-1)).toBe(5);
    });

    test("a batch a callback runs at the batch end delivers its writes", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const target = t.signal(0);
      const writer = t.sub<number>(source, (value) => {
        t.batch(() => {
          t.set(target, value * 10);
        });
      });
      const { seen } = watch(target);
      t.batch(() => {
        t.set(source, 1);
      });
      t.dispose(writer);
      expect(seen).toEqual([0, 10]);
    });
  });

  describe("errors", () => {
    test.if(t.subs === "many")("a throwing callback does not stop the other subs", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const first = watch(source);
      thrower(source, 1, []);
      const last = watch(source);
      thrownBy(() => {
        t.set(source, 1);
      });
      expect([first.seen, last.seen]).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });

    // Which error reaches the caller is unspecified
    test.if(t.subs === "many")("set rethrows one of the errors once every callback ran", () => {
      expect.assertions(2);
      const source = t.signal(0);
      const log: unknown[] = [];
      thrower(source, 1, log);
      thrower(source, 1, log);
      const caught = thrownBy(() => {
        t.set(source, 1);
      });
      expect(log).toHaveLength(2);
      expect(log).toContain(caught);
    });

    test("a throwing callback at a batch end does not stop the others", () => {
      expect.assertions(1);
      const [before, bad, after] = [t.signal(0), t.signal(0), t.signal(0)];
      const first = watch(before);
      thrower(bad, 1, []);
      const last = watch(after);
      thrownBy(() => {
        t.batch(() => {
          t.set(before, 1);
          t.set(bad, 1);
          t.set(after, 1);
        });
      });
      expect([first.seen, last.seen]).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });

    // As above
    test("a batch end rethrows one of the errors once every callback ran", () => {
      expect.assertions(2);
      const [left, right] = [t.signal(0), t.signal(0)];
      const log: unknown[] = [];
      thrower(left, 1, log);
      thrower(right, 1, log);
      const caught = thrownBy(() => {
        t.batch(() => {
          t.set(left, 1);
          t.set(right, 1);
        });
      });
      expect(log).toHaveLength(2);
      expect(log).toContain(caught);
    });

    // Every pending callback still runs, at scale: no recursion per throw (a drain recursing per
    // error overflows at ~10k throwing callbacks and leaves the rest unrun)
    test.if(t.subs === "many")(
      "100k throwing subs of one signal all run before set rethrows",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        const error = new Error("each");
        let calls = 0;
        const fail = (value: number): void => {
          if (value === 1) {
            calls++;
            throw error;
          }
        };
        for (let index = 0; index < 100_000; index++) t.sub(source, fail);
        const caught = thrownBy(() => {
          t.set(source, 1);
        });
        expect([calls, caught]).toEqual([100_000, error]);
      },
    );

    test("100k signals' throwing subs all run before a batch end rethrows", () => {
      expect.assertions(1);
      const sources = Array.from({ length: 100_000 }, () => t.signal(0));
      const error = new Error("each");
      let calls = 0;
      const fail = (value: number): void => {
        if (value === 1) {
          calls++;
          throw error;
        }
      };
      for (const source of sources) t.sub(source, fail);
      const caught = thrownBy(() => {
        t.batch(() => {
          for (const source of sources) t.set(source, 1);
        });
      });
      expect([calls, caught]).toEqual([100_000, error]);
    });

    test("sub rethrows what its first call threw", () => {
      expect.assertions(1);
      const error = new Error("first call");
      expect(() => {
        t.sub(t.signal(0), () => {
          throw error;
        });
      }).toThrow(error);
    });

    test("a write rethrows a callback's thrown undefined", () => {
      expect.assertions(1);
      const source = t.signal(0);
      t.sub<number>(source, (value) => {
        // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
        if (value === 1) throw undefined;
      });
      expect(
        throws(() => {
          t.set(source, 1);
        }),
      ).toBe(true);
    });

    test("a batch end rethrows a callback's thrown undefined", () => {
      expect.assertions(1);
      const source = t.signal(0);
      t.sub<number>(source, (value) => {
        // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
        if (value === 1) throw undefined;
      });
      expect(
        throws(() => {
          t.batch(() => {
            t.set(source, 1);
          });
        }),
      ).toBe(true);
    });

    test.if(t.subs === "many")("after set rethrows, the next write calls every sub at once", () => {
      expect.assertions(1);
      const source = t.signal(0);
      const first = watch(source);
      thrower(source, 1, []);
      const last = watch(source);
      thrownBy(() => {
        t.set(source, 1);
      });
      t.set(source, 2);
      expect([first.seen.at(-1), last.seen.at(-1)]).toEqual([2, 2]);
    });

    test("after a batch end rethrows, the next write calls back at once", () => {
      expect.assertions(1);
      const bad = t.signal(0);
      const source = t.signal(0);
      thrower(bad, 1, []);
      const { seen } = watch(source);
      thrownBy(() => {
        t.batch(() => {
          t.set(bad, 1);
        });
      });
      t.set(source, 1);
      expect(seen).toEqual([0, 1]);
    });

    test("after a batch end rethrows, a later batch delivers every signal it wrote", () => {
      expect.assertions(1);
      const [before, bad, after] = [t.signal(0), t.signal(0), t.signal(0)];
      const first = watch(before);
      thrower(bad, 1, []);
      const last = watch(after);
      const writeAll = (value: number): void => {
        t.batch(() => {
          t.set(before, value);
          t.set(bad, value);
          t.set(after, value);
        });
      };
      thrownBy(() => {
        writeAll(1);
      });
      writeAll(2);
      expect([first.seen.at(-1), last.seen.at(-1)]).toEqual([2, 2]);
    });
  });

  describe("memory", () => {
    test("a disposed sub's callback is collectable", async () => {
      expect.assertions(1);
      const source = t.signal(1);
      const alive = await survivors(() => {
        // A distinct callback per sub, each held only by it
        const callback = (): void => {};
        t.dispose(t.sub(source, callback));
        return callback;
      });
      expect(alive).toBeLessThan(10);
    });

    test.if(t.subs === "many")(
      "a held disposed handle keeps no sub made after it reachable",
      () => {
        expect.assertions(1);
        const source = t.signal(0);
        // A live first sub (some designs keep the first in the signal), older than the rest
        t.sub(source, noop);
        /** Subs made one after another, each disposed once the next exists; returns the first. */
        const churn = (count: number): Handle => {
          let previous = t.sub(source, noop);
          const first = previous;
          for (let index = 0; index < count; index++) {
            const next = t.sub(source, noop);
            t.dispose(previous);
            previous = next;
          }
          t.dispose(previous);
          return first;
        };
        churn(100);
        const before = objects();
        const held = churn(10_000);
        const grown = objects() - before;
        t.dispose(held);
        // 10k later subs: a chain through them (a newer-neighbour pointer kept on dispose) adds ~10k
        expect(grown).toBeLessThan(1000);
      },
    );

    test("a signal whose subs are all disposed keeps no storage that grows with past subs", () => {
      expect.assertions(1);
      const sources = Array.from({ length: 100 }, () => t.signal(0));
      const cycles = (rounds: number): void => {
        for (const source of sources) {
          for (let round = 0; round < rounds; round++) t.dispose(t.sub(source, () => {}));
        }
      };
      cycles(1);
      const before = heap();
      cycles(10_000);
      const grown = heap() - before;
      // 1M past subs: under a byte each; a kept 8-byte slot per past sub grows ~8 MB
      expect(grown).toBeLessThan(1_000_000);
    });
  });
});
