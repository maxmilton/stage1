import { collect, h } from '../src/browser/compile';

type TestComponent = HTMLDivElement;

interface TestProps {
  text: string;
}

type Refs = {
  t: Text;
};

const view = h<HTMLDivElement>(`
  <div id=test>
    @t
  </div>
`);

export function Test(props: TestProps): TestComponent {
  const root = view;
  const refs = collect<Refs>(root, view);

  refs.t.nodeValue = props.text;

  return root;
}
