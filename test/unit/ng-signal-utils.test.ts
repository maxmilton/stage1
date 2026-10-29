import { describe, expect, expectTypeOf, test } from "bun:test";
import { selector } from "../../src/ng/signal-utils.ts";
import { set, signal, type Signal } from "../../src/ng/signal.ts";

describe("selector", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(selector).not.toBeAny();
    expectTypeOf(selector).toBeFunction();
    expectTypeOf(selector<number>).parameters.toEqualTypeOf<[source: Signal<number>]>();
    expectTypeOf(selector<number>).returns.toEqualTypeOf<
      (key: number, fn: (selected: boolean) => void) => () => void
    >();
    expectTypeOf(() => {
      const select = selector(signal(""));
      select("a", (selected) => {
        expectTypeOf(selected).toEqualTypeOf<boolean>();
      });
      // @ts-expect-error - keys have the source's type
      select(1, () => {});
    }).toBeFunction();
  });

  test("calls a new key's callback at once with whether it is selected", () => {
    expect.assertions(1);
    const select = selector(signal("b"));
    const seen: [string, boolean][] = [];
    for (const key of ["a", "b"]) {
      select(key, (selected) => {
        seen.push([key, selected]);
      });
    }
    expect(seen).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  test("calls only the old and new keys' callbacks on a change", () => {
    expect.assertions(1);
    const source = signal("a");
    const select = selector(source);
    const seen: [string, boolean][] = [];
    for (const key of ["a", "b", "c"]) {
      select(key, (selected) => {
        seen.push([key, selected]);
      });
    }
    seen.length = 0;
    set(source, "c");
    expect(seen).toEqual([
      ["a", false],
      ["c", true],
    ]);
  });

  test("does not call a disposed key's callback", () => {
    expect.assertions(1);
    const source = signal("a");
    const select = selector(source);
    let calls = 0;
    select("b", () => {
      calls++;
    })();
    set(source, "b");
    expect(calls).toBe(1);
  });

  test("marks a key registered after a change by the current value", () => {
    expect.assertions(1);
    const source = signal("a");
    const select = selector(source);
    const dispose = select("a", () => {});
    set(source, "b");
    dispose();
    set(source, "c");
    const seen: boolean[] = [];
    select("c", (selected) => {
      seen.push(selected);
    });
    expect(seen).toEqual([true]);
  });

  test("follows changes again once a key registers after all were disposed", () => {
    expect.assertions(1);
    const source = signal("a");
    const select = selector(source);
    select("a", () => {})();
    const seen: boolean[] = [];
    select("b", (selected) => {
      seen.push(selected);
    });
    set(source, "b");
    set(source, "c");
    expect(seen).toEqual([false, true, false]);
  });
});
