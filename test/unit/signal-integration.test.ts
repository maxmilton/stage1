// The signal core's integration helpers (within, holder, own, owns, release): the owners list and
// mark build their rows from, and the async bridge (`within(handle, callback)`). Run in both modes:
// `bun test` (dev checks on) and `NODE_ENV=production bun test` (dev checks skip).
// Callbacks under test branch on the value they receive.
// oxlint-disable vitest/no-conditional-in-test

import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  type Computed,
  computed,
  defer,
  dispose,
  type Effect,
  effect,
  get,
  type Holder,
  holder,
  own,
  owns,
  release,
  type Scope,
  scope,
  set,
  signal,
  within,
} from "../../src/signal.ts";

// oxlint-disable-next-line node/no-process-env
const DEV = process.env.NODE_ENV !== "production";

describe("within", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(within).not.toBeAny();
    expectTypeOf(within).toBeFunction();
    // Erased: `A`, `B` and `R` -> `unknown`.
    expectTypeOf(within).parameters.toEqualTypeOf<
      [
        o: Effect | Scope | undefined,
        fn: (a: unknown, b: unknown) => unknown,
        a?: unknown,
        b?: unknown,
      ]
    >();
    expectTypeOf(within).returns.toBeUnknown();
    expectTypeOf(within<number, string, boolean>).parameters.toEqualTypeOf<
      [
        o: Effect | Scope | undefined,
        fn: (a: number, b: string) => boolean,
        a?: number | undefined,
        b?: string | undefined,
      ]
    >();
    expectTypeOf(within<number, string, boolean>).returns.toEqualTypeOf<boolean>();
    expectTypeOf((h: Holder, c: Computed<number>) => {
      expectTypeOf(
        within(h, (a: number, b: string) => a + b.length, 1, "x"),
      ).toEqualTypeOf<number>();
      expectTypeOf(within(h, effect, () => {})).toEqualTypeOf<Effect>();
      // @ts-expect-error - `a` is fn's first argument
      within(h, (a: number) => a, "x");
      // @ts-expect-error - a computed owns nothing
      within(c, () => {});
    }).toBeFunction();
  });

  test("calls fn with a and b and returns its result", () => {
    expect.assertions(1);
    expect(within(undefined, (a: number, b: string) => `${a}${b}`, 1, "x")).toBe("1x");
  });

  test("fn's reads subscribe the running effect to nothing", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      within(undefined, () => get(source));
    });
    set(source, 1);
    dispose(handle);
    expect(runs).toBe(1);
  });

  test("what fn creates is disposed with the given owner", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const page = scope(() => {});
    within(page, () => {
      effect(() => {
        get(source);
        runs++;
      });
    });
    dispose(page);
    set(source, 1);
    expect(runs).toBe(1);
  });

  test("what fn creates in an effect's run belongs to the given owner, not to that run", () => {
    expect.assertions(1);
    const trigger = signal(0);
    const source = signal(0);
    const seen: string[] = [];
    const page = scope(() => {});
    const handle = effect(() => {
      if (get(trigger) === 0)
        within(page, () => {
          effect(() => {
            seen.push(`child ${get(source)}`);
          });
        });
    });
    // The effect's re-run would dispose a child of its own run
    set(trigger, 1);
    set(source, 1);
    dispose(handle);
    dispose(page);
    expect(seen).toEqual(["child 0", "child 1"]);
  });

  test("with no owner given, what fn creates in an effect's run outlives the effect", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: number[] = [];
    let made!: Effect;
    const handle = effect(() => {
      made = within(undefined, effect, () => {
        seen.push(get(source));
      });
    });
    dispose(handle);
    set(source, 1);
    dispose(made);
    expect(seen).toEqual([0, 1]);
  });

  test("a read after within subscribes the running effect", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      within(undefined, () => {});
      get(source);
    });
    set(source, 1);
    dispose(handle);
    expect(runs).toBe(2);
  });

  test("what the running effect creates after within is its own again", () => {
    expect.assertions(1);
    const trigger = signal(0);
    const seen: string[] = [];
    const page = scope(() => {});
    const handle = effect(() => {
      const round = get(trigger);
      within(page, () => {});
      defer(() => {
        seen.push(`cleanup ${round}`);
      });
    });
    set(trigger, 1);
    dispose(page);
    expect(seen).toEqual(["cleanup 0"]);
    dispose(handle);
  });

  // A child's first run inside fn stamps the source with its own run id: the running effect must
  // resume with a fresh one (I4), or it takes that stamp for its own and never links the source
  test("a run reading a source after fn made an effect that read it is subscribed to it", () => {
    expect.assertions(1);
    const source = signal(0);
    const page = scope(() => {});
    let runs = 0;
    const handle = effect(() => {
      runs++;
      within(page, () => {
        effect(() => {
          get(source);
        });
      });
      get(source);
    });
    set(source, 1);
    dispose(handle);
    dispose(page);
    expect(runs).toBe(2);
  });

  test("after fn throws, the running effect's reads subscribe it", () => {
    expect.assertions(1);
    const source = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      try {
        within(undefined, () => {
          throw new Error("fn");
        });
      } catch {
        // Only the tracking afterwards matters
      }
      get(source);
    });
    set(source, 1);
    dispose(handle);
    expect(runs).toBe(2);
  });

  test("after fn throws, what the running effect creates is its own", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const page = scope(() => {});
    const handle = effect(() => {
      try {
        within(page, () => {
          throw new Error("fn");
        });
      } catch {
        // Only the owner afterwards matters
      }
      defer(() => {
        seen.push("cleanup");
      });
    });
    dispose(handle);
    expect(seen).toEqual(["cleanup"]);
    dispose(page);
  });

  describe.if(DEV)("dev checks", () => {
    test("within inside a computed's getter throws on read", () => {
      expect.assertions(1);
      const node = computed(() => within(undefined, () => 1));
      expect(() => get(node)).toThrow("within inside a computed");
    });
  });
});

describe("holder", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(holder).not.toBeAny();
    expectTypeOf(holder).toBeFunction();
    expectTypeOf(holder).parameters.toEqualTypeOf<
      [v?: (() => void) | undefined, g?: unknown, up?: Effect | Scope | undefined]
    >();
    expectTypeOf(holder).returns.toEqualTypeOf<Holder>();
    // A holder is an owner wherever one is accepted (within, dispose, holder's `up`)
    expectTypeOf<Holder>().toExtend<Effect>();
    expectTypeOf<Pick<Holder, "g">>().toEqualTypeOf<{ readonly g: unknown }>();
  });

  test("a holder made in a scope is not disposed with it", () => {
    expect.assertions(1);
    const seen: string[] = [];
    let made!: Holder;
    const owner = scope(() => {
      made = holder(() => {
        seen.push("holder");
      });
    });
    dispose(owner);
    expect(seen).toEqual([]);
    dispose(made);
  });

  test("dispose disposes what was created within it, newest first, then calls v", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const h = holder(() => {
      seen.push("holder");
    });
    within(h, () => {
      defer(() => {
        seen.push("older");
      });
      effect(() => () => {
        seen.push("effect");
      });
      defer(() => {
        seen.push("newer");
      });
    });
    dispose(h);
    expect(seen).toEqual(["newer", "effect", "older", "holder"]);
  });

  test("g is the caller's data until the holder is disposed", () => {
    expect.assertions(2);
    const data = { id: 1 };
    const h = holder(undefined, data);
    expect(h.g).toBe(data);
    dispose(h);
    expect(h.g).toBeUndefined();
  });

  test("an effect made within it re-runs after the holder's up when both read the written signal", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const parent = effect(() => {
      seen.push(`parent ${get(source)}`);
    });
    const h = holder(undefined, undefined, parent);
    // Subscribed after the parent, so a write reaches it first
    within(h, effect, () => {
      seen.push(`child ${get(source)}`);
    });
    set(source, 1);
    dispose(h);
    dispose(parent);
    expect(seen).toEqual(["parent 0", "child 0", "parent 1", "child 1"]);
  });

  test("up defaults to the current owner", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const made: Holder[] = [];
    const parent = effect(() => {
      seen.push(`parent ${get(source)}`);
      // Made once, in the first run, and never owned: the parent's re-run leaves it alone
      if (made.length === 0) made.push(holder());
    });
    within(made[0], effect, () => {
      seen.push(`child ${get(source)}`);
    });
    set(source, 1);
    dispose(made[0]);
    dispose(parent);
    expect(seen).toEqual(["parent 0", "child 0", "parent 1", "child 1"]);
  });
});

describe("own", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(own).not.toBeAny();
    expectTypeOf(own).toBeFunction();
    // Erased: `T` -> its `Holder` constraint.
    expectTypeOf(own).parameters.toEqualTypeOf<[h: Holder]>();
    expectTypeOf(own).returns.toEqualTypeOf<Holder>();
    interface Row extends Holder {
      readonly g: { id: string };
    }
    expectTypeOf(own<Row>).parameters.toEqualTypeOf<[h: Row]>();
    expectTypeOf(own<Row>).returns.toEqualTypeOf<Row>();
    expectTypeOf((e: Effect) => {
      // @ts-expect-error - only a holder can be adopted
      own(e);
    }).toBeFunction();
  });

  test("returns the holder", () => {
    expect.assertions(1);
    const h = holder();
    expect(own(h)).toBe(h);
  });

  test("the current owner disposes an owned holder with itself", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const owner = scope(() => {
      own(
        holder(() => {
          seen.push("holder");
        }),
      );
    });
    dispose(owner);
    expect(seen).toEqual(["holder"]);
  });

  test("an owned holder is torn down in its place among the owner's children, newest first", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const owner = scope(() => {
      defer(() => {
        seen.push("older");
      });
      own(
        holder(() => {
          seen.push("holder");
        }),
      );
      defer(() => {
        seen.push("newer");
      });
    });
    dispose(owner);
    expect(seen).toEqual(["newer", "holder", "older"]);
  });

  test("an effect's re-run disposes the holders its last run owned", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      const round = get(source);
      own(
        holder(() => {
          seen.push(`holder ${round}`);
        }),
      );
    });
    set(source, 1);
    expect(seen).toEqual(["holder 0"]);
    dispose(handle);
  });

  describe.if(DEV)("dev checks", () => {
    test("adopting a holder another owner holds throws", () => {
      expect.assertions(1);
      const h = holder();
      const first = scope(() => {
        own(h);
      });
      expect(() =>
        scope(() => {
          own(h);
        }),
      ).toThrow("own of a holder that already has an owner");
      dispose(first);
    });
  });
});

describe("owns", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(owns).not.toBeAny();
    expectTypeOf(owns).toBeFunction();
    expectTypeOf(owns).parameters.toEqualTypeOf<[h: Holder, after?: unknown]>();
    expectTypeOf(owns).returns.toEqualTypeOf<boolean>();
  });

  test("a new holder owns nothing", () => {
    expect.assertions(1);
    expect(owns(holder())).toBe(false);
  });

  test("a holder owns what was created within it", () => {
    expect.assertions(1);
    const h = holder();
    within(h, () => {
      defer(() => {});
    });
    expect(owns(h)).toBe(true);
  });

  test("a holder whose children were all disposed owns nothing", () => {
    expect.assertions(1);
    const h = holder();
    dispose(within(h, effect, () => {}));
    expect(owns(h)).toBe(false);
  });

  test("with after, whether the holder owns something newer than it", () => {
    expect.assertions(2);
    const h = holder();
    const kept = within(h, effect, () => {});
    expect(owns(h, kept)).toBe(false);
    within(h, () => {
      defer(() => {});
    });
    expect(owns(h, kept)).toBe(true);
  });
});

describe("release", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(release).not.toBeAny();
    expectTypeOf(release).toBeFunction();
    expectTypeOf(release).parameters.toEqualTypeOf<[h: Holder, after?: unknown]>();
    expectTypeOf(release).returns.toBeVoid();
    expectTypeOf(release).returns.not.toBeUndefined();
  });

  test("disposes everything the holder owns, newest first", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const h = holder();
    within(h, () => {
      defer(() => {
        seen.push("older");
      });
      effect(() => () => {
        seen.push("effect");
      });
      defer(() => {
        seen.push("newer");
      });
    });
    release(h);
    expect(seen).toEqual(["newer", "effect", "older"]);
  });

  test("with after, keeps after and what is older", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const h = holder();
    within(h, () => {
      defer(() => {
        seen.push("oldest");
      });
    });
    const kept = within(h, effect, () => () => {
      seen.push("kept");
    });
    within(h, () => {
      defer(() => {
        seen.push("newer");
      });
      defer(() => {
        seen.push("newest");
      });
    });
    release(h, kept);
    expect(seen).toEqual(["newest", "newer"]);
  });

  test("leaves the holder itself live: v uncalled and g kept", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const data = { id: 1 };
    const h = holder(() => {
      seen.push("holder");
    }, data);
    within(h, () => {
      defer(() => {
        seen.push("child");
      });
    });
    release(h);
    expect([seen, h.g]).toEqual([["child"], data]);
  });

  test("a released holder owns what is created within it afterwards", () => {
    expect.assertions(1);
    const seen: string[] = [];
    const h = holder();
    release(h);
    within(h, () => {
      defer(() => {
        seen.push("later");
      });
    });
    dispose(h);
    expect(seen).toEqual(["later"]);
  });

  test("holds the flush: effects a cleanup's write reaches run after the whole release", () => {
    expect.assertions(1);
    const source = signal(0);
    const seen: string[] = [];
    const handle = effect(() => {
      if (get(source) === 1) seen.push("effect");
    });
    const h = holder();
    within(h, () => {
      defer(() => {
        seen.push("older");
      });
      defer(() => {
        seen.push("newer");
        set(source, 1);
      });
    });
    release(h);
    dispose(handle);
    expect(seen).toEqual(["newer", "older", "effect"]);
  });
});
