// oxlint-disable oxclippy/similar-names id-length

import { type Signal, sub } from "./signal.ts";

/**
 * Selection by key: `select(key, fn)` calls `fn(selected)` now and whenever
 * `key` becomes or stops being `source`'s value. A change calls only the old
 * and new keys' callbacks, however many keys there are. One callback per key;
 * `source` is subscribed only while some key is.
 */
export const selector = <K>(
  source: Signal<K>,
): ((key: K, fn: (selected: boolean) => void) => () => void) => {
  const fns = new Map<K, (selected: boolean) => void>();
  let current: K;
  let unsubscribe: (() => void) | undefined;
  const move = (value: K): void => {
    if (Object.is(value, current)) return;
    const prev = current;
    current = value;
    fns.get(prev)?.(false);
    fns.get(value)?.(true);
  };
  return (key, fn) => {
    fn(Object.is(key, source.v));
    fns.set(key, fn);
    if (!unsubscribe) {
      current = source.v;
      unsubscribe = sub(source, move);
    }
    return () => {
      if (fns.get(key) !== fn) return;
      fns.delete(key);
      if (fns.size === 0) {
        // oxlint-disable-next-line typescript/no-non-null-assertion
        unsubscribe!();
        unsubscribe = undefined;
      }
    };
  };
};

/**
 * Selection by key, as `selector`, but each key registers a node and one `fn`
 * marks them all: `mark(key, node)` calls `fn(node, true)` now if `key` is
 * `source`'s value, and on a change `fn` runs for the old key's node (false)
 * and the new key's node (true). A node starts unmarked, so unselected keys
 * cost no call. Measured 4–6% faster than `selector` creating and removing
 * rows, and as fast selecting. Remembers the selected key, not its node, so a
 * removed node is never marked.
 */
export const mapper = <K, N>(
  source: Signal<K>,
  fn: (node: N, selected: boolean) => void,
): ((key: K, node: N) => () => void) => {
  const nodes = new Map<K, N>();
  let shown = source.v;
  sub(source, (key) => {
    const prev = nodes.get(shown);
    if (prev) fn(prev, false);
    shown = key;
    const next = nodes.get(key);
    if (next) fn(next, true);
  });
  return (key, node) => {
    if (Object.is(key, source.v)) fn(node, true);
    nodes.set(key, node);
    return () => {
      nodes.delete(key);
    };
  };
};
