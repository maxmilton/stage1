// stage1/ultralite's signals beyond lite-contract.test.ts (which runs its one-sub tests on this
// tier): one sub per signal (a second is a dev error; production replaces the first), the signal as
// the handle, unbatched writes in callbacks calling back at once, batch ends (writes their callbacks
// make queue and drain in the same loop), errors, the dev loop bound, the stack edge and memory.
// Run in both modes: `bun test` (dev checks on) and `NODE_ENV=production bun test`.
// oxlint-disable vitest/no-conditional-in-test node/no-process-env

import { describe, expect, test } from "bun:test";
import {
  batch,
  dispose,
  type Effect,
  set,
  type Signal,
  signal,
  sub,
} from "../../src/ultralite/signal.ts";

const DEV = process.env.NODE_ENV !== "production";

/** A sub that records every value it is called with. */
const watch = <T>(source: Signal<T>): T[] => {
  const seen: T[] = [];
  sub(source, (value) => {
    seen.push(value);
  });
  return seen;
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

/** One callback for subs whose calls do not matter. */
const noop = (): void => {};

/** How many of 20 objects from `make` survive a full collection. */
const survivors = async (make: () => object): Promise<number> => {
  const refs = Array.from({ length: 20 }, () => new WeakRef(make()));
  await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
  Bun.gc(true);
  return refs.filter((ref) => ref.deref() !== undefined).length;
};

/** Signals in a chain: each one's sub passes its value to the next through `write`. */
const chain = (links: number, write: (next: Signal<number>, value: number) => void) => {
  const signals = Array.from({ length: links + 1 }, () => signal(0));
  for (let index = 0; index < links; index++) {
    const next = signals[index + 1];
    sub(signals[index], (value) => {
      write(next, value);
    });
  }
  let last = 0;
  sub(signals[links], (value) => {
    last = value;
  });
  return { head: signals[0], last: () => last };
};

describe("ultralite signals", () => {
  describe("one sub per signal", () => {
    test("a sub's handle is its signal", () => {
      expect.assertions(1);
      const source = signal(0);
      expect(sub(source, noop)).toBe(source as unknown as Effect);
    });

    test.if(DEV)("dev: a second sub on a signal holding a live sub throws", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      expect(() => {
        sub(source, noop);
      }).toThrow(/^stage1: sub of a signal that already has a sub; dispose that first$/u);
    });

    test.if(DEV)(
      "dev: a rejected second sub is never called and leaves the first subscribed",
      () => {
        expect.assertions(1);
        const source = signal(0);
        const first = watch(source);
        const second: number[] = [];
        outcome(() => {
          sub(source, (value) => {
            second.push(value);
          });
        });
        set(source, 1);
        expect([first, second]).toEqual([[0, 1], []]);
      },
    );

    test.if(DEV)(
      "dev: a rejected second sub in a batch body leaves the first called at the end",
      () => {
        expect.assertions(1);
        const source = signal(0);
        const seen = watch(source);
        batch(() => {
          set(source, 1);
          outcome(() => {
            sub(source, noop);
          });
        });
        expect(seen).toEqual([0, 1]);
      },
    );

    test.if(!DEV)(
      "production: a second sub replaces the first, which is never called again",
      () => {
        expect.assertions(1);
        const source = signal(0);
        const first = watch(source);
        const second = watch(source);
        set(source, 1);
        expect([first, second]).toEqual([[0], [0, 1]]);
      },
    );

    test.if(!DEV)("production: a sub replaced in a batch body is not called at the end", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen = watch(source);
      batch(() => {
        set(source, 1);
        sub(source, noop);
      });
      expect(seen).toEqual([0]);
    });

    test.if(!DEV)(
      "production: the replacing sub is called at the end only for a change after its creation",
      () => {
        expect.assertions(1);
        const source = signal(0);
        sub(source, noop);
        let seen: number[] = [];
        batch(() => {
          set(source, 1);
          seen = watch(source);
          set(source, 2);
        });
        expect(seen).toEqual([1, 2]);
      },
    );

    test.if(!DEV)(
      "production: a sub made inside the replaced sub's call gets that call's later write",
      () => {
        expect.assertions(1);
        const source = signal(0);
        let seen: number[] = [];
        sub(source, (value) => {
          if (value === 1) {
            seen = watch(source);
            set(source, 2);
          }
        });
        set(source, 1);
        expect(seen).toEqual([1, 2]);
      },
    );

    test("a callback that disposes its own sub may sub its signal again", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      const handle = sub(source, (value) => {
        if (value === 1) {
          dispose(handle);
          sub(source, (each) => {
            seen.push(each);
          });
        }
      });
      set(source, 1);
      set(source, 2);
      expect(seen).toEqual([1, 2]);
    });

    test("a sub made after its signal's sub was disposed is called once per change", () => {
      expect.assertions(1);
      const source = signal(0);
      dispose(sub(source, noop));
      const seen = watch(source);
      set(source, 1);
      set(source, 1);
      set(source, 2);
      expect(seen).toEqual([0, 1, 2]);
    });

    test("Accepted tradeoff: disposing a handle again after its signal got a new sub disposes that sub", () => {
      expect.assertions(1);
      const source = signal(0);
      const first = sub(source, noop);
      dispose(first);
      const seen = watch(source);
      dispose(first);
      set(source, 1);
      expect(seen).toEqual([0]);
    });

    test("Accepted tradeoff: a first call that disposes its sub, subs its signal again and throws leaves the signal with no sub", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      outcome(() => {
        sub(source, () => {
          dispose(source as unknown as Effect);
          sub(source, (value) => {
            seen.push(value);
          });
          throw new Error("after re-subbing");
        });
      });
      set(source, 1);
      expect(seen).toEqual([0]);
    });
  });

  describe("writes in callbacks outside batches", () => {
    test("a write in a callback calls the written signal's sub before the callback goes on", () => {
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
      expect(log).toEqual(["target 0", "target 1", "source returns"]);
    });

    test("a callback that writes its own signal is re-entered with the new value", () => {
      expect.assertions(1);
      const source = signal(0);
      const log: string[] = [];
      sub(source, (value) => {
        log.push(`start ${value}`);
        if (value === 1) set(source, 2);
        log.push(`end ${value}`);
      });
      set(source, 1);
      expect(log).toEqual(["start 0", "end 0", "start 1", "start 2", "end 2", "end 1"]);
    });

    test("an error from the sub a callback's write calls is thrown into that callback", () => {
      expect.assertions(1);
      const source = signal(0);
      const target = signal(0);
      const error = new Error("target");
      sub(target, (value) => {
        if (value === 1) throw error;
      });
      let caught: unknown;
      sub(source, (value) => {
        if (value === 1) {
          caught = outcome(() => {
            set(target, 1);
          });
        }
      });
      set(source, 1);
      expect(caught).toEqual({ error });
    });

    test("a 10k chain of subs written outside batches reaches the last", () => {
      expect.assertions(1);
      const { head, last } = chain(10_000, set);
      set(head, 1);
      expect(last()).toBe(1);
    });

    // Each link nests a call: far past the stack (about 16k links on V8, 31k on JSC)
    test("after an unbatched chain overflows the stack, the next batch delivers", () => {
      expect.assertions(1);
      const { head } = chain(300_000, set);
      outcome(() => {
        set(head, 1);
      });
      const other = signal(0);
      const seen = watch(other);
      batch(() => {
        set(other, 1);
      });
      expect(seen).toEqual([0, 1]);
    });
  });

  describe("batch end", () => {
    test("Characterization: a batch end calls the subs newest write first", () => {
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

    test("a callback's write at a batch end reaches its signal's sub after the callback returns", () => {
      expect.assertions(1);
      const [trigger, target] = [signal(0), signal(0)];
      const seen = watch(target);
      let seenAtWrite = -1;
      sub(trigger, (value) => {
        if (value === 1) {
          set(target, 1);
          seenAtWrite = seen.length;
        }
      });
      batch(() => {
        set(trigger, 1);
      });
      expect([seenAtWrite, seen]).toEqual([1, [0, 1]]);
    });

    test("a callback's batch at a batch end delivers its write after the callback returns", () => {
      expect.assertions(1);
      const [trigger, target] = [signal(0), signal(0)];
      const seen = watch(target);
      let seenAfter = -1;
      sub(trigger, (value) => {
        if (value === 1) {
          batch(() => {
            set(target, 1);
          });
          seenAfter = seen.length;
        }
      });
      batch(() => {
        set(trigger, 1);
      });
      expect([seenAfter, seen]).toEqual([1, [0, 1]]);
    });

    test("a callback at a batch end that writes its own signal is called again with that value", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen: number[] = [];
      sub(source, (value) => {
        seen.push(value);
        if (value === 1) set(source, 2);
      });
      batch(() => {
        set(source, 1);
      });
      expect(seen).toEqual([0, 1, 2]);
    });

    test("a sub re-made on a pending signal by a callback at a batch end is called once, at creation", () => {
      expect.assertions(1);
      const [a, b] = [signal(0), signal(0)];
      const seen: string[] = [];
      let done = false;
      // Each re-makes the other's sub, so one re-made sub sits on a pending signal in either order
      const remake = (source: Signal<number>, handle: () => Effect, name: string): void => {
        done = true;
        dispose(handle());
        sub(source, (value) => {
          seen.push(`${name}2:${value}`);
        });
      };
      const ha: Effect = sub(a, (value) => {
        if (value === 1) {
          seen.push(`a:${value}`);
          // oxlint-disable-next-line no-use-before-define -- subs that re-make each other's
          if (!done) remake(b, () => hb, "b");
        }
      });
      const hb: Effect = sub(b, (value) => {
        if (value === 1) {
          seen.push(`b:${value}`);
          if (!done) remake(a, () => ha, "a");
        }
      });
      batch(() => {
        set(a, 1);
        set(b, 1);
      });
      expect(seen).toHaveLength(2);
    });

    test("a callback at a batch end that writes a signal back to its pre-batch value leaves its sub at that value", () => {
      expect.assertions(1);
      const [a, b] = [signal(0), signal(0)];
      const seenA = watch(a);
      sub(b, (value) => {
        if (value === 1) set(a, 0);
      });
      batch(() => {
        set(a, 1);
        set(b, 1);
      });
      // Whichever is delivered first, a's sub must end on a's value
      expect(seenA.at(-1)).toBe(0);
    });

    test("a callback at a batch end that restores a pending signal leaves its sub never called twice with one value", () => {
      expect.assertions(1);
      const [a, b] = [signal(0), signal(0)];
      const seenB = watch(b);
      sub(a, (value) => {
        if (value === 1) set(b, 0);
      });
      batch(() => {
        set(b, 1);
        set(a, 1);
      });
      expect([
        seenB.at(-1),
        seenB.every((value, index) => index === 0 || value !== seenB[index - 1]),
      ]).toEqual([0, true]);
    });

    test("a sub made at a batch end whose first call writes its own signal is called with that value", () => {
      expect.assertions(1);
      const trigger = signal(0);
      const fresh = signal(0);
      const seen: number[] = [];
      sub(trigger, (value) => {
        if (value === 1) {
          sub(fresh, (freshValue) => {
            seen.push(freshValue);
            if (freshValue === 0) set(fresh, 5);
          });
        }
      });
      batch(() => {
        set(trigger, 1);
      });
      expect(seen).toEqual([0, 5]);
    });

    test("every call at a batch end gets its signal's value at the time of the call", () => {
      expect.assertions(1);
      const [a, b] = [signal(0), signal(0)];
      const stale: number[] = [];
      sub(a, (value) => {
        if (value !== a.v) stale.push(value);
        if (value === 1) {
          set(b, 2);
          set(b, 3);
        }
      });
      sub(b, (value) => {
        if (value !== b.v) stale.push(value);
        if (value === 3) set(a, 4);
      });
      batch(() => {
        set(a, 1);
        set(b, 1);
      });
      expect(stale).toEqual([]);
    });

    // Far past the stack depth an unbatched chain reaches
    test("a 100k chain of subs at a batch end, each writing the next signal, reaches the last", () => {
      expect.assertions(1);
      const { head, last } = chain(100_000, set);
      outcome(() => {
        batch(() => {
          set(head, 1);
        });
      });
      expect(last()).toBe(1);
    });

    test("a 100k chain of subs that each batch their write reaches the last", () => {
      expect.assertions(1);
      const { head, last } = chain(100_000, (next, value) => {
        batch(() => {
          set(next, value);
        });
      });
      outcome(() => {
        set(head, 1);
      });
      expect(last()).toBe(1);
    });
  });

  describe("subs made in a batch", () => {
    test("a sub made after the last write is not called at the end", () => {
      expect.assertions(1);
      const source = signal(0);
      let seen: number[] = [];
      batch(() => {
        set(source, 1);
        seen = watch(source);
      });
      expect(seen).toEqual([1]);
    });

    test("a batch that restores the value of the last unbatched write calls nothing", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen = watch(source);
      set(source, 1);
      batch(() => {
        set(source, 2);
        set(source, 1);
      });
      expect(seen).toEqual([0, 1]);
    });

    test("a sub re-made after a disposal in a batch gets only later changes at the end", () => {
      expect.assertions(1);
      const source = signal(0);
      const handle = sub(source, noop);
      let seen: number[] = [];
      batch(() => {
        set(source, 1);
        dispose(handle);
        seen = watch(source);
        set(source, 2);
        set(source, 1);
      });
      expect(seen).toEqual([1]);
    });

    test("a first call that throws in a batch on a written signal is never called at the end", () => {
      expect.assertions(1);
      const source = signal(0);
      let calls = 0;
      batch(() => {
        set(source, 1);
        outcome(() => {
          sub(source, () => {
            calls++;
            throw new Error("first");
          });
        });
        set(source, 2);
      });
      expect(calls).toBe(1);
    });

    test("a sub made in a batch after a failed first call on its signal gets the end's value", () => {
      expect.assertions(1);
      const source = signal(0);
      let seen: number[] = [];
      batch(() => {
        set(source, 1);
        outcome(() => {
          sub(source, () => {
            throw new Error("first");
          });
        });
        seen = watch(source);
        set(source, 2);
      });
      expect(seen).toEqual([1, 2]);
    });
  });

  describe("errors", () => {
    test("sub rethrows a first call's thrown undefined", () => {
      expect.assertions(1);
      expect(
        outcome(() => {
          sub(signal(0), () => {
            // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
            throw undefined;
          });
        }),
      ).toEqual({ error: undefined });
    });

    test("a sub whose first call threw undefined is never called again", () => {
      expect.assertions(1);
      const source = signal(0);
      let calls = 0;
      outcome(() => {
        sub(source, () => {
          calls++;
          // oxlint-disable-next-line no-throw-literal typescript/only-throw-error -- the case under test
          throw undefined;
        });
      });
      set(source, 1);
      expect(calls).toBe(1);
    });

    test("after a batch whose body and end both throw, the next write calls back at once", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, (value) => {
        if (value === 1) throw new Error("end");
      });
      const other = signal(0);
      const seen = watch(other);
      outcome(() => {
        batch(() => {
          set(source, 1);
          throw new Error("body");
        });
      });
      set(other, 1);
      expect(seen).toEqual([0, 1]);
    });

    test("a callback's throwing batch at a batch end leaves later writes unbatched", () => {
      expect.assertions(1);
      const trigger = signal(0);
      const inner = signal(0);
      sub(trigger, (value) => {
        if (value === 1) {
          batch(() => {
            set(inner, 1);
            throw new Error("inner body");
          });
        }
      });
      const seenInner = watch(inner);
      const other = signal(0);
      const seen = watch(other);
      outcome(() => {
        batch(() => {
          set(trigger, 1);
        });
      });
      set(other, 1);
      expect([seenInner, seen]).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });

    test("Characterization: a batch end rethrows the last error caught (newest write first)", () => {
      expect.assertions(1);
      const first = signal(0);
      const second = signal(0);
      const error = new Error("first");
      sub(first, (value) => {
        if (value) throw error;
      });
      sub(second, (value) => {
        if (value) throw new Error("second");
      });
      expect(
        outcome(() => {
          batch(() => {
            set(first, 1);
            set(second, 1);
          });
        })?.error,
      ).toBe(error);
    });

    test("a callback that throws at a batch end after writing another signal gets that write delivered", () => {
      expect.assertions(1);
      const trigger = signal(0);
      const target = signal(0);
      sub(trigger, (value) => {
        if (value === 1) {
          set(target, 1);
          throw new Error("after the write");
        }
      });
      const seen = watch(target);
      outcome(() => {
        batch(() => {
          set(trigger, 1);
        });
      });
      expect(seen).toEqual([0, 1]);
    });
  });

  describe("equality", () => {
    test("loosely equal values written one after another all call back", () => {
      expect.assertions(1);
      const source = signal<unknown>(1);
      const seen = watch(source);
      for (const value of ["1", 1, true, null, undefined, 0, false, ""]) set(source, value);
      expect(seen).toEqual([1, "1", 1, true, null, undefined, 0, false, ""]);
    });

    test("a batch ending on a loosely equal value calls back", () => {
      expect.assertions(1);
      const source = signal<unknown>(1);
      const seen = watch(source);
      batch(() => {
        set(source, "1");
      });
      expect(seen).toEqual([1, "1"]);
    });

    test("a batch writing -0 over 0 calls nothing", () => {
      expect.assertions(1);
      const source = signal(0);
      const seen = watch(source);
      batch(() => {
        set(source, -0);
      });
      expect(seen).toEqual([0]);
    });
  });

  describe("dev loop bound", () => {
    /**
     * Once `on` is set, an endless write loop that fans out: the head's sub writes left and right,
     * and theirs write the head, each a value never written before, so writes stay pending whenever
     * a batch end stops it.
     */
    const loop = (): { on: boolean; head: Signal<number> } => {
      const state = { on: false, head: signal(0) };
      const [left, right] = [signal(0), signal(0)];
      let next = 0;
      const back = (): void => {
        if (state.on) set(state.head, ++next);
      };
      sub(state.head, () => {
        if (state.on) {
          set(left, ++next);
          set(right, ++next);
        }
      });
      sub(left, back);
      sub(right, back);
      return state;
    };

    test.if(DEV)("dev: an endless write loop at a batch end throws", () => {
      expect.assertions(1);
      const state = loop();
      expect(() => {
        batch(() => {
          state.on = true;
          set(state.head, 1);
        });
      }).toThrow(/^stage1: cycle: a batch end called subs a million times$/u);
    });

    // The loop stays on, so a later end that inherited its pending writes would loop again
    test.if(DEV)(
      "dev: after a batch end stopped a write loop, a later batch delivers only its own writes",
      () => {
        expect.assertions(1);
        const state = loop();
        outcome(() => {
          batch(() => {
            state.on = true;
            set(state.head, 1);
          });
        });
        const other = signal(0);
        const seen = watch(other);
        batch(() => {
          set(other, 1);
        });
        expect(seen).toEqual([0, 1]);
      },
    );

    // The bound counts every call at one end, endless or not
    test.if(DEV)("Accepted tradeoff: dev: a batch end of more than a million calls throws", () => {
      expect.assertions(1);
      const sources = Array.from({ length: 1_100_000 }, () => signal(0));
      for (const source of sources) sub(source, noop);
      expect(() => {
        batch(() => {
          for (const source of sources) set(source, 1);
        });
      }).toThrow(/million/u);
    });

    test.if(!DEV)("production: a batch end over 1.1M written signals calls every sub", () => {
      expect.assertions(1);
      let calls = 0;
      const count = (): void => {
        calls++;
      };
      const sources = Array.from({ length: 1_100_000 }, () => signal(0));
      for (const source of sources) sub(source, count);
      calls = 0;
      batch(() => {
        for (const source of sources) set(source, 1);
      });
      expect(calls).toBe(1_100_000);
    });
  });

  // JSC throws RangeError only at calls; the V8 back-edge and OSR-entry throws a batch end must
  // survive need V8: test/v8/maglev.spec.ts
  describe("stack edge", () => {
    // Pads with growing frames, so calls land at many offsets from the stack limit
    const pads: ((fn: () => void) => void)[] = Array.from({ length: 12 }, (_item, size) => {
      const args = Array.from({ length: size }, (_arg, index) => `a${index}`);
      // oxlint-disable-next-line no-new-func typescript/no-implied-eval -- frames of chosen sizes
      return new Function(
        "f",
        ...args,
        `${args.map((arg) => `var l${arg}=${arg};`).join("")}return f();`,
      ) as never;
    });
    /** Runs `attempt` in every frame from the stack limit up, at every pad, swallowing throws. */
    const atEdge = (attempt: () => void): void => {
      // try/catch in place, not a helper: a helper's own call could overflow outside the `try`
      const dive = (): void => {
        try {
          dive();
        } catch {
          // the stack limit
        }
        for (const pad of pads) {
          try {
            pad(attempt);
          } catch {
            // what `attempt` threw, an overflow included
          }
        }
      };
      dive();
    };

    test("after batches run at the stack limit, an unbatched write calls back at once", () => {
      expect.assertions(1);
      const source = signal(0);
      sub(source, noop);
      let next = 0;
      atEdge(() => {
        batch(() => {
          set(source, ++next);
        });
      });
      const other = signal(0);
      const seen = watch(other);
      set(other, 1);
      expect(seen).toEqual([0, 1]);
    });

    test("a sub that throws at the stack limit leaves its callback unsubscribed", () => {
      expect.assertions(1);
      const failed: [Signal<number>, { calls: number }][] = [];
      atEdge(() => {
        const source = signal(0);
        const count = { calls: 0 };
        try {
          sub(source, () => {
            count.calls++;
          });
        } catch {
          if (count.calls <= 1) failed.push([source, count]);
        }
      });
      const zombies = failed.filter(([source, count]) => {
        const before = count.calls;
        set(source, 1);
        return count.calls > before;
      });
      expect(zombies).toHaveLength(0);
    });

    test("a sub that throws at the stack limit inside a batch leaves its callback unsubscribed", () => {
      expect.assertions(1);
      const failed: [Signal<number>, { calls: number }][] = [];
      batch(() => {
        atEdge(() => {
          const source = signal(0);
          const count = { calls: 0 };
          try {
            sub(source, () => {
              count.calls++;
            });
          } catch {
            failed.push([source, count]);
          }
        });
      });
      const zombies = failed.filter(([source, count]) => {
        const before = count.calls;
        set(source, 1);
        return count.calls > before;
      });
      expect(zombies).toHaveLength(0);
    });
  });

  describe("memory", () => {
    test("a signal keeps none of the callbacks of the subs made and disposed on it", async () => {
      expect.assertions(1);
      const source = signal(0);
      const alive = await survivors(() => {
        // A distinct callback per sub, each held only by it
        const callback = (): void => {};
        dispose(sub(source, callback));
        return callback;
      });
      set(source, 1); // the signal lives past the collection
      expect(alive).toBeLessThan(10);
    });

    test("a signal keeps none of the callbacks whose first call threw", async () => {
      expect.assertions(1);
      const source = signal(0);
      const alive = await survivors(() => {
        const callback = (): void => {
          throw new Error("first call");
        };
        outcome(() => {
          sub(source, callback);
        });
        return callback;
      });
      set(source, 1); // the signal lives past the collection
      expect(alive).toBeLessThan(10);
    });

    test("a batch end keeps none of the values its signals held before the batch", async () => {
      expect.assertions(1);
      const kept: Signal<object>[] = [];
      const alive = await survivors(() => {
        const before = {};
        const source = signal(before);
        sub(source, noop);
        batch(() => {
          set(source, {});
        });
        kept.push(source);
        return before;
      });
      expect(alive).toBeLessThan(10);
    });

    test("a batch end keeps none of the signals written in it", async () => {
      expect.assertions(1);
      const alive = await survivors(() => {
        const source = signal(0);
        sub(source, noop);
        batch(() => {
          set(source, 1);
        });
        return source;
      });
      expect(alive).toBeLessThan(10);
    });

    test("a batch end keeps none of the unwatched signals written in it", async () => {
      expect.assertions(1);
      const alive = await survivors(() => {
        const source = signal(0);
        batch(() => {
          set(source, 1);
        });
        return source;
      });
      expect(alive).toBeLessThan(10);
    });

    test.if(DEV)(
      "dev: a batch end stopped by the loop bound keeps none of its pending signals",
      async () => {
        expect.assertions(1);
        let on = false;
        const head = signal(0);
        let next = 0;
        // An endless self-write loop once `on`: each batch below ends at the dev bound
        sub(head, () => {
          if (on) set(head, ++next);
        });
        const alive = await survivors(() => {
          const source = signal(0);
          sub(source, noop);
          on = true;
          outcome(() => {
            batch(() => {
              set(head, ++next);
              set(source, 1);
            });
          });
          on = false;
          return source;
        });
        expect(alive).toBeLessThan(10);
      },
    );
  });
});
