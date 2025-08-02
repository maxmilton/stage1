import { collect, h } from "../src/fast/runtime.ts";
import { compile } from "../src/macro.ts" with { type: "macro" };

type TestComponent = HTMLDivElement;

interface TestProps {
  text: string;
}

interface Refs {
  t: Text;
}

const meta = compile<Refs>(`
  <div id=test>
    @t
  </div>
`);
const view = h<HTMLDivElement>(meta.html);

export function Test(props: TestProps): TestComponent {
  const root = view;
  const refs = collect<Refs>(root, meta.d);

  refs[meta.ref.t].nodeValue = props.text;

  return root;
}
