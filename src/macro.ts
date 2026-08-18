import type { IndicesOf, InferRefs, TupleOfKeys } from "./types.ts";

/**
 * Valid ref name; lowercase because browsers normalise element attribute names
 * when rendering HTML, so a non-lowercase name would not survive a round trip.
 */
const REF_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/** Elements whose text content must be preserved verbatim. */
const VERBATIM_TAGS = new Set(["pre", "code", "textarea", "script", "style"]);

/** Subset of `VERBATIM_TAGS` whose text must never be read as a ref. */
const RAW_TAGS = new Set(["script", "style"]);

export interface CompileOptions {
  /**
   * Whether to keep spaces adjacent to tags in output HTML. When keepSpaces
   * is false, `<div> x </div>` becomes `<div>x</div>`.
   * @default false
   */
  keepSpaces?: boolean;
}

export interface CompileResult<R> {
  html: string;
  /** Array of ref key names. */
  k: readonly string[];
  /** Array of distances from previous ref node or template root. */
  d: readonly number[];
  /** Object mapping ref key names to their indices in the `k` array. */
  ref: IndicesOf<TupleOfKeys<R>>;
  /** Whether the template was successfully compiled without any errors. */
  success: boolean;
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
): CompileResult<R> {
  let isSuccess = true;
  const k: string[] = [];
  const d: number[] = [];
  let distance = 0;
  let verbatimDepth = 0;
  let isRawText = false;
  let textBuffer = "";
  /** `undefined` = root not seen yet, `true` = inside root, `false` = root closed. */
  let insideRoot: boolean | undefined;

  const fail = (message: string) => {
    const detail = Bun.enableANSIColors ? `\x1B[2m${template}\x1B[0m` : template;
    // eslint-disable-next-line no-console
    console.error(`${message} in template:\n${detail}`);
    isSuccess = false;
  };

  const addRef = (name: string) => {
    if (!REF_NAME_RE.test(name)) fail(`Invalid ref name "${name}"`);
    if (k.includes(name)) fail(`Duplicate ref name "${name}"`);
    k.push(name);
    d.push(distance);
    distance = 0;
  };

  const html = new HTMLRewriter()
    .onDocument({
      doctype() {
        fail("Found doctype but none was expected");
      },
      comments(node) {
        const text = node.text.trim();
        node.remove();
        if (!isRawText && text[0] === "@") {
          addRef(text.slice(1));
          // Replace with <!> which renders a Comment node at runtime
          node.after("<!>", { html: true });
          distance++;
        }
      },
      // A single Text node can arrive as several chunks — the tokenizer splits
      // on a bare "<" which does not start a tag, e.g. "a < b" — always ending
      // with an empty last chunk, so buffer it and handle the whole node once.
      text(chunk) {
        textBuffer += chunk.text;
        if (!chunk.lastInTextNode) {
          chunk.remove();
          return;
        }
        const raw = textBuffer;
        textBuffer = "";
        const text = raw.trim();

        if (!isRawText && text[0] === "@") {
          addRef(text.slice(1));
          // Replace with single space which renders a Text node at runtime
          chunk.replace(" ", { html: true });
        } else if (verbatimDepth) {
          // Whitespace-sensitive or raw content; never minified
          chunk.replace(raw, { html: true });
        } else if (text) {
          // Reduce any whitespace to a single space
          chunk.replace((keepSpaces ? raw : text).replace(/\s+/g, " "), { html: true });
        } else {
          return; // a removed node does not count towards distance
        }
        distance++;
      },
    })
    .on("*", {
      element(node) {
        const isRoot = insideRoot === undefined;
        // Void elements have no end tag to hook into; onEndTag throws for them.
        // NOTE: `selfClosing` is deliberately not consulted — in HTML content
        // "/>" is ignored by the parser, so <div/> is an OPEN div which does
        // have an end tag. Foreign content which really does self-close (e.g.
        // <svg/>) reports canHaveContent false, so this covers it already.
        const hasEndTag = node.canHaveContent;
        const isVerbatim = hasEndTag && VERBATIM_TAGS.has(node.tagName);
        const isRaw = isVerbatim && RAW_TAGS.has(node.tagName);

        // A DOM <template> keeps its children in .content, which the
        // firstChild/nextSibling walk in collect() cannot enter, so every
        // distance past it would be wrong — reject rather than crash at runtime
        if (node.tagName === "template") {
          fail("Found unsupported <template> element");
        }

        if (isRoot) {
          insideRoot = hasEndTag;
        } else if (!insideRoot) {
          fail("Expected single root element");
        }
        if (isVerbatim) verbatimDepth++;
        if (isRaw) isRawText = true;

        // Registering a second end tag handler replaces the first, so
        // everything which unwinds here has to share the one handler
        if (hasEndTag && (isRoot || isVerbatim)) {
          node.onEndTag(() => {
            if (isRoot) insideRoot = false;
            if (isVerbatim) verbatimDepth--;
            if (isRaw) isRawText = false;
          });
        }

        // Collect first; removing an attribute while iterating is not safe
        const refAttrs: string[] = [];
        for (const [name] of node.attributes) if (name[0] === "@") refAttrs.push(name);
        for (const name of refAttrs) node.removeAttribute(name);
        if (refAttrs.length > 1) {
          fail("Found multiple ref markers on single element");
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
