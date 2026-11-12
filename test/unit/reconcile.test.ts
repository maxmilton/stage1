// list and mark on the owner-aware core (rows own what create makes, parent-first re-runs), and the
// core's integration helpers they use; the list tests that hold for either tier also run on
// stage1/lite's list. Run in both modes: `bun test` (dev checks on) and
// `NODE_ENV=production bun test`.
// Callbacks and checks inside loops branch on the data they receive.
// oxlint-disable vitest/no-conditional-in-test node/no-process-env

import { describe, expect, expectTypeOf, spyOn, test } from "bun:test";
import { list as liteList } from "../../src/lite/reconcile.ts";
import {
  batch as liteBatch,
  dispose as liteDispose,
  set as liteSet,
  signal as liteSignal,
} from "../../src/lite/signal.ts";
import { type List, list, mark } from "../../src/reconcile.ts";
import {
  batch,
  defer,
  dispose,
  type Effect,
  effect,
  get,
  holder,
  owns,
  release,
  type Scope,
  scope,
  set,
  type Signal,
  signal,
  within,
} from "../../src/signal.ts";

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

/** Renders `items` into a new parent; returns the parent, the items signal and the list. */
const render = (
  items: readonly Item[],
): [
  parent: HTMLDivElement,
  items: Signal<readonly Item[]>,
  handle: List<string, HTMLSpanElement>,
] => {
  const parent = document.createElement("div");
  const source = signal(items);
  const handle = list(parent, source, "id", createItemNode, updateItemNode);
  return [parent, source, handle];
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

/** Items with unique ids, numbered from 0. */
const freshItems = (): (() => Item) => {
  let id = 0;
  return () => {
    const value = String(id++);
    return { id: value, label: value };
  };
};

/**
 * White-box: a core node's fields (`s`: an owner's newest child, `n`: its older sibling, `p`: its
 * newer sibling or owner, `o`: the node it climbs to). No public API counts a list's row owners.
 */
interface Raw {
  f: number;
  s: Raw | undefined;
  n: Raw | undefined;
  p: Raw | undefined;
  o: Raw | undefined;
}

/** The node behind a handle (full tier). */
const raw = (handle: unknown): Raw => handle as Raw;

/** Children of an owner, newest first. */
const children = (h: Raw): Raw[] => {
  const all: Raw[] = [];
  for (let k = h.s; k !== undefined; k = k.n) all.push(k);
  return all;
};

/** The owners of a list's owning rows: the list's children but the oldest (its subscription). */
const rowHolders = (handle: unknown): Raw[] => children(raw(handle)).slice(0, -1);

describe("list", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(list).not.toBeAny();
    expectTypeOf(list<Item, "id", HTMLSpanElement>).parameters.toEqualTypeOf<
      [
        parent: Element,
        items: Signal<readonly Item[]>,
        key: "id",
        create: (item: Item) => HTMLSpanElement,
        update?: ((node: HTMLSpanElement, item: Item) => void) | undefined,
      ]
    >();
    // The handle, which dispose and mark take
    expectTypeOf(list<Item, "id", HTMLSpanElement>).returns.toExtend<Effect>();
    expectTypeOf((parent: Element) => {
      list(
        parent,
        signal(ITEMS),
        "id",
        (item) => {
          expectTypeOf(item).toEqualTypeOf<Item>();
          return document.createElement("span");
        },
        (node, item) => {
          expectTypeOf(node).toEqualTypeOf<HTMLSpanElement>();
          expectTypeOf(item).toEqualTypeOf<Item>();
        },
      );
      expectTypeOf(list(parent, signal(ITEMS), "id", createItemNode)).toEqualTypeOf<
        List<string, HTMLSpanElement>
      >();
      // @ts-expect-error - key must be a property of the items
      list(parent, signal(ITEMS), "missing", createItemNode);
    }).toBeFunction();
  });
});

/** A list on its own items signal, written and stopped through its tier's API. */
interface Driven {
  readonly set: (items: readonly Item[]) => void;
  readonly get: () => readonly Item[];
  readonly dispose: () => void;
}

/** What the tests that hold for either tier's list use from that tier. */
interface Tier {
  /** A list in `parent` on a new items signal holding `items`. */
  readonly list: (
    parent: Element,
    items: readonly Item[],
    create: (item: Item) => HTMLSpanElement,
    update?: (node: HTMLSpanElement, item: Item) => void,
  ) => Driven;
  readonly batch: (fn: () => void) => void;
}

// stage1/lite's list has its own copy of the diff, so these tests run on both tiers
const TIERS: readonly (readonly [name: string, tier: Tier])[] = [
  [
    "stage1",
    {
      list: (parent, items, create, update) => {
        const source = signal(items);
        const handle = list(parent, source, "id", create, update);
        return {
          set: (next) => {
            set(source, next);
          },
          get: () => source.v,
          dispose: () => {
            dispose(handle);
          },
        };
      },
      batch,
    },
  ],
  [
    "stage1/lite",
    {
      list: (parent, items, create, update) => {
        const source = liteSignal(items);
        const handle = liteList(parent, source, "id", create, update);
        return {
          set: (next) => {
            liteSet(source, next);
          },
          get: () => source.v,
          dispose: () => {
            liteDispose(handle);
          },
        };
      },
      batch: liteBatch,
    },
  ],
];

describe.each(TIERS)("list on %s", (_, tier) => {
  /** Renders `items` into a new parent with the tier's list. */
  const show = (items: readonly Item[]): [parent: HTMLDivElement, items: Driven] => {
    const parent = document.createElement("div");
    return [parent, tier.list(parent, items, createItemNode, updateItemNode)];
  };

  test("renders the initial items in order", () => {
    expect.assertions(2);
    const [parent] = show(ITEMS);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
    expect(parent.textContent).toBe("ABCD");
  });

  test("renders items set later", () => {
    expect.assertions(1);
    const [parent, items] = show([]);
    items.set(ITEMS);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
  });

  test("leaves a connected parent in place among its siblings", () => {
    expect.assertions(2);
    const host = document.createElement("div");
    const parent = document.createElement("div");
    host.append("before", parent, "after");
    document.body.append(host);
    try {
      const items = tier.list(parent, [], createItemNode);
      items.set(ITEMS);
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
    const items = tier.list(parent, ITEMS, createItemNode, updateItemNode);
    items.set(REORDERED_ITEMS);
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
    const [parent, items] = show(lettered("abcdefghij"));
    expect(
      insertedIds(parent, () => {
        items.set(lettered("abdefghcij"));
      }),
    ).toEqual(["c"]);
  });

  test("moves only the row that moved earlier", () => {
    expect.assertions(1);
    const [parent, items] = show(lettered("abcdefghij"));
    expect(
      insertedIds(parent, () => {
        items.set(lettered("abhcdefgij"));
      }),
    ).toEqual(["h"]);
  });

  test("appends new rows at the end in order", () => {
    expect.assertions(1);
    const [parent, items] = show(lettered("abc"));
    expect(
      insertedIds(parent, () => {
        items.set(lettered("abcdef"));
      }),
    ).toEqual(["d", "e", "f"]);
  });

  test("inserts new rows between kept rows in order", () => {
    expect.assertions(1);
    const [parent, items] = show(lettered("ab"));
    items.set(lettered("axyzb"));
    expect(itemOrder(parent)).toEqual(["a", "x", "y", "z", "b"]);
  });

  test("inserts only the new rows when the kept rows keep their order", () => {
    expect.assertions(1);
    const [parent, items] = show(lettered("abcdef"));
    const inserted = insertedIds(parent, () => {
      items.set(lettered("abxdyf"));
    });
    expect(inserted.toSorted((x, y) => x.localeCompare(y))).toEqual(["x", "y"]);
  });

  test("moves the fewest rows when no end matches", () => {
    expect.assertions(1);
    const [parent, items] = show(lettered("abcdefghij"));
    // Old order c d e f g h in the middle becomes d c e f h g: 4 rows can stay
    expect(
      insertedIds(parent, () => {
        items.set(lettered("abdcefhgij"));
      }),
    ).toHaveLength(2);
  });

  test("swaps two rows with two moves", () => {
    expect.assertions(1);
    const [parent, items] = show(lettered("abcdef"));
    const inserted = insertedIds(parent, () => {
      items.set(lettered("aecdbf"));
    });
    expect(inserted.toSorted((x, y) => x.localeCompare(y))).toEqual(["b", "e"]);
  });

  test("reorders rows to match the new items", () => {
    expect.assertions(1);
    const [parent, items] = show(ITEMS);
    items.set(REORDERED_ITEMS);
    expect(itemOrder(parent)).toEqual(["d", "b", "e", "a"]);
  });

  test("keeps the row of each retained key", () => {
    expect.assertions(3);
    const [parent, items] = show(ITEMS);
    const nodes = [...parent.children];
    items.set(REORDERED_ITEMS);
    const [first, second, , fourth] = [...parent.children];
    expect(first).toBe(nodes[3]);
    expect(second).toBe(nodes[1]);
    expect(fourth).toBe(nodes[0]);
  });

  test("updates retained rows with their new items", () => {
    expect.assertions(1);
    const [parent, items] = show(ITEMS);
    items.set(REORDERED_ITEMS);
    expect(parent.textContent).toBe("DeltaBetaEpsilonAlpha");
  });

  test("removes the rows of dropped keys", () => {
    expect.assertions(2);
    const [parent, items] = show(ITEMS);
    const nodes = [...parent.children];
    items.set(REORDERED_ITEMS);
    expect(nodes[2].parentNode).toBeNull(); // "c"
    expect(itemOrder(parent)).not.toContain("c");
  });

  test("clears every row when the items empty", () => {
    expect.assertions(1);
    const [parent, items] = show(ITEMS);
    items.set([]);
    expect(parent.childNodes).toHaveLength(0);
  });

  test("swaps two rows", () => {
    expect.assertions(1);
    const [parent, items] = show(ITEMS);
    items.set([ITEMS[0], ITEMS[3], ITEMS[2], ITEMS[1]]);
    expect(itemOrder(parent)).toEqual(["a", "d", "c", "b"]);
  });

  test("reverses the rows", () => {
    expect.assertions(1);
    const [parent, items] = show(ITEMS);
    items.set(ITEMS.toReversed());
    expect(itemOrder(parent)).toEqual(["d", "c", "b", "a"]);
  });

  test("Regression: moves a row to the end, then a later row forward", () => {
    expect.assertions(1);
    const [parent, items] = show(lettered("abcde"));
    items.set(lettered("adceb"));
    expect(itemOrder(parent)).toEqual(["a", "d", "c", "e", "b"]);
  });

  test("replaces every row when no keys match", () => {
    expect.assertions(2);
    const [parent, items] = show(ITEMS);
    const nodes = [...parent.children];
    items.set(lettered("xy"));
    expect(itemOrder(parent)).toEqual(["x", "y"]);
    expect(nodes.some((node) => node.parentNode)).toBeFalse();
  });

  test("matches the items after a seeded sequence of edits", () => {
    expect.assertions(3);
    const next = random(48_271);
    const fresh = freshItems();
    const [parent, items] = show([]);
    const wrongOrder: number[] = [];
    const wrongText: number[] = [];
    const replacedRows: number[] = [];
    for (let round = 0; round < 300; round++) {
      const before = new Map(
        [...parent.children].map((node) => [(node as HTMLElement).dataset["id"], node]),
      );
      const data = editItems(next, items.get(), fresh);
      items.set(data);
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
    const shown = new Map<string, Item>();
    let repeats = 0;
    const items = tier.list(
      document.createElement("div"),
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
    for (let round = 0; round < 300; round++) items.set(editItems(next, items.get(), fresh));
    expect(repeats).toBe(0);
  });

  test("calls update for a retained key whose item changed", () => {
    expect.assertions(1);
    const updated: string[] = [];
    const items = tier.list(document.createElement("div"), ITEMS, createItemNode, (_node, item) => {
      updated.push(item.label);
    });
    items.set([ITEMS[0], { id: "b", label: "B2" }, ITEMS[2], ITEMS[3]]);
    expect(updated).toEqual(["B2"]);
  });

  test("does not call update when the item is the same object", () => {
    expect.assertions(1);
    let updates = 0;
    const items = tier.list(document.createElement("div"), ITEMS, createItemNode, () => {
      updates++;
    });
    items.set(ITEMS.toReversed());
    expect(updates).toBe(0);
  });

  test("drops the trailing rows when the new items are the old ones' start", () => {
    expect.assertions(2);
    const [parent, items] = show(ITEMS);
    const kept = [...parent.children].slice(0, 2);
    items.set(ITEMS.slice(0, 2));
    expect(itemOrder(parent)).toEqual(["a", "b"]);
    expect([...parent.children].every((node, index) => node === kept[index])).toBe(true);
  });

  test("keeps every row and updates only new items when each key stays in place", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    const updated: string[] = [];
    const items = tier.list(parent, ITEMS, createItemNode, (node, item) => {
      updated.push(item.id);
      updateItemNode(node, item);
    });
    const before = [...parent.children];
    items.set(
      ITEMS.map((item) => (item.id === "a" || item.id === "c" ? { ...item, label: "new" } : item)),
    );
    expect(updated).toEqual(["a", "c"]);
    expect([...parent.children].every((node, index) => node === before[index])).toBe(true);
    expect([...parent.children].map((node) => node.textContent)).toEqual(["new", "B", "new", "D"]);
  });

  test("a disposed list leaves its rows as they were", () => {
    expect.assertions(1);
    const [parent, items] = show(ITEMS);
    items.dispose();
    items.set(REORDERED_ITEMS);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
  });

  test("reconciles once per batch, with the final items", () => {
    expect.assertions(1);
    const created: string[] = [];
    const items = tier.list(document.createElement("div"), ITEMS, (item) => {
      created.push(item.id);
      return createItemNode(item);
    });
    created.length = 0;
    tier.batch(() => {
      items.set(lettered("x"));
      items.set(lettered("y"));
    });
    expect(created).toEqual(["y"]);
  });

  test("does not reconcile for a batch that restores the items", () => {
    expect.assertions(1);
    let creates = 0;
    const items = tier.list(document.createElement("div"), ITEMS, (item) => {
      creates++;
      return createItemNode(item);
    });
    creates = 0;
    tier.batch(() => {
      items.set(lettered("z"));
      items.set(ITEMS);
    });
    expect(creates).toBe(0);
  });

  test("a throwing create reaches the writer (dev: wrapped, naming the rule)", () => {
    expect.assertions(1);
    const items = tier.list(document.createElement("div"), [], (item) => {
      if (item.id === "bad") throw new Error("create failed");
      return createItemNode(item);
    });
    let caught: unknown;
    try {
      items.set([ITEMS[0], { id: "bad", label: "" }]);
    } catch (error) {
      caught = error;
    }
    if (DEV) {
      expect([
        (caught as Error).message.startsWith("stage1: a list's"),
        ((caught as Error).cause as Error).message,
      ]).toEqual([true, "create failed"]);
    } else expect((caught as Error).message).toBe("create failed");
  });

  test("a throwing create in the first build puts a connected parent back", () => {
    expect.assertions(2);
    const host = document.createElement("div");
    const parent = document.createElement("ul");
    host.append("before", parent, "after");
    document.body.append(host);
    try {
      const items = tier.list(parent, [], (item) => {
        if (item.id === "bad") throw new Error("create failed");
        return createItemNode(item);
      });
      expect(() => {
        items.set([ITEMS[0], { id: "bad", label: "" }]);
      }).toThrow();
      expect(host.childNodes[1]).toBe(parent);
    } finally {
      host.remove();
    }
  });
});

describe("list ownership", () => {
  test("an effect a row's create makes is disposed when the row is removed", () => {
    expect.assertions(1);
    const items = signal(ITEMS);
    const s = signal(0);
    const runs: string[] = [];
    list(document.createElement("div"), items, "id", (item) => {
      effect(() => {
        get(s);
        runs.push(item.id);
      });
      return createItemNode(item);
    });
    set(items, [ITEMS[0], ITEMS[2]]);
    runs.length = 0;
    set(s, 1);
    expect(runs.toSorted()).toEqual(["a", "c"]);
  });

  test("runs a row's cleanups when the row is removed, before it leaves the DOM", () => {
    expect.assertions(1);
    const items = signal(ITEMS);
    const cleaned: string[] = [];
    list(document.createElement("div"), items, "id", (item) => {
      const node = createItemNode(item);
      defer(() => {
        cleaned.push(`${item.id}${node.parentNode ? "" : " detached"}`);
      });
      return node;
    });
    set(items, [ITEMS[0], ITEMS[2]]);
    expect(cleaned.toSorted()).toEqual(["b", "d"]);
  });

  test("runs every row's cleanups when the items empty", () => {
    expect.assertions(1);
    const items = signal(ITEMS);
    const cleaned: string[] = [];
    list(document.createElement("div"), items, "id", (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    set(items, []);
    expect(cleaned.toSorted()).toEqual(["a", "b", "c", "d"]);
  });

  test("runs every replaced row's cleanups when no key matches", () => {
    expect.assertions(1);
    const items = signal(ITEMS);
    const cleaned: string[] = [];
    list(document.createElement("div"), items, "id", (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    set(items, lettered("xy"));
    expect(cleaned.toSorted()).toEqual(["a", "b", "c", "d"]);
  });

  test("keeps what moved and updated rows own", () => {
    expect.assertions(1);
    const items = signal(ITEMS);
    let cleanups = 0;
    list(
      document.createElement("div"),
      items,
      "id",
      (item) => {
        defer(() => {
          cleanups++;
        });
        return createItemNode(item);
      },
      updateItemNode,
    );
    set(items, ITEMS.toReversed());
    set(
      items,
      items.v.map((item) => ({ id: item.id, label: item.label })),
    );
    expect(cleanups).toBe(0);
  });

  test("runs each removed row's cleanups once over a seeded sequence of edits", () => {
    expect.assertions(2);
    const next = random(9001);
    const fresh = freshItems();
    const items = signal<readonly Item[]>([]);
    const cleanups = new Map<string, number>();
    // Every third row owns something: owning and plain rows mix
    const handle = list(document.createElement("div"), items, "id", (item) => {
      if (Number(item.id) % 3 === 0) {
        defer(() => {
          cleanups.set(item.id, (cleanups.get(item.id) ?? 0) + 1);
        });
      }
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
    expect(rowHolders(handle)).toHaveLength(
      items.v.filter((item) => Number(item.id) % 3 === 0).length,
    );
  });

  test("dispose runs every row's cleanups, newest row first", () => {
    expect.assertions(1);
    const cleaned: string[] = [];
    const handle = list(document.createElement("div"), signal(ITEMS), "id", (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      return createItemNode(item);
    });
    dispose(handle);
    expect(cleaned).toEqual(["d", "c", "b", "a"]);
  });

  test("rows that own nothing get no holder", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    const items = signal(lettered("abcdef"));
    // A create that reads a signal still makes nothing (an effect would be owned, even one that
    // reads nothing)
    const s = signal(0);
    const handle = list(parent, items, "id", (item) => {
      get(s);
      return createItemNode(item);
    });
    // happy-dom keeps its own state under described symbols; the list's is undescribed
    const undescribed = (node: Element): symbol[] =>
      Object.getOwnPropertySymbols(node).filter((key) => key.description === undefined);
    expect([...parent.children].flatMap((node) => undescribed(node))).toEqual([]);
    expect(rowHolders(handle)).toHaveLength(0);
    set(items, lettered("fedcba"));
    set(items, []);
    expect(rowHolders(handle)).toHaveLength(0);
  });

  test("a row's create and update run untracked", () => {
    expect.assertions(2);
    const items = signal(ITEMS);
    const s = signal(0);
    let creates = 0;
    list(
      document.createElement("div"),
      items,
      "id",
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
    set(
      items,
      items.v.map((item) => ({ id: item.id, label: item.label })),
    );
    creates = 0;
    set(s, 1);
    expect(creates).toBe(0);
    set(items, [...items.v, ...lettered("e")]);
    expect(creates).toBe(1);
  });

  // What update makes also goes at the list's next clear or replace, which dispose all its children
  test.serial(
    "Accepted tradeoff: what update makes outlives its row, to the list's disposal (dev warns)",
    () => {
      expect.assertions(2);
      const items = signal(ITEMS);
      const cleaned: string[] = [];
      using warn = spyOn(console, "warn").mockImplementation(() => {});
      const handle = list(
        document.createElement("div"),
        items,
        "id",
        createItemNode,
        (node, item) => {
          defer(() => {
            cleaned.push(item.label);
          });
          updateItemNode(node, item);
        },
      );
      set(items, [{ id: "a", label: "A2" }, ITEMS[1]]);
      set(items, [ITEMS[1]]);
      const kept = [...cleaned];
      dispose(handle);
      expect([kept, cleaned]).toEqual([[], ["A2"]]);
      expect(warn).toHaveBeenCalledTimes(DEV ? 1 : 0);
    },
  );

  test("a list made in an effect's run is disposed when the effect re-runs (no duplicated rows)", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    const items = signal<readonly Item[]>([ITEMS[0]]);
    const trigger = signal(0);
    let creates = 0;
    effect(() => {
      get(trigger);
      parent.textContent = "";
      list(parent, items, "id", (item) => {
        creates++;
        return createItemNode(item);
      });
    });
    set(trigger, 1);
    creates = 0;
    set(items, [ITEMS[0], ITEMS[1]]);
    expect(creates).toBe(1);
    expect(itemOrder(parent)).toEqual(["a", "b"]);
  });

  test("a list and its rows' effects are disposed with the scope that made them", () => {
    expect.assertions(2);
    const items = signal(ITEMS);
    const s = signal(0);
    let runs = 0;
    let creates = 0;
    const page = scope(() => {
      list(document.createElement("div"), items, "id", (item) => {
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
    expect(runs).toBe(0);
    expect(creates).toBe(0);
  });

  test("a nested list's row cleanups stay with that row", () => {
    expect.assertions(1);
    const inner = signal<readonly Item[]>([ITEMS[1]]);
    const cleaned: string[] = [];
    list(document.createElement("div"), signal([ITEMS[0]]), "id", (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      const node = createItemNode(item);
      list(node, inner, "id", (innerItem) => {
        defer(() => {
          cleaned.push(innerItem.id);
        });
        return createItemNode(innerItem);
      });
      return node;
    });
    set(inner, []);
    expect(cleaned).toEqual(["b"]);
  });

  test("a nested list is disposed with its row, its rows' cleanups first", () => {
    expect.assertions(2);
    const outer = signal<readonly Item[]>([ITEMS[0]]);
    const inner = signal<readonly Item[]>([ITEMS[1]]);
    const cleaned: string[] = [];
    let innerCreates = 0;
    list(document.createElement("div"), outer, "id", (item) => {
      defer(() => {
        cleaned.push(item.id);
      });
      const node = createItemNode(item);
      list(node, inner, "id", (innerItem) => {
        innerCreates++;
        defer(() => {
          cleaned.push(innerItem.id);
        });
        return createItemNode(innerItem);
      });
      return node;
    });
    set(outer, []);
    innerCreates = 0;
    set(inner, [ITEMS[2]]);
    expect(cleaned).toEqual(["b", "a"]);
    expect(innerCreates).toBe(0);
  });

  test("a row keeps what it owns when it catches a nested list's throwing create", () => {
    expect.assertions(1);
    const items = signal<readonly Item[]>([ITEMS[0]]);
    const cleaned: string[] = [];
    list(document.createElement("div"), items, "id", (item) => {
      defer(() => {
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
      defer(() => {
        cleaned.push("after");
      });
      return node;
    });
    set(items, []);
    expect(cleaned).toEqual(["after", "before"]);
  });

  test("a row effect re-runs after its list's owner (parent-first) and once per write", () => {
    expect.assertions(1);
    const s = signal(0);
    const order: string[] = [];
    effect(() => {
      order.push(`page ${get(s)}`);
      list(document.createElement("div"), signal(lettered("ab")), "id", (item) => {
        effect(() => {
          order.push(`${item.id} ${get(s)}`);
        });
        return createItemNode(item);
      });
    });
    order.length = 0;
    set(s, 1);
    // The page re-ran first: it disposed the old list and its row effects, then made new ones
    expect(order).toEqual(["page 1", "a 1", "b 1"]);
  });

  test("a row effect whose source changes in the batch that removes its row does not run (parent-first)", () => {
    expect.assertions(1);
    const items = signal(lettered("abc"));
    const s = signal(0);
    const runs: string[] = [];
    list(document.createElement("div"), items, "id", (item) => {
      effect(() => {
        runs.push(`${item.id} ${get(s)}`);
      });
      return createItemNode(item);
    });
    runs.length = 0;
    // The rows' effects are queued before the list's subscription
    batch(() => {
      set(s, 1);
      set(items, lettered("ac"));
    });
    expect(runs.toSorted()).toEqual(["a 1", "c 1"]);
  });

  test("rows keep what they own when the flush ending the list's creation changes the items", () => {
    expect.assertions(1);
    const items = signal(lettered("ab"));
    const x = signal(0);
    const s = signal(0);
    let runs = 0;
    effect(() => {
      if (get(x) === 1) set(items, lettered("abc"));
    });
    list(document.createElement("div"), items, "id", (item) => {
      effect(() => {
        get(s);
        runs++;
      });
      // Queues the effect above, which runs once the list's first reconcile is done
      if (item.id === "b") set(x, 1);
      return createItemNode(item);
    });
    runs = 0;
    set(s, 1);
    expect(runs).toBe(3);
  });

  test("a top-level list belongs to nothing and lives until disposed", () => {
    expect.assertions(2);
    const [parent, items, handle] = render(ITEMS);
    // In no owner's list, and it climbs to nothing
    expect([raw(handle).p, raw(handle).o]).toEqual([undefined, undefined]);
    set(items, lettered("x"));
    expect(itemOrder(parent)).toEqual(["x"]);
  });

  // The first row's owner is made before any row climbs to the list's subscription. Only row a's
  // effect reads `s`, so it is queued before the subscription (no other row climbs first)
  test("the first row's effect does not run in the batch that removes its row (parent-first)", () => {
    expect.assertions(1);
    const items = signal(lettered("abc"));
    const s = signal(0);
    const runs: string[] = [];
    list(document.createElement("div"), items, "id", (item) => {
      effect(() => {
        if (item.id === "a") runs.push(`a ${get(s)}`);
      });
      return createItemNode(item);
    });
    batch(() => {
      set(s, 1);
      set(items, lettered("bc"));
    });
    expect(runs).toEqual(["a 0"]);
  });

  test("a nested list's row effect does not run in the batch that removes its outer row (parent-first)", () => {
    expect.assertions(1);
    const outer = signal(lettered("ab"));
    const s = signal(0);
    const runs: string[] = [];
    list(document.createElement("div"), outer, "id", (item) => {
      const node = createItemNode(item);
      list(node, signal(lettered("x")), "id", (inner) => {
        effect(() => {
          runs.push(`${item.id}${inner.id} ${get(s)}`);
        });
        return createItemNode(inner);
      });
      return node;
    });
    runs.length = 0;
    batch(() => {
      set(s, 1);
      set(outer, lettered("b"));
    });
    expect(runs).toEqual(["bx 1"]);
  });

  // The list runs its subscription and its rows' first runs while the effect that
  // makes it is running; that effect must take a fresh run id back, or it takes the rows' stamps on
  // `x` for its own and never links `x`
  test("an effect that makes a list, then reads what its rows' effects read, re-runs when that changes", () => {
    expect.assertions(1);
    const x = signal(0);
    let runs = 0;
    effect(() => {
      list(document.createElement("div"), signal(lettered("ab")), "id", (item) => {
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

  // What update makes belongs to the list, released with its rows' owners
  test.serial("what update makes is disposed at the list's next clear", () => {
    expect.assertions(1);
    const items = signal(ITEMS);
    const cleaned: string[] = [];
    using _ = spyOn(console, "warn").mockImplementation(() => {});
    list(document.createElement("div"), items, "id", createItemNode, (node, item) => {
      defer(() => {
        cleaned.push(item.label);
      });
      updateItemNode(node, item);
    });
    set(items, [{ id: "a", label: "A2" }, ITEMS[1]]);
    set(items, []);
    expect(cleaned).toEqual(["A2"]);
  });
});

describe("list over seeded permutations", () => {
  test("matches a reference array with owning and plain rows mixed", () => {
    expect.assertions(4);
    const next = random(271_828);
    const fresh = freshItems();
    const items = signal<readonly Item[]>([]);
    const tick = signal(0);
    const ran = new Set<string>();
    const cleanups = new Map<string, number>();
    const parent = document.createElement("div");
    // Rows own an effect bound to their node, a cleanup, or nothing, by id
    list(parent, items, "id", (item) => {
      const node = createItemNode(item);
      if (Number(item.id) % 3 === 0) {
        effect(() => {
          node.title = String(get(tick));
          ran.add(item.id);
        });
      } else if (Number(item.id) % 3 === 1) {
        defer(() => {
          cleanups.set(item.id, (cleanups.get(item.id) ?? 0) + 1);
        });
      }
      return node;
    });
    const removed = new Set<string>();
    const wrongOrder: number[] = [];
    const replacedRows: number[] = [];
    const wrongRuns: number[] = [];
    for (let round = 1; round <= 300; round++) {
      const before = new Map(
        [...parent.children].map((node) => [(node as HTMLElement).dataset["id"], node]),
      );
      const data =
        round % 50 === 0 ? [] : (round % 2 ? permuteItems : editItems)(next, items.v, fresh);
      const ids = new Set(data.map((item) => item.id));
      for (const item of items.v) if (!ids.has(item.id)) removed.add(item.id);
      set(items, data);
      if (itemOrder(parent).join(",") !== data.map((item) => item.id).join(","))
        wrongOrder.push(round);
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
    const owning = [...removed].filter((id) => Number(id) % 3 === 1);
    expect([...cleanups].toSorted(([x], [y]) => x.localeCompare(y))).toEqual(
      owning.toSorted().map((id) => [id, 1]),
    );
  });
});

describe("list re-entrancy (writes and disposal during a reconcile)", () => {
  test("a row effect whose first run writes the items leaves the rows matching them", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(lettered("a"));
    list(parent, items, "id", (item) => {
      effect(() => {
        if (item.id === "b") set(items, lettered("abc"));
      });
      return createItemNode(item);
    });
    set(items, lettered("ab"));
    expect(itemOrder(parent)).toEqual(["a", "b", "c"]);
  });

  test("a row cleanup that writes the items as its row is removed leaves the rows matching them", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(lettered("abc"));
    list(parent, items, "id", (item) => {
      defer(() => {
        if (item.id === "b") set(items, lettered("xy"));
      });
      return createItemNode(item);
    });
    set(items, lettered("ac"));
    expect(itemOrder(parent)).toEqual(["x", "y"]);
  });

  test("an update that writes the items leaves the rows matching them", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    const items = signal(lettered("ab"));
    list(parent, items, "id", createItemNode, (node, item) => {
      updateItemNode(node, item);
      if (item.label === "B") set(items, lettered("z"));
    });
    set(items, [ITEMS[0], { id: "b", label: "B" }]);
    expect(itemOrder(parent)).toEqual(["z"]);
  });

  test("a row effect disposing the list's owner on its first run leaves no row effect running", () => {
    expect.assertions(1);
    const items = signal(lettered("a"));
    const s = signal(0);
    let runs = 0;
    const page = scope(() => {
      list(document.createElement("div"), items, "id", (item) => {
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

  test("a row cleanup disposing the list as rows are removed reaches no caller", () => {
    expect.assertions(1);
    const items = signal(lettered("abcd"));
    const handle = list(document.createElement("div"), items, "id", (item) => {
      defer(() => {
        if (item.id === "b") dispose(handle);
      });
      return createItemNode(item);
    });
    expect(() => {
      set(items, lettered("axyd"));
    }).not.toThrow();
  });

  test("a row cleanup disposing the list as rows are removed leaves no row effect running", () => {
    expect.assertions(1);
    const items = signal(lettered("abcd"));
    const s = signal(0);
    let runs = 0;
    const handle = list(document.createElement("div"), items, "id", (item) => {
      defer(() => {
        if (item.id === "b") dispose(handle);
      });
      effect(() => {
        get(s);
        runs++;
      });
      return createItemNode(item);
    });
    // The rows x and y are made after the disposal
    set(items, lettered("axyd"));
    runs = 0;
    set(s, 1);
    expect(runs).toBe(0);
  });

  test("a row cleanup disposing the list as the items empty reaches no caller", () => {
    expect.assertions(1);
    const items = signal(lettered("abc"));
    const handle = list(document.createElement("div"), items, "id", (item) => {
      defer(() => {
        if (item.id === "b") dispose(handle);
      });
      return createItemNode(item);
    });
    expect(() => {
      set(items, []);
    }).not.toThrow();
  });

  test.serial("an update that disposes the list warns nothing", () => {
    expect.assertions(1);
    const items = signal(lettered("ab"));
    using warn = spyOn(console, "warn").mockImplementation(() => {});
    // Rows that own something, so the disposal changes what the list owns
    const handle = list(
      document.createElement("div"),
      items,
      "id",
      (item) => {
        defer(() => {});
        return createItemNode(item);
      },
      (node, item) => {
        updateItemNode(node, item);
        dispose(handle);
      },
    );
    set(items, [ITEMS[0], ITEMS[1]]);
    expect(warn).not.toHaveBeenCalled();
  });
});

// Components are functions returning their node, run under an owner; the router that removes a
// page disposes it ("who removes, disposes").
describe("components", () => {
  const Row = (item: Item, selected: Signal<string>): HTMLElement => {
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
    const rows = list(root, items, "id", (item) => Row(item, selected));
    mark(selected, rows, (node, on) => {
      node.className = on ? "on" : "";
    });
    defer(() => {
      log.push("page cleanup");
    });
    return root;
  };

  /**
   * Shows Page, swaps it for a text node, then changes what it showed; returns the old page and the
   * log.
   */
  const swapPages = (): [old: HTMLElement, log: string[]] => {
    const outlet = document.createElement("div");
    const items = signal(ITEMS);
    const selected = signal("a");
    const log: string[] = [];
    let page: Effect | Scope | undefined;
    const show = (make: () => Node): void => {
      if (page) dispose(page);
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

describe("list errors (create and update must not throw)", () => {
  test.serial(
    "a throwing row cleanup leaves the rows matching the items (dropped; dev logs it)",
    () => {
      expect.assertions(1);
      const parent = document.createElement("div");
      const items = signal(lettered("abc"));
      list(parent, items, "id", (item) => {
        defer(() => {
          if (item.id === "b") throw new Error("cleanup failed");
        });
        return createItemNode(item);
      });
      using _ = spyOn(console, "error").mockImplementation(() => {});
      try {
        // Caught so the rows are checked even where the error reaches the writer
        set(items, lettered("acd"));
      } catch {
        // checked below
      }
      expect(itemOrder(parent)).toEqual(["a", "c", "d"]);
    },
  );

  test("the graph stays usable after a throwing create (owner and tracking restored)", () => {
    expect.assertions(2);
    const items = signal<readonly Item[]>([]);
    list(document.createElement("div"), items, "id", () => {
      throw new Error("create failed");
    });
    expect(() => {
      set(items, ITEMS);
    }).toThrow();
    const s = signal(0);
    let runs = 0;
    const e = effect(() => {
      get(s);
      runs++;
    });
    set(s, 1);
    // Owner restored: an effect made under a leaked row owner would be its child and climb to it
    expect([runs, raw(e).p, raw(e).o]).toEqual([2, undefined, undefined]);
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
    expectTypeOf(mark<string, HTMLSpanElement>).returns.toEqualTypeOf<Effect>();
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
    const [calls, fn] = recorder();
    mark(signal("b"), rowsOf(ITEMS), fn);
    expect(calls).toEqual([["b", true]]);
  });

  test("unmarks the old row and marks the new one when the selection changes", () => {
    expect.assertions(1);
    const selected = signal("b");
    const [calls, fn] = recorder();
    mark(selected, rowsOf(ITEMS), fn);
    calls.length = 0;
    set(selected, "c");
    expect(calls).toEqual([
      ["b", false],
      ["c", true],
    ]);
  });

  test("marks nothing when no row has the selected key", () => {
    expect.assertions(1);
    const [calls, fn] = recorder();
    mark(signal("z"), rowsOf(ITEMS), fn);
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

  test("calls nothing when a batch restores the value, even with a reader made in the batch", () => {
    expect.assertions(1);
    const selected = signal("a");
    const [calls, fn] = recorder();
    mark(selected, rowsOf(ITEMS), fn);
    calls.length = 0;
    batch(() => {
      set(selected, "b");
      effect(() => {
        get(selected);
      });
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
    effect(() => {
      get(selected);
    });
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

  test("stops following the selection once disposed", () => {
    expect.assertions(1);
    const selected = signal("a");
    const [calls, fn] = recorder();
    const handle = mark(selected, rowsOf(ITEMS), fn);
    dispose(handle);
    calls.length = 0;
    set(selected, "b");
    expect(calls).toEqual([]);
  });

  test("stops marking new rows once disposed", () => {
    expect.assertions(1);
    const [, items, rows] = render(ITEMS);
    const [calls, fn] = recorder();
    dispose(mark(signal("e"), rows, fn));
    set(items, [...ITEMS, ...lettered("e")]);
    expect(calls).toEqual([]);
  });

  test("is disposed with the scope that made it, detaching from its list", () => {
    expect.assertions(1);
    const [, items, rows] = render(ITEMS);
    const selected = signal("e");
    const [calls, fn] = recorder();
    dispose(scope(() => void mark(selected, rows, fn)));
    set(items, [...ITEMS, ...lettered("e")]);
    set(selected, "a");
    expect(calls).toEqual([]);
  });

  test("keeps none of the rows a list change removed (its map and marked row)", async () => {
    expect.assertions(1);
    // The list and mark stay alive (held here); the rows are held only weakly. In a function, so
    // no frame of this test holds the rows
    const removed = (): [refs: WeakRef<Element>[], held: unknown[]] => {
      const [parent, items, rows] = render(lettered("abcdefghijklmnopqrstuvwxyz"));
      const selected = signal("a");
      const handle = mark(selected, rows, () => {});
      // More lookups than SCANS: the mark builds its key map
      for (const id of "bcdefghijklm") set(selected, id);
      const refs = Array.from(parent.children, (node) => new WeakRef(node));
      set(items, []);
      return [refs, [items, rows, selected, handle]];
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
    expect([alive < refs.length / 2, held.length]).toEqual([true, 4]);
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
    expect(seen.toSorted()).toEqual([
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

// The core's integration helpers, directly (list and mark use them; `within` is also the public
// async bridge)
describe("core integration helpers", () => {
  test("within runs fn untracked with the given owner", () => {
    expect.assertions(2);
    const s = signal(0);
    const page = scope(() => {});
    let outer = 0;
    let inner = 0;
    effect(() => {
      outer++;
      within(page, () => {
        get(s);
        effect(() => {
          get(s);
          inner++;
        });
      });
    });
    set(s, 1);
    expect([outer, inner]).toEqual([1, 2]);
    dispose(page);
    set(s, 2);
    expect(inner).toBe(2);
  });

  test("release disposes what a holder owns newer than `after`, newest first, holding the flush", () => {
    expect.assertions(3);
    const log: string[] = [];
    const s = signal(0);
    effect(() => {
      if (get(s)) log.push("effect");
    });
    const h = holder();
    const kept = within(h, effect, () => () => {
      log.push("kept");
    });
    within(h, () => {
      defer(() => {
        log.push("b");
      });
      defer(() => {
        log.push("c");
        set(s, 1);
      });
    });
    release(h, kept);
    expect([log, owns(h, kept), owns(h)]).toEqual([["c", "b", "effect"], false, true]);
    release(h);
    expect(log).toEqual(["c", "b", "effect", "kept"]);
    expect(owns(h)).toBe(false);
  });
});
