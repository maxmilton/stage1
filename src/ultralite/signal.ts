// The ultralite tier's signals: lite's subs (no graph, no owners) with at most one sub per signal,
// for apps whose signals each have one sub at a time, as list and mark wiring does; fan-out goes
// inside that sub. It drops lite's nodes, so a signal is three fields and its sub allocates nothing.
//
// A signal holds its sub: callback `g` (undefined while it has none) and record `c`, the value of
// the sub's last call (stored before the call). A sub's handle is its signal, so `dispose(h)` stops
// the sub that signal holds at that time.
//
// Outside batches a write that changes the value calls the sub at once, with no further compare,
// and its error reaches the writer as thrown. A write made inside a callback calls at once too
// (nested): a callback that writes its own signal is re-entered, and a chain of such writes
// recurses once per link. A batch queues the signals written, once per write; its outermost end
// pops the queue, newest write first, and calls each popped signal's sub whose record differs from
// its value. Those calls run with `depth` at 1, so the writes they make queue and drain in the same
// loop. A restored value matches the record, except that of a sub created mid-batch after a write
// (it recorded the intermediate value).
//
// Errors: the batch end calls each callback in its own `try` and rethrows the last error caught once
// the queue is empty. A failed first call leaves the signal with no sub and rethrows.
//
// Dev checks sit behind `process.env.NODE_ENV !== "production"`: a production build (which must
// define it, e.g. `define: { "process.env.NODE_ENV": '"production"' }` in Bun.build) drops them
// whole, so they cost no bytes there after terser or swc (Bun's minifier alone keeps the batch
// end's unused counter, 4 B in a bundle with `batch`).
//
// Invariants:
// - I1 One sub: `g` is undefined or the callback of the signal's one sub. Dev builds throw when
//   `sub` finds a callback there; production replaces it (the old sub is never called again).
// - I2 Records: `c === v` for every signal with a sub while no batch is open or ending: `sub`
//   stores the record first, and every unbatched change is delivered at once and stores the record
//   with it. Exceptions after a stack overflow (I4).
// - I3 Depth: only `batch` changes `depth`, and each raise is undone in the frame that made it, with
//   no call or loop in between but a callback's (or the batch body's, under `try`). In a bundle
//   without batch, minifiers with a toplevel-aware pass (terser or swc with `module`) fold `depth`
//   to 0 and drop the queue and the drain; Bun's minifier alone keeps them.
// - I4 Stack overflow: V8 can throw RangeError at a loop's back-edge (an interrupt check) or OSR
//   entry, outside every `try`; the drain loop runs with `depth` at 0 and raises it only around each
//   call, so such a throw only ends the drain early: later writes are delivered as usual. Entries
//   left queued ride with the next batch end (until then, or until their signal's next change,
//   their subs lag), and a write whose own `queue.push` overflowed stored the value without queuing
//   it (its sub catches up at the signal's next change).
//
// Unspecified (what this core does, not a promise):
// - The order of a batch end's calls (newest write first here), and which error reaches the caller
//   when several throw there (the last caught; the end's replaces the body's).
// - Endless write loops: outside batches they overflow the stack; at a batch end production hangs,
//   and dev builds drop the queue and throw at the end's millionth call (a legitimate end of more
//   than a million calls throws too).
// - A handle disposed after its signal got a new sub disposes that sub. A first call that throws
//   after replacing its own sub (dispose, then sub on the same signal) leaves the signal with no sub.
// - Queue growth: one entry per write made in a batch that changes a signal with a sub (a batch
//   end's callbacks' writes included), so a batch of n such writes holds n entries until its end;
//   the queue keeps its peak capacity, and entries left by a stack overflow (I4) stay until the
//   next batch end.
//
// Values compare with === (NaN counts as changed). Property names are short because minifiers
// keep them.
//
// Callbacks are typed Function.
// oxlint-disable id-length max-depth oxclippy/excessive-nesting node/no-process-env
// oxlint-disable typescript/no-non-null-assertion
// oxlint-disable typescript/no-unsafe-function-type typescript/no-unsafe-call typescript/ban-types

import { checkCycle, report } from "../dev.ts";

declare const brand: unique symbol;
export interface Signal<T> {
  /** The current value. Write with `set`. */
  readonly v: T;
  readonly [brand]: "signal";
}
/** A sub's handle: what `sub` returns, for `dispose` (its signal). */
export interface Effect {
  readonly [brand]: "effect";
}

/** A signal and its sub. */
interface Head {
  /** The current value. */
  v: unknown;
  /** The sub's callback; undefined while there is none. */
  g: Function | undefined;
  /** The value of the sub's last call (stored before the call). */
  c: unknown;
}

/** Open batches, plus 1 while the outermost end calls a callback (I3). */
let depth = 0;
/**
 * Signals written while a batch is open, once per write; drained by the outermost end. Also the
 * end's "nothing thrown" value (private, so no user code can throw it).
 */
const queue: Head[] = [];

// The exports are typed by annotation, so their bodies take signals with no local alias

/** A writable value, with no sub yet. */
export const signal: <T>(value: T) => Signal<T> = (value: unknown) =>
  ({ v: value, g: undefined, c: value }) as never;

/** Reads a signal; same as `.v`. */
export const get: <T>(signal: Signal<T>) => T = ((s: Head): unknown => s.v) as never;

/**
 * Stores `value` when it differs (===) from the signal's value and, outside a batch, calls the
 * signal's sub with it before returning; its error reaches the caller.
 */
export const set: <T>(signal: Signal<T>, value: T) => void = ((s: Head, value: unknown): void => {
  if (s.v !== value) {
    s.v = value;
    // No sub: no call (a no-op callback there makes set's call site polymorphic on V8)
    if (s.g !== undefined) {
      if (depth) queue.push(s);
      else s.g((s.c = value));
    }
  }
}) as never;

/**
 * Calls `fn` with the signal's value now and after each change, until disposed. A signal holds one
 * sub: dev builds throw when it has one; production replaces it. If the first call throws, the
 * signal is left with no sub and the error rethrown.
 */
export const sub: <T>(signal: Signal<T>, fn: (value: T) => void) => Effect = ((
  s: Head,
  fn: Function,
): Head => {
  if (process.env.NODE_ENV !== "production" && s.g !== undefined) {
    report("critical", "sub of a signal that already has a sub; dispose that first");
  }
  s.g = fn;
  try {
    fn((s.c = s.v));
  } catch (error) {
    s.g = undefined;
    throw error;
  }
  return s;
}) as never;

/** Stops the sub the handle's signal holds. Idempotent until the signal gets a new sub. */
export const dispose: (handle: Effect) => void = ((s: Head): void => {
  s.g = undefined;
}) as never;

/** Defers notifications to the end of the outermost batch. */
export const batch = <T>(fn: () => T): T => {
  depth++;
  try {
    return fn();
  } finally {
    // The outermost end drains at depth 0 and raises it only around each call (I4)
    if (--depth === 0) {
      let error: unknown = queue;
      let calls = 0;
      // oxlint-disable-next-line unicorn/explicit-length-check -- bytes
      while (queue.length) {
        const s = queue.pop()!;
        if (s.c !== s.v && s.g !== undefined) {
          if (process.env.NODE_ENV !== "production") {
            try {
              checkCycle(++calls, "cycle: a batch end called subs a million times");
            } catch (error_) {
              queue.length = 0;
              error = error_;
              break;
            }
          }
          depth = 1;
          try {
            s.g((s.c = s.v));
          } catch (error_) {
            error = error_;
          }
          depth = 0;
        }
      }
      // The end's error replaces the body's (unspecified which wins)
      // oxlint-disable-next-line no-unsafe-finally
      if (error !== queue) throw error;
    }
  }
};
