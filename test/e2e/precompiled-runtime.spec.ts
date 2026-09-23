import { expect, type Page, test } from "@playwright/test";
import { compile, type CompileResult } from "../../src/macro.ts";
import type { InferRefs, LowercaseKeys, Refs } from "../../src/types.ts";

// These precompiled runtime tests are only available when running in Bun.
test.skip(!("bun" in process.versions), "Requires Bun");
if (!("bun" in process.versions)) {
  // oxlint-disable-next-line node/no-process-env
  if (process.env["CI"]) {
    throw new TypeError("Bun is required to run this e2e test file.");
  }
  // @ts-expect-error - stub to prevent runtime error in node, for debugging
  // eslint-disable-next-line unicorn/no-global-object-property-assignment
  global.Bun = { file: () => ({ text: () => {} }) };
}

const jsSrc = await Bun.file(new URL("../../dist/index.js", import.meta.url)).text();

function render<R extends InferRefs<R>>(
  page: Page,
  meta: CompileResult<R>,
): Promise<{ refs: Record<keyof LowercaseKeys<R>, string>; html: string }> {
  expect(meta.success).toBe(true);

  return page.evaluate(
    async ({ src, meta: { html, k, d } }) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      // oxlint-disable-next-line typescript/consistent-type-imports
      const runtime = (await import(url)) as typeof import("../../src/index.ts");
      const root = runtime.h(html);
      const refs = runtime.collect<Refs>(root, k, d);

      return {
        refs: Object.fromEntries(Object.entries(refs).map(([name, node]) => [name, node.nodeName])),
        html: root.outerHTML,
      };
    },
    { src: jsSrc, meta },
  );
}

test.describe("a compiled template", () => {
  test("collects every ref in a deep tree at the right node", async ({ page }) => {
    const meta = compile(/* html */ `
      <div @a>
        <header @b>
          <nav @c>
            <a @d href="@one">One</a>
            <a @e href="@two">Two</a>
          </nav>
        </header>
        <main @f>
          <h1 @g>Test</h1>
          <p @h><b @i>This</b> is a <a href="@" @j>test</a>.</p>
          <ol @k>
            <li @l id=one>One</li>
            <li @m id=two>Two</li>
          </ol>
          <form @n>
            <input @o />
            <textarea @p></textarea>
            <button @q>Submit</button>
          </form>
        </main>
        <!-- @r -->
        <footer @s>
          @t
        </footer>
      </div>
    `);
    const { refs } = await render(page, meta);
    expect(refs).toEqual({
      a: "DIV",
      b: "HEADER",
      c: "NAV",
      d: "A",
      e: "A",
      f: "MAIN",
      g: "H1",
      h: "P",
      i: "B",
      j: "A",
      k: "OL",
      l: "LI",
      m: "LI",
      n: "FORM",
      o: "INPUT",
      p: "TEXTAREA",
      q: "BUTTON",
      r: "#comment",
      s: "FOOTER",
      t: "#text",
    });
  });

  test("renders a compiled comment ref as a comment node", async ({ page }) => {
    const meta = compile(/* html */ "<div @a><!-- @b --><span @c>x</span></div>");
    const { refs } = await render(page, meta);
    expect(refs).toEqual({ a: "DIV", b: "#comment", c: "SPAN" });
  });

  test("renders a compiled text ref as a text node", async ({ page }) => {
    const meta = compile(/* html */ "<div @a>@b<span @c>x</span></div>");
    const { refs } = await render(page, meta);
    expect(refs).toEqual({ a: "DIV", b: "#text", c: "SPAN" });
  });

  test("collects refs inside SVG foreign content", async ({ page }) => {
    const meta = compile(/* html */ "<svg @a><circle @b cx=10 /><rect @c /></svg>");
    const { refs } = await render(page, meta);
    expect(refs).toEqual({ a: "svg", b: "circle", c: "rect" });
  });

  test("keeps the text of a verbatim block", async ({ page }) => {
    const meta = compile(/* html */ "<div @a><pre @b>  keep   me  </pre></div>");
    const { html } = await render(page, meta);
    expect(html).toBe(/* html */ "<div><pre>  keep   me  </pre></div>");
  });

  test("collects a ref after a verbatim block", async ({ page }) => {
    const meta = compile<{ a: HTMLDivElement; b: HTMLPreElement; c: HTMLSpanElement }>(
      /* html */ "<div @a><pre @b>  keep   me  </pre><span @c>after</span></div>",
    );
    const { refs } = await render(page, meta);
    expect(refs.c).toBe("SPAN");
  });
});

test.describe("a table template", () => {
  test("misses the cell when the parser inserts an implied tbody", async ({ page }) => {
    // Characterization (B14): unlike B10's malformed examples this source is
    // VALID HTML — <tbody> is optional and the parser inserts it. compile()
    // counts table→tr→td and emits d=[2]; the DOM is table→tbody→tr→td, so the
    // walk lands on the TR. Silent — no error, just the wrong node. The fix is
    // in the template; see the next test.
    const meta = compile<{ a: HTMLTableCellElement }>(
      /* html */ "<table><tr><td @a>x</td></tr></table>",
    );
    const { refs } = await render(page, meta);
    expect(refs.a).toBe("TR");
  });

  test("collects the cell when the template spells out tbody", async ({ page }) => {
    // The workaround half, and why the test above is characterization rather than
    // a bug report: spelling out the implied element realigns source and DOM.
    const meta = compile<{ a: HTMLTableCellElement }>(
      /* html */ "<table><tbody><tr><td @a>x</td></tr></tbody></table>",
    );
    const { refs } = await render(page, meta);
    expect(refs.a).toBe("TD");
  });
});
