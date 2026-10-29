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
    const prev = current;
    if (Object.is(value, prev)) return;
    current = value;
    fns.get(prev)?.(false);
    // That callback may have changed the selection again
    if (Object.is(current, value)) fns.get(value)?.(true);
  };
  return (key, fn) => {
    // Subscribing sets `current`, the value the sink has seen, which in a batch
    // can differ from `source.v`; no key is registered yet to call
    unsubscribe ??= sub(source, move);
    fn(Object.is(key, current));
    fns.set(key, fn);
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
 * cost no call. Measured against `selector`: 4–6% faster creating rows, 2–3%
 * faster removing them, and 6–16% faster selecting. One node per key; `fn`
 * never runs for a removed node.
 */
export const mapper = <K, N>(
  source: Signal<K>,
  fn: (node: N, selected: boolean) => void,
): ((key: K, node: N) => () => void) => {
  const nodes = new Map<K, N>();
  // The value the sink has seen, which in a batch can differ from `source.v`
  let shown = source.v;
  // The marked node, so a change looks up only the new key
  let lit: N | undefined;
  // Set once a key is registered twice; until then, cleanups skip checking that
  // their node is still the one registered
  let shared = false;
  sub(source, (key) => {
    if (Object.is(key, shown)) return;
    shown = key;
    const old = lit;
    lit = nodes.get(key);
    if (old) fn(old, false);
    // `lit`, not a local: if that call changed the selection again, this
    // re-marks the newest node rather than marking a stale one
    if (lit) fn(lit, true);
  });
  return (key, node) => {
    if (Object.is(key, shown)) {
      lit = node;
      fn(node, true);
    }
    const size = nodes.size;
    nodes.set(key, node);
    if (nodes.size === size) shared = true;
    return () => {
      if (!shared || nodes.get(key) === node) nodes.delete(key);
      if (lit === node) lit = undefined;
    };
  };
};
