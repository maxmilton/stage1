// The lite tier's list and mark (subs only, no owners); its diff also runs reconcile.test.ts's
// "list on stage1/lite" tests. Run in both modes: `bun test` (dev checks on) and
// `NODE_ENV=production bun test`.
// Callbacks and checks inside loops branch on the data they receive.
// oxlint-disable vitest/no-conditional-in-test node/no-process-env

import { describe, expect, expectTypeOf, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { type List, list, mark } from "../../src/lite/reconcile.ts";
import { batch, dispose, set, type Signal, signal, type Sub, sub } from "../../src/lite/signal.ts";

const DEV = process.env.NODE_ENV !== "production";

/** Bundles `exports` of stage1/lite, unminified, as an app's build would. */
const bundle = async (exports: string): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/lite-test-`);
  try {
    await Bun.write(
      `${dir}/entry.ts`,
      `export ${exports} from "${import.meta.dir}/../../src/lite/index.ts";`,
    );
    const out = await Bun.build({
      entrypoints: [`${dir}/entry.ts`],
      target: "browser",
      define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development") },
    });
    return await out.outputs[0].text();
  } finally {
    await rm(dir, { recursive: true });
  }
};

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

/** A list of `items` (its handle). */
const rowsOf = (items: readonly Item[]): List<string, HTMLSpanElement> => render(items)[2];

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

/** What `fn` threw, or undefined. */
const thrownBy = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("bundle", () => {
  test("bundles no graph or owner code into a jfb-shaped app", async () => {
    expect.assertions(1);
    // Unminified, so calls to the full tier's functions would show (a call, not a name: paths in
    // the bundle's comments may contain them)
    const code = await bundle("{ signal, set, dispose, list, mark }");
    expect(
      /\b(?:within|holder|owns?|release|effect|refresh|recompute|track|kill)\(/u.exec(code),
    ).toBeNull();
  });
});

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
        create: (item: Item) => HTMLSpanElement,
        update?: ((node: HTMLSpanElement, item: Item) => void) | undefined,
      ]
    >();
    // The handle, which dispose and mark take
    expectTypeOf(list<Item, "id", HTMLSpanElement>).returns.toExtend<Sub>();
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

  test("matches the items after a seeded sequence of edits, keeping matched rows", () => {
    expect.assertions(3);
    const next = random(48_271);
    const fresh = freshItems();
    const parent = document.createElement("div");
    const items = signal<readonly Item[]>([]);
    list(parent, items, "id", createItemNode, updateItemNode);
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

  test("a disposed list stops following its items", () => {
    expect.assertions(1);
    const [parent, items, handle] = render(ITEMS);
    dispose(handle);
    set(items, lettered("x"));
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
  });

  test("disposing a list twice leaves a later list on its items following them", () => {
    expect.assertions(1);
    const [, items, handle] = render(ITEMS);
    dispose(handle);
    const parent = document.createElement("div");
    list(parent, items, "id", createItemNode);
    dispose(handle);
    set(items, lettered("x"));
    expect(itemOrder(parent)).toEqual(["x"]);
  });

  test("a second list on one items signal follows it too, and is disposed on its own", () => {
    expect.assertions(2);
    const items = signal(ITEMS);
    const [first, second] = [document.createElement("div"), document.createElement("div")];
    const one = list(first, items, "id", createItemNode);
    list(second, items, "id", createItemNode);
    dispose(one);
    set(items, lettered("xy"));
    expect(itemOrder(first)).toEqual(["a", "b", "c", "d"]);
    expect(itemOrder(second)).toEqual(["x", "y"]);
  });

  test("a batch reconciles once, at its end, with the last items", () => {
    expect.assertions(1);
    const [parent, items] = render(ITEMS);
    const inside: string[][] = [];
    batch(() => {
      set(items, lettered("x"));
      set(items, lettered("y"));
      inside.push([...itemOrder(parent)]);
    });
    expect([inside, itemOrder(parent)]).toEqual([[["a", "b", "c", "d"]], ["y"]]);
  });

  test("items restored before a batch end reconcile nothing", () => {
    expect.assertions(1);
    const items = signal(ITEMS);
    let made = 0;
    list(document.createElement("div"), items, "id", (item: Item) => {
      made++;
      return createItemNode(item);
    });
    batch(() => {
      set(items, lettered("q"));
      set(items, ITEMS);
    });
    expect(made).toBe(4);
  });

  test.if(DEV)("dev: writing the items from create throws, naming stage1/lite", () => {
    expect.assertions(1);
    const items = signal<readonly Item[]>([]);
    let wrote = false;
    list(document.createElement("div"), items, "id", (item: Item) => {
      if (!wrote) {
        wrote = true;
        set(items, lettered("zz"));
      }
      return createItemNode(item);
    });
    const error = thrownBy(() => {
      set(items, ITEMS);
    }) as Error & { cause?: Error };
    expect(error.cause?.message ?? error.message).toContain("stage1/lite");
  });
});

describe("mark", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(mark).not.toBeAny();
    expectTypeOf(mark).toBeFunction();
    expectTypeOf(mark<string, HTMLSpanElement>).returns.toEqualTypeOf<Sub>();
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

  test("marks a row the first build creates while its key is selected", () => {
    expect.assertions(1);
    const items = signal<readonly Item[]>([]);
    const rows = list(document.createElement("div"), items, "id", createItemNode);
    const [calls, fn] = recorder();
    mark(signal("b"), rows, fn);
    set(items, ITEMS);
    expect(calls).toEqual([["b", true]]);
  });

  test("marks a row created while its key is selected", () => {
    expect.assertions(1);
    const [, items, rows] = render(ITEMS);
    const [calls, fn] = recorder();
    mark(signal("e"), rows, fn);
    set(items, [...ITEMS, ...lettered("e")]);
    expect(calls).toEqual([["e", true]]);
  });

  // A list's handle is its items' first sub (the signal itself) or a later node: mark reaches both
  test("marks a row of a list whose items signal already had a sub", () => {
    expect.assertions(1);
    const items = signal(ITEMS);
    sub(items, () => {});
    const [calls, fn] = recorder();
    mark(signal("c"), list(document.createElement("div"), items, "id", createItemNode), fn);
    expect(calls).toEqual([["c", true]]);
  });

  test("calls nothing for rows created with unselected keys", () => {
    expect.assertions(1);
    const [, items, rows] = render(ITEMS);
    const [calls, fn] = recorder();
    mark(signal("z"), rows, fn);
    set(items, [...ITEMS, ...lettered("xy")]);
    expect(calls).toEqual([]);
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

  test("marks the right row after many selections, an update that keeps every row, and a reorder", () => {
    expect.assertions(2);
    const [parent, items, rows] = render(lettered("abcdefghijklmnop"));
    const selected = signal("a");
    const [, fn] = recorder();
    mark(selected, rows, fn);
    for (const id of "bcdefghijklm") set(selected, id);
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

  test("a disposed mark stops following the selection", () => {
    expect.assertions(1);
    const selected = signal("a");
    const [calls, fn] = recorder();
    const handle = mark(selected, rowsOf(ITEMS), fn);
    dispose(handle);
    calls.length = 0;
    set(selected, "b");
    expect(calls).toEqual([]);
  });

  test("disposing a mark twice leaves a later mark on its selection following it", () => {
    expect.assertions(1);
    const selected = signal("a");
    const handle = mark(selected, rowsOf(ITEMS), () => {});
    dispose(handle);
    const [calls, fn] = recorder();
    mark(selected, rowsOf(ITEMS), fn);
    dispose(handle);
    set(selected, "b");
    expect(calls).toEqual([
      ["a", true],
      ["a", false],
      ["b", true],
    ]);
  });

  // A disposed mark stays attached to its list (documented; checking that its sub is live would
  // cost bytes), so a row created later with the key it showed last is still marked. Its sub is
  // the selection's first sub (the handle is the signal) or a later node: both
  test.each([
    ["the selection's only sub", false],
    ["a later sub of the selection", true],
  ])(
    "Accepted tradeoff: a disposed mark still marks rows the list creates later with its last key (%s)",
    (_, shared) => {
      expect.assertions(1);
      const [, items, rows] = render([]);
      const selected = signal("b");
      if (shared) sub(selected, () => {});
      const [calls, fn] = recorder();
      dispose(mark(selected, rows, fn));
      set(items, ITEMS);
      expect(calls).toEqual([["b", true]]);
    },
  );

  test("a live mark next to a disposed one on the same selection still marks new rows", () => {
    expect.assertions(1);
    const [, items, rows] = render([]);
    const selected = signal("b");
    const [old, oldFn] = recorder();
    dispose(mark(selected, rowsOf([]), oldFn));
    const [calls, fn] = recorder();
    mark(selected, rows, fn);
    set(items, ITEMS);
    expect([old, calls]).toEqual([[], [["b", true]]]);
  });

  // During the mark's first call its handle does not exist yet
  test("marks a row its list makes while the mark's first call runs", () => {
    expect.assertions(1);
    const [parent, items, rows] = render(ITEMS);
    let once = true;
    mark(signal("b"), rows, (node: HTMLElement, on) => {
      node.className = on ? "on" : "";
      if (once) {
        once = false;
        // A new row for "b": cleared, then made again
        set(items, []);
        set(items, lettered("ab"));
      }
    });
    expect(markedIds(parent.children)).toEqual(["b"]);
  });

  test("keeps none of the rows a list change removed (its map and marked row)", async () => {
    expect.assertions(1);
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
    let alive = refs.length;
    for (let turn = 0; turn < 10 && alive >= refs.length / 2; turn++) {
      // oxlint-disable-next-line no-await-in-loop -- each turn ends before the next collection
      await Bun.sleep(0);
      Bun.gc(true);
      alive = refs.filter((ref) => ref.deref() !== undefined).length;
    }
    expect([alive < refs.length / 2, held.length]).toEqual([true, 4]);
  });

  test("marks a map's elements as the selection moves", () => {
    expect.assertions(1);
    const nodes = new Map(["a", "b", "c"].map((id) => [id, createItemNode({ id, label: id })]));
    document.createElement("div").append(...nodes.values());
    const selected = signal("b");
    const [calls, fn] = recorder();
    mark(selected, nodes, fn);
    set(selected, "c");
    expect(calls).toEqual([
      ["b", true],
      ["b", false],
      ["c", true],
    ]);
  });
});
