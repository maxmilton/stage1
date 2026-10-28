// Characterization: Bun's `expectTypeOf` and TypeScript behaviour the type tests rely on.
// oxlint-disable typescript/no-explicit-any

import { describe, expect, expectTypeOf, mock, test } from "bun:test";

const isAssertion = (value: unknown): boolean =>
  typeof (value as { toEqualTypeOf?: unknown } | undefined)?.toEqualTypeOf === "function";

describe("expectTypeOf", () => {
  test("types", () => {
    expect.assertions(0);

    // toBeVoid also accepts undefined.
    type Done = () => void;
    expectTypeOf<undefined>().toBeVoid();
    expectTypeOf<Done>().returns.not.toBeUndefined();

    // Under exactOptionalPropertyTypes, optional parameters extract with `| undefined`.
    type Optional = (options?: { a: number }) => void;
    expectTypeOf<Optional>().parameters.toEqualTypeOf<[options?: { a: number } | undefined]>();
    // @ts-expect-error - `?:` alone doesn't match
    expectTypeOf<Optional>().parameters.toEqualTypeOf<[options?: { a: number }]>();

    // Extraction erases type parameters to constraints or unknown; defaults apply at call sites.
    type Generic = <T extends Node = Element>(html: string) => ChildNode & T;
    expectTypeOf<Generic>().returns.toEqualTypeOf<ChildNode & Node>();
    expectTypeOf<ReturnType<Generic>>().toEqualTypeOf<ChildNode & Node>();
    expectTypeOf((fn: Generic) => fn("")).returns.toEqualTypeOf<ChildNode & Element>();
    expectTypeOf<<T>() => T[]>().returns.toEqualTypeOf<unknown[]>();

    // An erased `keyof T` is never, and `.returns` on a never parameter is any.
    type Keyed = <T>(key: keyof T) => void;
    expectTypeOf<Keyed>().parameters.toEqualTypeOf<[key: never]>();
    expectTypeOf<Keyed>().returns.toBeAny();

    // Equality rejects any and never; toExtend accepts any; a top-level guard misses nested any.
    // @ts-expect-error - any doesn't equal string
    expectTypeOf<any>().toEqualTypeOf<string>();
    // @ts-expect-error - never doesn't equal string
    expectTypeOf<never>().toEqualTypeOf<string>();
    expectTypeOf<any>().toExtend<string>();
    // toExtend also accepts extra properties, so it never proves equality.
    expectTypeOf<{ a: number; b: string }>().toExtend<{ a: number }>();
    expectTypeOf<{ value: any }>().not.toBeAny();

    // Equality is representation-sensitive; branded compares structure.
    // @ts-expect-error - an intersection doesn't equal its flattened object
    expectTypeOf<{ a: 1 } & { b: 2 }>().toEqualTypeOf<{ a: 1; b: 2 }>();
    expectTypeOf<{ a: 1 } & { b: 2 }>().branded.toEqualTypeOf<{ a: 1; b: 2 }>();

    // Chains union overloads and drop never; Parameters and ReturnType take the last overload.
    interface Overloaded {
      (a: string): string;
      (a: number): never;
    }
    expectTypeOf<Overloaded>().parameters.toEqualTypeOf<[a: string] | [a: number]>();
    expectTypeOf<Overloaded>().returns.toEqualTypeOf<string>();
    expectTypeOf<Parameters<Overloaded>>().toEqualTypeOf<[a: number]>();
    expectTypeOf<ReturnType<Overloaded>>().toBeNever();
    interface OverloadedConstructor {
      new (a: string): { s: string };
      new (a: number): { n: number };
    }
    expectTypeOf<OverloadedConstructor>().constructorParameters.toEqualTypeOf<
      [a: string] | [a: number]
    >();

    class Box<T> {
      public items: T[] = [];

      private constructor() {}

      public get size(): number {
        return this.items.length;
      }

      public add(item: T): void {
        this.items.push(item);
      }

      public get(): T[] {
        return this.items;
      }
    }

    // toMatchObjectType picks a subset only from object-literal types.
    interface Fields {
      a: number;
      b: string;
    }
    expectTypeOf<{ a: number; b: string }>().toMatchObjectType<{ a: number }>();
    // @ts-expect-error - interfaces are compared whole
    expectTypeOf<Fields>().toMatchObjectType<{ a: number }>();
    // @ts-expect-error - class instances are compared whole
    expectTypeOf<Box<string>>().toMatchObjectType<{ size: number }>();
    expectTypeOf<Pick<Box<string>, "size">>().toEqualTypeOf<{ readonly size: number }>();

    // Interfaces lack the implicit index signature that object-literal types have.
    expectTypeOf<Fields>().not.toExtend<Record<string, unknown>>();
    expectTypeOf<{ a: number; b: string }>().toExtend<Record<string, unknown>>();

    // toExtend: method parameters are bivariant; function-property parameters aren't.
    expectTypeOf<Box<string>>().toExtend<Box<string | number>>();
    // @ts-expect-error - function properties are checked contravariantly
    expectTypeOf<{ m: (x: string) => void }>().toExtend<{ m: (x: string | number) => void }>();

    // A generic class's prototype instantiates its parameters as any.
    expectTypeOf<(typeof Box.prototype)["get"]>().returns.items.toBeAny();
    expectTypeOf<Box<string>["get"]>().returns.toEqualTypeOf<string[]>();

    // A private constructor doesn't extend a construct signature; a public one does.
    expectTypeOf(Box).not.toExtend<new (...args: never[]) => Box<unknown>>();
    // @ts-expect-error - a public constructor extends it
    expectTypeOf(Date).not.toExtend<new (...args: never[]) => Date>();

    // Negated toBeCallableWith and toBeConstructibleWith are typed never.
    // @ts-expect-error - negated toBeCallableWith
    expectTypeOf((a: number) => a).not.toBeCallableWith("a");
    // @ts-expect-error - negated toBeConstructibleWith
    expectTypeOf(Date).not.toBeConstructibleWith(1);

    // toBeCallableWith checks the erased signature, so it can't infer type parameters.
    interface Cell<T> {
      get: () => T;
      set: (value: T) => void;
    }
    const read = <T extends string>(cell: Cell<T>): T => cell.get();
    const cell: Cell<"a"> = { get: () => "a", set: () => {} };
    expectTypeOf(read(cell)).toEqualTypeOf<"a">();
    expectTypeOf(read<"a">).toBeCallableWith(cell);
    // @ts-expect-error - checked against Cell<string>, not inferred from `cell`
    expectTypeOf(read).toBeCallableWith(cell);
  });

  test("property chains return assertion objects", () => {
    expect.assertions(1);
    const assertion = expectTypeOf((a: number) => a) as unknown as Record<string, unknown>;
    const properties = [
      "parameters",
      "returns",
      "items",
      "branded",
      "constructorParameters",
      "thisParameter",
      "instance",
      "resolves",
      "guards",
      "asserts",
    ];
    expect(properties.filter((key) => !isAssertion(assertion[key]))).toEqual([]);
  });

  test("extraction methods return undefined, so they can't chain", () => {
    expect.assertions(1);
    const assertion = expectTypeOf({ a: 1 }) as unknown as Record<string, () => unknown>;
    const methods = [
      "parameter",
      "pick",
      "omit",
      "extract",
      "exclude",
      "toHaveProperty",
      "toBeCallableWith",
      "toBeConstructibleWith",
    ];
    expect(methods.filter((key) => assertion[key]() !== undefined)).toEqual([]);
  });

  test(".map() returns an assertion object", () => {
    expect.assertions(1);
    expect(isAssertion(expectTypeOf(1).map(() => "a"))).toBeTrue();
  });

  test(".map() never runs its callback", () => {
    expect.assertions(1);
    const project = mock(() => "a");
    expectTypeOf(1)
      .map(() => project())
      .toEqualTypeOf<string>();
    expect(project).not.toHaveBeenCalled();
  });

  test(".returns never calls the function", () => {
    expect.assertions(1);
    const fn = mock(() => 1);
    expectTypeOf(() => fn()).returns.toEqualTypeOf<number>();
    expect(fn).not.toHaveBeenCalled();
  });
});
