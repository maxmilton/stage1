export interface _Ref {
  readonly index: number;
  readonly ref: string;
}

export interface NodeRefs {
  [key: string]: Node;
}

export interface S1Node extends Element {
  _refs: _Ref[];
  collect<T extends NodeRefs>(node: Element): { [K in keyof T]: T[K] };
}
