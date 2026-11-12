// The lite tier's signals: subs only (no graph, no owners). Errors follow the full tier's rule
// (every pending callback still runs; which error reaches the caller is unspecified), so there is
// no first-error bookkeeping.
//
// Every sub records the value it was last called with, and a delivery is one compare of that record
// with its signal's current value. A signal holds its first sub itself (callback `g`, record `c`),
// so a one-sub signal allocates nothing more and is that sub's handle. Later subs are nodes, doubly
// linked after the signal, newest first.
//
// A write calls the signal's own sub, then walks its nodes, each when its record differs, storing
// the value before the call. A write made inside a callback walks at once (nested); when the outer
// walk resumes, it re-reads the value per node, so it never delivers a stale one. A batch only
// defers walks: its outermost end pops the signals written (newest first) and walks each, and a
// restored value matches every record but that of a sub created mid-batch, which recorded the
// intermediate value. Writes callbacks make there walk at once; a batch a callback runs there pops
// only the entries pushed since it began, so the end's depth does not grow with the signals pending.
//
// Errors: each callback runs in its own `try`; a walk (and a batch end) keeps the last error caught
// and rethrows it once every callback it reached ran. Which error reaches the caller when several
// throw is unspecified.
//
// Invariants:
//  - `g` is undefined until the first sub, then that sub's callback, NOOP once it is disposed; it
//    never returns to undefined (a disposed slot is never reused, so disposing the signal handle
//    again stays a no-op). So `g === undefined` implies no nodes, and `h.g === fn` tells whether
//    the sub `sub(s, fn)` returned as `h` is live.
//  - Nodes are prepended, so a walk never reaches one created after the walk started its nodes.
//  - A disposed node has callback NOOP and keeps its next pointer, so a walk standing on it, or
//    reaching it through another disposed node, goes on to the nodes that followed it. Its `p` is
//    cleared: nothing reads it again, and a held handle then reaches no disposed sub made after
//    it (live ones stay reachable through the older node it keeps, as from the signal).
//  - Signals have no `p` (reading it gives undefined) and disposed nodes have it undefined, so
//    `p` tells a linked node, which dispose unlinks, from everything else.
//  - Only `batch` changes `depth`: in a bundle without batch, minifiers fold `depth` to 0 and drop
//    the queue, so an app that never calls batch ships none of it.
//
// Values compare with === (NaN counts as changed). Property names are short because minifiers
// keep them; `v, s, g` sit at the same offsets in signals and nodes.

// `=== undefined` tests (V8: one compare, where a truthiness test on an object loads its map),
// and chained assignments are deliberate (bytes); callbacks are typed Function.
// oxlint-disable id-length no-use-before-define no-multi-assign
// oxlint-disable typescript/no-non-null-assertion
// oxlint-disable typescript/no-unsafe-function-type typescript/no-unsafe-call typescript/ban-types

declare const read: unique symbol;
declare const stop: unique symbol;

/** A writable value. `v` is its current value. */
export interface Signal<T> {
  readonly [read]: T;
  readonly v: T;
}

/** What `sub` returns, for `dispose`. */
export interface Sub {
  readonly [stop]: true;
}

/** A signal, and the slot of its first sub. */
interface Head {
  /** The current value. */
  v: unknown;
  /** The newest node. */
  s: Node | undefined;
  /** The first sub's callback: undefined until it exists, NOOP once disposed. */
  g: Function | undefined;
  /** The value of the first sub's last call (stored before the call). */
  c: unknown;
  /** Never set. */
  p?: undefined;
}

/** A sub after the first. */
interface Node {
  /** The value of its last call (stored before the call). */
  v: unknown;
  /** The next (older) node. A disposed node keeps it. */
  s: Node | undefined;
  /** The callback; NOOP once disposed. */
  g: Function;
  /** The previous (newer) node, or the signal; undefined once disposed. */
  p: Head | Node | undefined;
}

/** A disposed sub's callback, and the "nothing thrown" sentinel (no user code can throw it). */
// oxlint-disable-next-line no-empty-function
const NOOP = (): void => {};

/** Open batches. */
let depth = 0;
/** Signals with subs written while a batch is open, once per write; popped by the outermost end. */
const queue: Head[] = [];

// The exports are typed by annotation, so their bodies take signals and nodes with no local alias

export const signal: <T>(value: T) => Signal<T> = (value: unknown) =>
  ({ v: value, s: undefined, g: undefined, c: undefined }) as never;

/** Reads a signal; same as `.v`. */
export const get: <T>(signal: Signal<T>) => T = ((s: Head): unknown => s.v) as never;

export const set: <T>(signal: Signal<T>, value: T) => void = ((s: Head, value: unknown): void => {
  if (s.v !== value) {
    s.v = value;
    if (s.g !== undefined) {
      if (depth) queue.push(s);
      else notify(s);
    }
  }
}) as never;

/**
 * Calls `fn` with the signal's value now and after each change, until disposed. If the first call
 * throws, the sub is disposed and the error rethrown.
 */
export const sub: <T>(signal: Signal<T>, fn: (value: T) => void) => Sub = ((
  s: Head,
  fn: Function,
): Head | Node => {
  // A free slot means no nodes, so `next` is undefined then
  const next = s.s;
  const x: Head | Node =
    s.g === undefined ? ((s.g = fn), (s.c = s.v), s) : (s.s = { v: s.v, s: next, g: fn, p: s });
  if (next !== undefined) next.p = x as Node;
  try {
    fn(s.v);
  } catch (error) {
    dispose(x as never);
    throw error;
  }
  return x;
}) as never;

/** Stops a sub. Idempotent: a disposed node has no `p`, so disposing again only stores NOOP again. */
export const dispose: (handle: Sub) => void = ((x: Node): void => {
  x.g = NOOP;
  if (x.p !== undefined) {
    const next = (x.p.s = x.s);
    if (next !== undefined) next.p = x.p;
    x.p = undefined;
  }
}) as never;

/** Defers notifications to the end of the outermost batch. */
export const batch = (fn: () => void): void => {
  // Below `start` are the entries of the batch end this batch runs in, if any: that end pops them
  const start = queue.length;
  depth++;
  try {
    fn();
  } finally {
    if (!--depth) {
      let error: unknown = NOOP;
      while (queue.length > start) {
        try {
          notify(queue.pop()!);
        } catch (error_) {
          error = error_;
        }
      }
      // The end's error replaces the body's (unspecified which wins)
      // oxlint-disable-next-line no-unsafe-finally
      if (error !== NOOP) throw error;
    }
  }
};

// Calls the first sub, then every node, each when its record differs from the signal's value;
// rethrows the last error after. Two steps, so each sees one shape.
const notify = (s: Head): void => {
  let error: unknown = NOOP;
  if (s.c !== s.v) {
    try {
      s.g!((s.c = s.v));
    } catch (error_) {
      error = error_;
    }
  }
  for (let x = s.s; x !== undefined; x = x.s) {
    if (x.v !== s.v) {
      try {
        x.g((x.v = s.v));
      } catch (error_) {
        error = error_;
      }
    }
  }
  if (error !== NOOP) throw error;
};
