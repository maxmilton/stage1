// Type contracts of the lite tiers' signal APIs, stage1/lite and stage1/ultralite (their runtime
// behaviour is in lite-signal.test.ts, ultralite-signal.test.ts and lite-contract.test.ts). Their
// `Signal` and `Effect` are branded as the full tier's are, each module with its own brand, so a
// signal or handle of one tier is not accepted by another.

import { describe, expect, expectTypeOf, test } from "bun:test";
import * as lite from "../../src/lite/signal.ts";
import type * as full from "../../src/signal.ts";
import * as ultralite from "../../src/ultralite/signal.ts";

describe("stage1/lite", () => {
  const { batch, dispose, get, set, signal, sub } = lite;
  type Signal<T> = lite.Signal<T>;
  type Effect = lite.Effect;

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
      // `v` is the value as a plain field
      expectTypeOf<Pick<Signal<number>, "v">>().toEqualTypeOf<{ readonly v: number }>();
      expectTypeOf<Signal<number>>().not.toExtend<Signal<string>>();
      expectTypeOf<Signal<number>>().not.toExtend<Effect>();
      expectTypeOf<Signal<number>>().not.toExtend<full.Signal<number>>();
      expectTypeOf<full.Signal<number>>().not.toExtend<Signal<number>>();
      expectTypeOf<Signal<number>>().not.toExtend<ultralite.Signal<number>>();
      expectTypeOf((s: Signal<number>) => {
        // @ts-expect-error - v is read-only; writes go through set
        s.v = 2;
      }).toBeFunction();
    });
  });

  describe("get", () => {
    test("types", () => {
      expect.assertions(0);
      expectTypeOf(get).not.toBeAny();
      expectTypeOf(get).toBeFunction();
      // Erased: `T` -> `unknown`.
      expectTypeOf(get).parameters.toEqualTypeOf<[signal: Signal<unknown>]>();
      expectTypeOf(get).returns.toBeUnknown();
      expectTypeOf(get<number>).parameters.toEqualTypeOf<[signal: Signal<number>]>();
      expectTypeOf(get<number>).returns.toEqualTypeOf<number>();
      expectTypeOf((s: Signal<number>) => get(s)).returns.toEqualTypeOf<number>();
      expectTypeOf((s: full.Signal<number>) => {
        // @ts-expect-error - a full-tier signal is not a lite one
        get(s);
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
      expectTypeOf((s: Signal<number>) => {
        set(s, 2);
        // @ts-expect-error - the value must be the signal's type
        set(s, "2");
      }).toBeFunction();
    });
  });

  describe("sub", () => {
    test("types", () => {
      expect.assertions(0);
      expectTypeOf(sub).not.toBeAny();
      expectTypeOf(sub).toBeFunction();
      // Erased: `T` -> `unknown`.
      expectTypeOf(sub).parameters.toEqualTypeOf<
        [signal: Signal<unknown>, fn: (value: unknown) => void]
      >();
      // The sub's handle, named as the full tier's: dispose takes it
      expectTypeOf(sub).returns.toEqualTypeOf<Effect>();
      expectTypeOf(sub<number>).parameters.toEqualTypeOf<
        [signal: Signal<number>, fn: (value: number) => void]
      >();
      expectTypeOf((s: Signal<number>) => {
        sub(s, (value) => {
          expectTypeOf(value).toEqualTypeOf<number>();
        });
        // @ts-expect-error - fn takes the signal's type
        sub(s, (_value: string) => {});
        dispose(sub(s, () => {}));
      }).toBeFunction();
    });
  });

  describe("dispose", () => {
    test("types", () => {
      expect.assertions(0);
      expectTypeOf(dispose).not.toBeAny();
      expectTypeOf(dispose).toBeFunction();
      expectTypeOf(dispose).parameters.toEqualTypeOf<[handle: Effect]>();
      expectTypeOf(dispose).returns.toBeVoid();
      expectTypeOf(dispose).returns.not.toBeUndefined();
      expectTypeOf<Effect>().not.toExtend<Signal<unknown>>();
      expectTypeOf<Effect>().not.toExtend<full.Effect>();
      expectTypeOf<full.Effect>().not.toExtend<Effect>();
      expectTypeOf((e: Effect, s: Signal<number>, f: full.Effect) => {
        dispose(e);
        // @ts-expect-error - a signal is no handle (though a first sub's handle is its signal)
        dispose(s);
        // @ts-expect-error - a full-tier handle is not a lite one
        dispose(f);
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
});

describe("stage1/ultralite", () => {
  const { batch, dispose, get, set, signal, sub } = ultralite;
  type Signal<T> = ultralite.Signal<T>;
  type Effect = ultralite.Effect;

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
      // `v` is the value as a plain field
      expectTypeOf<Pick<Signal<number>, "v">>().toEqualTypeOf<{ readonly v: number }>();
      expectTypeOf<Signal<number>>().not.toExtend<Signal<string>>();
      expectTypeOf<Signal<number>>().not.toExtend<Effect>();
      expectTypeOf<Signal<number>>().not.toExtend<full.Signal<number>>();
      expectTypeOf<Signal<number>>().not.toExtend<lite.Signal<number>>();
      expectTypeOf((s: Signal<number>) => {
        // @ts-expect-error - v is read-only; writes go through set
        s.v = 2;
      }).toBeFunction();
    });
  });

  describe("get", () => {
    test("types", () => {
      expect.assertions(0);
      expectTypeOf(get).not.toBeAny();
      expectTypeOf(get).toBeFunction();
      // Erased: `T` -> `unknown`.
      expectTypeOf(get).parameters.toEqualTypeOf<[signal: Signal<unknown>]>();
      expectTypeOf(get).returns.toBeUnknown();
      expectTypeOf(get<number>).parameters.toEqualTypeOf<[signal: Signal<number>]>();
      expectTypeOf(get<number>).returns.toEqualTypeOf<number>();
      expectTypeOf((s: Signal<number>) => get(s)).returns.toEqualTypeOf<number>();
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
      expectTypeOf((s: Signal<number>) => {
        set(s, 2);
        // @ts-expect-error - the value must be the signal's type
        set(s, "2");
      }).toBeFunction();
    });
  });

  describe("sub", () => {
    test("types", () => {
      expect.assertions(0);
      expectTypeOf(sub).not.toBeAny();
      expectTypeOf(sub).toBeFunction();
      // Erased: `T` -> `unknown`.
      expectTypeOf(sub).parameters.toEqualTypeOf<
        [signal: Signal<unknown>, fn: (value: unknown) => void]
      >();
      // The sub's handle, named as the full tier's: dispose takes it
      expectTypeOf(sub).returns.toEqualTypeOf<Effect>();
      expectTypeOf(sub<number>).parameters.toEqualTypeOf<
        [signal: Signal<number>, fn: (value: number) => void]
      >();
      expectTypeOf((s: Signal<number>) => {
        sub(s, (value) => {
          expectTypeOf(value).toEqualTypeOf<number>();
        });
        // @ts-expect-error - fn takes the signal's type
        sub(s, (_value: string) => {});
        dispose(sub(s, () => {}));
      }).toBeFunction();
    });
  });

  describe("dispose", () => {
    test("types", () => {
      expect.assertions(0);
      expectTypeOf(dispose).not.toBeAny();
      expectTypeOf(dispose).toBeFunction();
      expectTypeOf(dispose).parameters.toEqualTypeOf<[handle: Effect]>();
      expectTypeOf(dispose).returns.toBeVoid();
      expectTypeOf(dispose).returns.not.toBeUndefined();
      expectTypeOf<Effect>().not.toExtend<Signal<unknown>>();
      expectTypeOf<Effect>().not.toExtend<lite.Effect>();
      expectTypeOf<Effect>().not.toExtend<full.Effect>();
      expectTypeOf<full.Effect>().not.toExtend<Effect>();
      expectTypeOf((e: Effect, s: Signal<number>, f: full.Effect) => {
        dispose(e);
        // @ts-expect-error - a signal is no handle (though at runtime the handle is its signal)
        dispose(s);
        // @ts-expect-error - a full-tier handle is not an ultralite one
        dispose(f);
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
});
