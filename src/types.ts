export interface Ref {
  readonly i: number;
  readonly ref: string;
}

export interface RefNodes {
  [key: string]: Node;
}

export interface S1Node extends Node, ChildNode {
  _refs: Ref[];
  collect<T extends RefNodes = RefNodes>(node: Node): T;
}
