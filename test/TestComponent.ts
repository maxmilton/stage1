import { compile } from '../src/macro.ts' with { type: 'macro' };
import { collect, h } from '../src/runtime.ts';

type TestComponent = HTMLDivElement;

interface TestProps {
  text: string;
}

interface Refs {
  t: Text;
}

const meta = compile(`
  <div id=test>
    @t
  </div>
`);
const view = h<HTMLDivElement>(meta.html);

export function Test(props: TestProps): TestComponent {
  const root = view;
  const refs = collect<Refs>(root, meta.k, meta.d);

  refs.t.nodeValue = props.text;

  return root;
}
