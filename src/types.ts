/** Ref names must be lowercase; browsers lowercase element attribute names. */
export type Refs<T = Record<string, Node>> = {
  [K in keyof T as K | Lowercase<K & string>]: string extends K
    ? Node
    : K extends Lowercase<K & string>
      ? Node
      : never;
};

/** Carries ref types for inference; absent at runtime. */
export interface InferRefs<R> {
  readonly "~refs"?: R | undefined;
}

/**
 * Opaque name-keyed type-level stand-in for a ref's runtime index (a number)
 * into {@link FlatRefs}.
 */
type RefKey<K extends string> = `@${K}`;

export type RefKeys<T> = { readonly [K in keyof T as K & string]: RefKey<K & string> };

export type FlatRefs<T> = Node[] & { [K in keyof T & string as RefKey<K>]: T[K] };
