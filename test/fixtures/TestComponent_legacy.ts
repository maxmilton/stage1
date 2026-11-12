import { collect, h } from "../../src/legacy/runtime.ts";
import { clone } from "../../src/legacy/utils.ts";
import { compile } from "../../src/macro.ts" with { type: "macro" };

type TestComponent = HTMLDivElement;

interface TestProps {
  text: string;
}

interface Refs {
  text: Text;
}

const meta = compile<Refs>(/* html */ `
  <div id=test>
    @text
  </div>
`);
const view = h<HTMLDivElement>(meta.html);

export function Test(props: TestProps): TestComponent {
  const root = clone(view);
  const refs = collect(root, meta.k, meta.d);

  refs.text.nodeValue = props.text;

  return root;
}
