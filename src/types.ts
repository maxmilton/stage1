declare class Ref {
  idx: number;

  ref: string | number;
  constructor(idx: number, ref: string | number);
}

interface RefObj<T extends Node> {
  [key: string]: T;
}

export interface Stage1Node<T extends Node = Node> extends T {
  _refPaths?: Ref[];
  collect(node: Node): RefObj<T>;
}
