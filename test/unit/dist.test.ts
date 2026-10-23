import { describe, expect, test } from "bun:test";
import pkg from "../../package.json" with { type: "json" };

// The only test file that reads dist/, so run `bun run build` first.
describe("dist files", () => {
  // TODO: Remove the MIME type checks? Bun infers them from the file extension, not the data.
  // Unknown types (e.g. symlinks, which Bun.file() doesn't follow) report application/octet-stream.

  const distFiles: [filename: string, type: string, minBytes?: number, maxBytes?: number][] = [
    ["reconcile/keyed.js", "text/javascript;charset=utf-8", 2000, 3500],
    ["reconcile/keyed.js.map", "application/json;charset=utf-8"],
    ["reconcile/non-keyed.js", "text/javascript;charset=utf-8", 2000, 3500],
    ["reconcile/non-keyed.js.map", "application/json;charset=utf-8"],
    ["reconcile/reuse-nodes.js", "text/javascript;charset=utf-8", 500, 1000],
    ["reconcile/reuse-nodes.js.map", "application/json;charset=utf-8"],
    ["browser.js", "text/javascript;charset=utf-8", 1000, 1500],
    ["browser.js.map", "application/json;charset=utf-8"],
    ["browser.mjs", "text/javascript;charset=utf-8", 1000, 1500],
    ["browser.mjs.map", "application/json;charset=utf-8"],
    ["index.d.ts", "text/javascript;charset=utf-8", 6000, 10_000],
    ["index.d.ts.map", "application/json;charset=utf-8"],
    ["index.js", "text/javascript;charset=utf-8", 1000, 1500],
    ["index.js.map", "application/json;charset=utf-8"],
    // Looser ceiling: macro.js runs in Bun at build time and never ships to a browser.
    ["macro.js", "text/javascript;charset=utf-8", 1000, 2000],
    ["macro.js.map", "application/json;charset=utf-8"],
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
      "./macro",
      "./browser",
      "./reconcile/keyed",
      "./reconcile/non-keyed",
      "./reconcile/reuse-nodes",
      "./fast",
      "./dist/*",
      "./package.json",
    ]);
  });

  test('contains the expected "files"', () => {
    expect.assertions(1);
    expect(pkg.files).toEqual(["dist", "src"]);
  });
});
