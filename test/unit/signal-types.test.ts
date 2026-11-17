// Type contracts of the signal core's public API (the runtime behaviour is in signal.test.ts and
// signal-mechanisms.test.ts; list's and mark's types are in reconcile.test.ts).
// oxlint-disable typescript/no-invalid-void-type

import { describe, expect, expectTypeOf, test } from "bun:test";
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
  sub,
  untracked,
} from "../../src/signal.ts";

describe("signal", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(signal).not.toBeAny();
    expectTypeOf(signal).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(signal).parameters.toEqualTypeOf<[value: unknown]>();
    expectTypeOf(signal).returns.toEqualTypeOf<Signal<unknown>>();
    expectTypeOf(signal<number>).parameters.toEqualTypeOf<[value: number]>();
    expectTypeOf(signal<number>).returns.toEqualTypeOf<Signal<number>>();
    expectTypeOf(() => signal(1)).returns.toEqualTypeOf<Signal<number>>();
    // `v` is the value as a plain field: the untracked read
    expectTypeOf<Pick<Signal<number>, "v">>().toEqualTypeOf<{ readonly v: number }>();
    expectTypeOf<Signal<number>>().not.toExtend<Signal<string>>();
    expectTypeOf<Signal<number>>().not.toExtend<Computed<number>>();
    expectTypeOf((s: Signal<number>) => {
      // @ts-expect-error - v is read-only; writes go through set
      s.v = 2;
    }).toBeFunction();
  });
});

describe("computed", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(computed).not.toBeAny();
    expectTypeOf(computed).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(computed).parameters.toEqualTypeOf<[fn: () => unknown]>();
    expectTypeOf(computed).returns.toEqualTypeOf<Computed<unknown>>();
    expectTypeOf(computed<number>).parameters.toEqualTypeOf<[fn: () => number]>();
    expectTypeOf(computed<number>).returns.toEqualTypeOf<Computed<number>>();
    expectTypeOf(() => computed(() => 1)).returns.toEqualTypeOf<Computed<number>>();
    expectTypeOf<Computed<number>>().not.toExtend<Computed<string>>();
    expectTypeOf<Computed<number>>().not.toExtend<Signal<number>>();
  });
});

describe("get", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(get).not.toBeAny();
    expectTypeOf(get).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(get).parameters.toEqualTypeOf<[node: Signal<unknown> | Computed<unknown>]>();
    expectTypeOf(get).returns.toBeUnknown();
    expectTypeOf(get<number>).parameters.toEqualTypeOf<[node: Signal<number> | Computed<number>]>();
    expectTypeOf(get<number>).returns.toEqualTypeOf<number>();
    expectTypeOf((s: Signal<number>) => get(s)).returns.toEqualTypeOf<number>();
    expectTypeOf((c: Computed<string>) => get(c)).returns.toEqualTypeOf<string>();
    expectTypeOf((e: Effect) => {
      // @ts-expect-error - an effect has no value
      get(e);
    }).toBeFunction();
  });
});

describe("set", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(set).not.toBeAny();
    expectTypeOf(set).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(set).parameters.toEqualTypeOf<[signal: Signal<unknown>, value: unknown]>();
    expectTypeOf(set).returns.toBeVoid();
    expectTypeOf(set).returns.not.toBeUndefined();
    expectTypeOf(set<number>).parameters.toEqualTypeOf<[signal: Signal<number>, value: number]>();
    expectTypeOf((s: Signal<number>, c: Computed<number>) => {
      set(s, 2);
      // @ts-expect-error - a computed is not writable
      set(c, 2);
      // @ts-expect-error - the value must be the signal's type
      set(s, "2");
    }).toBeFunction();
  });
});

describe("effect", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(effect).not.toBeAny();
    expectTypeOf(effect).toBeFunction();
    // The function's result is its cleanup: a function or nothing
    expectTypeOf(effect).parameters.toEqualTypeOf<[fn: () => void | (() => void)]>();
    expectTypeOf(effect).returns.toEqualTypeOf<Effect>();
    expectTypeOf(() => {
      effect(() => {});
      effect(() => () => {});
      // @ts-expect-error - a result that is not a function is no cleanup
      effect(() => 1);
      // @ts-expect-error - nor is a promise
      effect(async () => {});
    }).toBeFunction();
    expectTypeOf<Effect>().not.toExtend<Signal<unknown>>();
  });
});

describe("scope", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(scope).not.toBeAny();
    expectTypeOf(scope).toBeFunction();
    // The function's result is its cleanup: a function or nothing
    expectTypeOf(scope).parameters.toEqualTypeOf<[fn: () => void | (() => void)]>();
    expectTypeOf(scope).returns.toEqualTypeOf<Scope>();
    expectTypeOf(() => {
      scope(() => {});
      scope(() => () => {});
      // @ts-expect-error - a result that is not a function is no cleanup
      scope(() => 1);
      // @ts-expect-error - nor is a promise
      scope(async () => {});
    }).toBeFunction();
    expectTypeOf<Scope>().not.toExtend<Signal<unknown>>();
  });
});

describe("sub", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(sub).not.toBeAny();
    expectTypeOf(sub).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(sub).parameters.toEqualTypeOf<
      [source: Signal<unknown> | Computed<unknown>, fn: (value: unknown) => void]
    >();
    // An effect's handle: dispose takes it
    expectTypeOf(sub).returns.toEqualTypeOf<Effect>();
    expectTypeOf(sub<number>).parameters.toEqualTypeOf<
      [source: Signal<number> | Computed<number>, fn: (value: number) => void]
    >();
    expectTypeOf((s: Signal<number>, c: Computed<string>) => {
      sub(s, (value) => {
        expectTypeOf(value).toEqualTypeOf<number>();
      });
      sub(c, (value) => {
        expectTypeOf(value).toEqualTypeOf<string>();
      });
      // @ts-expect-error - fn takes the source's type
      sub(s, (_value: string) => {});
      dispose(sub(s, () => {}));
    }).toBeFunction();
  });
});

describe("defer", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(defer).not.toBeAny();
    expectTypeOf(defer).toBeFunction();
    expectTypeOf(defer).parameters.toEqualTypeOf<[fn: () => void]>();
    expectTypeOf(defer).returns.toBeVoid();
    expectTypeOf(defer).returns.not.toBeUndefined();
  });
});

describe("dispose", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(dispose).not.toBeAny();
    expectTypeOf(dispose).toBeFunction();
    expectTypeOf(dispose).parameters.toEqualTypeOf<[node: Effect | Scope | Computed<unknown>]>();
    expectTypeOf(dispose).returns.toBeVoid();
    expectTypeOf(dispose).returns.not.toBeUndefined();
    expectTypeOf((e: Effect, s: Scope, c: Computed<number>, v: Signal<number>) => {
      dispose(e);
      dispose(s);
      dispose(c);
      // @ts-expect-error - a signal owns nothing and is never disposed
      dispose(v);
    }).toBeFunction();
  });
});

describe("batch", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(batch).not.toBeAny();
    expectTypeOf(batch).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(batch).parameters.toEqualTypeOf<[fn: () => unknown]>();
    expectTypeOf(batch).returns.toBeUnknown();
    expectTypeOf(batch<number>).parameters.toEqualTypeOf<[fn: () => number]>();
    expectTypeOf(batch<number>).returns.toEqualTypeOf<number>();
    expectTypeOf((s: Signal<string>) => batch(() => get(s))).returns.toEqualTypeOf<string>();
  });
});

describe("untracked", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(untracked).not.toBeAny();
    expectTypeOf(untracked).toBeFunction();
    // Erased: `T` -> `unknown`.
    expectTypeOf(untracked).parameters.toEqualTypeOf<[fn: () => unknown]>();
    expectTypeOf(untracked).returns.toBeUnknown();
    expectTypeOf(untracked<number>).parameters.toEqualTypeOf<[fn: () => number]>();
    expectTypeOf(untracked<number>).returns.toEqualTypeOf<number>();
    expectTypeOf((s: Signal<string>) => untracked(() => get(s))).returns.toEqualTypeOf<string>();
  });
});
