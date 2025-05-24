export type Refs = Record<string, Node>;

export type InferRefs<T> = {
  [K in keyof T]: T[K] extends Node
    ? T[K]
    : /* `never` is more accurate but Node is useful for feedback */ Node;
};

export type LowercaseKeys<T> = {
  [K in keyof T as Lowercase<string & K>]: T[K];
};

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

type UnionToTuple<T> = UnionToIntersection<
  T extends any ? () => T : never
> extends () => infer W
  ? [...UnionToTuple<Exclude<T, W>>, W]
  : [];

export type TupleOfKeys<T> = Readonly<UnionToTuple<keyof T>>;

export type IndicesOf<T> = {
  [K in keyof T as T[K] extends string ? T[K] : never]: K extends `${number}`
    ? K
    : never;
};

export type FlatRefs<T> = UnionToTuple<keyof T> extends infer K
  ? K extends (keyof T)[]
    ? { [P in keyof K]: T[K[P] & keyof T] }
    : never
  : never;
