export type Refs<T = Record<string, Node>> = { [K in keyof T]: Node };

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
