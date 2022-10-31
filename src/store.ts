/* eslint-disable @typescript-eslint/indent */

type Handler<T, K extends keyof T> = (value: T[K], prev: T[K]) => unknown;
type Handlers<T, K extends keyof T> = Record<K, Handler<T, K>[] | undefined>;
type StoreOn<T, K extends keyof T> = (key: K, callback: Handler<T, K>) => void;
type StoreOff<T, K extends keyof T> = (key: K, callback: Handler<T, K>) => void;
/** @returns A function that will remove the listener when called. */
type StoreListen<T, K extends keyof T> = (
  key: K,
  callback: Handler<T, K>,
) => () => void;

export const store = <
  T extends Record<string | symbol, unknown>,
  K extends keyof T,
>(
  initialState: T,
): T & {
  on: StoreOn<T, K>;
  off: StoreOff<T, K>;
  listen: StoreListen<T, K>;
} => {
  const handlers = {} as Handlers<T, K>;

  const proxy = new Proxy(initialState, {
    // @ts-expect-error - FIXME: Resolve "'K' could be instantiated with a different subtype" error
    set(target, property: K, value: T[K], receiver) {
      if (handlers[property]) {
        for (const listener of handlers[property]!) {
          listener(value, target[property]);
        }
      }
      return Reflect.set(target, property, value, receiver);
    },
  }) as T & {
    on: StoreOn<T, K>;
    off: StoreOff<T, K>;
    listen: StoreListen<T, K>;
  };

  // TODO: Could these be added without calling the proxy setter? And while saving bytes?

  proxy.on = (property, callback) => {
    (handlers[property] ??= []).push(callback);
  };
  proxy.off = (property, callback) => {
    // eslint-disable-next-line no-bitwise
    handlers[property]?.splice(handlers[property]!.indexOf(callback) >>> 0, 1);
  };
  proxy.listen = (property, callback) => {
    proxy.on(property, callback);
    return () => proxy.off(property, callback);
  };

  return proxy;
};
