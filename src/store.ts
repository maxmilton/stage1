type Handler<T, K extends keyof T> = (value: T[K], prev: Readonly<T[K]>) => void;
type Store<T, K extends keyof T> = T & {
  readonly on: (
    key: K,
    callback: Handler<T, K>,
  ) => /**
   * off
   * @returns Returns true if the handler was removed, or false if it was already removed.
   */ () => boolean;
};

/**
 * Create a reactive data store.
 *
 * @param initialState - An initial store state object. It must not have an `on`
 * property because that is used to register callback functions.
 *
 * @returns A proxied state object that triggers registered callback handler
 * functions when its properties are set.
 */
export const store = <
  T extends Record<string | symbol, unknown>,
  K extends Exclude<keyof T, number>,
>(
  initialState: T & { on?: never },
): Store<T, K> => {
  const handlers = new Map<K, Set<Handler<T, K>>>();

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
      set(target, property: K, value: T[K]) {
        handlers.get(property)?.forEach((fn) => fn(value, target[property]));
        // eslint-disable-next-line no-param-reassign
        (target as T)[property] = value;
        return true;
      },
    },
  );
};
