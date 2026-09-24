export type Refs = Record<string, Node>;

export type InferRefs<T> = {
  [K in keyof T]: T[K] extends Node
    ? T[K]
    : /* `never` is more accurate but Node is useful for feedback */ Node;
};

export type LowercaseKeys<T> = {
  [K in keyof T as Lowercase<string & K>]: T[K];
};

type UnionToIntersection<T> = (T extends unknown ? (k: T) => void : never) extends (
  k: infer P,
) => void
  ? P
  : never;

type UnionToTuple<T> =
  UnionToIntersection<T extends unknown ? () => T : never> extends () => infer R
    ? [...UnionToTuple<Exclude<T, R>>, R]
    : [];

export type TupleOfKeys<T> = UnionToTuple<keyof T>;

export type IndicesOf<T> = {
  readonly [K in keyof T as T[K] extends string ? T[K] : never]: K extends `${number}` ? K : never;
};

/**
 * @typeParam T - `Refs` type. **Order of keys is preserved** and must match
 * the order of refs in the template!
 */
export type FlatRefs<T> =
  UnionToTuple<keyof T> extends infer K
    ? K extends (keyof T)[]
      ? { [P in keyof K]: T[K[P] & keyof T] }
      : never
    : never;
