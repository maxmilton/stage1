/* eslint-disable no-param-reassign */

import { describe, expect, expectTypeOf, test } from "bun:test";
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
const IDS = ["a", "b", "c", "d"];
const REORDERED_IDS = ["d", "b", "e", "a"];

const createItemNode = (item: Item): HTMLSpanElement => {
  const node = document.createElement("span");
  node.dataset.id = item.id;
  node.textContent = item.label;
  return node;
};

const updateItemNode = (node: HTMLSpanElement, item: Item): void => {
  node.dataset.id = item.id;
  node.textContent = item.label;
};

const createStringItemNode = (id: string): HTMLSpanElement => createItemNode({ id, label: id });
const updateStringItemNode = (node: HTMLSpanElement, id: string): void => {
  updateItemNode(node, { id, label: id });
};

const itemOrder = (parent: Element): string[] =>
  [...parent.children].map((node) => (node as HTMLElement).dataset.id ?? "");

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
    expectTypeOf(reconcileKeyed).not.toBeAny();
    expectTypeOf(reconcileKeyed).toBeFunction();
    expectTypeOf(reconcileKeyed).parameters.toEqualTypeOf<
      [
        key: never, // TODO: Fix inferred key type.
        // key: string | number | symbol,
        parent: Element,
        renderedData: unknown[],
        data: unknown[],
        createFn: (itemData: unknown) => Node,
        updateFn?: ((node: Node, itemData: unknown) => void) | undefined,
        beforeNode?: Node | undefined,
        afterNode?: Node | null | undefined,
      ]
    >();
    // @ts-expect-error - TODO: Fix inferred return type.
    expectTypeOf(reconcileKeyed).returns.not.toBeAny();
    // @ts-expect-error - TODO: Fix inferred return type.
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    expectTypeOf(reconcileKeyed).returns.toEqualTypeOf<void>();
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
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    expectTypeOf(reconcileNonKeyed).returns.toEqualTypeOf<void>();
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
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    expectTypeOf(reconcileReuseNodes).returns.toEqualTypeOf<void>();
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
