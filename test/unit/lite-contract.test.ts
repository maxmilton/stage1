// stage1/lite's signal contract: sub, set, dispose, batch, errors and memory. Order among subs is
// unspecified, so the sub under test gets observers on both sides of it and each observer is
// checked on its own. Callbacks write at most once, so a failure is a count, not a hang.
// oxlint-disable vitest/no-conditional-in-test

import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import {
  batch,
  dispose,
  get,
  set,
  type Signal,
  signal,
  type Sub,
  sub,
} from "../../src/lite/signal.ts";

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

describe("lite signals", () => {
  /** A sub that records every value it is called with. */
  const watch = <T = number>(source: Signal<T>): { seen: T[]; handle: Sub } => {
    const seen: T[] = [];
    const handle = sub<T>(source, (value) => {
      seen.push(value);
    });
    return { seen, handle };
  };

  /** Observers on both sides of a sub that writes 2 when called with 1; returns what each saw. */
  const writeMidNotification = (): number[][] => {
    const source = signal(0);
    const before = watch(source);
    let wrote = false;
    const writer = sub<number>(source, (value) => {
      if (value === 1 && !wrote) {
        wrote = true;
        set(source, 2);
      }
    });
    const after = watch(source);
    set(source, 1);
    dispose(before.handle);
    dispose(writer);
    dispose(after.handle);
    return [before.seen, after.seen];
  };

  /**
   * Observers on both sides of a sub that writes 2 when called with 1, after a write of 1 (in a
   * batch when `batched`); whether each observer's every call got the signal's value then held.
   */
  const currentAtEachCall = (batched: boolean): boolean[] => {
    const source = signal(0);
    const observer = (): boolean[] => {
      const current: boolean[] = [];
      sub<number>(source, (value) => {
        current.push(value === get(source));
      });
      return current;
    };
    const before = observer();
    let wrote = false;
    sub<number>(source, (value) => {
      if (value === 1 && !wrote) {
        wrote = true;
        set(source, 2);
      }
    });
    const after = observer();
    if (batched)
      batch(() => {
        set(source, 1);
      });
    else set(source, 1);
    return [before.every(Boolean), after.every(Boolean)];
  };

  /** A sub that throws a fresh error, logged in `log`, whenever it is called with `on`. */
  const thrower = (source: Signal<number>, on: number, log: unknown[]): Sub =>
    sub<number>(source, (value) => {
      if (value === on) {
        const error = new Error(`throws on ${on}`);
        log.push(error);
        throw error;
      }
    });

  describe("signal", () => {
    test("get and .v give the value last set", () => {
      expect.assertions(1);
      const source = signal(1);
      set(source, 2);
      expect([get(source), source.v]).toEqual([2, 2]);
    });
  });

  describe("sub", () => {
    test("calls back with the current value before returning", () => {
      expect.assertions(1);
      const source = signal(1);
      set(source, 2);
      const { seen } = watch(source);
      expect(seen).toEqual([2]);
    });

    test("calls back after each change with the value then held", () => {
      expect.assertions(1);
      const source = signal(1);
      const { seen } = watch(source);
      set(source, 2);
      set(source, 3);
      expect(seen).toEqual([1, 2, 3]);
    });

    test("an equal write calls back nothing", () => {
      expect.assertions(1);
      const source = signal(1);
      const { seen } = watch(source);
      set(source, 1);
      set(source, 2);
      set(source, 2);
      expect(seen).toEqual([1, 2]);
    });

    test("objects compare by identity", () => {
      expect.assertions(1);
      const first = { id: 1 };
      const source = signal(first);
      const { seen } = watch(source);
      set(source, first);
      set(source, { id: 1 });
      expect(seen).toHaveLength(2);
    });

    test("NaN written over NaN calls back again", () => {
      expect.assertions(1);
      const source = signal(Number.NaN);
      const { seen } = watch(source);
      set(source, Number.NaN);
      expect(seen).toHaveLength(2);
    });

    test("-0 written over 0 calls back nothing", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen } = watch(source);
      set(source, -0);
      expect(seen).toHaveLength(1);
    });

    test("a write the first call makes to its own signal is delivered", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      sub<number>(source, (value) => {
        seen.push(value);
        if (value === 0) set(source, 1);
      });
      expect(seen.at(-1)).toBe(1);
    });
  });

  describe("writes in callbacks", () => {
    test("other subs see values in write order, never an older one after a newer", () => {
      expect.assertions(1);
      // The writes were 0, 1, 2
      expect(writeMidNotification().map((seen) => inOrder(seen))).toEqual([true, true]);
    });

    test("other subs end with the latest value", () => {
      expect.assertions(1);
      expect(writeMidNotification().map((seen) => seen.at(-1))).toEqual([2, 2]);
    });

    test("no other sub is called twice in a row with one value", () => {
      expect.assertions(1);
      expect(writeMidNotification().map((seen) => repeats(seen))).toEqual([false, false]);
    });

    test("every call gets the signal's value at the time of the call", () => {
      expect.assertions(1);
      expect(currentAtEachCall(false)).toEqual([true, true]);
    });

    test("every call at a batch end gets the signal's value at the time of the call", () => {
      expect.assertions(1);
      expect(currentAtEachCall(true)).toEqual([true, true]);
    });

    test("a sub writing another signal notifies that signal's subs", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const writer = sub<number>(source, (value) => {
        set(target, value * 10);
      });
      const { seen } = watch(target);
      set(source, 1);
      dispose(writer);
      expect(seen).toEqual([0, 10]);
    });
  });

  describe("subs created mid-notification", () => {
    test("a sub created while its signal notifies is called once, at creation", () => {
      expect.assertions(1);
      const source = signal(0);
      let made: { seen: number[] } | undefined;
      const maker = sub<number>(source, (value) => {
        if (value === 1 && made === undefined) made = watch(source);
      });
      set(source, 1);
      dispose(maker);
      expect(made?.seen).toEqual([1]);
    });

    test("a sub created while its signal notifies at a batch end is called once, at creation", () => {
      expect.assertions(1);
      const source = signal(0);
      let made: { seen: number[] } | undefined;
      const maker = sub<number>(source, (value) => {
        if (value === 1 && made === undefined) made = watch(source);
      });
      batch(() => {
        set(source, 1);
      });
      dispose(maker);
      expect(made?.seen).toEqual([1]);
    });
  });

  describe("dispose", () => {
    // The lite tier has no owners (no scope, defer or effect): what a callback creates is
    // not disposed with its sub, nor when that sub is called again
    test("a sub created in another sub's callback outlives that sub's re-calls and disposal", () => {
      expect.assertions(1);
      const [outer, inner] = [signal(0), signal(0)];
      const seen: number[] = [];
      const handle = sub<number>(outer, (value) => {
        if (value === 0) {
          sub<number>(inner, (each) => {
            seen.push(each);
          });
        }
      });
      set(outer, 1);
      dispose(handle);
      set(inner, 1);
      expect(seen).toEqual([0, 1]);
    });

    test("a disposed sub is never called again", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen, handle } = watch(source);
      dispose(handle);
      set(source, 1);
      expect(seen).toEqual([0]);
    });

    test("disposing again leaves every other sub as it was", () => {
      expect.assertions(1);
      const source = signal(0);
      const subs = [watch(source), watch(source), watch(source), watch(source)];
      dispose(subs[1].handle);
      dispose(subs[2].handle);
      // Made after the first disposals, so it may reuse what they freed
      subs.push(watch(source));
      dispose(subs[1].handle);
      dispose(subs[2].handle);
      set(source, 1);
      expect(subs.map(({ seen }) => seen)).toEqual([[0, 1], [0], [0], [0, 1], [0, 1]]);
    });

    test("of two subs that dispose each other when called, only the first called runs", () => {
      expect.assertions(1);
      const source = signal(0);
      let runs = 0;
      const handles: Sub[] = [];
      const disposer = (other: number) => (value: number) => {
        if (value === 1) {
          runs++;
          dispose(handles[other]);
        }
      };
      handles.push(sub(source, disposer(1)), sub(source, disposer(0)));
      set(source, 1);
      for (const handle of handles) dispose(handle);
      expect(runs).toBe(1);
    });

    test("disposing other subs mid-notification skips none of the rest", () => {
      expect.assertions(1);
      const source = signal(0);
      const first = watch(source);
      const victims = [watch(source)];
      const killer = sub<number>(source, (value) => {
        if (value === 1) for (const victim of victims) dispose(victim.handle);
      });
      victims.push(watch(source));
      const last = watch(source);
      set(source, 1);
      dispose(killer);
      expect([first.seen, last.seen]).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });

    test("a sub disposing itself mid-notification is not called again", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      const handle: Sub = sub<number>(source, (value) => {
        seen.push(value);
        if (value === 1) dispose(handle);
      });
      set(source, 1);
      set(source, 2);
      expect(seen).toEqual([0, 1]);
    });

    test("a sub disposing itself mid-notification skips none of the rest", () => {
      expect.assertions(1);
      const source = signal(0);
      const first = watch(source);
      const handle: Sub = sub<number>(source, (value) => {
        if (value === 1) dispose(handle);
      });
      const last = watch(source);
      set(source, 1);
      expect([first.seen, last.seen]).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });

    test("a sub disposed in a batch body is not called at its end", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen, handle } = watch(source);
      batch(() => {
        set(source, 1);
        dispose(handle);
      });
      expect(seen).toEqual([0]);
    });

    test("of two subs that dispose each other at a batch end, only the first called runs", () => {
      expect.assertions(1);
      const left = signal(0);
      const right = signal(0);
      let runs = 0;
      const handles: Sub[] = [];
      const disposer = (other: number) => (value: number) => {
        if (value === 1) {
          runs++;
          dispose(handles[other]);
        }
      };
      handles.push(sub(left, disposer(1)), sub(right, disposer(0)));
      batch(() => {
        set(left, 1);
        set(right, 1);
      });
      for (const handle of handles) dispose(handle);
      expect(runs).toBe(1);
    });
  });

  describe("batch", () => {
    test("defers notifications until it ends", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen, handle } = watch(source);
      let during: number[] = [];
      batch(() => {
        set(source, 1);
        during = [...seen];
      });
      dispose(handle);
      expect(during).toEqual([0]);
    });

    test("returns what its body returns", () => {
      expect.assertions(1);
      expect(batch(() => 42)).toBe(42);
    });

    test("calls each sub of a changed signal once, with the final value", () => {
      expect.assertions(1);
      const source = signal(0);
      const first = watch(source);
      const second = watch(source);
      batch(() => {
        set(source, 1);
        set(source, 2);
        set(source, 3);
      });
      expect([first.seen, second.seen]).toEqual([
        [0, 3],
        [0, 3],
      ]);
    });

    test("a nested batch waits for the outermost", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen } = watch(source);
      let afterInner: number[] = [];
      batch(() => {
        batch(() => {
          set(source, 1);
        });
        afterInner = [...seen];
      });
      expect(afterInner).toEqual([0]);
    });

    test("reads inside see the writes so far", () => {
      expect.assertions(1);
      const source = signal(0);
      watch(source);
      let read: number[] = [];
      batch(() => {
        set(source, 1);
        read = [get(source), source.v];
      });
      expect(read).toEqual([1, 1]);
    });

    test("a value restored before the end notifies nothing", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen } = watch(source);
      batch(() => {
        set(source, 1);
        set(source, 0);
      });
      expect(seen).toEqual([0]);
    });

    test("a sub created after a write learns when the batch restores the value", () => {
      expect.assertions(1);
      const source = signal(0);
      let seen: number[] = [];
      batch(() => {
        set(source, 1);
        ({ seen } = watch(source));
        set(source, 0);
      });
      expect(seen).toEqual([1, 0]);
    });

    test("a sub created after a write learns of the restore when another sub watches too", () => {
      expect.assertions(1);
      const source = signal(0);
      watch(source);
      let seen: number[] = [];
      batch(() => {
        set(source, 1);
        ({ seen } = watch(source));
        set(source, 0);
      });
      expect(seen).toEqual([1, 0]);
    });

    test("a sub created before the writes is not told of a restore", () => {
      expect.assertions(1);
      const source = signal(0);
      let seen: number[] = [];
      batch(() => {
        ({ seen } = watch(source));
        set(source, 1);
        set(source, 0);
      });
      expect(seen).toEqual([0]);
    });

    // "Never called twice in a row with one value" over "each sub of a changed signal is called"
    test("a sub created after the last write is not called again with the value it got", () => {
      expect.assertions(1);
      const source = signal(0);
      watch(source);
      let seen: number[] = [];
      batch(() => {
        set(source, 1);
        ({ seen } = watch(source));
      });
      expect(seen).toEqual([1]);
    });

    test("a throwing body's error propagates", () => {
      expect.assertions(1);
      const error = new Error("body");
      expect(() => {
        batch(() => {
          throw error;
        });
      }).toThrow(error);
    });

    test("a throwing body still delivers the notifications it deferred", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen } = watch(source);
      thrownBy(() => {
        batch(() => {
          set(source, 1);
          throw new Error("body");
        });
      });
      expect(seen).toEqual([0, 1]);
    });

    test("a throwing body leaves later writes unbatched", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen } = watch(source);
      thrownBy(() => {
        batch(() => {
          throw new Error("body");
        });
      });
      set(source, 1);
      expect(seen).toEqual([0, 1]);
    });

    test("a nested body's throw, caught inside the outer body, still defers to the outer end", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen } = watch(source);
      let afterThrow: number[] = [];
      batch(() => {
        thrownBy(() => {
          batch(() => {
            throw new Error("inner");
          });
        });
        set(source, 1);
        afterThrow = [...seen];
      });
      expect(afterThrow).toEqual([0]);
    });

    test("a write a callback makes at the batch end is delivered", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const writer = sub<number>(source, (value) => {
        set(target, value * 10);
      });
      const { seen } = watch(target);
      batch(() => {
        set(source, 1);
      });
      dispose(writer);
      expect(seen).toEqual([0, 10]);
    });

    test("a callback's write at the batch end to a signal it also wrote leaves its subs at that write", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const writer = sub<number>(source, (value) => {
        if (value === 1) set(target, 5);
      });
      const { seen } = watch(target);
      batch(() => {
        set(source, 1);
        set(target, 1);
      });
      dispose(writer);
      expect(seen.at(-1)).toBe(5);
    });

    test("a batch a callback runs at the batch end delivers its writes", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const writer = sub<number>(source, (value) => {
        batch(() => {
          set(target, value * 10);
        });
      });
      const { seen } = watch(target);
      batch(() => {
        set(source, 1);
      });
      dispose(writer);
      expect(seen).toEqual([0, 10]);
    });
  });

  describe("errors", () => {
    test("a throwing callback does not stop the other subs", () => {
      expect.assertions(1);
      const source = signal(0);
      const first = watch(source);
      thrower(source, 1, []);
      const last = watch(source);
      thrownBy(() => {
        set(source, 1);
      });
      expect([first.seen, last.seen]).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });

    // Which error reaches the caller is unspecified
    test("set rethrows one of the errors once every callback ran", () => {
      expect.assertions(2);
      const source = signal(0);
      const log: unknown[] = [];
      thrower(source, 1, log);
      thrower(source, 1, log);
      const caught = thrownBy(() => {
        set(source, 1);
      });
      expect(log).toHaveLength(2);
      expect(log).toContain(caught);
    });

    test("a throwing callback at a batch end does not stop the others", () => {
      expect.assertions(1);
      const [before, bad, after] = [signal(0), signal(0), signal(0)];
      const first = watch(before);
      thrower(bad, 1, []);
      const last = watch(after);
      thrownBy(() => {
        batch(() => {
          set(before, 1);
          set(bad, 1);
          set(after, 1);
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
      const [left, right] = [signal(0), signal(0)];
      const log: unknown[] = [];
      thrower(left, 1, log);
      thrower(right, 1, log);
      const caught = thrownBy(() => {
        batch(() => {
          set(left, 1);
          set(right, 1);
        });
      });
      expect(log).toHaveLength(2);
      expect(log).toContain(caught);
    });

    // Every pending callback still runs, at scale: no recursion per throw (a drain recursing per
    // error overflows at ~10k throwing callbacks and leaves the rest unrun)
    test("100k throwing subs of one signal all run before set rethrows", () => {
      expect.assertions(1);
      const source = signal(0);
      const error = new Error("each");
      let calls = 0;
      const fail = (value: number): void => {
        if (value === 1) {
          calls++;
          throw error;
        }
      };
      for (let index = 0; index < 100_000; index++) sub(source, fail);
      const caught = thrownBy(() => {
        set(source, 1);
      });
      expect([calls, caught]).toEqual([100_000, error]);
    });

    test("100k signals' throwing subs all run before a batch end rethrows", () => {
      expect.assertions(1);
      const sources = Array.from({ length: 100_000 }, () => signal(0));
      const error = new Error("each");
      let calls = 0;
      const fail = (value: number): void => {
        if (value === 1) {
          calls++;
          throw error;
        }
      };
      for (const source of sources) sub(source, fail);
      const caught = thrownBy(() => {
        batch(() => {
          for (const source of sources) set(source, 1);
        });
      });
      expect([calls, caught]).toEqual([100_000, error]);
    });
  });

  describe("memory", () => {
    test("a disposed sub's callback is collectable", async () => {
      expect.assertions(1);
      const source = signal(1);
      const alive = await survivors(() => {
        // A distinct callback per sub, each held only by it
        const callback = (): void => {};
        dispose(sub(source, callback));
        return callback;
      });
      expect(alive).toBeLessThan(10);
    });

    test("a held disposed handle keeps no sub made after it reachable", () => {
      expect.assertions(1);
      const source = signal(0);
      // A live first sub (some designs keep the first in the signal), older than the rest
      sub(source, noop);
      /** Subs made one after another, each disposed once the next exists; returns the first. */
      const churn = (count: number): Sub => {
        let previous = sub(source, noop);
        const first = previous;
        for (let index = 0; index < count; index++) {
          const next = sub(source, noop);
          dispose(previous);
          previous = next;
        }
        dispose(previous);
        return first;
      };
      churn(100);
      const before = objects();
      const held = churn(10_000);
      const grown = objects() - before;
      dispose(held);
      // 10k later subs: a chain through them (a newer-neighbour pointer kept on dispose) adds ~10k
      expect(grown).toBeLessThan(1000);
    });

    test("a signal whose subs are all disposed keeps no storage that grows with past subs", () => {
      expect.assertions(1);
      const sources = Array.from({ length: 100 }, () => signal(0));
      const cycles = (rounds: number): void => {
        for (const source of sources) {
          for (let round = 0; round < rounds; round++) dispose(sub(source, () => {}));
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
