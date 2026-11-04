// Callbacks and checks inside loops branch on the data they receive.
// oxlint-disable vitest/no-conditional-in-test

import { describe, expect, expectTypeOf, test } from "bun:test";
import { type List, list, mark } from "../../src/ng/reconcile.ts";
import { batch, set, signal, type Signal, sub } from "../../src/ng/signal.ts";

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

/** Renders `items` into a new parent; returns the parent, the items signal and the list's dispose. */
const render = (
  items: readonly Item[],
): [
  parent: HTMLDivElement,
  items: Signal<readonly Item[]>,
  dispose: List<string, HTMLSpanElement>,
] => {
  const parent = document.createElement("div");
  const source = signal(items);
  const dispose = list(parent, source, "id", createItemNode, updateItemNode);
  return [parent, source, dispose];
};

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

/** Items with unique ids, numbered from 0. */
const freshItems = (): (() => Item) => {
  let id = 0;
  return () => {
    const value = String(id++);
    return { id: value, label: value };
  };
};

describe("list", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(list).not.toBeAny();
    expectTypeOf(list).toBeFunction();
    expectTypeOf(list<Item, "id", HTMLSpanElement>).parameters.toEqualTypeOf<
      [
        parent: Element,
        items: Signal<readonly Item[]>,
        key: "id",
        create: (item: Item, own: (dispose: () => void) => void) => HTMLSpanElement,
        update?: ((node: HTMLSpanElement, item: Item) => void) | undefined,
      ]
    >();
    // The dispose function, which mark also takes
    expectTypeOf(list<Item, "id", HTMLSpanElement>).returns.toExtend<() => void>();
    expectTypeOf(list<Item, "id", HTMLSpanElement>).returns.toEqualTypeOf<
      List<string, HTMLSpanElement>
    >();
    // Unannotated callbacks infer the item type from the signal and the node type from create.
    expectTypeOf((parent: Element) => {
      list(
        parent,
        signal(ITEMS),
        "id",
        (item, own) => {
          expectTypeOf(item).toEqualTypeOf<Item>();
          expectTypeOf(own).toEqualTypeOf<(dispose: () => void) => void>();
          return document.createElement("span");
        },
        (node, item) => {
          expectTypeOf(node).toEqualTypeOf<HTMLSpanElement>();
          expectTypeOf(item).toEqualTypeOf<Item>();
        },
      );
      // The key's type comes from the key passed
      expectTypeOf(list(parent, signal(ITEMS), "id", createItemNode)).toEqualTypeOf<
        List<string, HTMLSpanElement>
      >();
      // @ts-expect-error - key must be a property of the items
      list(parent, signal(ITEMS), "missing", createItemNode);
    }).toBeFunction();
  });

  test("renders the initial items in order", () => {
    expect.assertions(2);
    const [parent] = render(ITEMS);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
    expect(parent.textContent).toBe("ABCD");
  });

  test("renders items set later", () => {
    expect.assertions(1);
    const [parent, items] = render([]);
    set(items, ITEMS);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
  });

  test("leaves a connected parent in place among its siblings", () => {
    expect.assertions(2);
    const host = document.createElement("div");
    const parent = document.createElement("div");
    host.append("before", parent, "after");
    document.body.append(host);
    try {
      const items = signal<readonly Item[]>([]);
      list(parent, items, "id", createItemNode);
      set(items, ITEMS);
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
    const items = signal(ITEMS);
    list(parent, items, "id", createItemNode, updateItemNode);
    set(items, REORDERED_ITEMS);
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
    const [parent, items] = render(lettered("abcdefghij"));
    expect(
      insertedIds(parent, () => {
        set(items, lettered("abdefghcij"));
      }),
    ).toEqual(["c"]);
  });

  test("moves only the row that moved earlier", () => {
    expect.assertions(1);
    const [parent, items] = render(lettered("abcdefghij"));
    expect(
      insertedIds(parent, () => {
        set(items, lettered("abhcdefgij"));
      }),
    ).toEqual(["h"]);
  });

  test("appends new rows at the end in order", () => {
    expect.assertions(1);
    const [parent, items] = render(lettered("abc"));
    expect(
      insertedIds(parent, () => {
        set(items, lettered("abcdef"));
      }),
    ).toEqual(["d", "e", "f"]);
  });

  test("moves the fewest rows when no end matches", () => {
    expect.assertions(1);
    const [parent, items] = render(lettered("abcdefghij"));
    // Old order c d e f g h in the middle becomes d c e f h g: 4 rows can stay
    expect(
      insertedIds(parent, () => {
        set(items, lettered("abdcefhgij"));
      }),
    ).toHaveLength(2);
  });

  test("swaps two rows with two moves", () => {
    expect.assertions(1);
    const [parent, items] = render(lettered("abcdef"));
    const inserted = insertedIds(parent, () => {
      set(items, lettered("aecdbf"));
    });
    expect(inserted.toSorted((x, y) => x.localeCompare(y))).toEqual(["b", "e"]);
  });

  test("reorders rows to match the new items", () => {
    expect.assertions(1);
    const [parent, items] = render(ITEMS);
    set(items, REORDERED_ITEMS);
    expect(itemOrder(parent)).toEqual(["d", "b", "e", "a"]);
  });

  test("keeps the row of each retained key", () => {
    expect.assertions(3);
    const [parent, items] = render(ITEMS);
    const nodes = [...parent.children];
    set(items, REORDERED_ITEMS);
    const [first, second, , fourth] = [...parent.children];
    expect(first).toBe(nodes[3]);
    expect(second).toBe(nodes[1]);
    expect(fourth).toBe(nodes[0]);
  });

  test("updates retained rows with their new items", () => {
    expect.assertions(1);
    const [parent, items] = render(ITEMS);
    set(items, REORDERED_ITEMS);
    expect(parent.textContent).toBe("DeltaBetaEpsilonAlpha");
  });

  test("removes the rows of dropped keys", () => {
    expect.assertions(2);
    const [parent, items] = render(ITEMS);
    const nodes = [...parent.children];
    set(items, REORDERED_ITEMS);
    expect(nodes[2].parentNode).toBeNull(); // "c"
    expect(itemOrder(parent)).not.toContain("c");
  });

  test("clears every row when the items empty", () => {
    expect.assertions(1);
    const [parent, items] = render(ITEMS);
    set(items, []);
    expect(parent.childNodes).toHaveLength(0);
  });

  test("swaps two rows", () => {
    expect.assertions(1);
    const [parent, items] = render(ITEMS);
    set(items, [ITEMS[0], ITEMS[3], ITEMS[2], ITEMS[1]]);
    expect(itemOrder(parent)).toEqual(["a", "d", "c", "b"]);
  });

  test("reverses the rows", () => {
    expect.assertions(1);
    const [parent, items] = render(ITEMS);
    set(items, ITEMS.toReversed());
    expect(itemOrder(parent)).toEqual(["d", "c", "b", "a"]);
  });

  test("Regression: moves a row to the end, then a later row forward", () => {
    expect.assertions(1);
    const ids = ["a", "b", "c", "d", "e"];
    const [parent, items] = render(ids.map((id) => ({ id, label: id })));
    set(
      items,
      ["a", "d", "c", "e", "b"].map((id) => ({ id, label: id })),
    );
    expect(itemOrder(parent)).toEqual(["a", "d", "c", "e", "b"]);
  });

  test("replaces every row when no keys match", () => {
    expect.assertions(2);
    const [parent, items] = render(ITEMS);
    const nodes = [...parent.children];
    set(items, [
      { id: "x", label: "X" },
      { id: "y", label: "Y" },
    ]);
    expect(itemOrder(parent)).toEqual(["x", "y"]);
    expect(nodes.some((node) => node.parentNode)).toBeFalse();
  });

  test("matches the items after a seeded sequence of edits", () => {
    expect.assertions(3);
    const next = random(48_271);
    const fresh = freshItems();
    const [parent, items] = render([]);
    const wrongOrder: number[] = [];
    const wrongText: number[] = [];
    const replacedRows: number[] = [];
    for (let round = 0; round < 300; round++) {
      const before = new Map(
        [...parent.children].map((node) => [(node as HTMLElement).dataset["id"], node]),
      );
      const data = editItems(next, items.v, fresh);
      set(items, data);
      if (itemOrder(parent).join(",") !== data.map((item) => item.id).join(","))
        wrongOrder.push(round);
      if (parent.textContent !== data.map((item) => item.label).join("")) wrongText.push(round);
      for (const node of parent.children) {
        const kept = before.get((node as HTMLElement).dataset["id"]);
        if (kept && kept !== node) replacedRows.push(round);
      }
    }
    expect(wrongOrder).toEqual([]);
    expect(wrongText).toEqual([]);
    expect(replacedRows).toEqual([]);
  });

  test("never updates a row with the item it shows over a seeded sequence of edits", () => {
    expect.assertions(1);
    const next = random(1_234_567);
    const fresh = freshItems();
    const parent = document.createElement("div");
    const items = signal<readonly Item[]>([]);
    const shown = new Map<string, Item>();
    let repeats = 0;
    list(
      parent,
      items,
      "id",
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
    for (let round = 0; round < 300; round++) set(items, editItems(next, items.v, fresh));
    expect(repeats).toBe(0);
  });

  test("calls update for a retained key whose item changed", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(ITEMS);
    const updated: string[] = [];
    list(parent, items, "id", createItemNode, (_node, item) => {
      updated.push(item.label);
    });
    set(items, [ITEMS[0], { id: "b", label: "B2" }, ITEMS[2], ITEMS[3]]);
    expect(updated).toEqual(["B2"]);
  });

  test("does not call update when the item is the same object", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(ITEMS);
    let updates = 0;
    list(parent, items, "id", createItemNode, () => {
      updates++;
    });
    set(items, ITEMS.toReversed());
    expect(updates).toBe(0);
  });

  test("drops the trailing rows when the new items are the old ones' start", () => {
    expect.assertions(2);
    const [parent, items] = render(ITEMS);
    const kept = [...parent.children].slice(0, 2);
    set(items, ITEMS.slice(0, 2));
    expect(itemOrder(parent)).toEqual(["a", "b"]);
    expect([...parent.children].every((node, index) => node === kept[index])).toBe(true);
  });

  test("keeps every row and updates only new items when each key stays in place", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    const items = signal(ITEMS);
    const updated: string[] = [];
    list(parent, items, "id", createItemNode, (node, item) => {
      updated.push(item.id);
      updateItemNode(node, item);
    });
    const before = [...parent.children];
    set(
      items,
      ITEMS.map((item) => (item.id === "a" || item.id === "c" ? { ...item, label: "new" } : item)),
    );
    expect(updated).toEqual(["a", "c"]);
    expect([...parent.children].every((node, index) => node === before[index])).toBe(true);
    expect([...parent.children].map((node) => node.textContent)).toEqual(["new", "B", "new", "D"]);
  });

  test("runs a row's cleanups when the row is removed", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(ITEMS);
    const cleaned: string[] = [];
    list(parent, items, "id", (item, own) => {
      own(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    set(items, [ITEMS[0], ITEMS[2]]);
    expect(cleaned.toSorted((x, y) => x.localeCompare(y))).toEqual(["b", "d"]);
  });

  test("runs every row's cleanups when the items empty", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(ITEMS);
    const cleaned: string[] = [];
    list(parent, items, "id", (item, own) => {
      own(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    set(items, []);
    expect(cleaned.toSorted((x, y) => x.localeCompare(y))).toEqual(["a", "b", "c", "d"]);
  });

  test("runs the replaced rows' cleanups when no keys match", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(ITEMS);
    const cleaned: string[] = [];
    list(parent, items, "id", (item, own) => {
      own(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    set(items, [{ id: "x", label: "X" }]);
    expect(cleaned.toSorted((x, y) => x.localeCompare(y))).toEqual(["a", "b", "c", "d"]);
  });

  test("keeps the cleanups of rows that are only moved", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(ITEMS);
    let cleanups = 0;
    list(parent, items, "id", (item, own) => {
      own(() => {
        cleanups++;
      });
      return createItemNode(item);
    });
    set(items, ITEMS.toReversed());
    expect(cleanups).toBe(0);
  });

  test("runs each removed row's cleanups once over a seeded sequence of edits", () => {
    expect.assertions(1);
    const next = random(9001);
    const fresh = freshItems();
    const parent = document.createElement("div");
    const items = signal<readonly Item[]>([]);
    const cleanups = new Map<string, number>();
    list(parent, items, "id", (item, own) => {
      own(() => {
        cleanups.set(item.id, (cleanups.get(item.id) ?? 0) + 1);
      });
      return createItemNode(item);
    });
    const removed = new Set<string>();
    for (let round = 0; round < 300; round++) {
      const data = editItems(next, items.v, fresh);
      const ids = new Set(data.map((item) => item.id));
      for (const item of items.v) if (!ids.has(item.id)) removed.add(item.id);
      set(items, data);
    }
    expect([...cleanups].filter(([key, count]) => count !== 1 || !removed.has(key))).toEqual([]);
  });

  test("dispose stops further updates", () => {
    expect.assertions(1);
    const [parent, items, dispose] = render(ITEMS);
    dispose();
    set(items, REORDERED_ITEMS);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
  });

  test("dispose runs every row's cleanups", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const cleaned: string[] = [];
    const dispose = list(parent, signal(ITEMS), "id", (item, own) => {
      own(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    dispose();
    expect(cleaned.toSorted((x, y) => x.localeCompare(y))).toEqual(["a", "b", "c", "d"]);
  });

  test("a row's cleanups are not given to the row created after a throwing create", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    const items = signal<readonly Item[]>([]);
    const cleaned: string[] = [];
    list(parent, items, "id", (item, own) => {
      own(() => {
        cleaned.push(item.id);
      });
      if (item.id === "bad") throw new Error("create failed");
      return createItemNode(item);
    });
    expect(() => {
      set(items, [{ id: "bad", label: "" }]);
    }).toThrow("create failed");
    set(items, [ITEMS[0]]);
    cleaned.length = 0;
    set(items, []);
    expect(cleaned).toEqual(["a"]);
  });

  test("a row keeps its cleanups when it catches a nested list's throwing create", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal<readonly Item[]>([ITEMS[0]]);
    const cleaned: string[] = [];
    list(parent, items, "id", (item, own) => {
      own(() => {
        cleaned.push("before");
      });
      const node = createItemNode(item);
      try {
        list(node, signal([ITEMS[1]]), "id", () => {
          throw new Error("nested create failed");
        });
      } catch {
        // the row carries on without its nested list
      }
      own(() => {
        cleaned.push("after");
      });
      return node;
    });
    set(items, []);
    expect(cleaned).toEqual(["before", "after"]);
  });

  test("a nested list's row cleanups stay with that row", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const inner = signal<readonly Item[]>([ITEMS[1]]);
    const cleaned: string[] = [];
    list(parent, signal([ITEMS[0]]), "id", (item, own) => {
      own(() => {
        cleaned.push(item.id);
      });
      const node = createItemNode(item);
      own(
        list(node, inner, "id", (innerItem, innerOwn) => {
          innerOwn(() => {
            cleaned.push(innerItem.id);
          });
          return createItemNode(innerItem);
        }),
      );
      return node;
    });
    set(inner, []);
    expect(cleaned).toEqual(["b"]);
  });

  test("a nested list registered with own is disposed with its row", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const outer = signal<readonly Item[]>([ITEMS[0]]);
    const inner = signal<readonly Item[]>([ITEMS[1]]);
    let innerCreates = 0;
    list(parent, outer, "id", (item, own) => {
      const node = createItemNode(item);
      own(
        list(node, inner, "id", (innerItem) => {
          innerCreates++;
          return createItemNode(innerItem);
        }),
      );
      return node;
    });
    set(outer, []);
    innerCreates = 0;
    set(inner, [ITEMS[2]]);
    expect(innerCreates).toBe(0);
  });
});

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

/** A list of `items` in a new parent, for marks that need only its rows. */
const rowsOf = (items: readonly Item[]): List<string, HTMLSpanElement> =>
  list(document.createElement("div"), signal(items), "id", createItemNode);

/** A map from each letter to an element with that data id, all in one parent unless `detached`. */
const elements = (ids: string, detached = false): Map<string, HTMLSpanElement> => {
  const nodes = new Map(ids.split("").map((id) => [id, createItemNode({ id, label: id })]));
  if (!detached) document.createElement("div").append(...nodes.values());
  return nodes;
};

describe("mark", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(mark).not.toBeAny();
    expectTypeOf(mark).toBeFunction();
    expectTypeOf(mark<string, HTMLSpanElement>).parameters.toEqualTypeOf<
      [
        source: Signal<string>,
        nodes:
          | List<string, HTMLSpanElement>
          // oxlint-disable-next-line typescript/method-signature-style
          | { get(key: string): HTMLSpanElement | undefined },
        fn: (node: HTMLSpanElement, on: boolean) => void,
      ]
    >();
    expectTypeOf(mark<string, HTMLSpanElement>).returns.toEqualTypeOf<() => void>();
    // Unannotated callbacks infer the node type from the list or the map; the
    // signal sets the key type, so a map may hold only some keys.
    expectTypeOf((parent: Element) => {
      const rows = list(parent, signal(ITEMS), "id", createItemNode);
      mark(signal(""), rows, (node, on) => {
        expectTypeOf(node).toEqualTypeOf<HTMLSpanElement>();
        expectTypeOf(on).toEqualTypeOf<boolean>();
      });
      mark(signal<"x" | "y">("x"), new Map([["x", document.createElement("b")]]), (node) => {
        expectTypeOf(node).toEqualTypeOf<HTMLElement>();
      });
      // @ts-expect-error - the selection's keys have the list's key type
      mark(signal(0), rows, () => {});
      // @ts-expect-error - the map's keys must take the selection's keys
      mark(signal(""), new Map([[1, document.createElement("b")]]), () => {});
    }).toBeFunction();
  });

  test("marks the selected key's row at once", () => {
    expect.assertions(1);
    const rows = rowsOf(ITEMS);
    const [calls, fn] = recorder();
    mark(signal("b"), rows, fn);
    expect(calls).toEqual([["b", true]]);
  });

  test("unmarks the old row and marks the new one when the selection changes", () => {
    expect.assertions(1);
    const rows = rowsOf(ITEMS);
    const selected = signal("b");
    const [calls, fn] = recorder();
    mark(selected, rows, fn);
    calls.length = 0;
    set(selected, "c");
    expect(calls).toEqual([
      ["b", false],
      ["c", true],
    ]);
  });

  test("marks nothing when no row has the selected key", () => {
    expect.assertions(1);
    const rows = rowsOf(ITEMS);
    const [calls, fn] = recorder();
    mark(signal("z"), rows, fn);
    expect(calls).toEqual([]);
  });

  test("calls nothing for rows created with unselected keys", () => {
    expect.assertions(1);
    const [, items, rows] = render(ITEMS);
    const [calls, fn] = recorder();
    mark(signal("z"), rows, fn);
    set(items, [...ITEMS, ...lettered("xy")]);
    expect(calls).toEqual([]);
  });

  test("marks a row created while its key is selected", () => {
    expect.assertions(1);
    const [, items, rows] = render(ITEMS);
    const [calls, fn] = recorder();
    mark(signal("e"), rows, fn);
    set(items, [...ITEMS, ...lettered("e")]);
    expect(calls).toEqual([["e", true]]);
  });

  test("unmarks a row marked as it was created when the selection moves", () => {
    expect.assertions(1);
    const [parent, items, rows] = render(ITEMS);
    const selected = signal("e");
    const [, fn] = recorder();
    mark(selected, rows, fn);
    set(items, [...ITEMS, ...lettered("e")]);
    set(selected, "a");
    expect(markedIds(parent.children)).toEqual(["a"]);
  });

  test("never passes a removed row to fn", () => {
    expect.assertions(1);
    const [, items, rows] = render(ITEMS);
    const selected = signal("b");
    const [calls, fn] = recorder();
    mark(selected, rows, fn);
    set(
      items,
      ITEMS.filter((item) => item.id !== "b"),
    );
    calls.length = 0;
    set(selected, "c");
    expect(calls).toEqual([["c", true]]);
  });

  test("calls nothing when notified of an unchanged value", () => {
    expect.assertions(1);
    const rows = rowsOf(ITEMS);
    const selected = signal("a");
    const [calls, fn] = recorder();
    mark(selected, rows, fn);
    calls.length = 0;
    // A sink subscribed during the batch makes it notify, though it restores the value
    batch(() => {
      set(selected, "b");
      sub(selected, () => {});
      set(selected, "a");
    });
    expect(calls).toEqual([]);
  });

  test("marks the right row after many selections and then a list change", () => {
    expect.assertions(1);
    const [parent, items, rows] = render(lettered("abcdefghijklmnop"));
    const selected = signal("a");
    const [, fn] = recorder();
    mark(selected, rows, fn);
    // More selections than mark answers by scanning, while the list stays the same
    for (const id of "bcdefghijklm") set(selected, id);
    set(items, [...items.v.filter((item) => item.id !== "c"), ...lettered("q")]);
    set(selected, "q");
    expect(markedIds(parent.children)).toEqual(["q"]);
  });

  test("marks the right row after many selections, an update that keeps every row, and a reorder", () => {
    expect.assertions(2);
    const [parent, items, rows] = render(lettered("abcdefghijklmnop"));
    const selected = signal("a");
    const [, fn] = recorder();
    mark(selected, rows, fn);
    // More selections than mark answers by scanning, while the list stays the same
    for (const id of "bcdefghijklm") set(selected, id);
    // A new array with every key in place, one item replaced: the rows stay
    set(
      items,
      items.v.map((item) => (item.id === "d" ? { ...item, label: "D" } : item)),
    );
    set(selected, "d");
    expect(markedIds(parent.children)).toEqual(["d"]);
    set(items, [...items.v.filter((item) => item.id !== "e").toReversed(), ...lettered("q")]);
    set(selected, "q");
    expect(markedIds(parent.children)).toEqual(["q"]);
  });

  test("leaves only the new row marked when a batch adds a row and then selects it", () => {
    expect.assertions(1);
    const [parent, items, rows] = render(ITEMS);
    const selected = signal("a");
    const [, fn] = recorder();
    mark(selected, rows, fn);
    batch(() => {
      set(items, [...ITEMS, ...lettered("e")]);
      set(selected, "e");
    });
    expect(markedIds(parent.children)).toEqual(["e"]);
  });

  test("marks the restored key's row when created during a batch that restores the value", () => {
    expect.assertions(1);
    const [parent, , rows] = render(ITEMS);
    const selected = signal("a");
    sub(selected, () => {});
    const [, fn] = recorder();
    batch(() => {
      set(selected, "b");
      mark(selected, rows, fn);
      set(selected, "a");
    });
    expect(markedIds(parent.children)).toEqual(["a"]);
  });

  test("leaves only the final row marked when fn changes the selection mid-change", () => {
    expect.assertions(1);
    const [parent, , rows] = render(ITEMS);
    const selected = signal("a");
    const [, paint] = recorder();
    mark(selected, rows, (node, on) => {
      paint(node, on);
      if (node.dataset["id"] === "a" && !on) set(selected, "c");
    });
    set(selected, "b");
    expect(markedIds(parent.children)).toEqual(["c"]);
  });

  test("stops following the selection once stopped", () => {
    expect.assertions(1);
    const rows = rowsOf(ITEMS);
    const selected = signal("a");
    const [calls, fn] = recorder();
    const stop = mark(selected, rows, fn);
    stop();
    calls.length = 0;
    set(selected, "b");
    expect(calls).toEqual([]);
  });

  test("stops marking new rows once stopped", () => {
    expect.assertions(1);
    const [, items, rows] = render(ITEMS);
    const [calls, fn] = recorder();
    mark(signal("e"), rows, fn)();
    set(items, [...ITEMS, ...lettered("e")]);
    expect(calls).toEqual([]);
  });

  test("marks a map's element for the selected key at once", () => {
    expect.assertions(1);
    const [calls, fn] = recorder();
    mark(signal("b"), elements("abc"), fn);
    expect(calls).toEqual([["b", true]]);
  });

  test("unmarks the old map element and marks the new one when the selection changes", () => {
    expect.assertions(1);
    const selected = signal("b");
    const [calls, fn] = recorder();
    mark(selected, elements("abc"), fn);
    calls.length = 0;
    set(selected, "c");
    expect(calls).toEqual([
      ["b", false],
      ["c", true],
    ]);
  });

  test("only unmarks when the map lacks the selected key", () => {
    expect.assertions(1);
    const selected = signal("a");
    const [calls, fn] = recorder();
    mark(selected, elements("abc"), fn);
    calls.length = 0;
    set(selected, "z");
    expect(calls).toEqual([["a", false]]);
  });

  test("lets several marks share one map and one signal", () => {
    expect.assertions(1);
    const tabs = elements("ab");
    const selected = signal("a");
    const seen: string[] = [];
    mark(selected, tabs, (node, on) => {
      seen.push(`first ${node.dataset["id"]} ${on}`);
    });
    mark(selected, tabs, (node, on) => {
      seen.push(`second ${node.dataset["id"]} ${on}`);
    });
    seen.length = 0;
    set(selected, "b");
    expect(seen.toSorted((x, y) => x.localeCompare(y))).toEqual([
      "first a false",
      "first b true",
      "second a false",
      "second b true",
    ]);
  });

  test("unmarks a map's element that has no parent", () => {
    expect.assertions(1);
    const selected = signal("a");
    const [calls, fn] = recorder();
    mark(selected, elements("ab", true), fn);
    calls.length = 0;
    set(selected, "b");
    expect(calls).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  test("leaves only the final map element marked when fn changes the selection mid-change", () => {
    expect.assertions(1);
    const tabs = elements("abc");
    const selected = signal("a");
    const [, paint] = recorder();
    mark(selected, tabs, (node, on) => {
      paint(node, on);
      if (node.dataset["id"] === "a" && !on) set(selected, "c");
    });
    set(selected, "b");
    expect(markedIds(tabs.values())).toEqual(["c"]);
  });
});
