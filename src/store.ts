type Key<T> = Extract<keyof T, string | symbol>;
type Handler<T> = (value: T, prev: Readonly<T>) => void;
type Store<T> = T & {
  readonly on: <K extends Key<T>>(
    key: K,
    callback: Handler<T[K]>,
  ) => /**
   * Off
   *
   * @returns Returns true if the handler was removed, or false if it was already removed.
   */ () => boolean;
};

/**
 * Create a reactive data store.
 *
 * @param initialState - An initial store state object. It must not have an `on`
 *   property because that is used to register callback functions.
 * @returns A proxied state object that triggers registered callback handler
 *   functions when its properties are set.
 */
export const store = <T extends Record<string | symbol, unknown>>(
  initialState: Readonly<T> & { on?: never },
): Store<T> => {
  const handlers = new Map<Key<T>, Set<Handler<never>>>();

  return new Proxy(
    {
      // Shallow copy to prevent mutating the initial state object
      ...initialState,
      on(key, fn) {
        let list = handlers.get(key);
        if (!list) handlers.set(key, (list = new Set()));
        list.add(fn);
        return () => list.delete(fn);
      },
    },
    {
      set(target, property: Key<T>, value: T[Key<T>]) {
        handlers
          .get(property)
          // oxlint-disable-next-line unicorn/no-array-for-each typescript/no-confusing-void-expression
          ?.forEach((fn): void => (fn as Handler<T[Key<T>]>)(value, target[property]));
        (target as T)[property] = value;
        return true;
      },
    },
  );
};
