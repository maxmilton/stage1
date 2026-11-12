// stage1/lite's signals, its design's own edge cases beyond lite-contract.test.ts: the first sub
// held in the signal (the signal is its handle; a disposed slot is never reused), notification's
// two steps (the first sub, then the nodes), records under nested writes and batches, errors and
// memory. Where the contract leaves a choice (sibling order, self-write re-calls, where an error
// surfaces), a test labelled "Characterization" pins this design's choice, so a change to it is
// deliberate. A walk calls the first sub, then the nodes newest first, so "after" in a walk means a
// node created earlier (but after the first sub).
// oxlint-disable vitest/no-conditional-in-test

import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { batch, dispose, set, type Signal, signal, sub, type Sub } from "../../src/lite/signal.ts";

/** A sub that records every value it is called with. */
const watch = <T>(source: Signal<T>): { seen: T[]; handle: Sub } => {
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

describe("lite signals", () => {
  describe("the first sub, held in the signal", () => {
    test("Characterization: the first sub's handle is its signal", () => {
      expect.assertions(1);
      const source = signal(0);
      expect(sub(source, noop)).toBe(source as unknown as Sub);
    });

    test("Characterization: a later sub's handle is not its signal", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      expect(sub(source, noop)).not.toBe(source as unknown as Sub);
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
      const first: Sub = sub(source, (value) => {
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
      const targets: Sub[] = [];
      sub(source, (value) => {
        if (value === 1) for (const each of targets) dispose(each);
      });
      const node = watch(source);
      targets.push(node.handle);
      set(source, 1);
      expect(node.seen).toEqual([0]);
    });

    test("a node that disposes the first sub and writes again keeps the first sub from the nested write", () => {
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
      const newest: Sub = sub(source, (value) => {
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
      const handle: Sub = sub(source, (value) => {
        if (value === 1) {
          dispose(handle);
          for (const victim of victims.toReversed()) dispose(victim.handle);
        }
      });
      set(source, 1);
      expect([last.seen, ...victims.map(({ seen }) => seen)]).toEqual([[0, 1], [0], [0]]);
    });

    // Characterization: the nested walk delivers the newer value to the nodes after the writer, so
    // the resumed outer walk finds them up to date
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

    test("a node after the first sub's nested write is not called again with the older value", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, (value) => {
        if (value === 1) set(source, 2);
      });
      const node = watch(source);
      set(source, 1);
      expect(node.seen).toEqual([0, 2]);
    });

    test("a node made while its signal notifies gets a later sub's nested write", () => {
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
    // Characterization: a sub is called again for its own write (unspecified by the contract)
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

    // Characterization, as above
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
        // Ends at depth 0, so it walks what the outer batch end has not popped yet
        batch(noop);
      });
      batch(() => {
        set(source, 1);
        set(source, 2);
      });
      expect(seen).toEqual([0, 2]);
    });

    // Characterization: the end pops the newest write first, and a batch a callback runs there
    // delivers only the writes made since it began, so the outer end delivers the rest after it
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

    // Characterization: a nested walk's error is thrown into the callback that wrote
    test("an error in a walk a callback's write started is thrown into that callback", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const error = new Error("nested");
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
      set(source, 1);
      expect(caught).toBe(error);
    });

    test("an error a callback lets escape from a nested walk is rethrown by the outer write after every sub ran", () => {
      expect.assertions(2);
      const source = signal(0);
      const target = signal(0);
      const error = new Error("nested");
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

    // Without the early return, the equal write would walk the nodes the outer walk has not reached
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
  });
});
