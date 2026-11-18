// list and mark: one signal-free module for every tier. `list` returns the rows function and `mark`
// the show function; the "on <tier>" groups wire them with that tier's sub, which decides what
// becomes of a write to the items or the selection made inside a callback: stage1's and
// stage1/lite's subs deliver it after the callback returns, stage1/ultralite's calls back at once
// outside a batch (nested). stage1/ultralite holds one sub per signal, so tests that sub a signal
// twice skip it. Then the full tier's own behaviour (rows that own effects through drop,
// parent-first, re-entrancy, components, dev row warnings), and the diff's paths, called directly.
// The lite tiers' own checks are in lite-reconcile.test.ts.
// Run in both modes: `bun test` (dev checks on) and `NODE_ENV=production bun test`.
// Callbacks and checks inside loops branch on the data they receive.
// oxlint-disable vitest/no-conditional-in-test node/no-process-env

import { afterEach, describe, expect, expectTypeOf, spyOn, test } from "bun:test";
import * as lite from "../../src/lite/signal.ts";
import { list, mark, type Marked, type Rows } from "../../src/reconcile.ts";
import {
  batch,
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
  within,
} from "../../src/signal.ts";
import * as ultralite from "../../src/ultralite/signal.ts";

const DEV = process.env.NODE_ENV !== "production";

interface Item {
  readonly id: string;
  readonly label: string;
}

const ITEMS: readonly Item[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
  { id: "d", label: "D" },
];
const REORDERED_ITEMS: readonly Item[] = [
  { id: "d", label: "Delta" },
  { id: "b", label: "Beta" },
  { id: "e", label: "Epsilon" },
  { id: "a", label: "Alpha" },
];

const createItemNode = (item: Item): HTMLSpanElement => {
  const node = document.createElement("span");
  node.dataset["id"] = item.id;
  node.textContent = item.label;
  return node;
};

const updateItemNode = (node: HTMLSpanElement, item: Item): void => {
  node.dataset["id"] = item.id;
  node.textContent = item.label;
};

const itemOrder = (parent: Element): readonly string[] =>
  [...parent.children].map((node) => (node as HTMLElement).dataset["id"] ?? "");

/** One item per letter, each labelled with its own id. */
const lettered = (ids: string): Item[] => ids.split("").map((id) => ({ id, label: id }));

/** Ids of the rows `change` inserts into `parent`, moves included, in insertion order. */
const insertedIds = (parent: Element, change: () => void): string[] => {
  const observer = new MutationObserver(() => {});
  observer.observe(parent, { childList: true });
  change();
  const ids: string[] = [];
  for (const record of observer.takeRecords()) {
    for (const node of record.addedNodes) ids.push((node as HTMLElement).dataset["id"] ?? "");
  }
  observer.disconnect();
  return ids;
};

/** Seeded PRNG (Park–Miller), so a failing edit sequence replays exactly. */
const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
};

/** Next items: some dropped, swapped, maybe reversed, some inserted, some replaced. */
const editItems = (rand: () => number, current: readonly Item[], fresh: () => Item): Item[] => {
  const draft = current.filter(() => rand() < 0.8);
  for (let swaps = draft.length > 0 ? Math.floor(rand() * 4) : 0; swaps--;) {
    const i = Math.floor(rand() * draft.length);
    const j = Math.floor(rand() * draft.length);
    [draft[i], draft[j]] = [draft[j], draft[i]];
  }
  if (rand() < 0.2) draft.reverse();
  for (let inserts = Math.floor(rand() * 6); inserts--;) {
    draft.splice(Math.floor(rand() * (draft.length + 1)), 0, fresh());
  }
  return draft.map((item) => (rand() < 0.1 ? { id: item.id, label: `${item.label}'` } : item));
};

/** Next items: a random subset of `current` in random order (Fisher–Yates), with new items mixed in. */
const permuteItems = (rand: () => number, current: readonly Item[], fresh: () => Item): Item[] => {
  const draft = current.filter(() => rand() < 0.85);
  for (let i = draft.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [draft[i], draft[j]] = [draft[j], draft[i]];
  }
  for (let inserts = Math.floor(rand() * 8); inserts--;) {
    draft.splice(Math.floor(rand() * (draft.length + 1)), 0, fresh());
  }
  return draft;
};

/** Next items by one of the diff's distinct shapes, each with fresh ids mixed in. */
const shapeItems = (rand: () => number, current: readonly Item[], fresh: () => Item): Item[] => {
  const pick = (n: number): number => Math.floor(rand() * n);
  const draft = [...current];
  switch (pick(11)) {
    case 0:
      return [];
    case 1:
      return Array.from({ length: pick(8) }, fresh);
    case 2:
      return draft.toReversed();
    case 3:
      return [...Array.from({ length: 1 + pick(3) }, fresh), ...draft];
    case 4:
      return [...draft, ...Array.from({ length: 1 + pick(3) }, fresh)];
    case 5: {
      // Swap two rows: both cross
      const i = pick(draft.length);
      const j = pick(draft.length);
      if (draft.length > 1) [draft[i], draft[j]] = [draft[j], draft[i]];
      return draft;
    }
    case 6:
      // Drop a prefix and a suffix
      return draft.slice(pick(3), draft.length - pick(3));
    case 7:
      // First to last, last to first
      return draft.length > 1 ? [...draft.slice(-1), ...draft.slice(1, -1), draft[0]] : draft;
    case 8:
      // Same keys, every item a new object
      return draft.map((item) => ({ id: item.id, label: `${item.label}'` }));
    default: {
      const kept = draft.filter(() => rand() < 0.75);
      for (let i = kept.length - 1; i > 0; i--) {
        const j = pick(i + 1);
        [kept[i], kept[j]] = [kept[j], kept[i]];
      }
      for (let n = pick(5); n--;) kept.splice(pick(kept.length + 1), 0, fresh());
      return kept.map((item) => (rand() < 0.15 ? { id: item.id, label: `${item.label}*` } : item));
    }
  }
};

/** Items with unique ids, numbered from 0. */
const freshItems = (): (() => Item) => {
  let id = 0;
  return () => {
    const value = String(id++);
    return { id: value, label: value };
  };
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

/** The data ids of the nodes `fn` marked, in order. */
const markedIds = (nodes: Iterable<Element>): readonly string[] =>
  [...nodes]
    .filter((node) => node.className === "on")
    .map((node) => (node as HTMLElement).dataset["id"] ?? "");

/** A mark callback that sets a class on the node and records each call as [data id, on]. */
const recorder = (): [calls: [string, boolean][], fn: (node: HTMLElement, on: boolean) => void] => {
  const calls: [string, boolean][] = [];
  return [
    calls,
    (node, on) => {
      calls.push([node.dataset["id"] ?? "", on]);
      node.className = on ? "on" : "";
    },
  ];
};

/** A map from each letter to an element with that data id, all in one parent unless `detached`. */
const elements = (ids: string, detached = false): Map<string, HTMLSpanElement> => {
  const nodes = new Map(ids.split("").map((id) => [id, createItemNode({ id, label: id })]));
  if (!detached) document.createElement("div").append(...nodes.values());
  return nodes;
};

/** The warnings' first arguments. */
const texts = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls.map((call) => String(call[0]));

describe("list", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(list).not.toBeAny();
    expectTypeOf(list).toBeFunction();
    // Erased: `T` -> `unknown`, so `K` -> `keyof unknown` (never), `N` -> `ChildNode`. Through the
    // utility types: expect-type's overload-aware getters give never for the erased signature
    expectTypeOf<Parameters<typeof list>>().toEqualTypeOf<
      [
        parent: Element,
        key: never,
        create: (item: unknown) => ChildNode,
        update?: ((node: ChildNode, item: unknown) => void) | undefined,
        drop?: ((row: ChildNode) => void) | undefined,
      ]
    >();
    // Characterization: the erased return indexes `unknown` with `never`, which TypeScript makes any
    expectTypeOf<ReturnType<typeof list>>().toBeAny();
    expectTypeOf(list<Item, "id", HTMLSpanElement>).parameters.toEqualTypeOf<
      [
        parent: Element,
        key: "id",
        create: (item: Item) => HTMLSpanElement,
        update?: ((node: HTMLSpanElement, item: Item) => void) | undefined,
        drop?: ((row: HTMLSpanElement) => void) | undefined,
      ]
    >();
    expectTypeOf(list<Item, "id", HTMLSpanElement>).returns.not.toBeAny();
    expectTypeOf(list<Item, "id", HTMLSpanElement>).returns.toEqualTypeOf<
      Rows<Item, string, HTMLSpanElement>
    >();
    // The rows function takes the items, and mark takes it
    expectTypeOf<Rows<Item, string, HTMLSpanElement>>().toExtend<
      (items: readonly Item[]) => void
    >();
    expectTypeOf<Rows<Item, string, HTMLSpanElement>>().toExtend<Marked<string, HTMLSpanElement>>();
    expectTypeOf((parent: Element) => {
      const rows = list(
        parent,
        "id",
        (item: Item) => {
          expectTypeOf(item).toEqualTypeOf<Item>();
          return document.createElement("span");
        },
        (node, item) => {
          expectTypeOf(node).toEqualTypeOf<HTMLSpanElement>();
          expectTypeOf(item).toEqualTypeOf<Item>();
        },
        (row) => {
          expectTypeOf(row).toEqualTypeOf<HTMLSpanElement>();
        },
      );
      expectTypeOf(rows).toEqualTypeOf<Rows<Item, string, HTMLSpanElement>>();
      // Any tier's sub wires it
      sub(signal<readonly Item[]>([]), rows);
      lite.sub(lite.signal<readonly Item[]>([]), rows);
      ultralite.sub(ultralite.signal<readonly Item[]>([]), rows);
      // @ts-expect-error - the source must hold the list's items
      sub(signal<readonly string[]>([]), rows);
      // @ts-expect-error - key must be a property of the items
      list(parent, "missing", createItemNode);
    }).toBeFunction();
  });
});

describe("mark", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(mark).not.toBeAny();
    expectTypeOf(mark).toBeFunction();
    // Erased: `K` -> `unknown`, `N` -> `ChildNode`.
    expectTypeOf(mark).parameters.toEqualTypeOf<
      [
        // oxlint-disable-next-line typescript/method-signature-style -- as declared, like Map's
        nodes: Marked<unknown, ChildNode> | { get(key: unknown): ChildNode | undefined },
        fn: (node: ChildNode, on: boolean) => void,
      ]
    >();
    expectTypeOf(mark).returns.toEqualTypeOf<(key: unknown) => void>();
    expectTypeOf(mark<string, HTMLSpanElement>).parameters.toEqualTypeOf<
      [
        // oxlint-disable-next-line typescript/method-signature-style -- as declared, like Map's
        nodes: Marked<string, HTMLSpanElement> | { get(key: string): HTMLSpanElement | undefined },
        fn: (node: HTMLSpanElement, on: boolean) => void,
      ]
    >();
    expectTypeOf(mark<string, HTMLSpanElement>).returns.toEqualTypeOf<(key: string) => void>();
    expectTypeOf((parent: Element) => {
      const rows = list(parent, "id", createItemNode);
      const show = mark(rows, (node, on) => {
        expectTypeOf(node).toEqualTypeOf<HTMLSpanElement>();
        expectTypeOf(on).toEqualTypeOf<boolean>();
      });
      expectTypeOf(show).toEqualTypeOf<(key: string) => void>();
      const byMap = mark(new Map([["x", document.createElement("b")]]), (node) => {
        expectTypeOf(node).toEqualTypeOf<HTMLElement>();
      });
      expectTypeOf(byMap).toEqualTypeOf<(key: string) => void>();
      sub(signal("a"), show);
      // @ts-expect-error - the selection must hold the list's keys
      sub(signal(0), show);
    }).toBeFunction();
  });
});

/** A tier's signals and sub, loosely typed, as the list and mark tests drive them. */
interface Source<T> {
  readonly v: T;
}
interface Wiring {
  /** What becomes of a write to the source made inside the callback (outside a batch). */
  readonly reentry: "nested" | "after";
  /** "one": a signal holds at most one live sub (a second is a dev error). */
  readonly subs: "many" | "one";
  readonly signal: <T>(value: T) => Source<T>;
  readonly set: <T>(source: Source<T>, value: T) => void;
  readonly batch: (fn: () => void) => unknown;
  /** Calls `fn` with the source's value now and after each change; the handle is for `dispose`. */
  readonly sub: <T>(source: Source<T>, fn: (value: T) => void) => unknown;
  readonly dispose: (handle: unknown) => void;
}

const TIERS: readonly (readonly [name: string, wiring: Wiring])[] = [
  [
    "stage1",
    {
      reentry: "after",
      subs: "many",
      signal,
      set: set as Wiring["set"],
      batch,
      sub: sub as Wiring["sub"],
      dispose: dispose as Wiring["dispose"],
    },
  ],
  [
    "stage1/lite",
    {
      reentry: "after",
      subs: "many",
      signal: lite.signal,
      set: lite.set as Wiring["set"],
      batch: lite.batch,
      sub: lite.sub as Wiring["sub"],
      dispose: lite.dispose as Wiring["dispose"],
    },
  ],
  [
    "stage1/ultralite",
    {
      reentry: "nested",
      subs: "one",
      signal: ultralite.signal,
      set: ultralite.set as Wiring["set"],
      batch: ultralite.batch,
      sub: ultralite.sub as Wiring["sub"],
      dispose: ultralite.dispose as Wiring["dispose"],
    },
  ],
];

describe.each(TIERS)("on %s", (_tier, w) => {
  /** A list in a new parent on a new items signal, wired with the tier's sub. */
  const render = (
    items: readonly Item[],
    create: (item: Item) => HTMLSpanElement = createItemNode,
    update: ((node: HTMLSpanElement, item: Item) => void) | undefined = updateItemNode,
    parent: HTMLElement = document.createElement("div"),
  ) => {
    const source = w.signal(items);
    const rows = list(parent, "id", create, update);
    const handle = w.sub(source, rows);
    return {
      parent,
      source,
      rows,
      handle,
      set: (next: readonly Item[]): void => {
        w.set(source, next);
      },
      get: (): readonly Item[] => source.v,
    };
  };
  /** The rows of a list of `items`, for marks that need only its rows. */
  const rowsOf = (items: readonly Item[]) => render(items).rows;
  /** `mark(nodes, fn)` wired to `selected`; returns the wiring's handle. */
  const marked = <K>(
    selected: Source<K>,
    nodes: Marked<K, HTMLElement> | Map<K, HTMLElement>,
    fn: (node: HTMLElement, on: boolean) => void,
  ): unknown => w.sub(selected, mark(nodes, fn));

  describe("list", () => {
    test("renders the initial items in order", () => {
      expect.assertions(2);
      const { parent } = render(ITEMS);
      expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
      expect(parent.textContent).toBe("ABCD");
    });

    test("renders items set later", () => {
      expect.assertions(1);
      const rendered = render([]);
      rendered.set(ITEMS);
      expect(itemOrder(rendered.parent)).toEqual(["a", "b", "c", "d"]);
    });

    test("leaves a connected parent in place among its siblings", () => {
      expect.assertions(2);
      const host = document.createElement("div");
      const parent = document.createElement("div");
      host.append("before", parent, "after");
      document.body.append(host);
      try {
        const rendered = render([], createItemNode, undefined, parent);
        rendered.set(ITEMS);
        expect(host.childNodes[1]).toBe(parent);
        expect(host.textContent).toBe("beforeABCDafter");
      } finally {
        host.remove();
      }
    });

    test("Regression: keeps rows in order when the parent starts with whitespace text", () => {
      expect.assertions(2);
      const parent = document.createElement("div");
      parent.append("\n  ", "\n");
      const rendered = render(ITEMS, createItemNode, updateItemNode, parent);
      rendered.set(REORDERED_ITEMS);
      expect(itemOrder(parent)).toEqual(["d", "b", "e", "a"]);
      expect([...parent.children].map((node) => node.textContent)).toEqual([
        "Delta",
        "Beta",
        "Epsilon",
        "Alpha",
      ]);
    });

    test("moves only the row that moved later", () => {
      expect.assertions(1);
      const rendered = render(lettered("abcdefghij"));
      expect(
        insertedIds(rendered.parent, () => {
          rendered.set(lettered("abdefghcij"));
        }),
      ).toEqual(["c"]);
    });

    test("moves only the row that moved earlier", () => {
      expect.assertions(1);
      const rendered = render(lettered("abcdefghij"));
      expect(
        insertedIds(rendered.parent, () => {
          rendered.set(lettered("abhcdefgij"));
        }),
      ).toEqual(["h"]);
    });

    test("appends new rows at the end in order", () => {
      expect.assertions(1);
      const rendered = render(lettered("abc"));
      expect(
        insertedIds(rendered.parent, () => {
          rendered.set(lettered("abcdef"));
        }),
      ).toEqual(["d", "e", "f"]);
    });

    test("inserts new rows between kept rows in order", () => {
      expect.assertions(1);
      const rendered = render(lettered("ab"));
      rendered.set(lettered("axyzb"));
      expect(itemOrder(rendered.parent)).toEqual(["a", "x", "y", "z", "b"]);
    });

    test("inserts only the new rows when the kept rows keep their order", () => {
      expect.assertions(1);
      const rendered = render(lettered("abcdef"));
      const inserted = insertedIds(rendered.parent, () => {
        rendered.set(lettered("abxdyf"));
      });
      expect(inserted.toSorted((x, y) => x.localeCompare(y))).toEqual(["x", "y"]);
    });

    test("moves the fewest rows when no end matches", () => {
      expect.assertions(1);
      const rendered = render(lettered("abcdefghij"));
      // Old order c d e f g h in the middle becomes d c e f h g: 4 rows can stay
      expect(
        insertedIds(rendered.parent, () => {
          rendered.set(lettered("abdcefhgij"));
        }),
      ).toHaveLength(2);
    });

    test("swaps two rows with two moves", () => {
      expect.assertions(1);
      const rendered = render(lettered("abcdef"));
      const inserted = insertedIds(rendered.parent, () => {
        rendered.set(lettered("aecdbf"));
      });
      expect(inserted.toSorted((x, y) => x.localeCompare(y))).toEqual(["b", "e"]);
    });

    test("reorders rows to match the new items", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      rendered.set(REORDERED_ITEMS);
      expect(itemOrder(rendered.parent)).toEqual(["d", "b", "e", "a"]);
    });

    test("keeps the row of each retained key", () => {
      expect.assertions(3);
      const rendered = render(ITEMS);
      const nodes = [...rendered.parent.children];
      rendered.set(REORDERED_ITEMS);
      const [first, second, , fourth] = [...rendered.parent.children];
      expect(first).toBe(nodes[3]);
      expect(second).toBe(nodes[1]);
      expect(fourth).toBe(nodes[0]);
    });

    test("updates retained rows with their new items", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      rendered.set(REORDERED_ITEMS);
      expect(rendered.parent.textContent).toBe("DeltaBetaEpsilonAlpha");
    });

    test("removes the rows of dropped keys", () => {
      expect.assertions(2);
      const rendered = render(ITEMS);
      const nodes = [...rendered.parent.children];
      rendered.set(REORDERED_ITEMS);
      expect(nodes[2].parentNode).toBeNull(); // "c"
      expect(itemOrder(rendered.parent)).not.toContain("c");
    });

    test("clears every row when the items empty", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      rendered.set([]);
      expect(rendered.parent.childNodes).toHaveLength(0);
    });

    test("swaps two rows", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      rendered.set([ITEMS[0], ITEMS[3], ITEMS[2], ITEMS[1]]);
      expect(itemOrder(rendered.parent)).toEqual(["a", "d", "c", "b"]);
    });

    test("reverses the rows", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      rendered.set(ITEMS.toReversed());
      expect(itemOrder(rendered.parent)).toEqual(["d", "c", "b", "a"]);
    });

    test("Regression: moves a row to the end, then a later row forward", () => {
      expect.assertions(1);
      const rendered = render(lettered("abcde"));
      rendered.set(lettered("adceb"));
      expect(itemOrder(rendered.parent)).toEqual(["a", "d", "c", "e", "b"]);
    });

    test("replaces every row when no keys match", () => {
      expect.assertions(2);
      const rendered = render(ITEMS);
      const nodes = [...rendered.parent.children];
      rendered.set(lettered("xy"));
      expect(itemOrder(rendered.parent)).toEqual(["x", "y"]);
      expect(nodes.some((node) => node.parentNode)).toBeFalse();
    });

    test("matches the items after a seeded sequence of edits, keeping matched rows", () => {
      expect.assertions(3);
      const next = random(48_271);
      const fresh = freshItems();
      const rendered = render([]);
      const wrongOrder: number[] = [];
      const wrongText: number[] = [];
      const replacedRows: number[] = [];
      for (let round = 0; round < 300; round++) {
        const before = new Map(
          [...rendered.parent.children].map((node) => [(node as HTMLElement).dataset["id"], node]),
        );
        const data = editItems(next, rendered.get(), fresh);
        rendered.set(data);
        if (itemOrder(rendered.parent).join(",") !== data.map((item) => item.id).join(",")) {
          wrongOrder.push(round);
        }
        if (rendered.parent.textContent !== data.map((item) => item.label).join("")) {
          wrongText.push(round);
        }
        for (const node of rendered.parent.children) {
          const kept = before.get((node as HTMLElement).dataset["id"]);
          if (kept && kept !== node) replacedRows.push(round);
        }
      }
      expect(wrongOrder).toEqual([]);
      expect(wrongText).toEqual([]);
      expect(replacedRows).toEqual([]);
    });

    test("matches the items over seeded permutations and empties, keeping matched rows", () => {
      expect.assertions(2);
      const next = random(271_828);
      const fresh = freshItems();
      const rendered = render([]);
      const wrongOrder: number[] = [];
      const replacedRows: number[] = [];
      for (let round = 1; round <= 300; round++) {
        const before = new Map(
          [...rendered.parent.children].map((node) => [(node as HTMLElement).dataset["id"], node]),
        );
        const data =
          round % 50 === 0
            ? []
            : (round % 2 ? permuteItems : editItems)(next, rendered.get(), fresh);
        rendered.set(data);
        if (itemOrder(rendered.parent).join(",") !== data.map((item) => item.id).join(",")) {
          wrongOrder.push(round);
        }
        for (const node of rendered.parent.children) {
          const kept = before.get((node as HTMLElement).dataset["id"]);
          if (kept && kept !== node) replacedRows.push(round);
        }
      }
      expect(wrongOrder).toEqual([]);
      expect(replacedRows).toEqual([]);
    });

    test("never updates a row with the item it shows over a seeded sequence of edits", () => {
      expect.assertions(1);
      const next = random(1_234_567);
      const fresh = freshItems();
      const shown = new Map<string, Item>();
      let repeats = 0;
      const rendered = render(
        [],
        (item) => {
          shown.set(item.id, item);
          return createItemNode(item);
        },
        (node, item) => {
          if (shown.get(item.id) === item) repeats++;
          shown.set(item.id, item);
          updateItemNode(node, item);
        },
      );
      for (let round = 0; round < 300; round++)
        rendered.set(editItems(next, rendered.get(), fresh));
      expect(repeats).toBe(0);
    });

    test("calls update for a retained key whose item changed", () => {
      expect.assertions(1);
      const updated: string[] = [];
      const rendered = render(ITEMS, createItemNode, (_node, item) => {
        updated.push(item.label);
      });
      rendered.set([ITEMS[0], { id: "b", label: "B2" }, ITEMS[2], ITEMS[3]]);
      expect(updated).toEqual(["B2"]);
    });

    test("does not call update when the item is the same object", () => {
      expect.assertions(1);
      let updates = 0;
      const rendered = render(ITEMS, createItemNode, () => {
        updates++;
      });
      rendered.set(ITEMS.toReversed());
      expect(updates).toBe(0);
    });

    test("drops the trailing rows when the new items are the old ones' start", () => {
      expect.assertions(2);
      const rendered = render(ITEMS);
      const kept = [...rendered.parent.children].slice(0, 2);
      rendered.set(ITEMS.slice(0, 2));
      expect(itemOrder(rendered.parent)).toEqual(["a", "b"]);
      expect([...rendered.parent.children].every((node, index) => node === kept[index])).toBe(true);
    });

    test("keeps every row and updates only new items when each key stays in place", () => {
      expect.assertions(3);
      const updated: string[] = [];
      const rendered = render(ITEMS, createItemNode, (node, item) => {
        updated.push(item.id);
        updateItemNode(node, item);
      });
      const before = [...rendered.parent.children];
      rendered.set(
        ITEMS.map((item) =>
          item.id === "a" || item.id === "c" ? { ...item, label: "new" } : item,
        ),
      );
      expect(updated).toEqual(["a", "c"]);
      expect([...rendered.parent.children].every((node, index) => node === before[index])).toBe(
        true,
      );
      expect([...rendered.parent.children].map((node) => node.textContent)).toEqual([
        "new",
        "B",
        "new",
        "D",
      ]);
    });

    test("a disposed wiring leaves its rows as they were", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      w.dispose(rendered.handle);
      rendered.set(REORDERED_ITEMS);
      expect(itemOrder(rendered.parent)).toEqual(["a", "b", "c", "d"]);
    });

    test.if(w.subs === "many")(
      "disposing a wiring twice leaves a later list on its items following them",
      () => {
        expect.assertions(1);
        const first = render(ITEMS);
        w.dispose(first.handle);
        const parent = document.createElement("div");
        w.sub(first.source, list(parent, "id", createItemNode));
        w.dispose(first.handle);
        first.set(lettered("x"));
        expect(itemOrder(parent)).toEqual(["x"]);
      },
    );

    test.if(w.subs === "many")(
      "a second list on one items signal follows it too, and is disposed on its own",
      () => {
        expect.assertions(1);
        const items = w.signal(ITEMS);
        const [first, second] = [document.createElement("div"), document.createElement("div")];
        const one = w.sub(items, list(first, "id", createItemNode));
        w.sub(items, list(second, "id", createItemNode));
        w.dispose(one);
        w.set(items, lettered("xy"));
        expect([itemOrder(first), itemOrder(second)]).toEqual([
          ["a", "b", "c", "d"],
          ["x", "y"],
        ]);
      },
    );

    test("a batch reconciles once, at its end, with the last items", () => {
      expect.assertions(1);
      const created: string[] = [];
      const rendered = render(ITEMS, (item) => {
        created.push(item.id);
        return createItemNode(item);
      });
      created.length = 0;
      const inside: string[][] = [];
      w.batch(() => {
        rendered.set(lettered("x"));
        rendered.set(lettered("y"));
        inside.push([...itemOrder(rendered.parent)]);
      });
      expect([inside, created, itemOrder(rendered.parent)]).toEqual([
        [["a", "b", "c", "d"]],
        ["y"],
        ["y"],
      ]);
    });

    test("does not reconcile for a batch that restores the items", () => {
      expect.assertions(1);
      let creates = 0;
      const rendered = render(ITEMS, (item) => {
        creates++;
        return createItemNode(item);
      });
      creates = 0;
      w.batch(() => {
        rendered.set(lettered("z"));
        rendered.set(ITEMS);
      });
      expect(creates).toBe(0);
    });

    test("a throwing create reaches the writer (dev: wrapped, naming the rule)", () => {
      expect.assertions(1);
      const rendered = render([], (item) => {
        if (item.id === "bad") throw new Error("create failed");
        return createItemNode(item);
      });
      const caught = thrownBy(() => {
        rendered.set([ITEMS[0], { id: "bad", label: "" }]);
      }) as Error;
      if (DEV) {
        expect([caught.message, (caught.cause as Error).message]).toEqual([
          "stage1: a list's create, update, or drop threw; its rows no longer match its items",
          "create failed",
        ]);
      } else expect(caught.message).toBe("create failed");
    });

    test("a throwing create in the first build puts a connected parent back", () => {
      expect.assertions(2);
      const host = document.createElement("div");
      const parent = document.createElement("ul");
      host.append("before", parent, "after");
      document.body.append(host);
      try {
        const rendered = render(
          [],
          (item) => {
            if (item.id === "bad") throw new Error("create failed");
            return createItemNode(item);
          },
          undefined,
          parent,
        );
        expect(() => {
          rendered.set([ITEMS[0], { id: "bad", label: "" }]);
        }).toThrow();
        expect(host.childNodes[1]).toBe(parent);
      } finally {
        host.remove();
      }
    });

    test.if(w.reentry === "after")(
      "an update that writes the items leaves the rows matching them",
      () => {
        expect.assertions(1);
        const rendered = render(lettered("ab"), createItemNode, (node, item) => {
          updateItemNode(node, item);
          if (item.label === "B") w.set(rendered.source, lettered("z"));
        });
        rendered.set([ITEMS[0], { id: "b", label: "B" }]);
        expect(itemOrder(rendered.parent)).toEqual(["z"]);
      },
    );

    test.if(w.reentry === "after")(
      "a create that writes the items leaves the rows matching them",
      () => {
        expect.assertions(1);
        let wrote = false;
        const rendered = render([], (item) => {
          if (!wrote) {
            wrote = true;
            w.set(rendered.source, lettered("xy"));
          }
          return createItemNode(item);
        });
        rendered.set(ITEMS);
        expect(itemOrder(rendered.parent)).toEqual(["x", "y"]);
      },
    );

    // The wiring's first call is held: the write is delivered after it returns
    test.if(w.reentry === "after")(
      "a create in the first reconcile that writes the items leaves the rows matching them",
      () => {
        expect.assertions(1);
        const source = w.signal<readonly Item[]>(lettered("ab"));
        const parent = document.createElement("div");
        let wrote = false;
        w.sub(
          source,
          list(parent, "id", (item: Item) => {
            if (!wrote) {
              wrote = true;
              w.set(source, lettered("z"));
            }
            return createItemNode(item);
          }),
        );
        expect(itemOrder(parent)).toEqual(["z"]);
      },
    );
  });

  describe("mark", () => {
    test("marks the selected key's row at once", () => {
      expect.assertions(1);
      const [calls, fn] = recorder();
      marked(w.signal("b"), rowsOf(ITEMS), fn);
      expect(calls).toEqual([["b", true]]);
    });

    test("unmarks the old row and marks the new one when the selection changes", () => {
      expect.assertions(1);
      const selected = w.signal("b");
      const [calls, fn] = recorder();
      marked(selected, rowsOf(ITEMS), fn);
      calls.length = 0;
      w.set(selected, "c");
      expect(calls).toEqual([
        ["b", false],
        ["c", true],
      ]);
    });

    test("marks nothing when no row has the selected key", () => {
      expect.assertions(1);
      const [calls, fn] = recorder();
      marked(w.signal("z"), rowsOf(ITEMS), fn);
      expect(calls).toEqual([]);
    });

    test("calls nothing for rows created with unselected keys", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      const [calls, fn] = recorder();
      marked(w.signal("z"), rendered.rows, fn);
      rendered.set([...ITEMS, ...lettered("xy")]);
      expect(calls).toEqual([]);
    });

    test("marks a row created while its key is selected", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      const [calls, fn] = recorder();
      marked(w.signal("e"), rendered.rows, fn);
      rendered.set([...ITEMS, ...lettered("e")]);
      expect(calls).toEqual([["e", true]]);
    });

    test("marks a row the first build creates while its key is selected", () => {
      expect.assertions(1);
      const rendered = render([]);
      const [calls, fn] = recorder();
      marked(w.signal("b"), rendered.rows, fn);
      rendered.set(ITEMS);
      expect(calls).toEqual([["b", true]]);
    });

    test.if(w.subs === "many")("marks a row of a list whose items signal already had a sub", () => {
      expect.assertions(1);
      const items = w.signal(ITEMS);
      w.sub(items, () => {});
      const rows = list(document.createElement("div"), "id", createItemNode);
      w.sub(items, rows);
      const [calls, fn] = recorder();
      marked(w.signal("c"), rows, fn);
      expect(calls).toEqual([["c", true]]);
    });

    test("unmarks a row marked as it was created when the selection moves", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      const selected = w.signal("e");
      const [, fn] = recorder();
      marked(selected, rendered.rows, fn);
      rendered.set([...ITEMS, ...lettered("e")]);
      w.set(selected, "a");
      expect(markedIds(rendered.parent.children)).toEqual(["a"]);
    });

    test("never passes a removed row to fn", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      const selected = w.signal("b");
      const [calls, fn] = recorder();
      marked(selected, rendered.rows, fn);
      rendered.set(ITEMS.filter((item) => item.id !== "b"));
      calls.length = 0;
      w.set(selected, "c");
      expect(calls).toEqual([["c", true]]);
    });

    test.if(w.subs === "many")(
      "calls nothing when a batch restores the value, even with a reader made in the batch",
      () => {
        expect.assertions(1);
        const selected = w.signal("a");
        const [calls, fn] = recorder();
        marked(selected, rowsOf(ITEMS), fn);
        calls.length = 0;
        w.batch(() => {
          w.set(selected, "b");
          w.sub(selected, () => {});
          w.set(selected, "a");
        });
        expect(calls).toEqual([]);
      },
    );

    test("marks the right row after many selections and then a list change", () => {
      expect.assertions(1);
      const rendered = render(lettered("abcdefghijklmnop"));
      const selected = w.signal("a");
      const [, fn] = recorder();
      marked(selected, rendered.rows, fn);
      // More selections than mark answers by scanning, while the list stays the same
      for (const id of "bcdefghijklm") w.set(selected, id);
      rendered.set([...rendered.get().filter((item) => item.id !== "c"), ...lettered("q")]);
      w.set(selected, "q");
      expect(markedIds(rendered.parent.children)).toEqual(["q"]);
    });

    test("marks the right row after many selections, an update that keeps every row, and a reorder", () => {
      expect.assertions(2);
      const rendered = render(lettered("abcdefghijklmnop"));
      const selected = w.signal("a");
      const [, fn] = recorder();
      marked(selected, rendered.rows, fn);
      for (const id of "bcdefghijklm") w.set(selected, id);
      // A new array with every key in place, one item replaced: the rows stay
      rendered.set(
        rendered.get().map((item) => (item.id === "d" ? { id: "d", label: "D" } : item)),
      );
      w.set(selected, "d");
      expect(markedIds(rendered.parent.children)).toEqual(["d"]);
      rendered.set([
        ...rendered
          .get()
          .filter((item) => item.id !== "e")
          .toReversed(),
        ...lettered("q"),
      ]);
      w.set(selected, "q");
      expect(markedIds(rendered.parent.children)).toEqual(["q"]);
    });

    test("leaves only the new row marked when a batch adds a row and then selects it", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      const selected = w.signal("a");
      const [, fn] = recorder();
      marked(selected, rendered.rows, fn);
      w.batch(() => {
        rendered.set([...ITEMS, ...lettered("e")]);
        w.set(selected, "e");
      });
      expect(markedIds(rendered.parent.children)).toEqual(["e"]);
    });

    test.if(w.subs === "many")(
      "marks the restored key's row when created during a batch that restores the value",
      () => {
        expect.assertions(1);
        const rendered = render(ITEMS);
        const selected = w.signal("a");
        w.sub(selected, () => {});
        const [, fn] = recorder();
        w.batch(() => {
          w.set(selected, "b");
          marked(selected, rendered.rows, fn);
          w.set(selected, "a");
        });
        expect(markedIds(rendered.parent.children)).toEqual(["a"]);
      },
    );

    test("leaves only the final row marked when fn changes the selection mid-change", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      const selected = w.signal("a");
      const [, paint] = recorder();
      marked(selected, rendered.rows, (node, on) => {
        paint(node, on);
        if (node.dataset["id"] === "a" && !on) w.set(selected, "c");
      });
      w.set(selected, "b");
      expect(markedIds(rendered.parent.children)).toEqual(["c"]);
    });

    test("marks a row its list makes while the mark's first call runs", () => {
      expect.assertions(1);
      const rendered = render(ITEMS);
      let once = true;
      marked(w.signal("b"), rendered.rows, (node, on) => {
        node.className = on ? "on" : "";
        if (once) {
          once = false;
          // A new row for "b": cleared, then made again
          rendered.set([]);
          rendered.set(lettered("ab"));
        }
      });
      expect(markedIds(rendered.parent.children)).toEqual(["b"]);
    });

    test("a mark callback that removes the previously marked row: fn sees no removed row and the new row ends marked", () => {
      expect.assertions(1);
      const rendered = render(lettered("abc"));
      const selected = w.signal("");
      const calls: string[] = [];
      w.sub(
        selected,
        mark(rendered.rows, (node, on) => {
          calls.push(
            `${node.dataset["id"]} ${on}${node.parentNode === rendered.parent ? "" : " removed"}`,
          );
          node.className = on ? "on" : "";
          if (on && node.dataset["id"] === "c") rendered.set(lettered("bc"));
        }),
      );
      w.set(selected, "a");
      w.set(selected, "c");
      expect([itemOrder(rendered.parent), markedIds(rendered.parent.children), calls]).toEqual([
        ["b", "c"],
        ["c"],
        ["a true", "a false", "c true"],
      ]);
    });

    test("a drop that moves the selection off its removed row: fn sees no removed row and the new key ends marked", () => {
      expect.assertions(1);
      const parent = document.createElement("div");
      const items = w.signal<readonly Item[]>(lettered("abc"));
      const selected = w.signal("b");
      const calls: string[] = [];
      const rows = list(parent, "id", createItemNode, undefined, (row) => {
        if (row.dataset["id"] === selected.v) w.set(selected, "c");
      });
      w.sub(items, rows);
      w.sub(
        selected,
        mark(rows, (node, on) => {
          calls.push(`${node.dataset["id"]} ${on}${node.parentNode === parent ? "" : " removed"}`);
          node.className = on ? "on" : "";
        }),
      );
      w.set(items, lettered("ac"));
      expect([
        markedIds(parent.children),
        calls.filter((call) => call.endsWith("removed")),
      ]).toEqual([["c"], []]);
    });

    test("stops following the selection once its wiring is disposed", () => {
      expect.assertions(1);
      const selected = w.signal("a");
      const [calls, fn] = recorder();
      const handle = marked(selected, rowsOf(ITEMS), fn);
      w.dispose(handle);
      calls.length = 0;
      w.set(selected, "b");
      expect(calls).toEqual([]);
    });

    test.if(w.subs === "many")(
      "disposing a mark's wiring twice leaves a later mark on its selection following it",
      () => {
        expect.assertions(1);
        const selected = w.signal("a");
        const handle = marked(selected, rowsOf(ITEMS), () => {});
        w.dispose(handle);
        const [calls, fn] = recorder();
        marked(selected, rowsOf(ITEMS), fn);
        w.dispose(handle);
        w.set(selected, "b");
        expect(calls).toEqual([
          ["a", true],
          ["a", false],
          ["b", true],
        ]);
      },
    );

    // Nothing detaches a mark from its list but a later mark (documented; a check would cost
    // bytes). On stage1/lite the wiring is the selection's first sub or a later one: both
    // (stage1/ultralite holds one sub per signal: the first only)
    test.each(
      (
        [
          ["the selection's only sub", false],
          ["a later sub of the selection", true],
        ] as const
      ).filter(([, shared]) => !shared || w.subs === "many"),
    )(
      "Accepted tradeoff: a mark whose wiring is disposed still marks rows the list creates later with its last key (%s)",
      (_label, shared) => {
        expect.assertions(1);
        const rendered = render([]);
        const selected = w.signal("b");
        if (shared) w.sub(selected, () => {});
        const [calls, fn] = recorder();
        w.dispose(marked(selected, rendered.rows, fn));
        rendered.set(ITEMS);
        expect(calls).toEqual([["b", true]]);
      },
    );

    test("a live mark next to a disposed one on the same selection still marks new rows", () => {
      expect.assertions(1);
      const rendered = render([]);
      const selected = w.signal("b");
      const [old, oldFn] = recorder();
      w.dispose(marked(selected, rowsOf([]), oldFn));
      const [calls, fn] = recorder();
      marked(selected, rendered.rows, fn);
      rendered.set(ITEMS);
      expect([old, calls]).toEqual([[], [["b", true]]]);
    });

    test("keeps none of the rows a list change removed (its map and marked row)", async () => {
      expect.assertions(1);
      // The list and mark stay alive (held here); the rows are held only weakly. In a function,
      // so no frame of this test holds the rows
      const removed = (): [refs: WeakRef<Element>[], held: unknown[]] => {
        const rendered = render(lettered("abcdefghijklmnopqrstuvwxyz"));
        const selected = w.signal("a");
        const handle = marked(selected, rendered.rows, () => {});
        // More lookups than mark answers by scanning: it builds its key map
        for (const id of "bcdefghijklm") w.set(selected, id);
        const refs = Array.from(rendered.parent.children, (node) => new WeakRef(node));
        rendered.set([]);
        return [refs, [rendered.source, rendered.rows, rendered.handle, selected, handle]];
      };
      const [refs, held] = removed();
      // GC from fresh event-loop turns until most are gone, at most 10: the stack is scanned
      // conservatively, so a stray row may stay; a mark that kept the old rows keeps all 26
      let alive = refs.length;
      for (let turn = 0; turn < 10 && alive >= refs.length / 2; turn++) {
        // oxlint-disable-next-line no-await-in-loop -- each turn ends before the next collection
        await Bun.sleep(0);
        Bun.gc(true);
        alive = refs.filter((ref) => ref.deref() !== undefined).length;
      }
      // Reading `held` keeps the list and mark alive until here
      expect([alive < refs.length / 2, held.length]).toEqual([true, 5]);
    });

    test("marks a map's element for the selected key at once", () => {
      expect.assertions(1);
      const [calls, fn] = recorder();
      marked(w.signal("b"), elements("abc"), fn);
      expect(calls).toEqual([["b", true]]);
    });

    test("unmarks the old map element and marks the new one when the selection changes", () => {
      expect.assertions(1);
      const selected = w.signal("b");
      const [calls, fn] = recorder();
      marked(selected, elements("abc"), fn);
      calls.length = 0;
      w.set(selected, "c");
      expect(calls).toEqual([
        ["b", false],
        ["c", true],
      ]);
    });

    test("only unmarks when the map lacks the selected key", () => {
      expect.assertions(1);
      const selected = w.signal("a");
      const [calls, fn] = recorder();
      marked(selected, elements("abc"), fn);
      calls.length = 0;
      w.set(selected, "z");
      expect(calls).toEqual([["a", false]]);
    });

    test.if(w.subs === "many")("lets several marks share one map and one signal", () => {
      expect.assertions(1);
      const tabs = elements("ab");
      const selected = w.signal("a");
      const seen: string[] = [];
      marked(selected, tabs, (node, on) => {
        seen.push(`first ${node.dataset["id"]} ${on}`);
      });
      marked(selected, tabs, (node, on) => {
        seen.push(`second ${node.dataset["id"]} ${on}`);
      });
      seen.length = 0;
      w.set(selected, "b");
      expect(seen.toSorted()).toEqual([
        "first a false",
        "first b true",
        "second a false",
        "second b true",
      ]);
    });

    test("unmarks a map's element that has no parent", () => {
      expect.assertions(1);
      const selected = w.signal("a");
      const [calls, fn] = recorder();
      marked(selected, elements("ab", true), fn);
      calls.length = 0;
      w.set(selected, "b");
      expect(calls).toEqual([
        ["a", false],
        ["b", true],
      ]);
    });

    test("leaves only the final map element marked when fn changes the selection mid-change", () => {
      expect.assertions(1);
      const tabs = elements("abc");
      const selected = w.signal("a");
      const [, paint] = recorder();
      marked(selected, tabs, (node, on) => {
        paint(node, on);
        if (node.dataset["id"] === "a" && !on) w.set(selected, "c");
      });
      w.set(selected, "b");
      expect(markedIds(tabs.values())).toEqual(["c"]);
    });
  });
});

describe("list on stage1 (owners)", () => {
  /** A list wired with the full tier's sub, in a new parent. */
  const render = (
    items: readonly Item[],
    create: (item: Item) => HTMLSpanElement = createItemNode,
    update: ((node: HTMLSpanElement, item: Item) => void) | undefined = updateItemNode,
    parent: HTMLElement = document.createElement("div"),
  ) => {
    const source = signal(items);
    const handle = sub(source, list(parent, "id", create, update));
    return {
      parent,
      source,
      handle,
      set: (next: readonly Item[]): void => {
        set(source, next);
      },
    };
  };

  test("a row's create and update run untracked", () => {
    expect.assertions(2);
    const s = signal(0);
    let creates = 0;
    const rendered = render(
      ITEMS,
      (item) => {
        creates++;
        get(s);
        return createItemNode(item);
      },
      (node, item) => {
        get(s);
        updateItemNode(node, item);
      },
    );
    rendered.set(rendered.source.v.map((item) => ({ id: item.id, label: item.label })));
    creates = 0;
    set(s, 1);
    expect(creates).toBe(0);
    rendered.set([...rendered.source.v, ...lettered("e")]);
    expect(creates).toBe(1);
  });

  test("a list wired in an effect's run stops when the effect re-runs (no duplicated rows)", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    const items = signal<readonly Item[]>([ITEMS[0]]);
    const trigger = signal(0);
    let creates = 0;
    effect(() => {
      get(trigger);
      parent.textContent = "";
      sub(
        items,
        list(parent, "id", (item: Item) => {
          creates++;
          return createItemNode(item);
        }),
      );
    });
    set(trigger, 1);
    creates = 0;
    set(items, [ITEMS[0], ITEMS[1]]);
    expect(creates).toBe(1);
    expect(itemOrder(parent)).toEqual(["a", "b"]);
  });

  test("the graph stays usable after a throwing create (owner and tracking restored)", () => {
    expect.assertions(1);
    const rendered = render([], () => {
      throw new Error("create failed");
    });
    thrownBy(() => {
      rendered.set(ITEMS);
    });
    const s = signal(0);
    let runs = 0;
    effect(() => {
      get(s);
      runs++;
    });
    // An effect made under a leaked owner would go with the list's wiring
    dispose(rendered.handle);
    set(s, 1);
    expect(runs).toBe(2);
  });

  test("a list with no drop leaves nothing of its own on its rows", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const s = signal(0);
    // A create that reads a signal still makes nothing
    const rendered = render(
      lettered("abcdef"),
      (item) => {
        get(s);
        return createItemNode(item);
      },
      updateItemNode,
      parent,
    );
    rendered.set(lettered("fedcba"));
    // happy-dom keeps its own state under described symbols; a list's would be undescribed
    const undescribed = (node: Element): symbol[] =>
      Object.getOwnPropertySymbols(node).filter((key) => key.description === undefined);
    expect([...parent.children].flatMap((node) => undescribed(node))).toEqual([]);
  });

  test.serial(
    "a row effect made outside a scope belongs to the wiring: it outlives its row until the wiring is disposed (dev warns once)",
    () => {
      expect.assertions(3);
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const s = signal(0);
      const runs: string[] = [];
      const rendered = render(lettered("abc"), (item) => {
        effect(() => {
          runs.push(`${item.id} ${get(s)}`);
        });
        return createItemNode(item);
      });
      rendered.set(lettered("a"));
      runs.length = 0;
      set(s, 1);
      expect(runs.toSorted()).toEqual(["a 1", "b 1", "c 1"]);
      dispose(rendered.handle);
      runs.length = 0;
      set(s, 2);
      expect(runs).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(DEV ? 1 : 0);
    },
  );

  test.serial(
    "what update makes belongs to the wiring: it outlives its row until the wiring is disposed",
    () => {
      expect.assertions(1);
      // oxlint-disable-next-line no-underscore-dangle
      using _consoleSpy = spyOn(console, "warn").mockImplementation(() => {});
      const cleaned: string[] = [];
      const rendered = render(ITEMS, createItemNode, (node, item) => {
        defer(() => {
          cleaned.push(item.label);
        });
        updateItemNode(node, item);
      });
      rendered.set([{ id: "a", label: "A2" }, ITEMS[1]]);
      rendered.set([ITEMS[1]]);
      rendered.set([]);
      const kept = [...cleaned];
      dispose(rendered.handle);
      expect([kept, cleaned]).toEqual([[], ["A2"]]);
    },
  );
});

/** A row's scope, on rows made by `inScope` (a described symbol, unlike a list's own). */
const ROW_SCOPE = Symbol("row scope");
type ScopedRow = HTMLSpanElement & { [ROW_SCOPE]?: Scope };
/** Rows that own what create makes: create runs in a scope of the row's own (pattern 2). */
const inScope =
  (create: (item: Item) => HTMLSpanElement) =>
  (item: Item): HTMLSpanElement => {
    let node!: ScopedRow;
    const s = scope(() => {
      node = create(item);
    });
    node[ROW_SCOPE] = s;
    return node;
  };
/** The list's drop for `inScope` rows: disposes the row's scope (a plain row has none). */
const dropScope = (row: ScopedRow): void => {
  const s = row[ROW_SCOPE];
  if (s !== undefined) dispose(s);
};

describe("rows that own effects (through drop)", () => {
  /** A list on `source` whose rows own what create makes, wired with stage1's sub. */
  const ownedOn = (
    source: Signal<readonly Item[]>,
    create: (item: Item) => HTMLSpanElement,
    parent: HTMLElement = document.createElement("div"),
  ) => {
    const handle = sub(source, list(parent, "id", inScope(create), updateItemNode, dropScope));
    return {
      parent,
      source,
      handle,
      set: (next: readonly Item[]): void => {
        set(source, next);
      },
    };
  };
  const owned = (
    items: readonly Item[],
    create: (item: Item) => HTMLSpanElement,
    parent?: HTMLElement,
  ): ReturnType<typeof ownedOn> => ownedOn(signal(items), create, parent);

  test("an effect an owning row makes is disposed when the row is removed", () => {
    expect.assertions(1);
    const s = signal(0);
    const runs: string[] = [];
    const rendered = owned(ITEMS, (item) => {
      effect(() => {
        get(s);
        runs.push(item.id);
      });
      return createItemNode(item);
    });
    rendered.set([ITEMS[0], ITEMS[2]]);
    runs.length = 0;
    set(s, 1);
    expect(runs.toSorted()).toEqual(["a", "c"]);
  });

  test("one effect per row, its handle on the row and disposed by drop: a removed row's stops", () => {
    expect.assertions(2);
    type Row = HTMLSpanElement & { fx: Effect };
    const s = signal(0);
    const items = signal(lettered("abc"));
    const runs: string[] = [];
    const handle = sub(
      items,
      list(
        document.createElement("div"),
        "id",
        (item: Item) => {
          const row = createItemNode(item) as Row;
          row.fx = effect(() => {
            runs.push(`${item.id} ${get(s)}`);
          });
          return row;
        },
        undefined,
        (row) => {
          dispose(row.fx);
        },
      ),
    );
    set(items, lettered("ac"));
    runs.length = 0;
    set(s, 1);
    expect(runs.toSorted()).toEqual(["a 1", "c 1"]);
    dispose(handle);
    runs.length = 0;
    set(s, 2);
    expect(runs).toEqual([]);
  });

  test("runs a removed row's cleanups before it leaves the DOM", () => {
    expect.assertions(1);
    const cleaned: string[] = [];
    const rendered = owned(ITEMS, (item) => {
      const node = createItemNode(item);
      defer(() => {
        cleaned.push(`${item.id}${node.parentNode ? "" : " detached"}`);
      });
      return node;
    });
    rendered.set([ITEMS[0], ITEMS[2]]);
    expect(cleaned.toSorted()).toEqual(["b", "d"]);
  });

  test("runs every row's cleanups when the items empty, before the rows leave the DOM", () => {
    expect.assertions(1);
    const cleaned: string[] = [];
    const rendered = owned(ITEMS, (item) => {
      const node = createItemNode(item);
      defer(() => {
        cleaned.push(`${item.id}${node.parentNode ? "" : " detached"}`);
      });
      return node;
    });
    rendered.set([]);
    expect(cleaned.toSorted()).toEqual(["a", "b", "c", "d"]);
  });

  test("runs every replaced row's cleanups when no key matches", () => {
    expect.assertions(1);
    const cleaned: string[] = [];
    const rendered = owned(ITEMS, (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    rendered.set(lettered("xy"));
    expect(cleaned.toSorted()).toEqual(["a", "b", "c", "d"]);
  });

  test("keeps what moved and updated rows own", () => {
    expect.assertions(1);
    let cleanups = 0;
    const rendered = owned(ITEMS, (item) => {
      defer(() => {
        cleanups++;
      });
      return createItemNode(item);
    });
    rendered.set(ITEMS.toReversed());
    rendered.set(rendered.source.v.map((item) => ({ id: item.id, label: item.label })));
    expect(cleanups).toBe(0);
  });

  test("runs each removed row's cleanups once over a seeded sequence of edits, owning and plain rows mixed", () => {
    expect.assertions(1);
    const next = random(9001);
    const fresh = freshItems();
    const source = signal<readonly Item[]>([]);
    const cleanups = new Map<string, number>();
    // Every third row owns something: owning and plain rows mix
    const owning = inScope((item) => {
      defer(() => {
        cleanups.set(item.id, (cleanups.get(item.id) ?? 0) + 1);
      });
      return createItemNode(item);
    });
    sub(
      source,
      list(
        document.createElement("div"),
        "id",
        (item: Item) => (Number(item.id) % 3 === 0 ? owning(item) : createItemNode(item)),
        undefined,
        dropScope,
      ),
    );
    const removed = new Set<string>();
    for (let round = 0; round < 300; round++) {
      const data = editItems(next, source.v, fresh);
      const ids = new Set(data.map((item) => item.id));
      for (const item of source.v) if (!ids.has(item.id)) removed.add(item.id);
      set(source, data);
    }
    expect([...cleanups].filter(([key, count]) => count !== 1 || !removed.has(key))).toEqual([]);
  });

  test("every owning row's cleanup runs exactly once over seeded edits of each shape and the wiring's disposal", () => {
    expect.assertions(1);
    const next = random(77);
    const fresh = freshItems();
    let made = 0;
    const items = signal<readonly Item[]>([]);
    const cleanups = new Map<string, number>();
    const handle = sub(
      items,
      list(
        document.createElement("div"),
        "id",
        inScope((item) => {
          made++;
          defer(() => {
            cleanups.set(item.id, (cleanups.get(item.id) ?? 0) + 1);
          });
          return createItemNode(item);
        }),
        undefined,
        dropScope,
      ),
    );
    for (let round = 0; round < 300; round++) set(items, shapeItems(next, items.v, fresh));
    dispose(handle);
    expect([cleanups.size, [...cleanups].filter(([, count]) => count !== 1)]).toEqual([made, []]);
  });

  test("disposing the wiring runs every owning row's cleanups, newest row first", () => {
    expect.assertions(1);
    const cleaned: string[] = [];
    const rendered = owned(ITEMS, (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    dispose(rendered.handle);
    expect(cleaned).toEqual(["d", "c", "b", "a"]);
  });

  test("a list wired in a scope, and its rows' effects, are disposed with the scope", () => {
    expect.assertions(1);
    const items = signal<readonly Item[]>(ITEMS);
    const s = signal(0);
    let runs = 0;
    let creates = 0;
    const page = scope(() => {
      ownedOn(items, (item) => {
        creates++;
        effect(() => {
          get(s);
          runs++;
        });
        return createItemNode(item);
      });
    });
    dispose(page);
    runs = 0;
    creates = 0;
    set(s, 1);
    set(items, lettered("xyz"));
    expect([runs, creates]).toEqual([0, 0]);
  });

  test("a nested list's row cleanups stay with that row", () => {
    expect.assertions(1);
    const inner = signal<readonly Item[]>([ITEMS[1]]);
    const cleaned: string[] = [];
    owned([ITEMS[0]], (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      const node = createItemNode(item);
      ownedOn(
        inner,
        (innerItem) => {
          defer(() => {
            cleaned.push(innerItem.id);
          });
          return createItemNode(innerItem);
        },
        node,
      );
      return node;
    });
    set(inner, []);
    expect(cleaned).toEqual(["b"]);
  });

  test("a nested list is disposed with its row, its rows' cleanups first", () => {
    expect.assertions(2);
    const inner = signal<readonly Item[]>([ITEMS[1]]);
    const cleaned: string[] = [];
    let innerCreates = 0;
    const outer = owned([ITEMS[0]], (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      const node = createItemNode(item);
      ownedOn(
        inner,
        (innerItem) => {
          innerCreates++;
          defer(() => {
            cleaned.push(innerItem.id);
          });
          return createItemNode(innerItem);
        },
        node,
      );
      return node;
    });
    outer.set([]);
    innerCreates = 0;
    set(inner, [ITEMS[2]]);
    expect(cleaned).toEqual(["b", "a"]);
    expect(innerCreates).toBe(0);
  });

  test("a row keeps what it owns when it catches a nested list's throwing create", () => {
    expect.assertions(1);
    const cleaned: string[] = [];
    const rendered = owned([ITEMS[0]], (item) => {
      defer(() => {
        cleaned.push("before");
      });
      const node = createItemNode(item);
      try {
        sub(
          signal([ITEMS[1]]),
          list(node, "id", (): HTMLSpanElement => {
            throw new Error("nested create failed");
          }),
        );
      } catch {
        // the row carries on without its nested list
      }
      defer(() => {
        cleaned.push("after");
      });
      return node;
    });
    rendered.set([]);
    expect(cleaned).toEqual(["after", "before"]);
  });

  test("a row effect re-runs after its list's owner (parent-first) and once per write", () => {
    expect.assertions(1);
    const s = signal(0);
    const order: string[] = [];
    effect(() => {
      order.push(`page ${get(s)}`);
      owned(lettered("ab"), (item) => {
        effect(() => {
          order.push(`${item.id} ${get(s)}`);
        });
        return createItemNode(item);
      });
    });
    order.length = 0;
    set(s, 1);
    // The page re-ran first: it disposed the old wiring and its rows' effects, then made new ones
    expect(order).toEqual(["page 1", "a 1", "b 1"]);
  });

  test("a row effect whose source changes in the batch that removes its row does not run (parent-first)", () => {
    expect.assertions(1);
    const s = signal(0);
    const runs: string[] = [];
    const rendered = owned(lettered("abc"), (item) => {
      effect(() => {
        runs.push(`${item.id} ${get(s)}`);
      });
      return createItemNode(item);
    });
    runs.length = 0;
    // The rows' effects are queued before the wiring
    batch(() => {
      set(s, 1);
      rendered.set(lettered("ac"));
    });
    expect(runs.toSorted()).toEqual(["a 1", "c 1"]);
  });

  test("the first row's effect does not run in the batch that removes its row (parent-first)", () => {
    expect.assertions(1);
    const s = signal(0);
    const runs: string[] = [];
    const rendered = owned(lettered("abc"), (item) => {
      effect(() => {
        if (item.id === "a") runs.push(`a ${get(s)}`);
      });
      return createItemNode(item);
    });
    batch(() => {
      set(s, 1);
      rendered.set(lettered("bc"));
    });
    expect(runs).toEqual(["a 0"]);
  });

  test("a nested list's row effect does not run in the batch that removes its outer row (parent-first)", () => {
    expect.assertions(1);
    const s = signal(0);
    const runs: string[] = [];
    const outer = owned(lettered("ab"), (item) => {
      const node = createItemNode(item);
      owned(
        lettered("x"),
        (inner) => {
          effect(() => {
            runs.push(`${item.id}${inner.id} ${get(s)}`);
          });
          return createItemNode(inner);
        },
        node,
      );
      return node;
    });
    runs.length = 0;
    batch(() => {
      set(s, 1);
      outer.set(lettered("b"));
    });
    expect(runs).toEqual(["bx 1"]);
  });

  test("rows keep what they own when the flush ending the wiring's creation changes the items", () => {
    expect.assertions(1);
    const items = signal<readonly Item[]>(lettered("ab"));
    const x = signal(0);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      if (get(x) === 1) set(items, lettered("abc"));
    });
    ownedOn(items, (item) => {
      effect(() => {
        get(s);
        runs++;
      });
      // Queues the effect above, which runs once the first reconcile is done
      if (item.id === "b") set(x, 1);
      return createItemNode(item);
    });
    runs = 0;
    set(s, 1);
    expect(runs).toBe(3);
  });

  test("an effect that wires a list, then reads what its rows' effects read, re-runs when that changes", () => {
    expect.assertions(1);
    const x = signal(0);
    let runs = 0;
    effect(() => {
      owned(lettered("ab"), (item) => {
        effect(() => {
          get(x);
        });
        return createItemNode(item);
      });
      get(x);
      runs++;
    });
    set(x, 1);
    expect(runs).toBe(2);
  });

  test("a row effect queued before its wiring survives the wiring's throwing call", () => {
    expect.assertions(1);
    const items = signal<readonly Item[]>(lettered("ab"));
    const t = signal(0);
    const runs: string[] = [];
    let fail = false;
    const rows = list(
      document.createElement("div"),
      "id",
      inScope((item) => {
        effect(() => {
          runs.push(`${item.id} ${get(t)}`);
        });
        return createItemNode(item);
      }),
      undefined,
      dropScope,
    );
    sub(items, (next) => {
      if (fail) throw new Error("wiring");
      rows(next);
    });
    // A second reader of `t`, so its writes mark rather than run one reader alone
    effect(() => {
      get(t);
    });
    runs.length = 0;
    fail = true;
    thrownBy(() => {
      batch(() => {
        set(t, 1);
        set(items, lettered("abc"));
      });
    });
    set(t, 2);
    expect(runs.toSorted()).toEqual(["a 1", "a 2", "b 1", "b 2"]);
  });

  test("matches a reference array with owning (effect, cleanup) and plain rows mixed", () => {
    expect.assertions(4);
    const next = random(271_828);
    const fresh = freshItems();
    const source = signal<readonly Item[]>([]);
    const tick = signal(0);
    const ran = new Set<string>();
    const cleanups = new Map<string, number>();
    const parent = document.createElement("div");
    // Rows own an effect bound to their node, a cleanup, or nothing, by id
    const withEffect = inScope((item) => {
      const node = createItemNode(item);
      effect(() => {
        node.title = String(get(tick));
        ran.add(item.id);
      });
      return node;
    });
    const withCleanup = inScope((item) => {
      defer(() => {
        cleanups.set(item.id, (cleanups.get(item.id) ?? 0) + 1);
      });
      return createItemNode(item);
    });
    const kinds = [withEffect, withCleanup, createItemNode];
    sub(
      source,
      list(parent, "id", (item: Item) => kinds[Number(item.id) % 3](item), undefined, dropScope),
    );
    const removed = new Set<string>();
    const wrongOrder: number[] = [];
    const replacedRows: number[] = [];
    const wrongRuns: number[] = [];
    for (let round = 1; round <= 300; round++) {
      const before = new Map(
        [...parent.children].map((node) => [(node as HTMLElement).dataset["id"], node]),
      );
      const data =
        round % 50 === 0 ? [] : (round % 2 ? permuteItems : editItems)(next, source.v, fresh);
      const ids = new Set(data.map((item) => item.id));
      for (const item of source.v) if (!ids.has(item.id)) removed.add(item.id);
      set(source, data);
      if (itemOrder(parent).join(",") !== data.map((item) => item.id).join(",")) {
        wrongOrder.push(round);
      }
      for (const node of parent.children) {
        const kept = before.get((node as HTMLElement).dataset["id"]);
        if (kept && kept !== node) replacedRows.push(round);
      }
      // A tick re-runs exactly the effects of the rows present
      ran.clear();
      set(tick, round);
      const want = data.filter((item) => Number(item.id) % 3 === 0).map((item) => item.id);
      if ([...ran].toSorted().join(",") !== want.toSorted().join(",")) wrongRuns.push(round);
    }
    expect(wrongOrder).toEqual([]);
    expect(replacedRows).toEqual([]);
    expect(wrongRuns).toEqual([]);
    // Each removed row's cleanup ran once, and no present row's
    const cleaning = [...removed].filter((id) => Number(id) % 3 === 1);
    expect([...cleanups].toSorted(([x], [y]) => x.localeCompare(y))).toEqual(
      cleaning.toSorted().map((id) => [id, 1]),
    );
  });

  describe("re-entrancy", () => {
    test("a row effect whose first run writes the items leaves the rows matching them", () => {
      expect.assertions(1);
      // One write: a list that made row b again would otherwise loop forever
      let wrote = false;
      const rendered = owned(lettered("a"), (item) => {
        effect(() => {
          if (item.id === "b" && !wrote) {
            wrote = true;
            rendered.set(lettered("abc"));
          }
        });
        return createItemNode(item);
      });
      rendered.set(lettered("ab"));
      expect(itemOrder(rendered.parent)).toEqual(["a", "b", "c"]);
    });

    test("a row cleanup that writes the items as its row is removed leaves the rows matching them", () => {
      expect.assertions(1);
      const rendered = owned(lettered("abc"), (item) => {
        defer(() => {
          if (item.id === "b") rendered.set(lettered("xy"));
        });
        return createItemNode(item);
      });
      rendered.set(lettered("ac"));
      expect(itemOrder(rendered.parent)).toEqual(["x", "y"]);
    });

    test("a row cleanup that writes the items as they empty leaves the rows matching them", () => {
      expect.assertions(1);
      const rendered = owned(lettered("abc"), (item) => {
        defer(() => {
          if (item.id === "b") rendered.set(lettered("xy"));
        });
        return createItemNode(item);
      });
      rendered.set([]);
      expect(itemOrder(rendered.parent)).toEqual(["x", "y"]);
    });

    test("a row effect disposing the wiring's owner on its first run leaves no row effect running", () => {
      expect.assertions(1);
      const items = signal<readonly Item[]>(lettered("a"));
      const s = signal(0);
      let runs = 0;
      const page: Scope = scope(() => {
        ownedOn(items, (item) => {
          effect(() => {
            get(s);
            runs++;
            if (item.id === "b") dispose(page);
          });
          return createItemNode(item);
        });
      });
      set(items, lettered("abcd"));
      runs = 0;
      set(s, 1);
      expect(runs).toBe(0);
    });

    // The reconcile cannot stop when a row's effect disposes its wiring: the rest of the sub's
    // call goes on, and dev builds throw nothing for what it makes after
    test("a row effect disposing the wiring, then the row making more: nothing throws, and nothing it made runs after", () => {
      expect.assertions(3);
      type Row = HTMLSpanElement & { s: Scope };
      const items = signal<readonly Item[]>([{ id: "a", label: "a" }]);
      const t = signal(0);
      let runs = 0;
      const parent = document.createElement("div");
      const handle: Effect = sub(
        items,
        list(
          parent,
          "id",
          (item: Item): Row => {
            const node = createItemNode(item) as Row;
            node.s = scope(() => {
              effect(() => {
                if (item.id === "b") dispose(handle);
              });
              effect(() => {
                get(t);
                runs++;
              });
            });
            return node;
          },
          undefined,
          (row) => {
            dispose(row.s);
          },
        ),
      );
      expect(
        thrownBy(() => {
          set(items, lettered("abc"));
        }),
      ).toBeUndefined();
      runs = 0;
      set(t, 1);
      expect(runs).toBe(0);
      expect(parent.children.length).toBe(3);
    });

    test("a row cleanup disposing the wiring as rows are removed reaches no caller", () => {
      expect.assertions(1);
      const rendered = owned(lettered("abcd"), (item) => {
        defer(() => {
          if (item.id === "b") dispose(rendered.handle);
        });
        return createItemNode(item);
      });
      expect(() => {
        rendered.set(lettered("axyd"));
      }).not.toThrow();
    });

    test("a row cleanup disposing the wiring as rows are removed leaves no row effect running", () => {
      expect.assertions(1);
      const s = signal(0);
      let runs = 0;
      const rendered = owned(lettered("abcd"), (item) => {
        defer(() => {
          if (item.id === "b") dispose(rendered.handle);
        });
        effect(() => {
          get(s);
          runs++;
        });
        return createItemNode(item);
      });
      // The rows x and y are made after the disposal
      rendered.set(lettered("axyd"));
      runs = 0;
      set(s, 1);
      expect(runs).toBe(0);
    });

    test("a row cleanup disposing the wiring as the items empty reaches no caller", () => {
      expect.assertions(1);
      const rendered = owned(lettered("abc"), (item) => {
        defer(() => {
          if (item.id === "b") dispose(rendered.handle);
        });
        return createItemNode(item);
      });
      expect(() => {
        rendered.set([]);
      }).not.toThrow();
    });

    test.serial(
      "a throwing row cleanup leaves the rows matching the items (dropped; dev logs it)",
      () => {
        expect.assertions(1);
        const rendered = owned(lettered("abc"), (item) => {
          defer(() => {
            if (item.id === "b") throw new Error("cleanup failed");
          });
          return createItemNode(item);
        });
        // oxlint-disable-next-line no-underscore-dangle
        using _consoleSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
          // Caught so the rows are checked even where the error reaches the writer
          rendered.set(lettered("acd"));
        } catch {
          // checked below
        }
        expect(itemOrder(rendered.parent)).toEqual(["a", "c", "d"]);
      },
    );
  });

  // Components are functions returning their node, run under an owner; the code that removes a
  // page disposes it ("who removes, disposes")
  describe("components", () => {
    const Row = (item: Item, selected: Signal<string>): HTMLSpanElement => {
      const node = createItemNode(item);
      effect(() => {
        node.title = get(selected) === item.id ? "selected" : "";
      });
      return node;
    };
    const Page = (
      items: Signal<readonly Item[]>,
      selected: Signal<string>,
      log: string[],
    ): HTMLElement => {
      const root = document.createElement("main");
      const rows = list(
        root,
        "id",
        inScope((item) => Row(item, selected)),
        undefined,
        dropScope,
      );
      sub(items, rows);
      sub(
        selected,
        mark(rows, (node, on) => {
          node.className = on ? "on" : "";
        }),
      );
      defer(() => {
        log.push("page cleanup");
      });
      return root;
    };
    /** Shows Page, swaps it for a text node, then changes what it showed. */
    const swapPages = (): [old: HTMLElement, log: string[]] => {
      const outlet = document.createElement("div");
      const items = signal<readonly Item[]>(ITEMS);
      const selected = signal("a");
      const log: string[] = [];
      let page: Scope | undefined;
      const show = (make: () => Node): void => {
        if (page !== undefined) dispose(page);
        outlet.textContent = "";
        page = scope(() => {
          outlet.append(make());
        });
      };
      show(() => Page(items, selected, log));
      const old = outlet.firstChild as HTMLElement;
      show(() => document.createTextNode("empty"));
      set(selected, "b");
      set(items, lettered("xyz"));
      return [old, log];
    };

    test("a page swap stops the old page's list, rows' effects and mark", () => {
      expect.assertions(1);
      const [old] = swapPages();
      // The old rows still show the old selection (title: row effect; class: mark), and no new row came
      expect(
        [...old.children].map((node) => `${(node as HTMLElement).title}/${node.className}`),
      ).toEqual(["selected/on", "/", "/", "/"]);
    });

    test("a page swap runs the old page's cleanups", () => {
      expect.assertions(1);
      const [, log] = swapPages();
      expect(log).toEqual(["page cleanup"]);
    });
  });
});

// Dev builds warn when what rows make outlives them: the list tells the full core when a create or
// update runs. Production builds warn nothing
describe("dev row warnings", () => {
  // What a row's create makes straight under its sub wiring (the list has no drop)
  test.serial.each([
    [
      "an effect",
      () => {
        effect(() => {});
      },
    ],
    // A sub keeps its children like a scope: it must still count as made outside a scope
    [
      "a sub",
      () => {
        sub(signal(0), () => {});
      },
    ],
    [
      "a computed",
      () => {
        computed(() => 0);
      },
    ],
    [
      "a cleanup",
      () => {
        defer(() => {});
      },
    ],
  ] as const)(
    "a create that makes %s straight under its sub wiring warns once per list, naming create",
    (_what, make) => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const source = signal<readonly Item[]>(lettered("ab"));
      const handle = sub(
        source,
        list(document.createElement("div"), "id", (item: Item) => {
          make();
          return createItemNode(item);
        }),
      );
      set(source, lettered("abc"));
      dispose(handle);
      expect(texts(warn)).toEqual(
        DEV
          ? [
              "stage1: a list's create made an effect, sub, computed, or defer outside a scope: the list's wiring owns it, not the row; make it in a scope of the row's own that the list's drop disposes",
            ]
          : [],
      );
    },
  );

  test.serial("a create that makes an effect under an effect wiring warns once", () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(() => {});
    const source = signal<readonly Item[]>(lettered("ab"));
    const rows = list(document.createElement("div"), "id", (item: Item) => {
      effect(() => {});
      return createItemNode(item);
    });
    const handle = effect(() => {
      rows(get(source));
    });
    set(source, lettered("abc"));
    dispose(handle);
    expect(texts(warn)).toHaveLength(DEV ? 1 : 0);
  });

  test.serial("a create that makes its effects in a scope of the row's own warns nothing", () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(() => {});
    const source = signal<readonly Item[]>(lettered("ab"));
    const handle = sub(
      source,
      list(document.createElement("div"), "id", (item: Item) => {
        scope(() => {
          // Made by the row's effect: checked as that effect's, not the wiring's
          effect(() => {
            effect(() => {});
          });
          defer(() => {});
        });
        return createItemNode(item);
      }),
    );
    set(source, lettered("abc"));
    dispose(handle);
    expect(warn).not.toHaveBeenCalled();
  });

  test.serial("a list with a drop warns nothing about what its create makes", () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(() => {});
    type Row = HTMLSpanElement & { fx: Effect };
    const source = signal<readonly Item[]>(lettered("ab"));
    const handle = sub(
      source,
      list(
        document.createElement("div"),
        "id",
        (item: Item) => {
          const row = createItemNode(item) as Row;
          row.fx = effect(() => {});
          return row;
        },
        undefined,
        (row) => {
          dispose(row.fx);
        },
      ),
    );
    set(source, lettered("a"));
    dispose(handle);
    expect(warn).not.toHaveBeenCalled();
  });

  test.serial(
    "an update that makes an effect warns once per list, naming update; the effect belongs to the wiring",
    () => {
      expect.assertions(2);
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const items = signal<readonly Item[]>(lettered("ab"));
      const s = signal(0);
      const runs: string[] = [];
      const relabelled = (suffix: string): Item[] =>
        lettered("ab").map((item) => ({ id: item.id, label: item.id + suffix }));
      const handle = sub(
        items,
        list(document.createElement("div"), "id", createItemNode, (node, item) => {
          effect(() => {
            runs.push(`${item.label} ${get(s)}`);
          });
          node.textContent = item.label;
        }),
      );
      set(items, relabelled("1"));
      set(items, relabelled("2"));
      dispose(handle);
      set(s, 1);
      expect(runs).toEqual(["a1 0", "b1 0", "a2 0", "b2 0"]);
      expect(texts(warn)).toEqual(
        DEV
          ? [
              "stage1: a list's update made an effect, sub, computed, scope, or defer: the list's wiring owns it, not the row; make it in create instead, in a scope the list's drop disposes",
            ]
          : [],
      );
    },
  );

  test.serial(
    "an update that makes a scope or a cleanup warns (it is never dropped with the row)",
    () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const items = signal<readonly Item[]>(lettered("ab"));
      const a = list(document.createElement("div"), "id", createItemNode, () => {
        scope(() => {});
      });
      const b = list(document.createElement("div"), "id", createItemNode, () => {
        defer(() => {});
      });
      const handles = [sub(items, a), sub(items, b)];
      set(items, lettered("ab"));
      for (const handle of handles) dispose(handle);
      expect(texts(warn)).toHaveLength(DEV ? 2 : 0);
    },
  );

  test.serial(
    "an update called with no owner (rows called directly) that makes an effect warns",
    () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const made: Effect[] = [];
      const rows = list(document.createElement("div"), "id", createItemNode, () => {
        made.push(effect(() => {}));
      });
      rows(lettered("ab"));
      rows(lettered("ab"));
      for (const handle of made) dispose(handle);
      expect(texts(warn)).toHaveLength(DEV ? 1 : 0);
    },
  );

  test.serial(
    "create and update warn once each; an update's effect's own first run and a create's scope warn nothing",
    () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const items = signal<readonly Item[]>(lettered("ab"));
      const handle = sub(
        items,
        list(
          document.createElement("div"),
          "id",
          (item: Item) => {
            scope(() => {
              effect(() => {});
            });
            effect(() => {});
            return createItemNode(item);
          },
          () => {
            effect(() => {
              // Made by the update's effect: that effect's, not the wiring's
              defer(() => {});
            });
          },
        ),
      );
      set(items, lettered("ab"));
      set(items, lettered("ab"));
      dispose(handle);
      expect(texts(warn).map((text) => (text.includes("update") ? "update" : "create"))).toEqual(
        DEV ? ["create", "update"] : [],
      );
    },
  );

  // within: its caller chose the owner, so the row checks skip what fn makes
  test.serial("a create that makes an effect within another effect warns nothing", () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(() => {});
    const other = effect(() => {});
    const source = signal<readonly Item[]>(lettered("ab"));
    const handle = sub(
      source,
      list(document.createElement("div"), "id", (item: Item) => {
        within(other, () => {
          effect(() => {});
        });
        return createItemNode(item);
      }),
    );
    set(source, lettered("abc"));
    dispose(handle);
    dispose(other);
    expect(warn).not.toHaveBeenCalled();
  });

  test.serial(
    "a create whose first creation is within another owner still warns about a later effect straight under its sub wiring",
    () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const other = scope(() => {});
      const source = signal<readonly Item[]>(lettered("ab"));
      const handle = sub(
        source,
        list(document.createElement("div"), "id", (item: Item) => {
          within(other, () => {
            effect(() => {});
          });
          effect(() => {});
          return createItemNode(item);
        }),
      );
      set(source, lettered("abc"));
      dispose(handle);
      dispose(other);
      expect(texts(warn)).toHaveLength(DEV ? 1 : 0);
    },
  );

  test.serial(
    "a create whose within threw still warns about a later effect straight under its sub wiring",
    () => {
      expect.assertions(1);
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const other = scope(() => {});
      const source = signal<readonly Item[]>(lettered("ab"));
      const handle = sub(
        source,
        list(document.createElement("div"), "id", (item: Item) => {
          try {
            within(other, () => {
              throw new Error("fn");
            });
          } catch {
            // The throw under test
          }
          effect(() => {});
          return createItemNode(item);
        }),
      );
      set(source, lettered("abc"));
      dispose(handle);
      dispose(other);
      expect(texts(warn)).toHaveLength(DEV ? 1 : 0);
    },
  );

  test.serial("an update that makes an effect within the row's own scope warns nothing", () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(() => {});
    type Row = HTMLSpanElement & { s: Scope };
    const items = signal<readonly Item[]>(lettered("ab"));
    const handle = sub(
      items,
      list(
        document.createElement("div"),
        "id",
        (item: Item) => {
          const row = createItemNode(item) as Row;
          row.s = scope(() => {});
          return row;
        },
        (row) => {
          within(row.s, () => {
            effect(() => {});
          });
        },
        (row) => {
          dispose(row.s);
        },
      ),
    );
    set(items, lettered("ab"));
    dispose(handle);
    expect(warn).not.toHaveBeenCalled();
  });

  test.serial("an update that makes nothing warns nothing", () => {
    expect.assertions(1);
    using warn = spyOn(console, "warn").mockImplementation(() => {});
    const items = signal<readonly Item[]>(lettered("ab"));
    const handle = sub(
      items,
      list(document.createElement("div"), "id", createItemNode, (node, item) => {
        node.textContent = item.label;
      }),
    );
    set(items, lettered("ab"));
    dispose(handle);
    expect(warn).not.toHaveBeenCalled();
  });
});

// A rows call with no signal: the diff's own paths
describe("rows called directly", () => {
  afterEach(() => {
    document.body.textContent = "";
  });

  /**
   * A connected parent between two siblings; `moves()` counts its grandparent's child-list records
   * since the last call.
   */
  const mounted = (): { parent: HTMLElement; moves: () => number } => {
    const grandparent = document.createElement("div");
    const parent = document.createElement("ul");
    grandparent.append(document.createElement("p"), parent, document.createElement("p"));
    document.body.append(grandparent);
    const observer = new MutationObserver(() => {});
    observer.observe(grandparent, { childList: true });
    return { parent, moves: () => observer.takeRecords().length };
  };

  test("a first build takes a connected parent out once and puts it back", () => {
    expect.assertions(2);
    const { parent, moves } = mounted();
    list(parent, "id", createItemNode)(lettered("abc"));
    expect(parent.textContent).toBe("abc");
    expect(moves()).toBe(2);
  });

  test("clearing leaves a connected parent in place", () => {
    expect.assertions(2);
    const { parent, moves } = mounted();
    const rows = list(parent, "id", createItemNode);
    rows(lettered("abc"));
    moves();
    rows([]);
    expect(parent.textContent).toBe("");
    expect(moves()).toBe(0);
  });

  test("replacing every key takes a connected parent out once and puts it back", () => {
    expect.assertions(2);
    const { parent, moves } = mounted();
    const rows = list(parent, "id", createItemNode);
    rows(lettered("abc"));
    moves();
    rows(lettered("xyz"));
    expect(parent.textContent).toBe("xyz");
    expect(moves()).toBe(2);
  });

  test("a change that keeps one key edits the rows in place", () => {
    expect.assertions(2);
    const { parent, moves } = mounted();
    const rows = list(parent, "id", createItemNode);
    rows(lettered("abc"));
    moves();
    rows(lettered("xbz"));
    expect(parent.textContent).toBe("xbz");
    expect(moves()).toBe(0);
  });

  /**
   * Rows over `seed`'s edits of each shape (whitespace before them in the parent): the problems
   * found, comparing the rows with the items and the calls with the changes. `drop` adds a drop
   * that must see exactly the removed rows, while they are still in the parent.
   */
  const shapes = (seed: number, drops: boolean): string[] => {
    const rand = random(seed);
    const fresh = freshItems();
    const parent = document.createElement("div");
    parent.append(document.createTextNode("\n  "));
    document.body.append(parent);
    const events: string[] = [];
    const rows = list(
      parent,
      "id",
      (item: Item) => {
        events.push(`create ${item.id}`);
        return createItemNode(item);
      },
      (node, item) => {
        events.push(`update ${node.dataset["id"]} ${item.label}`);
        node.textContent = item.label;
      },
      drops
        ? (row) => {
            events.push(`drop ${row.dataset["id"]}${row.parentNode === parent ? "" : " detached"}`);
          }
        : undefined,
    );
    const problems: string[] = [];
    let current: Item[] = [];
    let byId = new Map<string, HTMLElement>();
    for (let round = 0; round < 400; round++) {
      const next = shapeItems(rand, current, fresh);
      events.length = 0;
      rows(next);
      const before = new Map(current.map((item) => [item.id, item]));
      const after = new Set(next.map((item) => item.id));
      const expected = [
        ...(drops
          ? current.filter((item) => !after.has(item.id)).map((item) => `drop ${item.id}`)
          : []),
        ...next.filter((item) => !before.has(item.id)).map((item) => `create ${item.id}`),
        ...next
          .filter((item) => before.has(item.id) && before.get(item.id) !== item)
          .map((item) => `update ${item.id} ${item.label}`),
      ];
      const nodes = new Map(
        [...parent.children].map((node) => [
          (node as HTMLElement).dataset["id"] ?? "",
          node as HTMLElement,
        ]),
      );
      const prior = byId;
      const kept = next.filter(
        (item) => before.has(item.id) && nodes.get(item.id) !== prior.get(item.id),
      );
      if (itemOrder(parent).join(",") !== next.map((item) => item.id).join(",")) {
        problems.push(`round ${round}: order ${itemOrder(parent).join(",")}`);
      }
      if (events.toSorted().join(",") !== expected.toSorted().join(",")) {
        problems.push(`round ${round}: ${events.join(",")} vs ${expected.join(",")}`);
      }
      if (kept.length > 0) {
        problems.push(
          `round ${round}: replaced kept rows ${kept.map((item) => item.id).join(",")}`,
        );
      }
      current = next;
      byId = nodes;
    }
    parent.remove();
    return problems.slice(0, 5);
  };

  test.each([1, 2, 3, 4, 5])(
    "seed %i: rows follow the items, keep their nodes, and create and update see exactly the new and changed rows",
    (seed) => {
      expect.assertions(1);
      expect(shapes(seed, false)).toEqual([]);
    },
  );

  test.each([1, 2, 3, 4, 5])(
    "seed %i, with drop: drop also sees exactly the removed rows, still in the parent",
    (seed) => {
      expect.assertions(1);
      expect(shapes(seed, true)).toEqual([]);
    },
  );

  test("drops every row while connected on each clear of an empty/full cycle", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const dropped: string[] = [];
    const rows = list(parent, "id", createItemNode, undefined, (row) => {
      dropped.push(`${row.dataset["id"]}${row.parentNode === parent ? "" : " detached"}`);
    });
    for (const ids of ["abc", "", "ab", "", "", "c"]) rows(lettered(ids));
    expect(dropped).toEqual(["a", "b", "c", "a", "b"]);
  });

  // Documented edge: on clear and replace the list calls rows.forEach(drop)
  test("Characterization: a row the keyed diff removes: drop gets only the row", () => {
    expect.assertions(1);
    const calls: unknown[][] = [];
    const rows = list(
      document.createElement("div"),
      "id",
      createItemNode,
      undefined,
      (...args: unknown[]) => {
        calls.push(args);
      },
    );
    rows(lettered("abc"));
    rows(lettered("ac"));
    expect(calls.map((args) => args.length)).toEqual([1]);
  });

  test.each([
    ["a replace (no key survives)", "xy"],
    ["a clear (no items)", ""],
  ])("Characterization: %s: drop also gets each row's index and the rows array", (_label, ids) => {
    expect.assertions(1);
    const calls: unknown[][] = [];
    const rows = list(
      document.createElement("div"),
      "id",
      createItemNode,
      undefined,
      (...args: unknown[]) => {
        calls.push(args);
      },
    );
    rows(lettered("ab"));
    rows(lettered(ids));
    expect(calls.map((args) => [args.length, args[1], Array.isArray(args[2])])).toEqual([
      [3, 0, true],
      [3, 1, true],
    ]);
  });

  test("a key shown while its row is cleared is marked again on the row made for it, and the removed row is never unmarked", () => {
    expect.assertions(1);
    const calls: [string, boolean, HTMLSpanElement][] = [];
    const rows = list(document.createElement("div"), "id", createItemNode);
    const show = mark(rows, (node, on) => {
      calls.push([node.dataset["id"] ?? "", on, node]);
    });
    rows(lettered("abc"));
    show("b");
    rows([]);
    rows(lettered("cb"));
    show("c");
    // The unmark reaches the row made after the clear, not the cleared one
    expect([
      calls.map(([key, on]) => `${key} ${on}`),
      calls[2][2] === calls[1][2],
      calls[2][2] !== calls[0][2],
    ]).toEqual([["b true", "b true", "b false", "c true"], true, true]);
  });

  // A sub never repeats a value, so only a direct call reaches the show function's own check
  test("a show call with the key it showed last calls nothing", () => {
    expect.assertions(1);
    const [calls, fn] = recorder();
    const rows = list(document.createElement("div"), "id", createItemNode);
    rows(ITEMS);
    const show = mark(rows, fn);
    show("b");
    show("b");
    expect(calls).toEqual([["b", true]]);
  });

  test.serial("a rows call that keeps every row in place keeps the mark's key map", () => {
    expect.assertions(2);
    const ids = "abcdefghijklmnopqrst";
    const rows = list(document.createElement("ul"), "id", createItemNode);
    rows(lettered(ids));
    const show = mark(rows, () => {});
    using sets = spyOn(Map.prototype, "set");
    // The first lookups scan the rows; a later one builds the map, a set per row
    for (const id of "abcdefghi") show(id);
    expect(sets).toHaveBeenCalledTimes(ids.length);
    // New objects with the same keys in place: updates only
    rows(lettered(ids));
    for (const id of "jklmnopqr") show(id);
    expect(sets).toHaveBeenCalledTimes(ids.length);
  });
});

describe("bundle", () => {
  test("the list module imports no signal module (one file serves every tier)", async () => {
    expect.assertions(1);
    const loaded: string[] = [];
    const out = await Bun.build({
      entrypoints: [`${import.meta.dir}/../../src/reconcile.ts`],
      target: "browser",
      plugins: [
        {
          name: "record",
          setup(build) {
            build.onLoad({ filter: /\.ts$/u }, async (args) => {
              loaded.push(args.path);
              return { contents: await Bun.file(args.path).text(), loader: "ts" };
            });
          },
        },
      ],
    });
    expect([out.success, loaded.filter((file) => file.endsWith("/signal.ts"))]).toEqual([true, []]);
  });
});
