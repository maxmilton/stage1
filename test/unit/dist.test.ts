import { describe, expect, test } from "bun:test";
import pkg from "../../package.json" with { type: "json" };

// Run `bun run build` before tests that read dist/.
describe("dist files", () => {
  // TODO: Remove the MIME type checks? Bun infers them from the file extension, not the data.
  // Unknown types (e.g. symlinks, which Bun.file() doesn't follow) report application/octet-stream.

  const distFiles: [filename: string, type: string, minBytes?: number, maxBytes?: number][] = [
    ["legacy/reconcile/keyed.d.ts", "text/javascript;charset=utf-8"],
    ["legacy/reconcile/keyed.d.ts.map", "application/json;charset=utf-8"],
    ["legacy/reconcile/keyed.js", "text/javascript;charset=utf-8", 2000, 3500],
    ["legacy/reconcile/keyed.js.map", "application/json;charset=utf-8"],
    ["legacy/reconcile/non-keyed.d.ts", "text/javascript;charset=utf-8"],
    ["legacy/reconcile/non-keyed.d.ts.map", "application/json;charset=utf-8"],
    ["legacy/reconcile/non-keyed.js", "text/javascript;charset=utf-8", 2000, 3500],
    ["legacy/reconcile/non-keyed.js.map", "application/json;charset=utf-8"],
    ["legacy/reconcile/reuse-nodes.d.ts", "text/javascript;charset=utf-8"],
    ["legacy/reconcile/reuse-nodes.d.ts.map", "application/json;charset=utf-8"],
    ["legacy/reconcile/reuse-nodes.js", "text/javascript;charset=utf-8", 500, 1000],
    ["legacy/reconcile/reuse-nodes.js.map", "application/json;charset=utf-8"],
    ["legacy/reconcile/reuse-lite.d.ts", "text/javascript;charset=utf-8"],
    ["legacy/reconcile/reuse-lite.d.ts.map", "application/json;charset=utf-8"],
    ["legacy/reconcile/reuse-lite.js", "text/javascript;charset=utf-8", 250, 400],
    ["legacy/reconcile/reuse-lite.js.map", "application/json;charset=utf-8"],
    ["browser.d.ts", "text/javascript;charset=utf-8"],
    ["browser.d.ts.map", "application/json;charset=utf-8"],
    ["browser.js", "text/javascript;charset=utf-8", 1000, 1500],
    ["browser.js.map", "application/json;charset=utf-8"],
    ["browser.mjs", "text/javascript;charset=utf-8", 1000, 1500],
    ["browser.mjs.map", "application/json;charset=utf-8"],
    ["legacy/index.d.ts", "text/javascript;charset=utf-8"],
    ["legacy/index.d.ts.map", "application/json;charset=utf-8"],
    ["legacy/index.js", "text/javascript;charset=utf-8", 1000, 1500],
    ["legacy/index.js.map", "application/json;charset=utf-8"],
    ["macro.d.ts", "text/javascript;charset=utf-8"],
    ["macro.d.ts.map", "application/json;charset=utf-8"],
    // Looser ceiling: macro.js runs in Bun at build time and never ships to a browser.
    ["macro.js", "text/javascript;charset=utf-8", 1000, 2000],
    ["macro.js.map", "application/json;charset=utf-8"],
    ["types.d.ts", "text/javascript;charset=utf-8"],
    ["types.d.ts.map", "application/json;charset=utf-8"],
  ];

  describe.each(distFiles)("%s", (filename, type, minBytes, maxBytes) => {
    const file = Bun.file(`dist/${filename}`);

    test("exists with content", () => {
      expect.assertions(2);
      expect(file.exists()).resolves.toBeTrue();
      expect(file.size).toBeGreaterThan(0);
    });

    test("has the expected MIME type", () => {
      expect.assertions(1);
      expect(file.type).toBe(type);
    });

    if (typeof minBytes === "number" && typeof maxBytes === "number") {
      test("is within expected file size limits", () => {
        expect.assertions(2);
        expect(file.size).toBeGreaterThan(minBytes);
        expect(file.size).toBeLessThan(maxBytes);
      });
    }
  });

  test("contains no extra files", () => {
    expect.assertions(1);
    const expectedFiles = new Set(distFiles.map(([filename]) => filename));
    const actualFiles = new Set(new Bun.Glob("**").scanSync({ cwd: "dist", dot: true }));
    expect(actualFiles.difference(expectedFiles)).toBeEmpty();
  });
});

// stage1, stage1/lite and stage1/ultralite ship as source; the app's Bun build decides whether the
// dev checks stay.
describe.each([
  // Measured 6445 B (Bun 1.4.4); the previous signal core and lists made 7088 B
  ["src/index.ts", 6000, 7500],
  // Measured 4121 B (Bun 1.4.4); the core that walked nested writes at once made 3956 B
  ["src/lite/index.ts", 3500, 4800],
  // Measured 3697 B (Bun 1.4.4)
  ["src/ultralite/index.ts", 3300, 4500],
])("%s", (entry, minBytes, maxBytes) => {
  // Explicit define: without one, Bun.build substitutes the test process's NODE_ENV.
  const bundle = async (nodeEnv: string) => {
    const result = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      minify: true,
      define: { "process.env.NODE_ENV": JSON.stringify(nodeEnv) },
    });
    return result.outputs[0].text();
  };

  // Dev checks throw "stage1: …" errors or log to the console; a production build drops them all.
  test("a production build has no dev checks", async () => {
    expect.assertions(1);
    expect(await bundle("production")).not.toMatch(/console\.|stage1: /u);
  });

  // Guards the test above: the pattern finds the dev checks when they are there.
  test("a development build has the dev checks", async () => {
    expect.assertions(1);
    expect(await bundle("development")).toMatch(/console\.|stage1: /u);
  });

  test("a production build is within expected size limits", async () => {
    expect.assertions(2);
    const code = await bundle("production");
    expect(code.length).toBeGreaterThan(minBytes);
    expect(code.length).toBeLessThan(maxBytes);
  });
});

// Characterization (Bun 1.4.4), behind the README's advice: an inherited NODE_ENV beats the flag.
describe("bun build --production", () => {
  const build = (nodeEnv?: string) => {
    // oxlint-disable-next-line node/no-process-env
    const { NODE_ENV: _inherited, ...env } = process.env;
    return Bun.spawnSync(
      [process.execPath, "build", "src/index.ts", "--production", "--target=browser"],
      { env: nodeEnv === undefined ? env : { ...env, NODE_ENV: nodeEnv } },
    );
  };

  test("drops the dev checks when NODE_ENV is unset", () => {
    expect.assertions(2);
    const result = build();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).not.toMatch(/console\.|stage1: /u);
  });

  test("keeps the dev checks when NODE_ENV=development is inherited", () => {
    expect.assertions(2);
    const result = build("development");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toMatch(/console\.|stage1: /u);
  });
});

describe("package.json", () => {
  const file = Bun.file("package.json");

  test("exists with correct MIME type", () => {
    expect.assertions(2);
    expect(file.exists()).resolves.toBeTrue();
    expect(file.type).toBe("application/json;charset=utf-8");
  });

  test("contains valid JSON", async () => {
    expect.assertions(1);
    const text = await file.text();
    expect(JSON.parse(text)).toBePlainObject();
  });

  test('has "module" type', () => {
    expect.assertions(1);
    expect(pkg.type).toBe("module");
  });

  test("contains the expected exports keys", () => {
    expect.assertions(1);
    expect(pkg.exports).toContainAllKeys([
      ".",
      "./lite",
      "./ultralite",
      "./macro",
      "./browser",
      "./legacy",
      "./legacy/reconcile/keyed",
      "./legacy/reconcile/non-keyed",
      "./legacy/reconcile/reuse-nodes",
      "./legacy/reconcile/reuse-lite",
      "./src/*",
      "./package.json",
    ]);
  });

  // Resolution takes the first matching condition, and "default" always matches
  const afterDefault = Object.entries(pkg.exports).flatMap(([path, target]) => {
    const keys = typeof target === "string" ? [] : Object.keys(target);
    const index = keys.indexOf("default");
    return index === -1 ? [] : keys.slice(index + 1).map((key) => `${path} ${key}`);
  });

  test('has no condition after "default"', () => {
    expect.assertions(1);
    expect(afterDefault).toBeEmpty();
  });

  const exportTargets = Object.values(pkg.exports).flatMap((target) =>
    typeof target === "string" ? [target] : Object.values(target),
  );

  // A subpath pattern target needs at least one match
  const targetExists = async (target: string) => {
    if (!target.includes("*")) return Bun.file(target).exists();
    const first = await new Bun.Glob(target).scan().next();
    return !first.done;
  };

  test("has a file at every export target", async () => {
    expect.assertions(1);
    const found = await Promise.all(exportTargets.map((target) => targetExists(target)));
    expect(exportTargets.filter((_target, index) => !found[index])).toBeEmpty();
  });

  test('has a file at "main", "browser" and "types"', async () => {
    expect.assertions(1);
    const targets = [pkg.main, pkg.browser, pkg.types];
    const found = await Promise.all(targets.map((target) => Bun.file(target).exists()));
    expect(targets.filter((_target, index) => !found[index])).toBeEmpty();
  });

  test('contains the expected "files"', () => {
    expect.assertions(1);
    expect(pkg.files).toEqual(["dist", "src"]);
  });
});
