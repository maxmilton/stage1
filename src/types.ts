export type Refs = Record<string, Node>;

export type InferRefs<T> = {
  [K in keyof T]: T[K] extends Node
    ? T[K]
    : /* `never` is more accurate but Node is useful for feedback */ Node;
};

export type LowercaseKeys<T> = {
  [K in keyof T as Lowercase<string & K>]: T[K];
};

/**
 * Opaque name-keyed type-level stand-in for a ref's runtime index (a number)
 * into {@link FlatRefs}.
 */
type RefKey<K extends string> = `@${K}`;

export type RefKeys<T> = { readonly [K in keyof T & string]: RefKey<K> };

export type FlatRefs<T> = Node[] & { [K in keyof T & string as RefKey<K>]: T[K] };
