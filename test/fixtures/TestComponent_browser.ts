import { collect, h } from "../../src/browser/runtime.ts";

type TestComponent = HTMLDivElement;

interface TestProps {
  text: string;
}

interface Refs {
  text: Text;
}

const view = h<HTMLDivElement>(/* html */ `
  <div id=test>
    @text
  </div>
`);

export function Test(props: TestProps): TestComponent {
  const root = view;
  const refs = collect<Refs>(root, view);

  refs.text.nodeValue = props.text;

  return root;
}
