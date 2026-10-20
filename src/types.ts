/** Ref names must be lowercase; browsers lowercase element attribute names. */
export type Refs<T = Record<string, Node>> = {
  [K in keyof T as string extends K ? K : Lowercase<K & string>]: Node;
};

/**
 * Opaque name-keyed type-level stand-in for a ref's runtime index (a number)
 * into {@link FlatRefs}.
 */
type RefKey<K extends string> = `@${K}`;

export type RefKeys<T> = { readonly [K in keyof T & string]: RefKey<K> };

export type FlatRefs<T> = Node[] & { [K in keyof T & string as RefKey<K>]: T[K] };
