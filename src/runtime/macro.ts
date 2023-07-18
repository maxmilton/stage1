/**
 * Bun macro which compiles a template string at build-time into a format that
 * can be used by the runtime.
 * @param template - HTML template string.
 * @param keepComments - Whether to keep HTML comments in the output.
 */
export async function compile(
  template: string,
  keepComments?: boolean,
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
      if (!chunk.lastInTextNode) {
        const content = chunk.text.trim();
        if (!content) {
          if (!whitespaceSensitiveBlock) {
            chunk.remove();
          }
          return;
        }
        if (content[0] === '@') {
          k.push(content.slice(1));
          d.push(distance);
          distance = 0;
          chunk.replace(' ');
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

  const res = rewriter.transform(
    new Response(
      template
        .trim()
        // reduce any whitespace to a single space
        .replace(/\s+/g, ' '),
    ),
  );
  const html = await res.text();

  return { html, k, d };
}
