/** @private */
export interface RefInfo {
  /** Ref key name. */
  readonly k: string;
  /** Distance from previous ref node or root. */
  readonly d: number;
}

export interface S1View extends Node, ChildNode {
  /** @private */
  $$refs: readonly RefInfo[];
}

export type Refs = Record<string, Node>;

export type LowercaseKeys<T> = {
  [K in keyof T as Lowercase<string & K>]: T[K];
};
