/** @internal */
export interface Ref {
  readonly i: number;
  readonly ref: string;
}

export type Refs = Record<string, Node>;

export type LowercaseKeys<T> = {
  [K in keyof T as Lowercase<string & K>]: T[K];
};

export interface S1Node extends Node, ChildNode {
  _refs: Ref[];
  // Some browsers lowercase rendered HTMLElement attribute names so we
  // lowercase the ref keys to bring awareness to this.
  collect<T extends Refs = Refs>(node: Node): LowercaseKeys<T>;
}
