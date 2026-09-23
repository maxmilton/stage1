import path from "node:path";
import { expect, test } from "@playwright/test";

const jsPath = path.resolve(import.meta.dirname, "../../dist/browser.js");

test.describe("a compiled view", () => {
  test("is the template's root element", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });

    const result = await page.evaluate(
      () => window.stage1.h(/* html */ "<ul id=root><li>A</li></ul>").nodeName,
    );

    expect(result).toBe("UL");
  });

  test("has whitespace between tags collapsed away", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });

    const result = await page.evaluate(
      () =>
        window.stage1.h(/* html */ `
          <ul>
            <li>A</li>
            <li>B</li>
          </ul>
        `).outerHTML,
    );

    expect(result).toBe(/* html */ "<ul><li>A</li><li>B</li></ul>");
  });

  test("has whitespace around text content collapsed away", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    const result = await page.evaluate(
      () => window.stage1.h(/* html */ "<p> hello </p>").outerHTML,
    );
    expect(result).toBe(/* html */ "<p>hello</p>");
  });

  test("puts SVG elements in the SVG namespace", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    // h() never calls createElementNS — the namespace comes from the parser, so
    // only a real one can answer. The unit test asserts instanceof, which is
    // happy-dom judging its own output.
    const result = await page.evaluate(
      () => window.stage1.h(/* html */ "<svg><circle cx=10 /></svg>").namespaceURI,
    );
    expect(result).toBe("http://www.w3.org/2000/svg");
  });

  test("has its ref markers stripped from the rendered DOM", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    const result = await page.evaluate(
      () => window.stage1.h(/* html */ "<ul @list><li @item>A</li></ul>").outerHTML,
    );
    expect(result).toBe(/* html */ "<ul><li>A</li></ul>");
  });

  test("can be built with the html tagged template", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    const result = await page.evaluate(
      // oxfmt-ignore
      () => window.stage1.html/* html */`<div id=x>a</div>`.outerHTML,
    );
    expect(result).toBe(/* html */ '<div id="x">a</div>');
  });
});

test.describe("collect", () => {
  test("finds the root ref in a detached clone of the view", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    const isRootTheClone = await page.evaluate(() => {
      const { h, collect } = window.stage1;
      const view = h(/* html */ "<ul @l><li @a>A</li><li @b>B</li></ul>");
      const root = view.cloneNode(true) as Element;
      return collect<{ l: Element }>(root, view).l === root;
    });
    expect(isRootTheClone).toBe(true);
  });

  test("finds a child ref in a detached clone of the view", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    const isRefInClone = await page.evaluate(() => {
      const { h, collect } = window.stage1;
      const view = h(/* html */ "<ul @l><li @a>A</li><li @b>B</li></ul>");
      const root = view.cloneNode(true) as Element;
      return collect<{ a: Element }>(root, view).a === root.firstChild;
    });
    expect(isRefInClone).toBe(true);
  });

  test("finds refs in a clone attached to the document", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    const isRefInClone = await page.evaluate(() => {
      const { h, collect } = window.stage1;
      const view = h(/* html */ "<div @a><span @b>x</span></div>");
      const root = view.cloneNode(true) as Element;
      document.body.append(root);
      return collect<{ a: Element; b: Element }>(root, view).b === root.firstChild;
    });
    expect(isRefInClone).toBe(true);
  });

  test("finds refs in a view compiled before a later h() call", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    const result = await page.evaluate(() => {
      const { h, collect } = window.stage1;
      const view = h(/* html */ "<div @a><span @b>x</span></div>");
      h(/* html */ "<p @c>other</p>");
      return collect<{ a: Element; b: Element }>(view, view).b.nodeName;
    });
    expect(result).toBe("SPAN");
  });

  type Case = { name: string; template: string } & (
    | { field: "keys"; expected: string[] }
    | { field: "html"; expected: string }
  );

  const CASES: Case[] = [
    {
      name: "lowercases element attribute ref names",
      // V8: no runtime .toLowerCase() anywhere — the browser does it while
      // parsing, which is what LowercaseKeys<T> rests on.
      template: /* html */ "<div @Foo></div>",
      field: "keys",
      expected: ["foo"],
    },
    {
      name: "keeps the case of text ref names",
      // Open issue T11: nodeValue is not normalised, so the key keeps its case
      // while LowercaseKeys<T> claims lowercase. compile() rejects it (V19);
      // live mode does no validation by design.
      template: /* html */ "<div>@Foo</div>",
      field: "keys",
      expected: ["Foo"],
    },
    {
      name: "keeps the last marker when an element has several",
      // Accepted tradeoff (B1): the reverse attribute scan saves bytes, so live
      // mode keeps the LAST marker where compile() keeps the first and errors.
      template: /* html */ "<div @a @b></div>",
      field: "keys",
      expected: ["b"],
    },
    {
      name: "leaves the unused marker of a multi-marker element in the DOM",
      // Accepted tradeoff (B1), visible half: the losing marker ships to the page.
      template: /* html */ "<div @a @b></div>",
      field: "html",
      expected: /* html */ '<div @a=""></div>',
    },
    {
      name: "ignores a comment ref with surrounding whitespace",
      // Characterization (V17): the whitespace collapse does not reach inside
      // comments and collector() only matches nodeValue[0], so this is silently
      // not a ref. compile() accepts both spellings.
      template: /* html */ "<div><!-- @a --><b @c></b></div>",
      field: "keys",
      expected: ["c"],
    },
    {
      name: "reads a style at-rule as a ref name",
      // Accepted tradeoff (B9): <style> content is a text node, and any text
      // node starting with "@" is a ref. compile() is protected by RAW_TAGS
      // (B7); guarding live mode costs bytes. Use precompiled mode for
      // <script>/<style>.
      template: /* html */ "<div><style>@media print{a{b:c}}</style></div>",
      field: "keys",
      // eslint-disable-next-line array-bracket-spacing
      expected: [/* css */ "media print{a{b:c}}"],
    },
    {
      name: "wipes the CSS of a style element read as a ref",
      // Accepted tradeoff (B9), destructive half: the stylesheet is blanked.
      template: /* html */ "<div><style>@media print{a{b:c}}</style></div>",
      field: "html",
      expected: /* html */ "<div><style></style></div>",
    },
  ];

  for (const { name, template, field, expected } of CASES) {
    test(name, async ({ page }) => {
      await page.addScriptTag({ path: jsPath });
      const result = await page.evaluate((tpl) => {
        const { h, collect } = window.stage1;
        const view = h(tpl);
        return { keys: Object.keys(collect(view, view)), html: view.outerHTML };
      }, template);
      expect(result[field]).toEqual(expected);
    });
  }

  test("does not descend into a template element", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    const result = await page.evaluate(() => {
      const { h, collect } = window.stage1;
      const view = h(/* html */ "<div><template><span @a></span></template><b @b></b></div>");
      const refs = collect<{ b: Element }>(view, view);
      return { keys: Object.keys(refs), b: refs.b.nodeName };
    });
    expect(result).toEqual({ keys: ["b"], b: "B" });
  });

  test("roots the view at the foster-parented element", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    // Characterization (B10): the parser foster-parents the <div> out of the
    // <table>, so h()'s "root" is that <div> and the table is its SIBLING.
    // Templates must use parser-valid nesting; not detectable at build time.
    const result = await page.evaluate(
      () =>
        window.stage1.h(
          /* html */ "<table><div @a></div><tbody><tr><td @b>x</td></tr></tbody></table>",
        ).outerHTML,
    );
    expect(result).toBe(/* html */ "<div></div>");
  });

  test("roots the view at the first of several parser-produced roots", async ({ page }) => {
    await page.addScriptTag({ path: jsPath });
    // Characterization (B10), other half: <div> inside <p> auto-closes it, so
    // this one template becomes THREE roots and h() returns only the first —
    // the ref is not even inside what the caller gets back.
    const result = await page.evaluate(
      () => window.stage1.h(/* html */ "<p>a<div @a>b</div></p>").outerHTML,
    );
    expect(result).toBe(/* html */ "<p>a</p>");
  });
});
