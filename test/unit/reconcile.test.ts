/* eslint-disable no-param-reassign */

import { describe, expect, expectTypeOf, spyOn, test } from "bun:test";
import { reconcile as reconcileKeyed } from "../../src/reconcile/keyed.ts";
import { reconcile as reconcileNonKeyed } from "../../src/reconcile/non-keyed.ts";
import { reconcile as reconcileReuseNodes } from "../../src/reconcile/reuse-nodes.ts";

interface Item {
  id: string;
  label: string;
}

const ITEMS: Item[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
  { id: "d", label: "D" },
];
const REORDERED_ITEMS: Item[] = [
  { id: "d", label: "Delta" },
  { id: "b", label: "Beta" },
  { id: "e", label: "Epsilon" },
  { id: "a", label: "Alpha" },
];
const REPLACEMENT_ITEMS: Item[] = [
  { id: "x", label: "X" },
  { id: "y", label: "Y" },
];
/**
 * A shuffle the prefix/suffix/swap fast paths cannot consume, so reconciling
 * SHUFFLE_FROM to SHUFFLE_TO reaches the general path with every node reusable
 * (`P` has no `-1` entries) — the only input which actually runs the longest
 * increasing subsequence algorithm.
 *
 * The LIS only decides HOW MANY nodes move, never the resulting order, so the
 * tests below assert the move count. A correct LIS keeps the longest increasing
 * run in place and moves just 2 nodes; a broken one renders the same order with
 * more DOM operations, which order assertions alone cannot detect.
 */
const SHUFFLE_FROM_IDS = ["a", "b", "c", "d", "e", "f"];
const SHUFFLE_TO_IDS = ["c", "a", "b", "f", "d", "e"];
const SHUFFLE_FROM: Item[] = SHUFFLE_FROM_IDS.map((id) => ({ id, label: id.toUpperCase() }));
const SHUFFLE_TO: Item[] = SHUFFLE_TO_IDS.map((id) => ({ id, label: id.toUpperCase() }));
const IDS = ["a", "b", "c", "d"];
const REORDERED_IDS = ["d", "b", "e", "a"];

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

const createStringItemNode = (id: string): HTMLSpanElement => createItemNode({ id, label: id });
const updateStringItemNode = (node: HTMLSpanElement, id: string): void => {
  updateItemNode(node, { id, label: id });
};

const itemOrder = (parent: Element): string[] =>
  [...parent.children].map((node) => (node as HTMLElement).dataset["id"] ?? "");

/** Create a parent element with boundary nodes the reconcilers must not touch. */
const createBoundedParent = (): [
  parent: HTMLDivElement,
  before: HTMLElement,
  after: HTMLElement,
] => {
  const parent = document.createElement("div");
  const before = document.createElement("i");
  const after = document.createElement("i");
  parent.append(before, after);
  return [parent, before, after];
};

describe("keyed", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(reconcileKeyed).not.toBeAny();
    expectTypeOf(reconcileKeyed).toBeFunction();
    // Characterization of the tooling, not a defect in `src/` (SPEC.md R18):
    // erasure resolves the unconstrained `T` to `unknown` ∴ `keyof T` -> `never`
    // and the return -> `any`. Pinned positively so this reds if bun fixes it.
    expectTypeOf(reconcileKeyed).parameters.toEqualTypeOf<
      [
        key: never,
        parent: Element,
        renderedData: unknown[],
        data: unknown[],
        createFn: (itemData: unknown) => Node,
        updateFn?: ((node: Node, itemData: unknown) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    expectTypeOf(reconcileKeyed).returns.toBeAny();
    expectTypeOf<Parameters<typeof reconcileKeyed<Item, HTMLSpanElement>>>().toEqualTypeOf<
      [
        key: keyof Item,
        parent: Element,
        renderedData: Item[],
        data: Item[],
        createFn: (itemData: Item) => HTMLSpanElement,
        updateFn?: ((node: HTMLSpanElement, itemData: Item) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    expectTypeOf<ReturnType<typeof reconcileKeyed<Item, HTMLSpanElement>>>().toBeVoid();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(reconcileKeyed).toBeFunction();
    expect(reconcileKeyed).not.toBeClass();
  });

  test("expects 8 parameters (3 optional)", () => {
    expect.assertions(1);
    expect(reconcileKeyed).toHaveParameters(5, 3);
  });

  test("returns undefined", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const create = () => document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(reconcileKeyed("id", parent, [], [], create)).toBeUndefined();
  });

  test("creates nodes for initial data", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
    expect(parent.textContent).toBe("ABCD");
  });

  test("reorders existing nodes", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode);
    reconcileKeyed("id", parent, ITEMS, REORDERED_ITEMS, createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["d", "b", "e", "a"]);
  });

  test("reuses and updates nodes with matching keys", () => {
    expect.assertions(4);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileKeyed("id", parent, ITEMS, REORDERED_ITEMS, createItemNode, updateItemNode);
    const [firstNode, secondNode, , fourthNode] = [...parent.children];
    expect(firstNode).toBe(nodes[3]);
    expect(secondNode).toBe(nodes[1]);
    expect(fourthNode).toBe(nodes[0]);
    expect(parent.textContent).toBe("DeltaBetaEpsilonAlpha");
  });

  test("creates nodes for keys not previously rendered", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileKeyed("id", parent, ITEMS, REORDERED_ITEMS, createItemNode, updateItemNode);
    const thirdNode = [...parent.children][2];
    expect(nodes).not.toContain(thirdNode);
    expect(thirdNode.textContent).toBe("Epsilon");
  });

  test("removes nodes for keys absent from new data", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileKeyed("id", parent, ITEMS, REORDERED_ITEMS, createItemNode, updateItemNode);
    expect(nodes[2].parentNode).toBeNull(); // "c"
    expect(itemOrder(parent)).not.toContain("c");
  });

  test("clears all nodes when data is empty", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileKeyed("id", parent, ITEMS, [], createItemNode, updateItemNode);
    expect(parent.childNodes).toHaveLength(0);
    expect(nodes[0].parentNode).toBeNull();
    expect(nodes[3].parentNode).toBeNull();
  });

  test("reorders with the fewest moves when the fast paths cannot match", () => {
    expect.assertions(4);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], SHUFFLE_FROM, createItemNode, updateItemNode);
    const nodes = new Set(parent.children);
    using insertBeforeSpy = spyOn(parent, "insertBefore");
    reconcileKeyed("id", parent, SHUFFLE_FROM, SHUFFLE_TO, createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(SHUFFLE_TO_IDS);
    expect(parent.textContent).toBe("CABFDE");
    expect([...parent.children].every((node) => nodes.has(node))).toBeTrue();
    expect(insertBeforeSpy).toHaveBeenCalledTimes(2);
  });

  test("removes trailing nodes when data shrinks", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileKeyed("id", parent, ITEMS, ITEMS.slice(0, 2), createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["a", "b"]);
    expect(nodes[2].parentNode).toBeNull();
    expect(nodes[3].parentNode).toBeNull();
  });

  // NOTE: Removing from the front makes the suffix-skip fast path consume the
  // trailing match first, so the shrink loop ends with `prevEnd === 0`.
  test("removes the leading node when data shrinks from the front", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    const first = ITEMS.slice(0, 2);
    reconcileKeyed("id", parent, [], first, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileKeyed("id", parent, first, ITEMS.slice(1, 2), createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["b"]);
    expect(nodes[0].parentNode).toBeNull();
    expect(parent.firstElementChild).toBe(nodes[1]);
  });

  test("reuses the trailing nodes when only the first item changes", () => {
    expect.assertions(4);
    const parent = document.createElement("div");
    const first = ITEMS.slice(0, 3);
    reconcileKeyed("id", parent, [], first, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    const next = [{ id: "x", label: "X" }, ...first.slice(1)];
    reconcileKeyed("id", parent, first, next, createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["x", "b", "c"]);
    const [, secondNode, thirdNode] = [...parent.children];
    expect(secondNode).toBe(nodes[1]);
    expect(thirdNode).toBe(nodes[2]);
    expect(nodes[0].parentNode).toBeNull();
  });

  test("appends nodes when data grows", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS.slice(0, 2), createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileKeyed("id", parent, ITEMS.slice(0, 2), ITEMS, createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
    expect(parent.firstElementChild).toBe(nodes[0]);
    expect(parent.textContent).toBe("ABCD");
  });

  test("replaces every node when no keys match", () => {
    expect.assertions(4);
    const parent = document.createElement("div");
    reconcileKeyed("id", parent, [], ITEMS.slice(0, 2), createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileKeyed(
      "id",
      parent,
      ITEMS.slice(0, 2),
      REPLACEMENT_ITEMS,
      createItemNode,
      updateItemNode,
    );
    expect(itemOrder(parent)).toEqual(["x", "y"]);
    expect(nodes[0].parentNode).toBeNull();
    expect(nodes[1].parentNode).toBeNull();
    expect(parent.textContent).toBe("XY");
  });

  test("replaces every node between boundary nodes when no keys match", () => {
    expect.assertions(4);
    const [parent, before, after] = createBoundedParent();
    const first = ITEMS.slice(0, 2);
    reconcileKeyed("id", parent, [], first, createItemNode, updateItemNode, before, after);
    const nodes = [...parent.children].slice(1, -1);
    reconcileKeyed(
      "id",
      parent,
      first,
      REPLACEMENT_ITEMS,
      createItemNode,
      updateItemNode,
      before,
      after,
    );
    expect(parent.firstChild).toBe(before);
    expect(parent.lastChild).toBe(after);
    expect(parent.textContent).toBe("XY");
    expect(nodes[0].parentNode).toBeNull();
  });

  test("creates nodes between boundary nodes", () => {
    expect.assertions(3);
    const [parent, before, after] = createBoundedParent();
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode, before, after);
    expect(parent.firstChild).toBe(before);
    expect(parent.lastChild).toBe(after);
    expect(parent.textContent).toBe("ABCD");
  });

  test("clears only nodes between boundary nodes", () => {
    expect.assertions(3);
    const [parent, before, after] = createBoundedParent();
    reconcileKeyed("id", parent, [], ITEMS, createItemNode, updateItemNode, before, after);
    reconcileKeyed("id", parent, ITEMS, [], createItemNode, updateItemNode, before, after);
    expect([...parent.children]).toEqual([before, after]);
    expect(before.parentNode).toBe(parent);
    expect(after.parentNode).toBe(parent);
  });
});

describe("non-keyed", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(reconcileNonKeyed).not.toBeAny();
    expectTypeOf(reconcileNonKeyed).toBeFunction();
    expectTypeOf(reconcileNonKeyed).parameters.toEqualTypeOf<
      [
        parent: Element,
        renderedData: unknown[],
        data: unknown[],
        createFn: (itemData: unknown) => Node,
        updateFn?: ((node: Node, itemData: unknown) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    expectTypeOf(reconcileNonKeyed).returns.not.toBeAny();
    expectTypeOf(reconcileNonKeyed).returns.toBeVoid();
    // Erased above; instantiated to pin item and node types flowing through together.
    expectTypeOf<Parameters<typeof reconcileNonKeyed<Item, HTMLSpanElement>>>().toEqualTypeOf<
      [
        parent: Element,
        renderedData: Item[],
        data: Item[],
        createFn: (itemData: Item) => HTMLSpanElement,
        updateFn?: ((node: HTMLSpanElement, itemData: Item) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    expectTypeOf<ReturnType<typeof reconcileNonKeyed<Item, HTMLSpanElement>>>().toBeVoid();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(reconcileNonKeyed).toBeFunction();
    expect(reconcileNonKeyed).not.toBeClass();
  });

  test("expects 7 parameters (3 optional)", () => {
    expect.assertions(1);
    expect(reconcileNonKeyed).toHaveParameters(4, 3);
  });

  test("returns undefined", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const create = () => document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(reconcileNonKeyed(parent, [], [], create)).toBeUndefined();
  });

  test("creates nodes for initial data", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], IDS, createStringItemNode, updateStringItemNode);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
    expect(parent.textContent).toBe("abcd");
  });

  test("reorders existing nodes", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], IDS, createStringItemNode, updateStringItemNode);
    reconcileNonKeyed(parent, IDS, REORDERED_IDS, createStringItemNode, updateStringItemNode);
    expect(itemOrder(parent)).toEqual(["d", "b", "e", "a"]);
  });

  test("reuses nodes for equal data", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], IDS, createStringItemNode, updateStringItemNode);
    const nodes = [...parent.children];
    reconcileNonKeyed(parent, IDS, REORDERED_IDS, createStringItemNode, updateStringItemNode);
    const [firstNode, secondNode, , fourthNode] = [...parent.children];
    expect(firstNode).toBe(nodes[3]);
    expect(secondNode).toBe(nodes[1]);
    expect(fourthNode).toBe(nodes[0]);
  });

  test("removes nodes for data absent from new data", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], IDS, createStringItemNode, updateStringItemNode);
    const nodes = [...parent.children];
    reconcileNonKeyed(parent, IDS, REORDERED_IDS, createStringItemNode, updateStringItemNode);
    expect(nodes[2].parentNode).toBeNull(); // "c"
    expect(itemOrder(parent)).not.toContain("c");
  });

  test("removes surplus nodes when data shrinks", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], IDS, createStringItemNode, updateStringItemNode);
    const nodes = [...parent.children];
    reconcileNonKeyed(parent, IDS, ["a", "b"], createStringItemNode, updateStringItemNode);
    expect(itemOrder(parent)).toEqual(["a", "b"]);
    const [firstNode, secondNode] = [...parent.children];
    expect(firstNode).toBe(nodes[0]);
    expect(secondNode).toBe(nodes[1]);
  });

  test("reorders with the fewest moves when the fast paths cannot match", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], SHUFFLE_FROM_IDS, createStringItemNode, updateStringItemNode);
    const nodes = new Set(parent.children);
    using insertBeforeSpy = spyOn(parent, "insertBefore");
    reconcileNonKeyed(
      parent,
      SHUFFLE_FROM_IDS,
      SHUFFLE_TO_IDS,
      createStringItemNode,
      updateStringItemNode,
    );
    expect(itemOrder(parent)).toEqual(SHUFFLE_TO_IDS);
    expect([...parent.children].every((node) => nodes.has(node))).toBeTrue();
    expect(insertBeforeSpy).toHaveBeenCalledTimes(2);
  });

  test("reuses the trailing nodes when only the first item changes", () => {
    expect.assertions(4);
    const parent = document.createElement("div");
    const first = ["a", "b", "c"];
    reconcileNonKeyed(parent, [], first, createStringItemNode, updateStringItemNode);
    const nodes = [...parent.children];
    reconcileNonKeyed(parent, first, ["x", "b", "c"], createStringItemNode, updateStringItemNode);
    expect(itemOrder(parent)).toEqual(["x", "b", "c"]);
    const [, secondNode, thirdNode] = [...parent.children];
    expect(secondNode).toBe(nodes[1]);
    expect(thirdNode).toBe(nodes[2]);
    expect(nodes[0].parentNode).toBeNull();
  });

  test("appends nodes when data grows", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], ["a", "b"], createStringItemNode, updateStringItemNode);
    const nodes = [...parent.children];
    reconcileNonKeyed(parent, ["a", "b"], IDS, createStringItemNode, updateStringItemNode);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
    expect(parent.firstElementChild).toBe(nodes[0]);
  });

  test("replaces every node when no data matches", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], ["a", "b"], createStringItemNode, updateStringItemNode);
    const nodes = [...parent.children];
    reconcileNonKeyed(parent, ["a", "b"], ["x", "y"], createStringItemNode, updateStringItemNode);
    expect(itemOrder(parent)).toEqual(["x", "y"]);
    expect(nodes[0].parentNode).toBeNull();
    expect(nodes[1].parentNode).toBeNull();
  });

  // NOTE: Removing from the front makes the suffix-skip fast path consume the
  // trailing match first, so the shrink loop ends with `prevEnd === 0`.
  test("removes the leading node when data shrinks from the front", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileNonKeyed(parent, [], ["a", "b"], createStringItemNode, updateStringItemNode);
    const nodes = [...parent.children];
    reconcileNonKeyed(parent, ["a", "b"], ["b"], createStringItemNode, updateStringItemNode);
    expect(itemOrder(parent)).toEqual(["b"]);
    expect(nodes[0].parentNode).toBeNull();
    expect(parent.firstElementChild).toBe(nodes[1]);
  });

  test("appends nodes between boundary nodes when data grows", () => {
    expect.assertions(3);
    const [parent, before, after] = createBoundedParent();
    reconcileNonKeyed(parent, [], ["a", "b"], createStringItemNode, undefined, before, after);
    reconcileNonKeyed(
      parent,
      ["a", "b"],
      IDS,
      createStringItemNode,
      updateStringItemNode,
      before,
      after,
    );
    expect(parent.firstChild).toBe(before);
    expect(parent.lastChild).toBe(after);
    expect(parent.textContent).toBe("abcd");
  });

  test("replaces every node between boundary nodes when no data matches", () => {
    expect.assertions(4);
    const [parent, before, after] = createBoundedParent();
    reconcileNonKeyed(parent, [], ["a", "b"], createStringItemNode, undefined, before, after);
    const nodes = [...parent.children].slice(1, -1);
    reconcileNonKeyed(
      parent,
      ["a", "b"],
      ["x", "y"],
      createStringItemNode,
      updateStringItemNode,
      before,
      after,
    );
    expect(parent.firstChild).toBe(before);
    expect(parent.lastChild).toBe(after);
    expect(parent.textContent).toBe("xy");
    expect(nodes[0].parentNode).toBeNull();
  });

  test("creates nodes between boundary nodes", () => {
    expect.assertions(3);
    const [parent, before, after] = createBoundedParent();
    reconcileNonKeyed(parent, [], IDS, createStringItemNode, undefined, before, after);
    expect(parent.firstChild).toBe(before);
    expect(parent.lastChild).toBe(after);
    expect(parent.textContent).toBe("abcd");
  });

  test("clears only nodes between boundary nodes", () => {
    expect.assertions(3);
    const [parent, before, after] = createBoundedParent();
    reconcileNonKeyed(parent, [], IDS, createStringItemNode, undefined, before, after);
    reconcileNonKeyed(parent, IDS, [], createStringItemNode, undefined, before, after);
    expect([...parent.children]).toEqual([before, after]);
    expect(before.parentNode).toBe(parent);
    expect(after.parentNode).toBe(parent);
  });
});

describe("reuse-nodes", () => {
  test("types", () => {
    expect.assertions(0);
    expectTypeOf(reconcileReuseNodes).not.toBeAny();
    expectTypeOf(reconcileReuseNodes).toBeFunction();
    expectTypeOf(reconcileReuseNodes).parameters.toEqualTypeOf<
      [
        parent: Element,
        renderedData: unknown[],
        data: unknown[],
        createFn: (itemData: unknown) => Node,
        updateFn?: ((node: Node, itemData: unknown) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    expectTypeOf(reconcileReuseNodes).returns.not.toBeAny();
    expectTypeOf(reconcileReuseNodes).returns.toBeVoid();
    // Erased above; instantiated to pin item and node types flowing through together.
    expectTypeOf<Parameters<typeof reconcileReuseNodes<Item, HTMLSpanElement>>>().toEqualTypeOf<
      [
        parent: Element,
        renderedData: Item[],
        data: Item[],
        createFn: (itemData: Item) => HTMLSpanElement,
        updateFn?: ((node: HTMLSpanElement, itemData: Item) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    expectTypeOf<ReturnType<typeof reconcileReuseNodes<Item, HTMLSpanElement>>>().toBeVoid();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(reconcileReuseNodes).toBeFunction();
    expect(reconcileReuseNodes).not.toBeClass();
  });

  test("expects 7 parameters (3 optional)", () => {
    expect.assertions(1);
    expect(reconcileReuseNodes).toHaveParameters(4, 3);
  });

  test("returns undefined", () => {
    expect.assertions(1);
    const parent = document.createElement("div");
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const create = () => document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(reconcileReuseNodes(parent, [], [], create)).toBeUndefined();
  });

  test("creates nodes for initial data", () => {
    expect.assertions(2);
    const parent = document.createElement("div");
    reconcileReuseNodes(parent, [], ITEMS, createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["a", "b", "c", "d"]);
    expect(parent.textContent).toBe("ABCD");
  });

  test("updates existing nodes in place by position", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileReuseNodes(parent, [], ITEMS, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileReuseNodes(parent, ITEMS, REPLACEMENT_ITEMS, createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["x", "y"]);
    const [firstNode, secondNode] = [...parent.children];
    expect(firstNode).toBe(nodes[0]);
    expect(secondNode).toBe(nodes[1]);
  });

  test("removes surplus nodes", () => {
    expect.assertions(3);
    const parent = document.createElement("div");
    reconcileReuseNodes(parent, [], ITEMS, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    reconcileReuseNodes(parent, ITEMS, REPLACEMENT_ITEMS, createItemNode, updateItemNode);
    expect(parent.children).toHaveLength(2);
    expect(nodes[2].parentNode).toBeNull();
    expect(nodes[3].parentNode).toBeNull();
  });

  test("appends nodes for added data", () => {
    expect.assertions(4);
    const parent = document.createElement("div");
    reconcileReuseNodes(parent, [], REPLACEMENT_ITEMS, createItemNode, updateItemNode);
    const nodes = [...parent.children];
    const expanded = [...REPLACEMENT_ITEMS, { id: "z", label: "Z" }];
    reconcileReuseNodes(parent, REPLACEMENT_ITEMS, expanded, createItemNode, updateItemNode);
    expect(itemOrder(parent)).toEqual(["x", "y", "z"]);
    const [firstNode, secondNode, thirdNode] = [...parent.children];
    expect(firstNode).toBe(nodes[0]);
    expect(secondNode).toBe(nodes[1]);
    expect(thirdNode.textContent).toBe("Z");
  });

  test("creates nodes between boundary nodes", () => {
    expect.assertions(3);
    const [parent, before, after] = createBoundedParent();
    reconcileReuseNodes(parent, [], ITEMS, createItemNode, updateItemNode, before, after);
    expect(parent.firstChild).toBe(before);
    expect(parent.lastChild).toBe(after);
    expect(parent.textContent).toBe("ABCD");
  });

  test("clears only nodes between boundary nodes", () => {
    expect.assertions(3);
    const [parent, before, after] = createBoundedParent();
    reconcileReuseNodes(parent, [], ITEMS, createItemNode, updateItemNode, before, after);
    reconcileReuseNodes(parent, ITEMS, [], createItemNode, updateItemNode, before, after);
    expect([...parent.children]).toEqual([before, after]);
    expect(before.parentNode).toBe(parent);
    expect(after.parentNode).toBe(parent);
  });
});
