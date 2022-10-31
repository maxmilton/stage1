type Handler<T, K extends keyof T> = (value: T[K], prev: T[K]) => any;
type Handlers<T> = Record<keyof T, Handler<T, keyof T>[]>;
type StoreOn<T> = <K extends keyof T>(key: K, callback: Handler<T, K>) => void;
type StoreOff<T> = <K extends keyof T>(key: K, callback: Handler<T, K>) => void;
type StoreListen<T> = <K extends keyof T>(
  key: K,
  callback: Handler<T, K>,
) => () => void;

export const store = <T extends Record<string, any>>(
  initialState: T,
): T & { on: StoreOn<T>; off: StoreOff<T>; listen: StoreListen<T> } => {
  const handlers = {} as Handlers<T>;

  const proxy = new Proxy(initialState, {
    set(target, property, value, receiver) {
      if (typeof property === 'string' && handlers[property]) {
        for (const listener of handlers[property]) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          listener(value, target[property]);
        }
      }
      return Reflect.set(target, property, value, receiver);
    },
  }) as T & { on: StoreOn<T>; off: StoreOff<T>; listen: StoreListen<T> };

  // TODO: Could these be added without calling the proxy setter? And while saving bytes?

  proxy.on = (property, callback) => {
    // @ts-expect-error- FIXME:!
    (handlers[property] ??= []).push(callback);
  };
  proxy.off = (property, callback) => {
    // @ts-expect-error- FIXME:!
    // eslint-disable-next-line no-bitwise
    handlers[property]?.splice(handlers[property].indexOf(callback) >>> 0, 1);
  };
  proxy.listen = (property, callback) => {
    proxy.on(property, callback);
    return () => proxy.off(property, callback);
  };

  return proxy;
};
