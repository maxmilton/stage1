import type { IndicesOf, InferRefs, TupleOfKeys } from "./types.ts";

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
  let success = true;
  const k: string[] = [];
  const d: number[] = [];
  let distance = 0;
  let whitespaceSensitiveBlock = false;
  let root: boolean | undefined;

  const html = new HTMLRewriter()
    .onDocument({
      doctype() {
        // eslint-disable-next-line no-console
        console.error(
          "Found doctype but none was expected in template:",
          template,
        );
        success = false;
      },
      comments(node) {
        const text = node.text.trim();
        if (text[0] === "@") {
          k.push(text.slice(1));
          d.push(distance);
          distance = 1;
          // Replace with <!> which renders a Comment node at runtime
          node.remove();
          node.after("<!>", { html: true });
        } else {
          node.remove();
        }
      },
      // This text handler is invoked twice for each Text node: first with the
      // actual text, then with an empty last chunk. This behaviour stems from
      // the fact that the data provided to `HTMLRewriter.transform()` can be
      // streamed; where the last empty chunk signals the end of the text.
      text(chunk) {
        if (!chunk.lastInTextNode) {
          const text = chunk.text.trim();
          if (!text) {
            if (!whitespaceSensitiveBlock) {
              chunk.remove();
            }
            return;
          }
          if (text[0] === "@") {
            k.push(text.slice(1));
            d.push(distance);
            distance = 0;
            // Replace with single space which renders a Text node at runtime
            chunk.replace(" ", { html: true });
          } else if (!whitespaceSensitiveBlock) {
            // Reduce any whitespace to a single space
            chunk.replace(
              (keepSpaces ? chunk.text : text).replace(/\s+/g, " "),
              { html: true },
            );
          }
          distance++;
        }
      },
    })
    .on("*", {
      element(node) {
        if (!root) {
          if (root === undefined) {
            root = true;
            node.onEndTag(() => {
              root = false;
            });
          } else {
            // eslint-disable-next-line no-console
            console.error(
              "Expected template to have a single root element:",
              template,
            );
            success = false;
          }
        }

        if (node.tagName === "pre" || node.tagName === "code") {
          whitespaceSensitiveBlock = true;
          node.onEndTag(() => {
            whitespaceSensitiveBlock = false;
          });
        }
        for (const [name] of node.attributes) {
          if (name[0] === "@") {
            k.push(name.slice(1));
            d.push(distance);
            distance = 0;
            node.removeAttribute(name);
            break;
          }
        }
        distance++;
      },
    })
    .transform(template.trim());

  // Check k entries are unique
  if (new Set(k).size !== k.length) {
    // eslint-disable-next-line no-console
    console.error("Duplicate ref keys found in template:", template);
    success = false;
  }

  return {
    html,
    k,
    d,
    // @ts-expect-error - computed type
    ref: Object.fromEntries(d.map((_, i) => [k[i], i])),
    success,
  };
}
