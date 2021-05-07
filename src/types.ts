declare class Ref {
  idx: number;

  ref: string | number;

  constructor(idx: number, ref: string | number);
}

interface NodeRefs {
  [key: string]: Node;
}

export interface Stage1Node extends Node {
  _refPaths?: Ref[];
  collect<T extends NodeRefs>(node: Node): { [K in keyof T]: T[K] };
}
