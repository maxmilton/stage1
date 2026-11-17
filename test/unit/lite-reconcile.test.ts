// stage1/lite's and stage1/ultralite's list and mark: the same module as stage1's (its behaviour,
// wired with each tier's sub, is in reconcile.test.ts), here what only the lite tiers show: what a
// lite app bundles, and stage1/ultralite's sub calling back at once outside a batch, so a write to
// the items or the selection from a create re-enters the reconcile (stage1/lite's sub queues it, as
// stage1's does). Run in both modes: `bun test` (dev checks on) and `NODE_ENV=production bun test`.
// oxlint-disable vitest/no-conditional-in-test node/no-process-env

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { batch, list, mark, set, type Signal, signal, sub } from "../../src/ultralite/index.ts";

const DEV = process.env.NODE_ENV !== "production";
/** This run's mode, as an app's build would define it. */
const NODE_ENV = process.env.NODE_ENV ?? "development";

/** Bundles `exports` of `entry`, unminified, as an app's build would in `nodeEnv`. */
const bundle = async (entry: string, exports: string, nodeEnv: string): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/lite-test-`);
  try {
    await Bun.write(
      `${dir}/entry.ts`,
      `export ${exports} from "${import.meta.dir}/../../${entry}";`,
    );
    const out = await Bun.build({
      entrypoints: [`${dir}/entry.ts`],
      target: "browser",
      define: { "process.env.NODE_ENV": JSON.stringify(nodeEnv) },
    });
    return await out.outputs[0].text();
  } finally {
    await rm(dir, { recursive: true });
  }
};

interface Item {
  readonly id: string;
}

/** A row showing its item's id. */
const span = (item: Item): HTMLSpanElement => {
  const node = document.createElement("span");
  node.textContent = item.id;
  return node;
};

describe.each([
  ["stage1/lite", "src/lite/index.ts"],
  ["stage1/ultralite", "src/ultralite/index.ts"],
])("bundle of %s", (_tier, entry) => {
  test("bundles no graph or owner code into a jfb-shaped app", async () => {
    expect.assertions(1);
    // Unminified, so calls to the full tier's functions would show (a call, not a name: paths in
    // the bundle's comments may contain them)
    const code = await bundle(entry, "{ signal, set, sub, dispose, list, mark }", NODE_ENV);
    expect(/\b(?:effect|scope|refresh|recompute|track|kill|climb)\(/u.exec(code)).toBeNull();
  });
});

describe("list on stage1/ultralite", () => {
  // The nested reconcile would duplicate rows
  test.if(DEV)(
    "dev: a create that writes the items outside a batch throws, naming stage1/ultralite",
    () => {
      expect.assertions(1);
      const items = signal<readonly Item[]>([]);
      let wrote = false;
      sub(
        items,
        list(document.createElement("div"), "id", (item: Item) => {
          if (!wrote) {
            wrote = true;
            set(items, [{ id: "z" }]);
          }
          return span(item);
        }),
      );
      let error: (Error & { cause?: Error }) | undefined;
      try {
        set(items, [{ id: "a" }, { id: "b" }]);
      } catch (error_) {
        error = error_ as Error & { cause?: Error };
      }
      expect(error?.cause?.message ?? error?.message).toBe(
        "stage1: a list's rows were called again during their reconcile: a write to its items from a list callback was delivered at once (stage1/ultralite outside a batch, or rows called outside every callback and batch)",
      );
    },
  );

  // Characterization: a batch end calls with `depth` raised, so the write waits for the reconcile
  test("a create that writes the items at a batch end leaves the rows matching them", () => {
    expect.assertions(1);
    const items = signal<readonly Item[]>([]);
    const parent = document.createElement("div");
    let wrote = false;
    sub(
      items,
      list(parent, "id", (item: Item) => {
        if (!wrote) {
          wrote = true;
          set(items, [{ id: "z" }]);
        }
        return span(item);
      }),
    );
    batch(() => {
      set(items, [{ id: "a" }, { id: "b" }]);
    });
    expect(parent.textContent).toBe("z");
  });
});

describe("mark on stage1/ultralite", () => {
  /** A list whose create of row "b" selects "a", and a mark wired to the selection. */
  const selectingList = (): { parent: HTMLElement; items: Signal<readonly Item[]> } => {
    const items = signal<readonly Item[]>([]);
    const selected = signal("");
    const parent = document.createElement("div");
    const rows = list(parent, "id", (item: Item) => {
      if (item.id === "b") set(selected, "a");
      return span(item);
    });
    sub(items, rows);
    sub(
      selected,
      mark(rows, (node, on) => {
        node.className = on ? "on" : "";
      }),
    );
    return { parent, items };
  };

  // Characterization: the show call runs inside the reconcile and finds the rows from before it
  test("a show call a create makes outside a batch marks no row the reconcile is making", () => {
    expect.assertions(1);
    const { parent, items } = selectingList();
    set(items, [{ id: "a" }, { id: "b" }]);
    expect([...parent.children].map((node) => node.className)).toEqual(["", ""]);
  });

  // Characterization: at a batch end the show call waits for the reconcile
  test("a show call a create makes at a batch end marks a row made earlier in that reconcile", () => {
    expect.assertions(1);
    const { parent, items } = selectingList();
    batch(() => {
      set(items, [{ id: "a" }, { id: "b" }]);
    });
    expect([...parent.children].map((node) => node.className)).toEqual(["on", ""]);
  });
});
