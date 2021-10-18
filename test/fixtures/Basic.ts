import { h, S1Node } from '../..';

type BasicComponent = S1Node & HTMLDivElement;

const view = h`
  <nav id=basic>
    <a href=l1>Link 1</a>
    <a href=l2>Link 2</a>
    <a href=l3>Link 3</a>
  </nav>
`;

export const Basic = (): BasicComponent => {
  const root = view as BasicComponent;
  return root;
};
