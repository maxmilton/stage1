import type { IndicesOf, InferRefs, TupleOfKeys } from "./types.ts";

/**
 * Valid ref name; lowercase because browsers normalise element attribute names
 * when rendering HTML, so a non-lowercase name would not survive a round trip.
 */
const REF_NAME_RE = /^[a-z][a-z0-9_-]*$/;

export interface CompileOptions {
  /**
   * Whether to keep spaces adjacent to tags in output HTML. When keepSpaces
   * is false, `<div> x </div>` becomes `<div>x</div>`.
   * @default false
   */
  keepSpaces?: boolean;
}

/**
 * Bun macro to compile a template string at build-time into a format that can
 * be used by the runtime.
 * @param template - HTML template string.
 * @param options - Compile options.
 */
export function compile<R extends InferRefs<R> = object>(
  template: string,
  { keepSpaces }: CompileOptions = {},
): {
  html: string;
  /** Array of ref key names. */
  k: readonly string[];
  /** Array of distances from previous ref node or template root. */
  d: readonly number[];
  /** Object mapping ref key names to their indices in the `k` array. */
  ref: IndicesOf<TupleOfKeys<R>>;
  /** Whether the template was successfully compiled without any errors. */
  success: boolean;
} {
  let isSuccess = true;
  const k: string[] = [];
  const d: number[] = [];
  let distance = 0;
  let wsDepth = 0;
  /** `undefined` = root not seen yet, `true` = inside root, `false` = root closed. */
  let insideRoot: boolean | undefined;

  const fail = (message: string) => {
    // eslint-disable-next-line no-console
    console.error(message, template);
    isSuccess = false;
  };

  const addRef = (name: string) => {
    if (!REF_NAME_RE.test(name)) fail(`Invalid ref name "${name}" in template:`);
    if (k.includes(name)) fail(`Duplicate ref name "${name}" in template:`);
    k.push(name);
    d.push(distance);
    distance = 0;
  };

  const html = new HTMLRewriter()
    .onDocument({
      doctype() {
        fail("Found doctype but none was expected in template:");
      },
      comments(node) {
        const text = node.text.trim();
        node.remove();
        if (text[0] === "@") {
          addRef(text.slice(1));
          // Replace with <!> which renders a Comment node at runtime
          node.after("<!>", { html: true });
          distance++;
        }
      },
      // This text handler is invoked twice for each Text node: first with the
      // actual text, then with an empty last chunk. This behaviour stems from
      // the fact that the data provided to `HTMLRewriter.transform()` can be
      // streamed; where the last empty chunk signals the end of the text.
      text(chunk) {
        if (chunk.lastInTextNode) return;

        const text = chunk.text.trim();
        if (text[0] === "@") {
          addRef(text.slice(1));
          // Replace with single space which renders a Text node at runtime
          chunk.replace(" ", { html: true });
        } else if (!wsDepth) {
          if (!text) {
            chunk.remove();
            return; // a removed node does not count towards distance
          }
          // Reduce any whitespace to a single space
          chunk.replace((keepSpaces ? chunk.text : text).replace(/\s+/g, " "), { html: true });
        }
        distance++;
      },
    })
    .on("*", {
      element(node) {
        if (insideRoot === undefined) {
          insideRoot = true;
          node.onEndTag(() => {
            insideRoot = false;
          });
        } else if (!insideRoot) {
          fail("Expected template to have a single root element:");
        }

        if (node.tagName === "pre" || node.tagName === "code") {
          wsDepth++;
          node.onEndTag(() => {
            wsDepth--;
          });
        }

        const refAttrs: string[] = [];
        for (const [name] of node.attributes) {
          if (name[0] === "@") refAttrs.push(name);
        }
        for (const name of refAttrs) node.removeAttribute(name);
        if (refAttrs.length > 1) {
          fail("Found multiple ref markers on a single element in template:");
        }
        if (refAttrs.length) addRef(refAttrs[0].slice(1));
        distance++;
      },
    })
    .transform(template.trim());

  return {
    html,
    k,
    d,
    // @ts-expect-error - computed type
    ref: Object.fromEntries(k.map((name, index) => [name, index])),
    success: isSuccess,
  };
}
