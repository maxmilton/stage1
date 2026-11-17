// stage1/lite's signals, its design's own edge cases beyond lite-contract.test.ts: the first sub
// held in the signal (the signal is its handle; a disposed slot is never reused), notification's
// two steps (the first sub, then the nodes), records under queued writes and batches, the queue
// (a write made while a callback runs, a batch is open or a first call is held is delivered after
// it), errors, the dev loop bound, the stack edge and memory. Where the contract leaves a choice
// (sibling order, where an error surfaces), a test labelled "Characterization" pins this design's
// choice, so a change to it is deliberate. A walk calls the first sub, then the nodes newest first,
// so "after" in a walk means a node created earlier (but after the first sub). Run in both modes:
// `bun test` (dev checks on) and `NODE_ENV=production bun test`.
// oxlint-disable vitest/no-conditional-in-test node/no-process-env

import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import {
  batch,
  dispose,
  type Effect,
  set,
  type Signal,
  signal,
  sub,
  trigger,
} from "../../src/lite/signal.ts";
import { list } from "../../src/reconcile.ts";
import { noop as utilsNoop } from "../../src/utils.ts";

const DEV = process.env.NODE_ENV !== "production";

/** A sub that records every value it is called with. */
const watch = <T>(source: Signal<T>): { seen: T[]; handle: Effect } => {
  const seen: T[] = [];
  const handle = sub(source, (value) => {
    seen.push(value);
  });
  return { seen, handle };
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

/** One callback for subs whose calls do not matter. */
const noop = (): void => {};

/** How many of 20 objects from `make` survive a full collection. */
const survivors = async (make: () => object): Promise<number> => {
  const refs = Array.from({ length: 20 }, () => new WeakRef(make()));
  await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
  Bun.gc(true);
  return refs.filter((ref) => ref.deref() !== undefined).length;
};

/** What `fn` threw, boxed (so a thrown undefined shows), or undefined when it returned. */
const outcome = (fn: () => void): { error: unknown } | undefined => {
  try {
    fn();
  } catch (error) {
    return { error };
  }
  return undefined;
};

/**
 * What a probe sub saw after an unbatched write, after a batch's write, and after a first call's
 * write: each is delivered before it returns only when no pass, batch or first call is left open.
 */
const atRest = (): number[][] => {
  const probe = signal(0);
  const { seen } = watch(probe);
  set(probe, 1);
  const afterSet = [...seen];
  batch(() => {
    set(probe, 2);
  });
  const afterBatch = [...seen];
  sub(signal(0), () => {
    set(probe, 3);
  });
  return [afterSet, afterBatch, seen];
};
const REST = [
  [0, 1],
  [0, 1, 2],
  [0, 1, 2, 3],
];

describe("lite signals", () => {
  describe("the first sub, held in the signal", () => {
    test("Characterization: the first sub's handle is its signal", () => {
      expect.assertions(1);
      const source = signal(0);
      expect(sub(source, noop)).toBe(source as unknown as Effect);
    });

    test("Characterization: a later sub's handle is not its signal", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      expect(sub(source, noop)).not.toBe(source as unknown as Effect);
    });

    test("disposing the first sub's handle again after a later sub was made leaves that sub subscribed", () => {
      expect.assertions(1);
      const source = signal(0);
      const first = sub(source, noop);
      dispose(first);
      const later = watch(source);
      dispose(first);
      set(source, 1);
      expect(later.seen).toEqual([0, 1]);
    });

    test("a disposed first sub is never called again while later subs are", () => {
      expect.assertions(1);
      const source = signal(0);
      let calls = 0;
      dispose(
        sub(source, () => {
          calls++;
        }),
      );
      watch(source);
      set(source, 1);
      set(source, 2);
      expect(calls).toBe(1);
    });

    test("a sub made after the first was disposed is called on every change", () => {
      expect.assertions(1);
      const source = signal(0);
      dispose(sub(source, noop));
      const later = watch(source);
      set(source, 1);
      set(source, 2);
      expect(later.seen).toEqual([0, 1, 2]);
    });

    test("after a first sub's first call throws, the next sub is called on every change", () => {
      expect.assertions(1);
      const source = signal(0);
      thrownBy(() => {
        sub(source, () => {
          throw new Error("first call");
        });
      });
      const later = watch(source);
      set(source, 1);
      set(source, 2);
      expect(later.seen).toEqual([0, 1, 2]);
    });

    test("a first sub whose first call threw is never called again", () => {
      expect.assertions(1);
      const source = signal(0);
      let calls = 0;
      thrownBy(() => {
        sub(source, () => {
          calls++;
          throw new Error("first call");
        });
      });
      watch(source);
      set(source, 1);
      expect(calls).toBe(1);
    });
  });

  describe("nodes after the first sub", () => {
    test("disposing a node's handle again after a newer node was made leaves that node subscribed", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const older = sub(source, noop);
      dispose(older);
      const newer = watch(source);
      dispose(older);
      set(source, 1);
      expect(newer.seen).toEqual([0, 1]);
    });
  });

  describe("notification: the first sub, then the nodes", () => {
    test("Characterization: the first sub is called first, then the nodes newest first", () => {
      expect.assertions(1);
      const source = signal(0);
      const order: string[] = [];
      for (const name of ["first", "older", "newer"]) {
        sub(source, (value) => {
          if (value === 1) order.push(name);
        });
      }
      set(source, 1);
      expect(order).toEqual(["first", "newer", "older"]);
    });

    test("the first sub disposing itself mid-notification skips no node", () => {
      expect.assertions(2);
      const source = signal(0);
      const first: Effect = sub(source, (value) => {
        if (value === 1) dispose(first);
      });
      const older = watch(source);
      const newer = watch(source);
      set(source, 1);
      expect(older.seen).toEqual([0, 1]);
      expect(newer.seen).toEqual([0, 1]);
    });

    test("the first sub disposing a node before the walk reaches it keeps that node from being called", () => {
      expect.assertions(1);
      const source = signal(0);
      const targets: Effect[] = [];
      sub(source, (value) => {
        if (value === 1) for (const each of targets) dispose(each);
      });
      const node = watch(source);
      targets.push(node.handle);
      set(source, 1);
      expect(node.seen).toEqual([0]);
    });

    test("a node that disposes the first sub and writes again keeps the first sub from that write", () => {
      expect.assertions(1);
      const source = signal(0);
      const first = watch(source);
      sub(source, (value) => {
        if (value === 1) {
          dispose(first.handle);
          set(source, 2);
        }
      });
      set(source, 1);
      expect(first.seen).toEqual([0, 1]);
    });

    test("a node disposing itself and the node after it while called skips no older node", () => {
      expect.assertions(2);
      const source = signal(0);
      sub(source, noop);
      const oldest = watch(source);
      const middle = watch(source);
      const newest: Effect = sub(source, (value) => {
        if (value === 1) {
          dispose(newest);
          dispose(middle.handle);
        }
      });
      set(source, 1);
      expect(oldest.seen).toEqual([0, 1]);
      expect(middle.seen).toEqual([0]);
    });

    test("a walk standing on a node that disposed itself and the next two reaches the node after them", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const last = watch(source);
      const victims = [watch(source), watch(source)];
      const handle: Effect = sub(source, (value) => {
        if (value === 1) {
          dispose(handle);
          for (const victim of victims.toReversed()) dispose(victim.handle);
        }
      });
      set(source, 1);
      expect([last.seen, ...victims.map(({ seen }) => seen)]).toEqual([[0, 1], [0], [0]]);
    });

    // The walk reads the value per node, so the nodes after the writer get the newer value in it,
    // and the walk of the queued write finds them up to date
    test("a write inside a callback reaches each node after the writer once, with the newer value", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const after = watch(source);
      const writer = sub(source, (value) => {
        if (value === 1) set(source, 2);
      });
      set(source, 1);
      dispose(writer);
      expect(after.seen).toEqual([0, 2]);
    });

    // The contract allows delivering the reset value again (a skipped change); the record skips it
    test("Characterization: a value a callback writes and resets within one notification never reaches the nodes after it", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const after = watch(source);
      const writer = sub(source, (value) => {
        if (value === 1) set(source, 0);
      });
      set(source, 1);
      dispose(writer);
      expect(after.seen).toEqual([0]);
    });

    test("a node after the first sub's write is not called again with the older value", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, (value) => {
        if (value === 1) set(source, 2);
      });
      const node = watch(source);
      set(source, 1);
      expect(node.seen).toEqual([0, 2]);
    });

    test("a node made while its signal notifies gets a later sub's write", () => {
      expect.assertions(1);
      const source = signal(0);
      let made: number[] = [];
      sub(source, (value) => {
        if (value === 1) made = watch(source).seen;
      });
      sub(source, (value) => {
        if (value === 1) set(source, 2);
      });
      set(source, 1);
      expect(made).toEqual([1, 2]);
    });

    // The node walk starts after the first sub's call, so it reaches a node that call made: the
    // record keeps it from a second call
    test("a node the first sub makes while its signal notifies is called once, at creation", () => {
      expect.assertions(1);
      const source = signal(0);
      let made: number[] = [];
      sub(source, (value) => {
        if (value === 1) made = watch(source).seen;
      });
      set(source, 1);
      expect(made).toEqual([1]);
    });

    test("after a node's first call throws, the subs around it are each called once per change", () => {
      expect.assertions(3);
      const source = signal(0);
      const first = watch(source);
      const before = watch(source);
      thrownBy(() => {
        sub(source, () => {
          throw new Error("first call");
        });
      });
      const after = watch(source);
      set(source, 1);
      expect(first.seen).toEqual([0, 1]);
      expect(before.seen).toEqual([0, 1]);
      expect(after.seen).toEqual([0, 1]);
    });
  });

  describe("records", () => {
    test("the first sub writing its own signal is called again with that value", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 1) set(source, 2);
      });
      set(source, 1);
      expect(seen).toEqual([0, 1, 2]);
    });

    test("a node writing its own signal is called again with that value", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 1) set(source, 2);
      });
      set(source, 1);
      expect(seen).toEqual([0, 1, 2]);
    });

    test("a first sub that wrote its signal while called gets a later write back to the value it was called with", () => {
      expect.assertions(1);
      const source = signal(0);
      let wrote = false;
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 1 && !wrote) {
          wrote = true;
          set(source, 2);
        }
      });
      watch(source);
      set(source, 1);
      // Its last call got 2, its own write
      set(source, 1);
      expect(seen.at(-1)).toBe(1);
    });

    test("a node that wrote its signal while called gets a later write back to the value it was called with", () => {
      expect.assertions(1);
      const source = signal(0);
      watch(source);
      let wrote = false;
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 1 && !wrote) {
          wrote = true;
          set(source, 2);
        }
      });
      set(source, 1);
      // Its last call got 2, its own write
      set(source, 1);
      expect(seen.at(-1)).toBe(1);
    });

    // The record is stored before the call, so a call that throws still records its value
    test("a first sub whose call threw is called with a later write back to its previous value", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 1) throw new Error("first sub");
      });
      thrownBy(() => {
        set(source, 1);
      });
      set(source, 0);
      expect(seen).toEqual([0, 1, 0]);
    });

    // As above
    test("a node whose call threw is called with a later write back to its previous value", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 1) throw new Error("node");
      });
      thrownBy(() => {
        set(source, 1);
      });
      set(source, 0);
      expect(seen).toEqual([0, 1, 0]);
    });

    test("a first call of the first sub that writes its own signal is called again with that value", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 0) set(source, 1);
      });
      expect(seen).toEqual([0, 1]);
    });

    test("a first call of a node that writes its own signal is called again with that value", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 0) set(source, 1);
      });
      expect(seen).toEqual([0, 1]);
    });
  });

  describe("batch", () => {
    test("Characterization: a batch end walks the signals newest write first", () => {
      expect.assertions(1);
      const order: string[] = [];
      const signals = ["a", "b", "c"].map((name) => {
        const source = signal(0);
        sub(source, (value) => {
          if (value === 1) order.push(name);
        });
        return source;
      });
      batch(() => {
        for (const source of signals) set(source, 1);
      });
      expect(order).toEqual(["c", "b", "a"]);
    });

    test("a signal changed, restored and changed again in one batch calls its sub once with the final value", () => {
      expect.assertions(1);
      const source = signal(0);
      const watcher = watch(source);
      batch(() => {
        set(source, 1);
        set(source, 0);
        set(source, 2);
      });
      expect(watcher.seen).toEqual([0, 2]);
    });

    test("a node made after a write learns of the restore", () => {
      expect.assertions(1);
      const source = signal(0);
      watch(source);
      let late: number[] = [];
      batch(() => {
        set(source, 1);
        late = watch(source).seen;
        set(source, 0);
      });
      expect(late).toEqual([1, 0]);
    });

    test("a first sub made after a write learns of the restore", () => {
      expect.assertions(1);
      const source = signal(0);
      let late: number[] = [];
      batch(() => {
        set(source, 1);
        late = watch(source).seen;
        set(source, 0);
      });
      expect(late).toEqual([1, 0]);
    });

    test("a node made in a batch whose first call's write is restored before the end is not called again", () => {
      expect.assertions(1);
      const source = signal(2);
      watch(source);
      const seen: number[] = [];
      batch(() => {
        sub(source, (value) => {
          seen.push(value);
          if (seen.length === 1) set(source, 0);
        });
        set(source, 2);
      });
      expect(seen).toEqual([2]);
    });

    test("a first sub made in a batch whose first call's write is restored before the end is not called again", () => {
      expect.assertions(1);
      const source = signal(2);
      const seen: number[] = [];
      batch(() => {
        sub(source, (value) => {
          seen.push(value);
          if (seen.length === 1) set(source, 0);
        });
        set(source, 2);
      });
      expect(seen).toEqual([2]);
    });

    test("a callback's batch at a batch end does not call a sub again with the value it is being called with", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        // Inside a callback: its end delivers nothing, the outer pass does
        batch(noop);
      });
      batch(() => {
        set(source, 1);
        set(source, 2);
      });
      expect(seen).toEqual([0, 2]);
    });

    // Characterization: the end pops the newest write first, and a batch a callback runs there
    // delivers nothing at its own end, so the outer end delivers the rest after that callback
    test("a callback's batch at a batch end leaves the signals the outer end has not reached to that end", () => {
      expect.assertions(1);
      const pending = signal(0);
      const source = signal(0);
      const later = watch(pending);
      let seenInside: number[] = [];
      const runner = sub(source, (value) => {
        if (value === 1) {
          batch(noop);
          seenInside = [...later.seen];
        }
      });
      batch(() => {
        set(pending, 1);
        set(source, 1);
      });
      dispose(runner);
      expect([seenInside, later.seen]).toEqual([[0], [0, 1]]);
    });

    // Characterization: so the outer end, not that callback's batch, rethrows the pending sub's error
    test("an error from a signal pending at a batch end surfaces from the outer end, not a callback's batch", () => {
      expect.assertions(1);
      const pending = signal(0);
      const source = signal(0);
      const error = new Error("pending");
      sub(pending, (value) => {
        if (value === 1) throw error;
      });
      let caught: unknown;
      sub(source, (value) => {
        if (value === 1)
          caught = thrownBy(() => {
            batch(noop);
          });
      });
      const outer = thrownBy(() => {
        batch(() => {
          set(pending, 1);
          set(source, 1);
        });
      });
      expect([caught, outer]).toEqual([undefined, error]);
    });

    // Regression: a batch a callback ran at a batch end popped every signal still pending, inside
    // that callback, so the end nested once per pending signal and overflowed the stack
    test("a batch end over 100k signals whose subs each run a batch calls every sub with the final value", () => {
      expect.assertions(1);
      const rows = Array.from({ length: 100_000 }, () => signal(0));
      let updated = 0;
      const update = (value: number): void => {
        if (value === 1) updated++;
        batch(noop);
      };
      for (const row of rows) sub(row, update);
      const error = thrownBy(() => {
        batch(() => {
          for (const row of rows) set(row, 1);
        });
      });
      expect([error, updated]).toEqual([undefined, rows.length]);
    });

    test("a batch a callback opens at a batch end delivers its write to a signal still pending there", () => {
      expect.assertions(2);
      const left = signal(0);
      const right = signal(0);
      // Whichever is notified first writes the other, which is still waiting in the queue
      const { seen: leftSeen } = watch(left);
      const { seen: rightSeen } = watch(right);
      sub(left, (value) => {
        if (value === 1) {
          batch(() => {
            set(right, 2);
          });
        }
      });
      sub(right, (value) => {
        if (value === 1) {
          batch(() => {
            set(left, 2);
          });
        }
      });
      batch(() => {
        set(left, 1);
        set(right, 1);
      });
      expect(leftSeen.at(-1)).toBe(left.v);
      expect(rightSeen.at(-1)).toBe(right.v);
    });
  });

  describe("errors", () => {
    test("a throwing first sub stops no node", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, (value) => {
        if (value === 1) throw new Error("first sub");
      });
      const node = watch(source);
      thrownBy(() => {
        set(source, 1);
      });
      expect(node.seen).toEqual([0, 1]);
    });

    // Characterization: the last error caught wins; the first sub is called first, so a node's
    // error replaces its
    test("set rethrows a later node's error, not the first sub's", () => {
      expect.assertions(1);
      const source = signal(0);
      const error = new Error("node");
      sub(source, (value) => {
        if (value === 1) throw new Error("first sub");
      });
      sub(source, (value) => {
        if (value === 1) throw error;
      });
      expect(
        thrownBy(() => {
          set(source, 1);
        }),
      ).toBe(error);
    });

    test("an error from the subs a callback's write reaches is rethrown by the outer write, not into that callback", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const error = new Error("target");
      sub(target, (value) => {
        if (value === 1) throw error;
      });
      let caught: unknown;
      sub(source, (value) => {
        if (value === 1)
          caught = thrownBy(() => {
            set(target, 1);
          });
      });
      const outer = thrownBy(() => {
        set(source, 1);
      });
      expect([caught, outer]).toEqual([undefined, error]);
    });

    test("an error from the subs a callback's write reaches is rethrown after every sub of the outer signal ran", () => {
      expect.assertions(2);
      const source = signal(0);
      const target = signal(0);
      const error = new Error("target");
      sub(source, noop);
      const last = watch(source);
      sub(target, (value) => {
        if (value === 1) throw error;
      });
      sub(source, (value) => {
        set(target, value);
      });
      const caught = thrownBy(() => {
        set(source, 1);
      });
      expect(caught).toBe(error);
      expect(last.seen).toEqual([0, 1]);
    });
    // Characterization: the contract leaves open which of the two propagates
    test("a batch whose body and end both throw rethrows the end's error", () => {
      expect.assertions(1);
      const source = signal(0);
      const error = new Error("end");
      sub(source, (value) => {
        if (value === 1) throw error;
      });
      expect(
        thrownBy(() => {
          batch(() => {
            set(source, 1);
            throw new Error("body");
          });
        }),
      ).toBe(error);
    });
  });

  describe("queued writes", () => {
    test("a callback's write to another signal reaches that signal's subs after the callback returns", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const log: string[] = [];
      sub(target, (value) => {
        log.push(`target ${value}`);
      });
      sub(source, (value) => {
        if (value === 1) {
          set(target, 1);
          log.push("source returns");
        }
      });
      set(source, 1);
      expect(log).toEqual(["target 0", "source returns", "target 1"]);
    });

    test("a callback that writes its own signal is called again after it returns, with the new value", () => {
      expect.assertions(1);
      const source = signal(0);
      const log: string[] = [];
      sub(source, (value) => {
        log.push(`start ${value}`);
        if (value === 1) set(source, 2);
        log.push(`end ${value}`);
      });
      set(source, 1);
      expect(log).toEqual(["start 0", "end 0", "start 1", "end 1", "start 2", "end 2"]);
    });

    test("a sub made in a callback whose first call writes its own signal is called again after that call", () => {
      expect.assertions(1);
      const source = signal(0);
      const own = signal(0);
      const log: string[] = [];
      sub(source, (value) => {
        if (value === 1) {
          sub(own, (ownValue) => {
            log.push(`start ${ownValue}`);
            if (ownValue === 0) set(own, 1);
            log.push(`end ${ownValue}`);
          });
        }
      });
      set(source, 1);
      expect(log).toEqual(["start 0", "end 0", "start 1", "end 1"]);
    });

    // Far past the stack depth a recursion per link reaches (about 4k on V8, 15k on JSC)
    test("a chain of 100k subs, each writing the next signal, delivers to the last", () => {
      expect.assertions(1);
      const last = signal(0);
      const chain = [...Array.from({ length: 99_999 }, () => signal(0)), last];
      for (let index = 0; index < chain.length - 1; index++) {
        const next = chain[index + 1];
        sub(chain[index], (value) => {
          set(next, value);
        });
      }
      const { seen } = watch(last);
      const error = thrownBy(() => {
        set(chain[0], 1);
      });
      expect([error, seen.at(-1)]).toEqual([undefined, 1]);
    });

    test("a batch a callback runs is delivered after that callback returns, not at the batch's end", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const log: string[] = [];
      sub(target, (value) => {
        log.push(`target ${value}`);
      });
      sub(source, (value) => {
        if (value === 1) {
          batch(() => {
            set(target, 1);
          });
          log.push("batch returned");
        }
      });
      set(source, 1);
      expect(log).toEqual(["target 0", "batch returned", "target 1"]);
    });

    test("a callback's write at a batch end reaches its signal's subs after the callback returns", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const log: string[] = [];
      sub(target, (value) => {
        log.push(`target ${value}`);
      });
      sub(source, (value) => {
        if (value === 1) {
          set(target, 1);
          log.push("source returns");
        }
      });
      batch(() => {
        set(source, 1);
      });
      expect(log).toEqual(["target 0", "source returns", "target 1"]);
    });

    test("a sub a callback disposes after writing its signal is not called for that write", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      sub(target, noop);
      let calls = 0;
      const later = sub(target, () => {
        calls++;
      });
      sub(source, (value) => {
        if (value === 1) {
          set(target, 1);
          dispose(later);
        }
      });
      set(source, 1);
      expect(calls).toBe(1);
    });

    test("a callback writing a signal 1000 times calls that signal's sub once, with the last value", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const { seen } = watch(target);
      sub(source, (value) => {
        if (value === 1) for (let write = 1; write <= 1000; write++) set(target, write);
      });
      set(source, 1);
      expect(seen).toEqual([0, 1000]);
    });

    test("a sub a callback creates after writing its signal is called once, at creation", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      sub(target, noop);
      let seen: number[] = [];
      sub(source, (value) => {
        if (value === 1) {
          set(target, 1);
          ({ seen } = watch(target));
        }
      });
      set(source, 1);
      expect(seen).toEqual([1]);
    });
  });

  describe("batches in callbacks and first calls", () => {
    test("a callback's batch that throws leaves the callback's later writes queued", () => {
      expect.assertions(2);
      const source = signal(0);
      const target = signal(0);
      const log: string[] = [];
      sub(target, (value) => {
        log.push(`target ${value}`);
      });
      sub(source, (value) => {
        if (value === 0) return;
        thrownBy(() => {
          batch(() => {
            throw new Error("body");
          });
        });
        set(target, value);
        log.push("writer returns");
      });
      set(source, 1);
      expect(log).toEqual(["target 0", "writer returns", "target 1"]);
      expect(atRest()).toEqual(REST);
    });

    test("nested batches inside a callback deliver after the callback returns, not at their ends", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const log: string[] = [];
      sub(target, (value) => {
        log.push(`target ${value}`);
      });
      sub(source, (value) => {
        if (value === 0) return;
        batch(() => {
          batch(() => {
            set(target, value);
          });
          log.push("inner end");
        });
        log.push("outer end");
      });
      set(source, 1);
      expect(log).toEqual(["target 0", "inner end", "outer end", "target 1"]);
    });

    test("a batch inside an at-rest first call delivers after the first call returns, before sub returns", () => {
      expect.assertions(1);
      const target = signal(0);
      const log: string[] = [];
      sub(target, (value) => {
        log.push(`target ${value}`);
      });
      sub(signal(0), () => {
        batch(() => {
          set(target, 1);
        });
        log.push("first call returns");
      });
      log.push("sub returned");
      expect(log).toEqual(["target 0", "first call returns", "target 1", "sub returned"]);
    });
  });

  describe("first call", () => {
    test("a first call that writes its own signal is called again after it returns, before sub returns", () => {
      expect.assertions(1);
      const source = signal(0);
      const log: string[] = [];
      sub(source, (value) => {
        log.push(`start ${value}`);
        if (value === 0) set(source, 1);
        log.push(`end ${value}`);
      });
      log.push("sub returned");
      expect(log).toEqual(["start 0", "end 0", "start 1", "end 1", "sub returned"]);
    });

    test("a first call's write to another signal reaches its subs after the first call returns", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const log: string[] = [];
      sub(target, (value) => {
        log.push(`target ${value}`);
      });
      sub(source, () => {
        set(target, 1);
        log.push("first call returns");
      });
      expect(log).toEqual(["target 0", "first call returns", "target 1"]);
    });

    test("sub rethrows an error from the subs its first call's write reached", () => {
      expect.assertions(1);
      const target = signal(0);
      const error = new Error("target");
      sub(target, (value) => {
        if (value === 1) throw error;
      });
      expect(
        thrownBy(() => {
          sub(signal(0), () => {
            // The first call itself throws nothing
            thrownBy(() => {
              set(target, 1);
            });
          });
        }),
      ).toBe(error);
    });

    test("a sub whose first call's writes made sub throw is never called again", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      sub(target, (value) => {
        if (value === 1) throw new Error("target");
      });
      let calls = 0;
      thrownBy(() => {
        sub(source, () => {
          calls++;
          set(target, 1);
        });
      });
      set(source, 1);
      expect(calls).toBe(1);
    });

    // Characterization: the newest queued signal is delivered first
    test("a sub made inside an at-rest first call is held too, and both are delivered after the outer first call", () => {
      expect.assertions(1);
      const a = signal(0);
      const b = signal(0);
      const log: string[] = [];
      sub(a, (value) => {
        log.push(`a ${value}`);
        if (value === 0) {
          sub(b, (bValue) => {
            log.push(`b ${bValue}`);
            if (bValue === 0) {
              set(b, 1);
              set(a, 1);
            }
          });
          log.push("a first returns");
        }
      });
      log.push("sub returned");
      expect(log).toEqual(["a 0", "b 0", "a first returns", "a 1", "b 1", "sub returned"]);
    });

    test("a sub made in a callback whose first call throws is disposed, and its writes reach others after the callback", () => {
      expect.assertions(3);
      const source = signal(0);
      const inner = signal(0);
      const target = signal(0);
      const log: string[] = [];
      sub(target, (value) => {
        log.push(`target ${value}`);
      });
      let innerCalls = 0;
      sub(source, (value) => {
        if (value === 0) return;
        const error = thrownBy(() => {
          sub(inner, (innerValue) => {
            // Writes once, so a sub left subscribed is a count, not an endless loop
            if (++innerCalls > 1) return;
            set(target, value);
            set(inner, innerValue + 1);
            throw new Error("first");
          });
        });
        log.push(`caught ${(error as Error).message}`, "outer returns");
      });
      set(source, 1);
      expect(log).toEqual(["target 0", "caught first", "outer returns", "target 1"]);
      set(inner, 5);
      expect(innerCalls).toBe(1);
      expect(atRest()).toEqual(REST);
    });

    // Characterization: which error reaches the caller is unspecified; this core rethrows the last
    test("when an at-rest first call and the delivery of its writes both throw, sub rethrows the delivery's error", () => {
      expect.assertions(2);
      const target = signal(0);
      sub(target, (value) => {
        if (value === 1) throw new Error("delivery");
      });
      const error = thrownBy(() => {
        sub(signal(0), () => {
          set(target, 1);
          throw new Error("first");
        });
      });
      expect((error as Error).message).toBe("delivery");
      expect(atRest()).toEqual(REST);
    });

    test("an at-rest first call that writes its signal and throws, whose writes' delivery throws too, is not called again", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      sub(target, (value) => {
        if (value === 1) throw new Error("delivery");
      });
      let calls = 0;
      thrownBy(() => {
        sub(source, () => {
          calls++;
          set(target, 1);
          set(source, 1);
          throw new Error("first");
        });
      });
      set(source, 2);
      expect(calls).toBe(1);
    });

    test("a first call that disposes its own sub and writes its signal is not called again", () => {
      expect.assertions(2);
      const source = signal(0);
      let calls = 0;
      sub(source, (value) => {
        calls++;
        // The first sub's handle is its signal (characterized above)
        if (value === 0) {
          dispose(source as unknown as Effect);
          set(source, 1);
        }
      });
      const afterSub = calls;
      set(source, 2);
      expect(afterSub).toBe(1);
      expect(calls).toBe(1);
    });
  });

  describe("failed first call", () => {
    /**
     * A sub on `source` whose first call writes `write` (default: its own signal) 1 and then
     * throws; returns how often it was called after that throw.
     */
    const failingWriter = (source: Signal<number>, write = source): (() => number) => {
      let threw = false;
      let after = 0;
      thrownBy(() => {
        sub(source, () => {
          if (threw) after++;
          else {
            set(write, 1);
            threw = true;
            throw new Error("first call");
          }
        });
      });
      return () => after;
    };

    test("a first sub whose first call writes its signal and then throws is not called after it threw", () => {
      expect.assertions(1);
      const source = signal(0);
      const after = failingWriter(source);
      set(source, 2);
      expect(after()).toBe(0);
    });

    test("a node whose first call writes its signal and then throws is not called after it threw", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const after = failingWriter(source);
      set(source, 2);
      expect(after()).toBe(0);
    });

    test("a first call whose write reaches a sub writing its signal, then throws, is not called after it threw", () => {
      expect.assertions(1);
      const source = signal(0);
      const relay = signal(0);
      sub(relay, (value) => {
        set(source, value);
      });
      const after = failingWriter(source, relay);
      expect(after()).toBe(0);
    });

    test("in a batch, a first call that writes its signal and then throws is not called after it threw", () => {
      expect.assertions(1);
      const source = signal(0);
      let after = (): number => -1;
      batch(() => {
        after = failingWriter(source);
      });
      expect(after()).toBe(0);
    });

    test("a failed first call's write still reaches its signal's other subs", () => {
      expect.assertions(1);
      const source = signal(0);
      const { seen } = watch(source);
      failingWriter(source);
      expect(seen).toEqual([0, 1]);
    });

    test("a first call that throws undefined makes sub throw and leaves no sub", () => {
      expect.assertions(1);
      const source = signal(0);
      let calls = 0;
      const result = outcome(() => {
        sub(source, () => {
          calls++;
          // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
          throw undefined;
        });
      });
      set(source, 1);
      expect([result, calls]).toEqual([{ error: undefined }, 1]);
    });
  });

  describe("errors in a pass", () => {
    test("a pass that queued nothing still rethrows a node's thrown undefined", () => {
      expect.assertions(3);
      const source = signal(0);
      const { seen } = watch(source);
      sub(source, (value) => {
        // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
        if (value === 1) throw undefined;
      });
      const result = outcome(() => {
        set(source, 1);
      });
      expect(result).toEqual({ error: undefined });
      expect(seen).toEqual([0, 1]);
      expect(atRest()).toEqual(REST);
    });

    test("a pass that queued nothing still rethrows the first sub's thrown undefined", () => {
      expect.assertions(3);
      const source = signal(0);
      sub(source, (value) => {
        // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
        if (value === 1) throw undefined;
      });
      const { seen } = watch(source);
      const result = outcome(() => {
        set(source, 1);
      });
      expect(result).toEqual({ error: undefined });
      expect(seen).toEqual([0, 1]);
      expect(atRest()).toEqual(REST);
    });

    test("an error in the write's own walk is rethrown after its callback's queued writes are delivered", () => {
      expect.assertions(3);
      const source = signal(0);
      const target = signal(0);
      const { seen } = watch(target);
      sub(source, (value) => {
        if (value === 0) return;
        set(target, value);
        throw new Error("walk");
      });
      const error = thrownBy(() => {
        set(source, 1);
      });
      expect((error as Error).message).toBe("walk");
      expect(seen).toEqual([0, 1]);
      expect(atRest()).toEqual(REST);
    });

    test("a thrown undefined from the delivery of queued writes alone is rethrown by the write that started the pass", () => {
      expect.assertions(3);
      const source = signal(0);
      const target = signal(0);
      sub(source, (value) => {
        set(target, value);
      });
      sub(target, (value) => {
        // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
        if (value === 1) throw undefined;
      });
      const { seen } = watch(target);
      const result = outcome(() => {
        set(source, 1);
      });
      expect(result).toEqual({ error: undefined });
      expect(seen).toEqual([0, 1]);
      expect(atRest()).toEqual(REST);
    });

    test("an error caught in one pass is not rethrown by the next one", () => {
      expect.assertions(2);
      const source = signal(0);
      sub(source, (value) => {
        if (value === 1) throw new Error("once");
      });
      const first = outcome(() => {
        set(source, 1);
      });
      const second = outcome(() => {
        set(source, 2);
      });
      expect(first).toBeDefined();
      expect(second).toBeUndefined();
    });

    // Characterization: which error reaches the caller is unspecified; this core rethrows the last
    test("of an error in the write's walk and one in the delivery of its queued writes, the delivery's reaches the caller", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      sub(target, (value) => {
        if (value !== 0) throw new Error("delivery");
      });
      sub(source, (value) => {
        if (value === 0) return;
        set(target, value);
        throw new Error("walk");
      });
      const error = thrownBy(() => {
        set(source, 1);
      });
      expect((error as Error).message).toBe("delivery");
    });
  });

  describe("dev loop bound", () => {
    test.if(DEV)(
      "dev: a write loop that never settles throws once a pass made a million calls",
      () => {
        expect.assertions(1);
        const source = signal(0);
        sub(source, (value) => {
          if (value > 0) set(source, value + 1);
        });
        expect(() => {
          set(source, 1);
        }).toThrow(/^stage1: cycle: a pass called subs a million times$/u);
      },
    );

    test.if(DEV)(
      "dev: after a NaN self-write throws at the bound, writes call back at once",
      () => {
        expect.assertions(1);
        const source = signal(0);
        sub(source, (value) => {
          if (value !== 0) set(source, Number.NaN);
        });
        thrownBy(() => {
          set(source, 1);
        });
        expect(atRest()).toEqual(REST);
      },
    );

    // The skipped sub keeps its old record, so a pass that inherited the entry would call it
    test.if(DEV)(
      "dev: once the bound throws, the pass drains: a write queued before it reaches no later pass",
      () => {
        expect.assertions(1);
        const loop = signal(0);
        const other = signal(0);
        const { seen } = watch(other);
        sub(loop, (value) => {
          if (value === 1) set(other, 1);
          if (value > 0) set(loop, value + 1);
        });
        thrownBy(() => {
          set(loop, 1);
        });
        const probe = signal(0);
        sub(probe, noop);
        set(probe, 1);
        expect(seen).toEqual([0]);
      },
    );

    // The bound counts every call in one pass, endless or not
    test.if(DEV)("Accepted tradeoff: dev: a pass of more than a million calls throws", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, (value) => {
        if (value > 0 && value < 1_100_000) set(source, value + 1);
      });
      expect(() => {
        set(source, 1);
      }).toThrow(/million/u);
    });

    test.if(!DEV)("production: a pass of 1.1M calls makes every call", () => {
      expect.assertions(1);
      const source = signal(0);
      let calls = 0;
      sub(source, (value) => {
        calls++;
        if (value > 0 && value < 1_100_000) set(source, value + 1);
      });
      calls = 0;
      set(source, 1);
      expect(calls).toBe(1_100_000);
    });

    test.if(DEV)("dev: a first call's write loop throws at the bound and disposes the sub", () => {
      expect.assertions(2);
      const source = signal(0);
      let calls = 0;
      const error = thrownBy(() => {
        sub(source, (value) => {
          calls++;
          set(source, value + 1);
        });
      });
      const before = calls;
      set(source, -5);
      expect((error as Error).message).toContain("million");
      expect(calls).toBe(before);
    });
  });

  // JSC throws RangeError only at calls; the V8 back-edge and OSR-entry throws a pass must survive
  // need V8: test/v8/turbofan.spec.ts
  describe("stack edge", () => {
    // Long enough to cut a walk short; JSC throws only at calls, so longer loops (2000) found no more
    const SUBS = 200;
    const FRAMES = 48;
    const pads = Array.from({ length: 128 }, (_item, slots) =>
      Array.from<number>({ length: slots }).fill(0),
    );

    /**
     * Recurses to the stack limit, then, unwinding, calls `op` with 0 to 127 padding arguments in
     * each of FRAMES frames from the first one where a call fits again, swallowing what it throws:
     * so some call of `op` stops at each point of its work.
     */
    const atStackEdge = (op: () => void): void => {
      const call = (): void => {
        op();
      };
      const tiny = (): number => 0;
      let started = false;
      let swept = 0;
      // try/catch in place, not thrownBy: a helper's own call could overflow outside the `try`
      const deeper = (): void => {
        try {
          deeper();
        } catch {
          // the stack limit
        }
        if (!started) {
          try {
            tiny();
            started = true;
          } catch {
            // not yet below the limit
          }
        }
        if (started && swept < FRAMES) {
          swept++;
          // An index loop: an iterator's calls could overflow outside the `try`
          for (let slots = 0; slots < 128; slots++) {
            try {
              Reflect.apply(call, undefined, pads[slots]);
            } catch {
              // what `op` threw, an overflow included
            }
          }
        }
      };
      deeper();
    };

    /** Signals with a sub each that records its last value, and ops that write them. */
    const fixture = () => {
      const many = Array.from({ length: SUBS }, () => signal(0));
      const lastSeen = many.map(() => 0);
      for (const [index, each] of many.entries()) {
        sub(each, (value) => {
          lastSeen[index] = value;
        });
      }
      const writeMany = (value: number): void => {
        for (let index = 0; index < SUBS; index++) set(many[index], value);
      };
      let value = 0;
      const big = signal(0);
      for (let index = 0; index < SUBS; index++) sub(big, noop);
      const source = signal(0);
      sub(source, writeMany);
      const thrower = signal(0);
      sub(thrower, (thrown) => {
        if (thrown === 0) return;
        writeMany(thrown);
        throw new Error("thrower");
      });
      const nested = signal(0);
      sub(nested, (written) => {
        thrownBy(() => {
          batch(() => {
            writeMany(written);
            throw new Error("inner batch");
          });
        });
      });
      const heldSub = signal(0);
      sub(heldSub, (written) => {
        if (written !== 0) {
          dispose(
            sub(signal(0), () => {
              writeMany(written);
            }),
          );
        }
      });
      const ops: Record<string, () => void> = {
        walk: () => {
          set(big, ++value);
        },
        drain: () => {
          set(source, ++value);
        },
        throwdrain: () => {
          set(thrower, ++value);
        },
        batchwalk: () => {
          batch(() => {
            set(big, ++value);
          });
        },
        batchdrain: () => {
          batch(() => {
            writeMany(++value);
          });
        },
        subdrain: () => {
          dispose(
            sub(signal(0), () => {
              writeMany(++value);
            }),
          );
        },
        subthrow: () => {
          sub(signal(0), () => {
            writeMany(++value);
            throw new Error("first");
          });
        },
        nestedbatch: () => {
          set(nested, ++value);
        },
        heldsub: () => {
          set(heldSub, ++value);
        },
      };
      return { many, lastSeen, ops };
    };

    test.each([
      ["a write to a signal with 200 subs", "walk"],
      ["a write whose callback writes 200 signals", "drain"],
      ["a write whose callback writes 200 signals and throws", "throwdrain"],
      ["a batch writing a signal with 200 subs", "batchwalk"],
      ["a batch writing 200 signals", "batchdrain"],
      ["a sub whose first call writes 200 signals", "subdrain"],
      ["a sub whose first call writes 200 signals and throws", "subthrow"],
      ["a callback whose throwing batch writes 200 signals", "nestedbatch"],
      ["a sub made in a callback whose first call writes 200 signals", "heldsub"],
    ])("%s, run at the stack edge, leaves later writes delivered", (_label, name) => {
      expect.assertions(2);
      const { many, lastSeen, ops } = fixture();
      const op = ops[name];
      atStackEdge(op);
      for (let run = 0; run < 300; run++) thrownBy(op);
      atStackEdge(op);
      expect(atRest()).toEqual(REST);
      // A walk cut short is excused until the signal's next write: rewrite every signal at rest
      for (let index = 0; index < SUBS; index++) set(many[index], -1 - index);
      expect(lastSeen.every((seen, index) => seen === -1 - index)).toBe(true);
    });
  });

  describe("equality", () => {
    test("is ===: NaN over NaN notifies, -0 over 0 does not", () => {
      expect.assertions(1);
      const nan = signal(Number.NaN);
      const zero = signal(0);
      const nanSeen = watch(nan).seen;
      const zeroSeen = watch(zero).seen;
      set(nan, Number.NaN);
      set(zero, -0);
      expect([nanSeen.length, zeroSeen.length]).toEqual([2, 1]);
    });

    test("a node is called when its signal changes to NaN", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const node = watch(source);
      set(source, Number.NaN);
      expect(node.seen).toEqual([0, Number.NaN]);
    });

    test("a batch end calls a sub last called with NaN with the value written in the batch", () => {
      expect.assertions(1);
      const source = signal(Number.NaN);
      const watcher = watch(source);
      batch(() => {
        set(source, 1);
      });
      expect(watcher.seen.at(-1)).toBe(1);
    });

    // No NaN code: a record of NaN never matches, so each queued write walks again
    test("Accepted tradeoff: a batch ending on NaN calls a sub once per write that changed its signal", () => {
      expect.assertions(1);
      const source = signal(0);
      const watcher = watch(source);
      batch(() => {
        set(source, 1);
        set(source, Number.NaN);
      });
      expect(watcher.seen).toEqual([0, Number.NaN, Number.NaN]);
    });

    // No NaN code: the node step starts after the first sub's call, reaches the node that call made,
    // and its NaN record does not match
    test("Accepted tradeoff: a node the first sub makes while its signal notifies NaN is called again by that walk", () => {
      expect.assertions(1);
      const source = signal(0);
      let made: number[] = [];
      sub(source, (value) => {
        if (Number.isNaN(value)) made = watch(source).seen;
      });
      set(source, Number.NaN);
      expect(made).toEqual([Number.NaN, Number.NaN]);
    });

    test("an equal write inside a callback calls no other sub before it returns", () => {
      expect.assertions(1);
      const source = signal(0);
      let seenInside: number[] = [];
      let after: number[] = [];
      sub(source, (value) => {
        if (value === 1) {
          set(source, 1);
          seenInside = [...after];
        }
      });
      ({ seen: after } = watch(source));
      set(source, 1);
      expect(seenInside).toEqual([0]);
    });
  });

  describe("memory", () => {
    test("a disposed first sub's callback is collectable while its signal lives", async () => {
      expect.assertions(1);
      const signals: Signal<number>[] = [];
      const alive = await survivors(() => {
        const source = signal(0);
        signals.push(source);
        // A distinct callback per sub, each held only by it
        const callback = (): void => {};
        dispose(sub(source, callback));
        return callback;
      });
      expect(alive).toBeLessThan(10);
    });

    test("a held disposed node handle keeps no node made after it reachable", async () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const held = sub(source, noop);
      let previous = sub(source, noop);
      dispose(held);
      const alive = await survivors(() => {
        // Made before the previous one is disposed, so it is that one's newer neighbour
        const next = sub(source, noop);
        dispose(previous);
        const disposed = previous;
        previous = next;
        return disposed;
      });
      dispose(held); // held past the collection
      expect(alive).toBeLessThan(10);
    });

    test("a signal whose nodes are disposed newest first keeps none of them", async () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const alive = await survivors(() => {
        const older = sub(source, noop);
        dispose(sub(source, noop));
        dispose(older);
        return older;
      });
      set(source, 1); // the signal lives past the collection
      expect(alive).toBeLessThan(10);
    });

    test("disposing a node twice leaves its signal keeping none of its disposed nodes", async () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      const alive = await survivors(() => {
        const older = sub(source, noop);
        const newer = sub(source, noop);
        dispose(newer);
        dispose(newer);
        dispose(older);
        return older;
      });
      set(source, 1); // the signal lives past the collection
      expect(alive).toBeLessThan(10);
    });

    // sub's catch unlinks the node; the callback alone being dropped would not free it
    test("a signal retains nothing that grows with subs whose first call threw", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop); // takes the slot, so the failing subs are nodes
      const failure = new Error("first call");
      const fail = (): never => {
        throw failure;
      };
      const attempts = (count: number): void => {
        for (let index = 0; index < count; index++) {
          thrownBy(() => {
            sub(source, fail);
          });
        }
      };
      attempts(1000); // warm, so the heap below measures only what the attempts keep
      Bun.gc(true);
      const before = heapStats().heapSize;
      attempts(200_000);
      Bun.gc(true);
      const grown = heapStats().heapSize - before;
      set(source, 1); // the signal lives past the measurement
      // A node is 4 fields: about 10 MB if each stayed linked
      expect(grown).toBeLessThan(2_000_000);
    });

    test("a signal whose first sub was disposed keeps none of the nodes disposed after it", async () => {
      expect.assertions(1);
      const source = signal(0);
      dispose(sub(source, noop));
      const alive = await survivors(() => {
        const node = sub(source, noop);
        dispose(node);
        return node;
      });
      set(source, 1); // the signal lives past the collection
      expect(alive).toBeLessThan(10);
    });

    test("a pass keeps none of the signals it popped", async () => {
      expect.assertions(1);
      const alive = await survivors(() => {
        const source = signal(0);
        const target = signal(0);
        sub(target, noop);
        sub(source, (value) => {
          set(target, value);
        });
        set(source, 1);
        return target;
      });
      expect(alive).toBeLessThan(10);
    });

    test("a pass keeps none of the errors it caught", async () => {
      expect.assertions(1);
      const alive = await survivors(() => {
        const source = signal(0);
        const target = signal(0);
        const error = new Error("each");
        sub(target, (value) => {
          if (value === 1) throw error;
        });
        sub(source, (value) => {
          set(target, value);
        });
        thrownBy(() => {
          set(source, 1);
        });
        return error;
      });
      expect(alive).toBeLessThan(10);
    });
  });

  // A trigger is a set of a value no sub was called with: tests run per write, `trigger` after an
  // in-place push and the oracle, a set of a copy, against one expected outcome
  describe("trigger", () => {
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

    describe("at rest", () => {
      test.each(WRITES)("calls the first sub and every node once more (%s)", (_name, write) => {
        expect.assertions(1);
        const source = signal([1]);
        const subs = [watch(source), watch(source), watch(source)];
        write(source, 2);
        expect(subs.map(({ seen }) => seen.length)).toEqual([2, 2, 2]);
      });

      test("passes the signal's own value", () => {
        expect.assertions(1);
        const value = [1];
        const source = signal(value);
        const { seen } = watch(source);
        trigger(source);
        expect(seen[1]).toBe(value);
      });

      test("leaves the signal's value in place", () => {
        expect.assertions(1);
        const value = [1];
        const source = signal(value);
        watch(source);
        trigger(source);
        expect(source.v).toBe(value);
      });

      test("calls each sub again on each trigger", () => {
        expect.assertions(1);
        const source = signal([0]);
        const { seen } = watch(source);
        trigger(source);
        trigger(source);
        expect(seen).toHaveLength(3);
      });

      test("a set of the same value after a trigger calls no sub", () => {
        expect.assertions(1);
        const source = signal([0]);
        const { seen } = watch(source);
        trigger(source);
        set(source, source.v);
        expect(seen).toHaveLength(2);
      });

      test("a set of a new value after a trigger calls each sub with it", () => {
        expect.assertions(1);
        const source = signal([0]);
        const { seen } = watch(source);
        trigger(source);
        set(source, [1]);
        expect(seen).toEqual([[0], [0], [1]]);
      });

      test("calls the first sub and every node of a signal holding undefined", () => {
        expect.assertions(1);
        // oxlint-disable-next-line unicorn/no-useless-undefined -- the value under test
        const source = signal(undefined);
        const subs = [watch(source), watch(source), watch(source)];
        trigger(source);
        // Not toEqual on `seen`: it ignores undefined array items
        expect(subs.map(({ seen }) => seen.length)).toEqual([2, 2, 2]);
      });

      test("calls the first sub and every node of a signal holding stage1's noop (a disposed sub's callback)", () => {
        expect.assertions(1);
        const source = signal(utilsNoop);
        const subs = [watch(source), watch(source), watch(source)];
        trigger(source);
        expect(subs.map(({ seen }) => seen.length)).toEqual([2, 2, 2]);
      });

      test("on a signal with no subs throws nothing", () => {
        expect.assertions(1);
        const source = signal([0]);
        expect(() => {
          trigger(source);
        }).not.toThrow();
      });

      test("on a signal with no subs, a sub made after it is called once, at creation", () => {
        expect.assertions(1);
        const source = signal([0]);
        trigger(source);
        const { seen } = watch(source);
        expect(seen).toHaveLength(1);
      });
    });

    describe("disposed subs", () => {
      test("a disposed first sub is not called", () => {
        expect.assertions(1);
        const source = signal([0]);
        let calls = 0;
        const first = sub(source, () => {
          calls++;
        });
        watch(source);
        dispose(first);
        trigger(source);
        expect(calls).toBe(1);
      });

      test("the nodes of a signal whose first sub was disposed are called", () => {
        expect.assertions(1);
        const source = signal([0]);
        dispose(sub(source, noop));
        const node = watch(source);
        trigger(source);
        expect(node.seen).toHaveLength(2);
      });

      test("a disposed node is not called", () => {
        expect.assertions(1);
        const source = signal([0]);
        watch(source);
        const node = watch(source);
        dispose(node.handle);
        trigger(source);
        expect(node.seen).toHaveLength(1);
      });
    });

    describe("in callbacks (delivered after the callback returns)", () => {
      test.each(WRITES)(
        "a sub that writes its own signal while called is called again (%s)",
        (_name, write) => {
          expect.assertions(1);
          const source = signal([0]);
          let calls = 0;
          sub(source, () => {
            if (++calls === 2) write(source, 1);
          });
          set(source, [9]);
          expect(calls).toBe(3);
        },
      );

      test.each(WRITES)(
        "a sub's first call that writes its signal is called again before sub returns (%s)",
        (_name, write) => {
          expect.assertions(1);
          const source = signal([0]);
          let calls = 0;
          sub(source, () => {
            if (++calls === 1) write(source, 1);
          });
          expect(calls).toBe(2);
        },
      );

      test.each(WRITES)(
        "a node's write while called reaches each node after it once (%s)",
        (_name, write) => {
          expect.assertions(1);
          const source = signal([0]);
          watch(source);
          const older = watch(source);
          let calls = 0;
          sub(source, () => {
            if (++calls === 2) write(source, 1);
          });
          set(source, [9]);
          expect(older.seen).toHaveLength(2);
        },
      );

      test("a set inside a trigger's walk reaches each node after the writer once, with the new value", () => {
        expect.assertions(1);
        const before = [0];
        const after = [1];
        const source = signal(before);
        let calls = 0;
        sub(source, () => {
          if (++calls === 2) set(source, after);
        });
        const node = watch(source);
        trigger(source);
        expect(node.seen).toEqual([before, after]);
      });

      test("a trigger inside a set's walk reaches each node after the writer once", () => {
        expect.assertions(1);
        const after = [1];
        const source = signal([0]);
        sub(source, (value) => {
          if (value === after && value.length === 1) {
            value.push(2);
            trigger(source);
          }
        });
        const node = watch(source);
        set(source, after);
        expect(node.seen).toHaveLength(2);
      });

      test.each(WRITES)(
        "a write by a sub of another signal calls that signal's subs after the sub returns (%s)",
        (_name, write) => {
          expect.assertions(1);
          const a = signal(0);
          const b = signal([0]);
          const order: string[] = [];
          sub(b, () => {
            order.push("b");
          });
          sub(a, (value) => {
            if (value === 1) write(b, 1);
            order.push("a");
          });
          order.length = 0;
          set(a, 1);
          expect(order).toEqual(["a", "b"]);
        },
      );

      test.each(WRITES)(
        "a write in a callback's own batch calls the subs after that callback returns (%s)",
        (_name, write) => {
          expect.assertions(1);
          const a = signal(0);
          const b = signal([0]);
          const order: string[] = [];
          sub(b, () => {
            order.push("b");
          });
          sub(a, (value) => {
            if (value === 1) {
              batch(() => {
                write(b, 1);
                order.push("body");
              });
            }
            order.push("a");
          });
          order.length = 0;
          batch(() => {
            set(a, 1);
          });
          expect(order).toEqual(["body", "a", "b"]);
        },
      );
    });

    describe("batch", () => {
      test("defers the calls to the batch end", () => {
        expect.assertions(2);
        const source = signal([0]);
        const { seen } = watch(source);
        batch(() => {
          trigger(source);
          expect(seen).toHaveLength(1);
        });
        expect(seen).toHaveLength(2);
      });

      test.each(WRITES)(
        "several writes in a batch call each sub once at its end (%s)",
        (_name, write) => {
          expect.assertions(2);
          const source = signal([0]);
          const first = watch(source);
          const node = watch(source);
          batch(() => {
            write(source, 1);
            write(source, 2);
          });
          expect(first.seen).toHaveLength(2);
          expect(node.seen).toHaveLength(2);
        },
      );

      test("a nested batch's trigger waits for the outermost end", () => {
        expect.assertions(2);
        const source = signal([0]);
        const { seen } = watch(source);
        batch(() => {
          batch(() => {
            trigger(source);
          });
          expect(seen).toHaveLength(1);
        });
        expect(seen).toHaveLength(2);
      });

      test("a trigger, then a write of another value and back, calls each sub with the value", () => {
        expect.assertions(1);
        const value = [0];
        const source = signal(value);
        const { seen } = watch(source);
        batch(() => {
          value.push(1);
          trigger(source);
          set(source, [2]);
          set(source, value);
        });
        expect(seen).toEqual([value, value]);
      });

      test("a trigger, then a set, calls each sub once with the set value", () => {
        expect.assertions(1);
        const source = signal([0]);
        const { seen } = watch(source);
        batch(() => {
          trigger(source);
          set(source, [1]);
        });
        expect(seen).toEqual([[0], [1]]);
      });

      test("a set, then a trigger, calls each sub once with the set value", () => {
        expect.assertions(1);
        const source = signal([0]);
        const { seen } = watch(source);
        batch(() => {
          set(source, [1]);
          trigger(source);
        });
        expect(seen).toEqual([[0], [1]]);
      });

      test("a write and its restore, then a trigger, call each sub with the restored value", () => {
        expect.assertions(1);
        const value = [0];
        const source = signal(value);
        const { seen } = watch(source);
        batch(() => {
          set(source, [1]);
          set(source, value);
          trigger(source);
        });
        expect(seen).toEqual([value, value]);
      });

      test("Accepted tradeoff: a trigger, then a restore of the value a sub was called with, calls it again", () => {
        expect.assertions(1);
        const value = [0];
        const source = signal(value);
        const { seen } = watch(source);
        batch(() => {
          const other = [1];
          set(source, other);
          other.push(2);
          trigger(source);
          set(source, value);
        });
        // A trigger forgets every record, also one of a value the signal no longer holds (a set
        // of an unseen value, then back, calls nothing)
        expect(seen).toEqual([value, value]);
      });

      test("a node made after a trigger is called once, at creation", () => {
        expect.assertions(1);
        const source = signal([0]);
        watch(source);
        let node: { seen: number[][] } | undefined;
        batch(() => {
          trigger(source);
          node = watch(source);
        });
        expect(node?.seen).toHaveLength(1);
      });

      test("a first sub made after a trigger is called once, at creation", () => {
        expect.assertions(1);
        const source = signal([0]);
        let first: { seen: number[][] } | undefined;
        batch(() => {
          trigger(source);
          first = watch(source);
        });
        expect(first?.seen).toHaveLength(1);
      });

      test("a sub made before a trigger is called again at its end", () => {
        expect.assertions(1);
        const source = signal([0]);
        watch(source);
        let node: { seen: number[][] } | undefined;
        batch(() => {
          node = watch(source);
          trigger(source);
        });
        expect(node?.seen).toHaveLength(2);
      });

      test("on a signal with no subs, the batch end throws nothing", () => {
        expect.assertions(1);
        const source = signal([0]);
        expect(() => {
          batch(() => {
            trigger(source);
          });
        }).not.toThrow();
      });
    });

    describe("errors", () => {
      test("a throwing sub stops no other sub", () => {
        expect.assertions(2);
        const source = signal([0]);
        const first = watch(source);
        const older = watch(source);
        let calls = 0;
        sub(source, () => {
          if (++calls === 2) throw new Error("second call");
        });
        thrownBy(() => {
          trigger(source);
        });
        expect(first.seen).toHaveLength(2);
        expect(older.seen).toHaveLength(2);
      });

      test("rethrows a sub's error", () => {
        expect.assertions(1);
        const source = signal([0]);
        const error = new Error("second call");
        let calls = 0;
        sub(source, () => {
          if (++calls === 2) throw error;
        });
        expect(
          thrownBy(() => {
            trigger(source);
          }),
        ).toBe(error);
      });

      test("a batch end rethrows the error of a sub a trigger in it reached", () => {
        expect.assertions(1);
        const source = signal([0]);
        const error = new Error("second call");
        let calls = 0;
        sub(source, () => {
          if (++calls === 2) throw error;
        });
        expect(
          thrownBy(() => {
            batch(() => {
              trigger(source);
            });
          }),
        ).toBe(error);
      });
    });

    // Unsupported (documented): a list keeps the array it rendered and diffs by identity
    describe("a list's items pushed in place, then triggered", () => {
      /** A list of 1 in a detached parent, wired as sub(items, list(...)). */
      const mount = (): { items: Signal<{ id: number }[]>; parent: HTMLElement } => {
        const parent = document.createElement("div");
        const items = signal([{ id: 1 }]);
        sub(
          items,
          list(parent, "id", (item) => {
            const row = document.createElement("p");
            row.textContent = String(item.id);
            return row;
          }),
        );
        return { items, parent };
      };

      test.if(DEV)("dev: the trigger throws the list guard's error", () => {
        expect.assertions(1);
        const { items } = mount();
        items.v.push({ id: 2 });
        expect(() => {
          trigger(items);
        }).toThrow(/^stage1: a list's items array was changed in place/u);
      });

      test.if(!DEV)("Characterization (production): no row is added", () => {
        expect.assertions(1);
        const { items, parent } = mount();
        items.v.push({ id: 2 });
        trigger(items);
        expect(parent.children).toHaveLength(1);
      });
    });

    // Seeded programs run twice: in place (boxes changed in place, then triggered) and with copies
    // (each change sets a new box). The calls (box id and count) must match. A trigger forgets every
    // record, so with copies a change also replaces every box the signal can be set back to.
    describe("differential: a trigger is a set of a new box", () => {
      interface Box {
        readonly id: string;
        n: number;
      }
      interface World {
        readonly signals: Signal<Box>[];
        write: (si: number, k: number) => void;
        change: (si: number) => void;
      }
      const SIGNALS = 3;
      const POOL = 3;
      const pools = (): Box[][] =>
        Array.from({ length: SIGNALS }, (_, si) =>
          Array.from({ length: POOL }, (_unused, k) => ({ id: `${si}${k}`, n: 0 })),
        );
      const inPlace = (): World => {
        const boxes = pools();
        const signals = boxes.map((pool) => signal(pool[0]));
        return {
          signals,
          write: (si, k) => {
            set(signals[si], boxes[si][k]);
          },
          change: (si) => {
            signals[si].v.n++;
            trigger(signals[si]);
          },
        };
      };
      const copies = (): World => {
        const latest = pools();
        const signals = latest.map((pool) => signal(pool[0]));
        return {
          signals,
          write: (si, k) => {
            set(signals[si], latest[si][k]);
          },
          change: (si) => {
            const pool = latest[si];
            const k = pool.findIndex((box) => box.id === signals[si].v.id);
            for (let j = 0; j < POOL; j++) pool[j] = { ...pool[j] };
            pool[k] = { id: pool[k].id, n: pool[k].n + 1 };
            set(signals[si], pool[k]);
          },
        };
      };
      /** Program `seed` in a world: its log of calls and errors. */
      const run = (seed: number, make: () => World): string[] => {
        // mulberry32
        let state = seed;
        /* oxlint-disable no-bitwise unicorn/prefer-math-trunc unicorn/number-literal-case */
        const random = (): number => {
          state = (state + 0x6d_2b_79_f5) | 0;
          let t = Math.imul(state ^ (state >>> 15), 1 | state);
          t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
          return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
        };
        /* oxlint-enable no-bitwise unicorn/prefer-math-trunc unicorn/number-literal-case */
        const pick = (n: number): number => Math.floor(random() * n);
        const world = make();
        const log: string[] = [];
        const handles: Effect[] = [];
        // Bounds what callbacks do, so a self-write loop ends
        let budget = 40;
        let made = 0;
        let calls = 0;
        const op = (inCallback: boolean): void => {
          if (inCallback && budget-- <= 0) return;
          const si = pick(SIGNALS);
          switch (pick(inCallback ? 7 : 6)) {
            case 0:
              world.write(si, pick(POOL));
              break;
            case 1:
            case 2:
              world.change(si);
              break;
            case 3: {
              const id = made++;
              handles.push(
                sub(world.signals[si], (box) => {
                  const call = calls++;
                  log.push(`${id}<${box.id}.${box.n}`);
                  if (random() < 0.35) op(true);
                  if (random() < 0.05) throw new Error(`e${call}`);
                }),
              );
              break;
            }
            case 4:
              if (handles.length > 0) dispose(handles[pick(handles.length)]);
              break;
            case 5:
              batch(() => {
                for (let i = pick(4); i >= 0; i--) op(inCallback);
              });
              break;
            default:
              world.write(si, pick(POOL));
              world.change(si);
          }
        };
        for (let i = 0; i < 15; i++) {
          try {
            op(false);
          } catch (error) {
            log.push(`threw ${(error as Error).message}`);
          }
        }
        return log;
      };

      test("3000 seeded programs log the same calls in both worlds", () => {
        expect.assertions(2);
        let first = "";
        let total = 0;
        for (let seed = 1; seed <= 3000 && first === ""; seed++) {
          const changed = run(seed, inPlace);
          const copied = run(seed, copies);
          total += changed.length;
          const at = changed.findIndex((line, i) => line !== copied[i]);
          if (at !== -1 || changed.length !== copied.length) {
            const i = at === -1 ? Math.min(changed.length, copied.length) : at;
            first = `seed ${seed} call ${i}: in place ${changed[i]}, copies ${copied[i]}`;
          }
        }
        expect(first).toBe("");
        // Guards against programs that call nothing
        expect(total).toBeGreaterThan(30_000);
      });
    });
  });
});
