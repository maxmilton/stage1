// XXX: THIS STORE FEATURE IS EXPERIEMNTAL AND MAY BE REMOVED IN FUTURE!!

type Handler<T, K extends keyof T> = (value: T[K], prev: T[K]) => any;
type Handlers<T> = Record<keyof T, Handler<T, keyof T>[]>;
type StoreOn<T> = <K extends keyof T>(key: K, callback: Handler<T, K>) => void;
type StoreOff<T> = <K extends keyof T>(key: K, callback: Handler<T, K>) => void;
type StoreListen<T> = <K extends keyof T>(
  key: K,
  callback: Handler<T, K>,
) => () => void;

// TODO: Could something similar be achived without using Proxy for better browser support?

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

/**
 * Run callback when a node has been removed from the DOM.
 *
 * Use sparingly to minimize performance impact.
 */
export const onNodeRemove = (node: Node, callback: () => void): void => {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.removedNodes[0]?.contains(node)) {
        callback();
        observer.disconnect();
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
};
