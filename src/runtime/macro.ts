export interface CompileOptions {
  /**
   * Keep HTML comments in output HTML?
   * @default false
   */
  keepComments?: boolean;
  /**
   * Keep spaces adjacent to tags in output HTML? When keepSpace is `false`,
   * `<div> x </div>` becomes `<div>x</div>`.
   * @default false
   */
  keepSpace?: boolean;
}

/**
 * Bun macro which compiles a template string at build-time into a format that
 * can be used by the runtime.
 * @param template - HTML template string.
 * @param keepComments - Whether to keep HTML comments in the output.
 */
export async function compile(
  template: string,
  { keepComments, keepSpace }: CompileOptions = {},
  // @ts-expect-error - Bun macros always result in synchronous inlined data.
): { html: string; k: readonly string[]; d: readonly number[] } {
  const rewriter = new HTMLRewriter();
  const k: string[] = [];
  const d: number[] = [];
  let distance = 0;
  let whitespaceSensitiveBlock = false;

  rewriter.on('*', {
    element(node) {
      if (node.tagName === 'pre' || node.tagName === 'code') {
        whitespaceSensitiveBlock = true;
        node.onEndTag(() => {
          whitespaceSensitiveBlock = false;
        });
      }
      for (const [name] of node.attributes) {
        if (name[0] === '@') {
          k.push(name.slice(1));
          d.push(distance);
          distance = 0;
          node.removeAttribute(name);
          break;
        }
      }
      distance++;
    },
    text(chunk) {
      // Since the response given to HTMLRewriter.transform() is not streamed,
      // this text handler is called once with the acual text, and then again
      // with an empty last chunk.
      if (!chunk.lastInTextNode) {
        const text = chunk.text.trim();
        if (!text) {
          if (!whitespaceSensitiveBlock) {
            chunk.remove();
          }
          return;
        }
        if (text[0] === '@') {
          k.push(text.slice(1));
          d.push(distance);
          distance = 0;
          // replace with single space which will be turned into a text node
          chunk.replace(' ');
        } else if (!whitespaceSensitiveBlock) {
          // reduce any whitespace to a single space
          chunk.replace((keepSpace ? chunk.text : text).replace(/\s+/g, ' '));
        }
        distance++;
      }
    },
    comments(node) {
      if (keepComments) {
        distance++;
      } else {
        node.remove();
      }
    },
  });

  const res = rewriter.transform(new Response(template.trim()));
  const html = await res.text();

  return { html, k, d };
}
