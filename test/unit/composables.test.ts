// What reactive promises (src/composables.ts: header comment and JSDoc): a class's `$key` signal
// and computed fields read and write as plain `key` properties through accessors on its prototype.
// Development builds check each misuse at the call or at the access; production builds drop the
// checks, so each misuse is run in both modes and production must report nothing. Run in both
// modes: `bun test` (development checks on) and `NODE_ENV=production bun test`.
// Class names are unique in this file: development builds warn of a second class with the same
// source text, and a class's name is part of it.
// Classes are written as apps write them, some members only to collide with a key, and some
// constructors branch on their arguments:
// oxlint-disable max-classes-per-file typescript/explicit-member-accessibility class-methods-use-this
// oxlint-disable vitest/no-conditional-in-test

import { describe, expect, expectTypeOf, spyOn, test } from "bun:test";
import type * as Composables from "../../src/composables.ts";
import type { ReactiveKeys } from "../../src/composables.ts";
import * as lite from "../../src/lite/signal.ts";
import {
  batch,
  type Computed,
  computed,
  dispose,
  type Effect,
  effect,
  get,
  scope,
  set,
  type Signal,
  signal,
  sub,
  trigger,
} from "../../src/signal.ts";

// oxlint-disable-next-line node/no-process-env
const DEV = process.env.NODE_ENV !== "production";

// A module instance of its own per evaluation of this file (its imports, the core included, are
// shared): its development state remembers each class source it was given, and a re-run
// (`--rerun-each`) evaluates this file's class literals again
const { reactive } = (await import(
  `../../src/composables.ts?${crypto.randomUUID()}`
)) as typeof Composables;

/** reactive as JavaScript calls it: the types reject the misuses passed to it. */
const untyped = reactive as (C: unknown) => unknown;

const noop = (): void => {};

/**
 * What `fn` reports, in order: ["warn", message] for each console.warn, then ["throw", message] if
 * it throws.
 */
const reports = (fn: () => unknown): [kind: "throw" | "warn", message: string][] => {
  using warn = spyOn(console, "warn").mockImplementation(noop);
  let threw: [kind: "throw", message: string][] = [];
  try {
    fn();
  } catch (error) {
    threw = [["throw", error instanceof Error ? error.message : String(error)]];
  }
  return [...warn.mock.calls.map((args): ["warn", string] => ["warn", String(args[0])]), ...threw];
};

/** Each value `read` returns, in an effect that runs it; disposed at the end of the block (`using`). */
const watch = <T>(read: () => T): { seen: T[] } & Disposable => {
  const seen: T[] = [];
  const fx = effect(() => {
    seen.push(read());
  });
  return {
    seen,
    [Symbol.dispose]: () => {
      dispose(fx);
    },
  };
};

/** Two signal keys and a computed one, as an app writes them (instances are each test's own). */
class Cart {
  declare price: number;
  declare count: number;
  declare readonly total: number;
  readonly $price = signal(2);
  readonly $count = signal(1);
  readonly $total = computed(() => this.price * this.count);
}
// oxlint-disable-next-line vitest/require-hook -- once per class, at module level, after it
reactive(Cart);

describe("reactive", () => {
  test("returns the class it was given", () => {
    expect.assertions(1);
    class Same {
      declare a: number;
      readonly $a = signal(0);
    }
    expect(reactive(Same)).toBe(Same);
  });

  test("a key reads the value of its $ field", () => {
    expect.assertions(1);
    const cart = new Cart();
    set(cart.$price, 5);
    expect(cart.price).toBe(5);
  });

  test("a write to a key sets its $ field", () => {
    expect.assertions(1);
    const cart = new Cart();
    cart.price = 5;
    expect(cart.$price.v).toBe(5);
  });

  test("an effect that reads a key runs again when the key is written", () => {
    expect.assertions(1);
    const cart = new Cart();
    using reads = watch(() => cart.price);
    cart.price = 3;
    expect(reads.seen).toEqual([2, 3]);
  });

  test("an effect that reads one key does not run again when another key is written", () => {
    expect.assertions(1);
    const cart = new Cart();
    using reads = watch(() => cart.price);
    cart.count = 3;
    expect(reads.seen).toEqual([2]);
  });

  test("a write of the value a key holds runs nothing", () => {
    expect.assertions(1);
    const cart = new Cart();
    using reads = watch(() => cart.price);
    cart.price = 2;
    expect(reads.seen).toEqual([2]);
  });

  test("writes to two keys in a batch run an effect that reads both once, with both written", () => {
    expect.assertions(1);
    const cart = new Cart();
    using reads = watch(() => [cart.price, cart.count]);
    batch(() => {
      cart.price = 3;
      cart.count = 4;
    });
    expect(reads.seen).toEqual([
      [2, 1],
      [3, 4],
    ]);
  });

  test("each instance keeps its own state", () => {
    expect.assertions(1);
    const first = new Cart();
    const second = new Cart();
    first.price = 5;
    expect(second.price).toBe(2);
  });

  test("a sub on a key's $ field is called for writes to the key", () => {
    expect.assertions(1);
    const cart = new Cart();
    const seen: number[] = [];
    const s = sub(cart.$count, (count) => {
      seen.push(count);
    });
    cart.count = 3;
    dispose(s);
    expect(seen).toEqual([1, 3]);
  });

  test("a trigger of a key's $ field runs an effect that reads the key", () => {
    expect.assertions(1);
    const cart = new Cart();
    using reads = watch(() => cart.count);
    trigger(cart.$count);
    expect(reads.seen).toEqual([1, 1]);
  });

  test("a constructor's write to a key sets its $ field", () => {
    expect.assertions(1);
    class Started {
      declare count: number;
      readonly $count = signal(0);
      constructor(count = 1) {
        this.reset(count);
      }
      reset(count: number): void {
        this.count = count;
      }
    }
    reactive(Started);
    expect(new Started(2).$count.v).toBe(2);
  });

  test("an instance made before the call gets the keys", () => {
    expect.assertions(1);
    class Early {
      declare a: number;
      readonly $a = signal(1);
    }
    const early = new Early();
    reactive(Early);
    expect(early.a).toBe(1);
  });

  test("types", () => {
    expect.assertions(0);
    class Pair {
      static readonly label = "pair";
      declare a: number;
      declare readonly b: string;
      readonly $a = signal(0);
      readonly $b = computed(() => String(this.a));
    }
    class Box<T> {
      declare value: T;
      readonly $value: Signal<T>;
      constructor(value?: T) {
        this.$value = signal(value as T);
      }
    }
    expectTypeOf(reactive).not.toBeAny();
    expectTypeOf(reactive).toBeFunction();
    // Erased: `T` -> its constraint, whose instance type is `any`, which has no `$` keys: `{}`
    // oxlint-disable-next-line typescript/no-empty-object-type typescript/ban-types
    expectTypeOf(reactive).parameters.toEqualTypeOf<[C: new () => {}]>();
    // oxlint-disable-next-line typescript/no-empty-object-type typescript/ban-types
    expectTypeOf(reactive).returns.toEqualTypeOf<new () => {}>();
    // Identity: the class itself, statics included
    expectTypeOf(reactive<typeof Pair>).parameters.toEqualTypeOf<[C: typeof Pair]>();
    expectTypeOf(reactive<typeof Pair>).returns.toEqualTypeOf<typeof Pair>();
    expectTypeOf(() => reactive(Pair)).returns.toEqualTypeOf<typeof Pair>();
    expectTypeOf(() => reactive(Pair).label).returns.toEqualTypeOf<"pair">();
    // A generic class keeps its type parameter
    expectTypeOf(() => new (reactive(Box))(1).value).returns.toEqualTypeOf<number>();
    // Calls in a never-invoked callback: rejections and accepted tradeoffs
    expectTypeOf(() => {
      class Undeclared {
        declare a: number;
        readonly $a = signal(0);
        readonly $b = signal(0);
      }
      class Mistyped {
        declare a: string;
        readonly $a = signal(0);
      }
      class Narrower {
        declare a: number;
        readonly $a = signal<number | undefined>(0);
      }
      class NarrowerComputed {
        declare readonly a: 1;
        readonly $a = computed(() => 2);
      }
      class MethodKey {
        readonly $reset = signal(0);
        reset(): void {
          set(this.$reset, 0);
        }
      }
      class ValueField {
        declare a: number;
        readonly $a = 0;
      }
      class LiteField {
        declare a: number;
        readonly $a = lite.signal(0);
      }
      class NeedsArgs {
        declare a: number;
        readonly $a: Signal<number>;
        constructor(a: number) {
          this.$a = signal(a);
        }
      }
      class OwnField {
        a = 0;
        readonly $a = signal(0);
      }
      class WritableComputed {
        declare a: number;
        readonly $a = computed(() => 0);
      }
      // @ts-expect-error - the key `b` has no declaration
      reactive(Undeclared);
      // @ts-expect-error - `a` is declared a string for a number signal
      reactive(Mistyped);
      // @ts-expect-error - `a` is declared narrower than its signal's values: reads would claim a
      // number when the signal holds undefined
      reactive(Narrower);
      // @ts-expect-error - `a` is declared narrower than its computed's values
      reactive(NarrowerComputed);
      // @ts-expect-error - `reset` is a method, not the number its signal holds
      reactive(MethodKey);
      // @ts-expect-error - `$a` holds a value, not a signal or computed
      reactive(ValueField);
      // @ts-expect-error - `$a` holds a lite tier's signal
      reactive(LiteField);
      // @ts-expect-error - reactive() constructs the class with no arguments
      reactive(NeedsArgs);
      // Accepted tradeoff: a field of the key's type is a key to the types (development builds
      // throw: it hides the accessor)
      expectTypeOf(reactive(OwnField)).toEqualTypeOf<typeof OwnField>();
      // Accepted tradeoff: `readonly` never affects assignability, so a computed's key declared
      // writable passes (development builds throw at a write)
      expectTypeOf(reactive(WritableComputed)).toEqualTypeOf<typeof WritableComputed>();
    }).toBeFunction();
  });
});

describe("reactive: the instance it makes", () => {
  test("is one, made at the call with no arguments", () => {
    expect.assertions(1);
    const calls: unknown[][] = [];
    class Counted {
      declare a: number;
      readonly $a = signal(0);
      constructor(...args: unknown[]) {
        calls.push(args);
      }
    }
    reactive(Counted);
    expect(calls).toEqual([[]]);
  });

  test("a $ field its constructor sets only for some arguments gets no key", () => {
    expect.assertions(1);
    class Optional {
      declare readonly $extra: Signal<number> | undefined;
      constructor(extra = false) {
        if (extra) this.$extra = signal(1);
      }
    }
    untyped(Optional);
    expect("extra" in new Optional(true)).toBe(false);
  });

  test.serial("is not kept", async () => {
    expect.assertions(1);
    // Development builds warn of the second class this literal makes
    using _ = spyOn(console, "warn").mockImplementation(noop);
    const made: WeakRef<object>[] = [];
    // 20 classes of one instance each, so a stray pointer keeps one instance, not all
    const classes = Array.from({ length: 20 }, () => {
      class Kept {
        declare a: number;
        readonly $a = signal(0);
        constructor() {
          made.push(new WeakRef(this));
        }
      }
      return reactive(Kept);
    });
    await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
    Bun.gc(true);
    // Reading `classes` keeps them, and what reactive() gave their prototypes, alive until here
    expect([made.filter((ref) => ref.deref() !== undefined).length < 10, classes.length]).toEqual([
      true,
      20,
    ]);
  });
});

describe("reactive: computed fields", () => {
  test("a computed's key reads the computed's value", () => {
    expect.assertions(1);
    const cart = new Cart();
    set(cart.$count, 3);
    expect(cart.total).toBe(6);
  });

  test("an effect that reads a computed's key runs again when a signal the computed reads is written", () => {
    expect.assertions(1);
    const cart = new Cart();
    using reads = watch(() => cart.total);
    set(cart.$count, 3);
    expect(reads.seen).toEqual([2, 6]);
  });

  test.if(!DEV)(
    "Accepted tradeoff: production: a write to a computed's key is what it reads until a signal the computed reads is written",
    () => {
      expect.assertions(1);
      const cart = new Cart();
      // Evaluated first: a computed that never ran evaluates at its first read
      get(cart.$total);
      (cart as { total: number }).total = 10;
      const written = cart.total;
      set(cart.$count, 3);
      expect([written, cart.total]).toEqual([10, 6]);
    },
  );
});

describe("reactive: inheritance", () => {
  test("a subclass passed too has its own keys and its base's", () => {
    expect.assertions(1);
    class Parent {
      declare a: number;
      readonly $a = signal(0);
    }
    reactive(Parent);
    class Child extends Parent {
      declare b: number;
      readonly $b = signal(0);
    }
    reactive(Child);
    const child = new Child();
    child.a = 1;
    child.b = 2;
    expect([child.$a.v, child.$b.v]).toEqual([1, 2]);
  });

  test("a subclass's keys stay off its base's instances", () => {
    expect.assertions(1);
    class Elder {
      declare a: number;
      readonly $a = signal(0);
    }
    reactive(Elder);
    class Younger extends Elder {
      declare b: number;
      readonly $b = signal(0);
    }
    reactive(Younger);
    expect("b" in new Elder()).toBe(false);
  });

  test.serial("a subclass not passed keeps its base's keys", () => {
    expect.assertions(1);
    class Founder {
      declare a: number;
      readonly $a = signal(0);
    }
    reactive(Founder);
    class Heir extends Founder {
      readonly $b = signal(0);
    }
    const heir = new Heir();
    // Development builds warn of Heir's $b, which has no key
    using _ = spyOn(console, "warn").mockImplementation(noop);
    heir.a = 1;
    expect(heir.$a.v).toBe(1);
  });

  test("a subclass of a plain class with $ fields gives its instances keys for them", () => {
    expect.assertions(1);
    class Plain {
      readonly $a = signal(1);
    }
    class Keyed extends Plain {
      declare a: number;
    }
    reactive(Keyed);
    expect(new Keyed().a).toBe(1);
  });
});

describe("reactive: a second call", () => {
  test.serial("keeps the keys working", () => {
    expect.assertions(1);
    class Again {
      declare a: number;
      readonly $a = signal(0);
    }
    reactive(Again);
    // Development builds warn of the second call
    using _ = spyOn(console, "warn").mockImplementation(noop);
    reactive(Again);
    const again = new Again();
    again.a = 1;
    expect(again.$a.v).toBe(1);
  });
});

describe("reactive: enumerability", () => {
  test("for…in lists the keys after the own fields", () => {
    expect.assertions(1);
    class Listed {
      declare a: number;
      declare b: string;
      readonly $a = signal(0);
      readonly $b = signal("");
    }
    reactive(Listed);
    const keys: string[] = [];
    // oxlint-disable-next-line guard-for-in -- the inherited keys are what is tested
    for (const key in new Listed()) keys.push(key);
    expect(keys).toEqual(["$a", "$b", "a", "b"]);
  });
});

describe.if(!DEV)("reactive: production, for what development builds throw at", () => {
  test("a key that is a method of the class replaces it", () => {
    expect.assertions(1);
    class Resettable {
      readonly $reset = signal(7);
      reset(): void {
        set(this.$reset, 0);
      }
    }
    untyped(Resettable);
    expect((new Resettable() as unknown as { reset: unknown }).reset).toBe(7);
  });

  test("a key that is a member of a base class replaces it on the subclass's prototype only", () => {
    expect.assertions(1);
    class Titled {
      title(): string {
        return "base";
      }
    }
    class Retitled extends Titled {
      readonly $title = signal("own");
    }
    untyped(Retitled);
    expect([
      typeof new Titled().title,
      (new Retitled() as unknown as { title: unknown }).title,
    ]).toEqual(["function", "own"]);
  });

  test("an own key next to its $ field hides the key's accessor", () => {
    expect.assertions(1);
    class Hidden {
      count = 0;
      readonly $count = signal(0);
    }
    reactive(Hidden);
    const hidden = new Hidden();
    hidden.count = 5;
    expect(hidden.$count.v).toBe(0);
  });
});

// Each misuse, with the start of what development builds report for it; production reports nothing

/** Misuses reactive() throws for at the call. */
const AT_CALL: [name: string, misuse: () => void, report: RegExp][] = [
  [
    "a constructor that needs arguments",
    () => {
      class Paged {
        readonly $offset: Signal<number>;
        constructor(init: { offset: number }) {
          this.$offset = signal(init.offset);
        }
      }
      untyped(Paged);
    },
    /^stage1: reactive\(Paged\): the constructor threw when called with no arguments \(see cause\)/u,
  ],
  [
    "a constructor that returns an object not inheriting the class's prototype",
    () => {
      // oxlint-disable-next-line typescript/no-extraneous-class -- the misuse under test
      class Elsewhere {
        constructor() {
          // oxlint-disable-next-line no-constructor-return -- the misuse under test
          return { $a: signal(0) };
        }
      }
      untyped(Elsewhere);
    },
    /^stage1: reactive\(Elsewhere\): the constructor returned an object that does not inherit the class's prototype/u,
  ],
  [
    "a constructor that makes an effect",
    () => {
      class MakesEffect {
        readonly $a = signal(0);
        constructor() {
          effect(noop);
        }
      }
      untyped(MakesEffect);
    },
    /^stage1: reactive\(MakesEffect\): the constructor made or ran an effect, sub, or scope/u,
  ],
  [
    "a constructor that makes a sub",
    () => {
      class MakesSub {
        readonly $a = signal(0);
        constructor() {
          sub(this.$a, noop);
        }
      }
      untyped(MakesSub);
    },
    /^stage1: reactive\(MakesSub\): the constructor made or ran an effect, sub, or scope/u,
  ],
  [
    "a constructor that makes a scope",
    () => {
      class MakesScope {
        readonly $a = signal(0);
        constructor() {
          scope(noop);
        }
      }
      untyped(MakesScope);
    },
    /^stage1: reactive\(MakesScope\): the constructor made or ran an effect, sub, or scope/u,
  ],
  [
    "a constructor whose write runs an effect",
    () => {
      const source = signal(0);
      const fx = effect(() => {
        get(source);
      });
      class RunsEffect {
        readonly $a = signal(0);
        constructor() {
          set(source, 1);
        }
      }
      try {
        untyped(RunsEffect);
      } finally {
        dispose(fx);
      }
    },
    /^stage1: reactive\(RunsEffect\): the constructor made or ran an effect, sub, or scope/u,
  ],
  [
    "a $ field that holds a number",
    () => {
      class HoldsNumber {
        readonly $a = 0;
      }
      untyped(HoldsNumber);
    },
    /^stage1: reactive\(HoldsNumber\): \$a holds a number, not a signal or computed/u,
  ],
  [
    "a $ field that holds a plain object",
    () => {
      class HoldsObject {
        readonly $a = { v: 0 };
      }
      untyped(HoldsObject);
    },
    /^stage1: reactive\(HoldsObject\): \$a holds an object, not a signal or computed/u,
  ],
  [
    "a $ field that holds an effect",
    () => {
      const fx = effect(noop);
      class HoldsEffect {
        readonly $a: Effect = fx;
      }
      try {
        untyped(HoldsEffect);
      } finally {
        dispose(fx);
      }
    },
    /^stage1: reactive\(HoldsEffect\): \$a holds an effect, sub, or scope, not a signal or computed/u,
  ],
  [
    "a $ field that holds a lite tier's signal",
    () => {
      class HoldsLite {
        readonly $a = lite.signal(0);
      }
      untyped(HoldsLite);
    },
    /^stage1: reactive\(HoldsLite\): \$a holds an object, not a signal or computed/u,
  ],
  [
    "an own key next to its $ field",
    () => {
      class Shadowed {
        count = 0;
        readonly $count = signal(0);
      }
      untyped(Shadowed);
    },
    /^stage1: reactive\(Shadowed\): an own count hides the accessor for \$count/u,
  ],
  [
    "a key that is a method of the class",
    () => {
      class Method {
        readonly $reset = signal(0);
        reset(): void {
          set(this.$reset, 0);
        }
      }
      untyped(Method);
    },
    /^stage1: reactive\(Method\): reset is already a member of the class's prototype/u,
  ],
  [
    "a key that is an accessor of the class",
    () => {
      class Getter {
        readonly $count = signal(0);
        get count(): number {
          return this.$count.v;
        }
      }
      untyped(Getter);
    },
    /^stage1: reactive\(Getter\): count is already a member of the class's prototype/u,
  ],
  [
    "a key that is a member of a base class",
    () => {
      class Labeller {
        label(): string {
          return "base";
        }
      }
      class Labelled extends Labeller {
        readonly $label = signal("");
      }
      untyped(Labelled);
    },
    /^stage1: reactive\(Labelled\): label is already a member of Labeller\.prototype/u,
  ],
  [
    "the key toString, a member of Object.prototype",
    () => {
      class Str {
        readonly $toString = signal("");
      }
      untyped(Str);
    },
    /^stage1: reactive\(Str\): toString is already a member of Object\.prototype/u,
  ],
  [
    "the key constructor",
    () => {
      class Ctor {
        readonly $constructor = signal(0);
      }
      untyped(Ctor);
    },
    /^stage1: reactive\(Ctor\): constructor is already a member of the class's prototype/u,
  ],
];

/** Misuses development builds warn of. */
const WARNED: [name: string, misuse: () => void, report: RegExp][] = [
  [
    "a second call for one class",
    () => {
      class Twice {
        declare a: number;
        readonly $a = signal(0);
      }
      reactive(Twice);
      reactive(Twice);
    },
    /^stage1: reactive\(Twice\) again: call it once per class$/u,
  ],
  [
    "a second class with the same source",
    () => {
      const make = () =>
        class SameSource {
          declare a: number;
          readonly $a = signal(0);
        };
      reactive(make());
      reactive(make());
    },
    /^stage1: reactive\(SameSource\): a second class with the same source/u,
  ],
  [
    "a call in an effect",
    () => {
      dispose(
        effect(() => {
          reactive(
            class InEffect {
              declare a: number;
              readonly $a = signal(0);
            },
          );
        }),
      );
    },
    /^stage1: reactive\(InEffect\) inside an effect, sub, or scope/u,
  ],
  [
    "a call in a scope",
    () => {
      dispose(
        scope(() => {
          reactive(
            class InScope {
              declare a: number;
              readonly $a = signal(0);
            },
          );
        }),
      );
    },
    /^stage1: reactive\(InScope\) inside an effect, sub, or scope/u,
  ],
  [
    "a subclass with $ fields of its own not passed, accessed through two instances (once)",
    () => {
      class Based {
        declare a: number;
        readonly $a = signal(0);
      }
      reactive(Based);
      class Unpassed extends Based {
        readonly $b = signal(0);
      }
      const first = new Unpassed();
      const second = new Unpassed();
      first.a = 1;
      second.a = first.a;
    },
    /^stage1: Unpassed extends a reactive class but was not passed to reactive\(\): \$b has no accessor$/u,
  ],
];

/** Misuses an access throws for. */
const AT_ACCESS: [name: string, misuse: () => unknown, report: RegExp][] = [
  [
    "a read of a key whose $ field was replaced by a value",
    () => {
      class ReplacedRead {
        declare a: number;
        readonly $a = signal(0);
      }
      reactive(ReplacedRead);
      const x = new ReplacedRead();
      (x as { $a: unknown }).$a = 5;
      return x.a;
    },
    /^stage1: ReplacedRead: \$a holds a number, not a signal or computed/u,
  ],
  [
    "a write of a key whose $ field was replaced by a value",
    () => {
      class ReplacedWrite {
        declare a: number;
        readonly $a = signal(0);
      }
      reactive(ReplacedWrite);
      const x = new ReplacedWrite();
      (x as { $a: unknown }).$a = 5;
      x.a = 1;
    },
    /^stage1: ReplacedWrite: \$a holds a number, not a signal or computed/u,
  ],
  [
    "a read of a key whose $ field this instance lacks",
    () => {
      class Sometimes {
        declare a: number;
        declare readonly $a: Signal<number>;
        constructor(skip = false) {
          if (!skip) this.$a = signal(0);
        }
      }
      reactive(Sometimes);
      return new Sometimes(true).a;
    },
    /^stage1: Sometimes: \$a holds undefined, not a signal or computed/u,
  ],
  [
    "a write to a computed's key",
    () => {
      class Totals {
        declare readonly total: number;
        readonly $total = computed(() => 1);
      }
      reactive(Totals);
      (new Totals() as { total: number }).total = 2;
    },
    /^stage1: Totals: a write to total, whose \$total holds a computed/u,
  ],
];

describe.serial.if(DEV)("reactive: development checks", () => {
  test.each(AT_CALL)("the call throws for %s", (_name, misuse, report) => {
    expect.assertions(1);
    expect(reports(misuse)).toEqual([["throw", expect.stringMatching(report)]]);
  });

  test("the error for a constructor that throws has the constructor's error as its cause", () => {
    expect.assertions(1);
    const failure = new Error("needs an id");
    class Identified {
      readonly $id = signal(0);
      constructor(id?: number) {
        if (id === undefined) throw failure;
      }
    }
    let cause: unknown;
    try {
      untyped(Identified);
    } catch (error) {
      ({ cause } = error as Error);
    }
    expect(cause).toBe(failure);
  });

  test.each(WARNED)("warns of %s", (_name, misuse, report) => {
    expect.assertions(1);
    expect(reports(misuse)).toEqual([["warn", expect.stringMatching(report)]]);
  });

  test.each(AT_ACCESS)("throws for %s", (_name, misuse, report) => {
    expect.assertions(1);
    expect(reports(misuse)).toEqual([["throw", expect.stringMatching(report)]]);
  });
});

describe.serial.if(!DEV)("reactive: production reports nothing", () => {
  // What a misuse then does is its own outcome (a wrong value, a TypeError), not a report
  test.each([...AT_CALL, ...WARNED, ...AT_ACCESS])("for %s", (_name, misuse) => {
    expect.assertions(1);
    expect(reports(misuse).filter(([, message]) => message.startsWith("stage1: "))).toEqual([]);
  });
});

// Both modes: the checks never fire for these
describe.serial("reactive: legitimate use reports nothing", () => {
  test.each([
    [
      "a class of signal and computed fields with a defaulted constructor parameter, read and written",
      () => {
        class Priced {
          declare price: number;
          declare readonly doubled: number;
          readonly $price: Signal<number>;
          readonly $doubled = computed(() => this.price * 2);
          constructor(price = 1) {
            this.$price = signal(price);
          }
        }
        reactive(Priced);
        const priced = new Priced(3);
        priced.price = priced.doubled;
      },
    ],
    [
      // False-positive guard: the instance reactive() makes has an own key, as a field would give it
      "a constructor that writes a key, read and written",
      () => {
        class Initialized {
          declare count: number;
          readonly $count = signal(0);
          constructor(count = 1) {
            this.count = count;
          }
        }
        reactive(Initialized);
        const initialized = new Initialized(2);
        initialized.count += 1;
      },
    ],
    [
      "a subclass passed too, read and written",
      () => {
        class Ancestor {
          declare a: number;
          readonly $a = signal(0);
        }
        reactive(Ancestor);
        class Descendant extends Ancestor {
          declare b: number;
          readonly $b = signal(0);
        }
        reactive(Descendant);
        const descendant = new Descendant();
        descendant.b = descendant.a;
        descendant.a = descendant.b;
      },
    ],
    [
      "a subclass with no $ fields of its own, not passed, read and written",
      () => {
        class Root {
          declare a: number;
          readonly $a = signal(0);
        }
        reactive(Root);
        class Leaf extends Root {
          twice(): number {
            return this.a * 2;
          }
        }
        const leaf = new Leaf();
        leaf.a = leaf.twice();
      },
    ],
    [
      "a subclass of a plain class with $ fields, read and written",
      () => {
        class PlainBase {
          readonly $a = signal(0);
        }
        class FromPlain extends PlainBase {
          declare a: number;
        }
        reactive(FromPlain);
        const fromPlain = new FromPlain();
        fromPlain.a += 1;
      },
    ],
    [
      "a constructor that returns an instance of a subclass, read and written",
      () => {
        class Factory {
          declare a: number;
          readonly $a = signal(0);
          // A factory: what it returns is still a Factory
          // oxlint-disable-next-line typescript/consistent-return
          constructor() {
            // oxlint-disable-next-line no-constructor-return no-use-before-define
            if (new.target === Factory) return new Made();
          }
        }
        class Made extends Factory {}
        reactive(Factory);
        const made = new Factory();
        made.a += 1;
      },
    ],
    [
      "an instance made, read, and written in an effect",
      () => {
        class Owned {
          declare a: number;
          readonly $a = signal(0);
        }
        reactive(Owned);
        dispose(
          effect(() => {
            const owned = new Owned();
            owned.a += 1;
          }),
        );
      },
    ],
  ])("%s", (_name, use) => {
    expect.assertions(1);
    expect(reports(use)).toEqual([]);
  });
});

describe("ReactiveKeys", () => {
  test("types", () => {
    expect.assertions(0);
    interface Fields {
      readonly $a: Signal<number>;
      $b: Computed<string>;
      c: boolean;
      $d: number;
      $e: Effect;
      $f: lite.Signal<number>;
      g: number;
      $g: Signal<number>;
      h: 0;
      $h: Signal<number>;
    }
    // Each `$key` field's key, writable: its value type, or `never` for what is neither a signal
    // nor a computed of this tier, and for a key declared narrower than that type
    expectTypeOf<ReactiveKeys<Fields>>().toEqualTypeOf<{
      a: number;
      b: string;
      d: never;
      e: never;
      f: never;
      g: number;
      h: never;
    }>();
  });
});
