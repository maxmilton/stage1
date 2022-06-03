export interface Ref {
  readonly i: number;
  readonly ref: string;
}

export type RefNodes = Record<string, Node>;

export interface S1Node extends Node, ChildNode {
  _refs: Ref[];
  collect<T extends RefNodes = RefNodes>(node: Node): T;
}
