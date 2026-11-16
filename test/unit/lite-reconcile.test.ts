// stage1/lite's list and mark: the same module as stage1's (its behaviour, wired with each tier's
// sub, is in reconcile.test.ts), here what only the lite tier shows: what a lite app bundles, and
// lite's sub calling the rows function again during its reconcile. Run in both modes: `bun test`
// (dev checks on) and `NODE_ENV=production bun test`.
// oxlint-disable node/no-process-env

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { list, set, signal, sub } from "../../src/lite/index.ts";

const DEV = process.env.NODE_ENV !== "production";
/** This run's mode, as an app's build would define it. */
const NODE_ENV = process.env.NODE_ENV ?? "development";

/** Bundles `exports` of stage1/lite, unminified, as an app's build would in `nodeEnv`. */
const bundle = async (exports: string, nodeEnv: string): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/lite-test-`);
  try {
    await Bun.write(
      `${dir}/entry.ts`,
      `export ${exports} from "${import.meta.dir}/../../src/lite/index.ts";`,
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

describe("bundle", () => {
  test("bundles no graph or owner code into a jfb-shaped app", async () => {
    expect.assertions(1);
    // Unminified, so calls to the full tier's functions would show (a call, not a name: paths in
    // the bundle's comments may contain them)
    const code = await bundle("{ signal, set, sub, dispose, list, mark }", NODE_ENV);
    expect(/\b(?:effect|scope|refresh|recompute|track|kill|climb)\(/u.exec(code)).toBeNull();
  });

  test("a production app carries none of the dev row check", async () => {
    expect.assertions(1);
    const code = await bundle("{ signal, set, sub, dispose, list, mark }", "production");
    expect([code.includes("stage1.row"), code.includes("Symbol.for")]).toEqual([false, false]);
  });
});

describe("list", () => {
  // stage1/lite's sub calls back at once: the nested reconcile would duplicate rows
  test.if(DEV)("dev: a create that writes the items throws, naming stage1/lite", () => {
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
        const node = document.createElement("span");
        node.textContent = item.id;
        return node;
      }),
    );
    let error: (Error & { cause?: Error }) | undefined;
    try {
      set(items, [{ id: "a" }, { id: "b" }]);
    } catch (error_) {
      error = error_ as Error & { cause?: Error };
    }
    expect(error?.cause?.message ?? error?.message).toContain("stage1/lite");
  });
});
