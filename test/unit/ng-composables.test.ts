// Callbacks under test branch on the value they receive.
// oxlint-disable vitest/no-conditional-in-test

import { describe, expect, expectTypeOf, test } from "bun:test";
import { mapper, selector } from "../../src/ng/composables.ts";
import { batch, set, signal, type Signal, sub } from "../../src/ng/signal.ts";

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

  test("Regression: a key registered during a batch that restores the value ends unselected", () => {
    expect.assertions(1);
    const source = signal("a");
    const select = selector(source);
    select("a", () => {});
    let last: boolean | undefined;
    batch(() => {
      set(source, "b");
      select("b", (selected) => {
        last = selected;
      });
      set(source, "a");
    });
    expect(last).toBe(false);
  });

  test("Regression: a first key registered during a batch that restores the value ends unselected", () => {
    expect.assertions(1);
    const source = signal("a");
    sub(source, () => {});
    const select = selector(source);
    let last: boolean | undefined;
    batch(() => {
      set(source, "b");
      select("b", (selected) => {
        last = selected;
      });
      set(source, "a");
    });
    expect(last).toBe(false);
  });

  test("Regression: a callback that changes the selection during a change leaves only the final key selected", () => {
    expect.assertions(1);
    const source = signal("a");
    const select = selector(source);
    const state: Record<string, boolean> = {};
    for (const key of ["a", "b", "c"]) {
      select(key, (selected) => {
        state[key] = selected;
        if (key === "a" && !selected) set(source, "c");
      });
    }
    set(source, "b");
    expect(state).toEqual({ a: false, b: false, c: true });
  });
});

/** A mapper `fn` with the set of nodes it has marked. */
const marking = (): [marked: Set<string>, fn: (node: string, selected: boolean) => void] => {
  const marked = new Set<string>();
  return [
    marked,
    (node, selected) => {
      if (selected) marked.add(node);
      else marked.delete(node);
    },
  ];
};

describe("mapper", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(mapper).not.toBeAny();
    expectTypeOf(mapper).toBeFunction();
    expectTypeOf(mapper<number, HTMLElement>).parameters.toEqualTypeOf<
      [source: Signal<number>, fn: (node: HTMLElement, selected: boolean) => void]
    >();
    expectTypeOf(mapper<number, HTMLElement>).returns.toEqualTypeOf<
      (key: number, node: HTMLElement) => () => void
    >();
    expectTypeOf(() => {
      const mark = mapper(signal(""), (_node: HTMLElement, selected) => {
        expectTypeOf(selected).toEqualTypeOf<boolean>();
      });
      // @ts-expect-error - keys have the source's type
      mark(1, document.body);
      // @ts-expect-error - nodes have fn's node type
      mark("a", "body");
    }).toBeFunction();
  });

  test("marks a registered node at once only if its key is selected", () => {
    expect.assertions(1);
    const seen: [string, boolean][] = [];
    const mark = mapper(signal("b"), (node: string, selected) => {
      seen.push([node, selected]);
    });
    mark("a", "node a");
    mark("b", "node b");
    expect(seen).toEqual([["node b", true]]);
  });

  test("calls fn only for the old and new keys' nodes on a change", () => {
    expect.assertions(1);
    const source = signal("a");
    const seen: [string, boolean][] = [];
    const mark = mapper(source, (node: string, selected) => {
      seen.push([node, selected]);
    });
    for (const key of ["a", "b", "c"]) mark(key, `node ${key}`);
    seen.length = 0;
    set(source, "c");
    expect(seen).toEqual([
      ["node a", false],
      ["node c", true],
    ]);
  });

  test("does not mark a disposed node", () => {
    expect.assertions(1);
    const source = signal("a");
    let calls = 0;
    const mark = mapper(source, () => {
      calls++;
    });
    mark("b", "node b")();
    set(source, "b");
    expect(calls).toBe(0);
  });

  test("does not call fn for a removed node when the selection moves", () => {
    expect.assertions(1);
    const source = signal("a");
    let calls = 0;
    const mark = mapper(source, () => {
      calls++;
    });
    mark("a", "node a")();
    set(source, "b");
    expect(calls).toBe(1);
  });

  test("does not call fn when notified of an unchanged value", () => {
    expect.assertions(1);
    const source = signal("a");
    let calls = 0;
    const mark = mapper(source, () => {
      calls++;
    });
    mark("a", "node a");
    // A sink subscribed during the batch makes it notify, though it restores the value
    batch(() => {
      set(source, "b");
      sub(source, () => {});
      set(source, "a");
    });
    expect(calls).toBe(1);
  });

  test("Regression: a node registered during a batch that restores the value stays unmarked", () => {
    expect.assertions(1);
    const source = signal("a");
    const [marked, fn] = marking();
    const mark = mapper(source, fn);
    mark("a", "node a");
    batch(() => {
      set(source, "b");
      mark("b", "node b");
      set(source, "a");
    });
    expect([...marked]).toEqual(["node a"]);
  });

  test("Regression: fn changing the selection during a change leaves only the final node marked", () => {
    expect.assertions(1);
    const source = signal("a");
    const [marked, paint] = marking();
    const mark = mapper(source, (node: string, selected) => {
      paint(node, selected);
      if (node === "node a" && !selected) set(source, "c");
    });
    for (const key of ["a", "b", "c"]) mark(key, `node ${key}`);
    set(source, "b");
    expect([...marked]).toEqual(["node c"]);
  });

  test("Regression: a stale cleanup keeps the newer node of its key", () => {
    expect.assertions(1);
    const source = signal("a");
    const [marked, fn] = marking();
    const mark = mapper(source, fn);
    const disposeOld = mark("k", "old");
    mark("k", "new");
    disposeOld();
    set(source, "k");
    expect([...marked]).toEqual(["new"]);
  });
});
