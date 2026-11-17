// The lite tier's signals: subs only (no graph, no owners). A write made while a callback runs is
// queued and delivered after that callback returns, as the full tier's subs do: no write calls a
// sub back inside a callback (I1), and a cascade of any length runs in one loop.
//
// Every sub records the value it was last called with, and a delivery is one compare of that record
// with its signal's current value. A signal holds its first sub itself (callback `g`, record `c`),
// so a one-sub signal allocates nothing more and is that sub's handle. Later subs are nodes, doubly
// linked after the signal, newest first.
//
// A write at rest starts a pass (`flush`): it walks the signal, calling the first sub, then the
// nodes, each when its record differs, storing the value before the call; then it pops the queue,
// newest entry first, and walks each popped signal the same way, until the queue is empty. While
// `held` is set (a pass is calling back, a batch is open, or a first call is held), a write only
// pushes its signal, once per write. A batch only holds the pass: its outermost end starts one on
// its newest entry. `sub` holds its first call like a batch: the writes it makes, to its own signal
// too, are delivered after it returns (at rest, before `sub` returns; inside a callback or batch,
// by the pass or batch end that holds it).
//
// Errors: each callback runs in its own `try`; a pass keeps the last error caught and rethrows it
// once the queue is empty. `sub` disposes its sub whenever it throws: when the first call threw
// (before the pass that delivers that call's writes, so it is never called again), and when that
// pass threw (the caller gets no handle).
//
// Dev checks sit behind `process.env.NODE_ENV !== "production"`: a production build (which must
// define it, e.g. `define: { "process.env.NODE_ENV": '"production"' }` in Bun.build) drops them
// whole, so they cost no bytes there after terser or swc (Bun's minifier alone leaves 4 B in a
// bundle with `batch`: a declaration split in two).
//
// Invariants:
// - I1 Held: at rest `held` and `dirty` are false and the queue is empty (after a stack overflow,
//   see I6). A pass sets `held` for each call it makes and clears it after, and runs no user code
//   between calls; every callback runs with `held` set (in a pass, or a first call `sub` holds). So
//   no write starts a pass inside a callback: no callback is re-entered by a write, and no pass
//   runs inside another.
// - I2 Dirty: `dirty` is false only if the queue is empty and the running pass has caught nothing:
//   every push and every caught error sets it, and only a pass that found the queue empty clears
//   it. So a non-empty queue implies `dirty` (the ends of a batch and of a failed first call test
//   the length alone).
// - I3 Records: a walk re-reads the value per sub, so it never delivers a stale one, and a signal
//   pushed again or restored before its turn reaches only the subs whose record differs from its
//   value: none, but a sub created after an earlier write, which recorded the intermediate value.
//   So a sub whose call writes its own signal is called again after it returns, once the pass
//   reaches that entry.
// - I4 Slot: `g` is undefined until the first sub, then that sub's callback, `noop` once it is
//   disposed; it never returns to undefined (a disposed slot is never reused, so disposing the
//   signal handle again stays a no-op). So `g === undefined` implies no nodes, `h.g === fn` tells
//   whether the sub `sub(s, fn)` returned as `h` is live (for `fn` other than `noop`), and a
//   queued signal has a `g`.
// - I5 Nodes are prepended, so a walk never reaches one created after the walk started its nodes. A
//   disposed node has callback `noop` and keeps its next pointer, so a walk standing on it, or
//   reaching it through another disposed node, goes on to the nodes that followed it. Its `p` is
//   cleared: nothing reads it again, and a held handle then reaches no disposed sub made after it
//   (live ones stay reachable through the older node it keeps, as from the signal). Signals have
//   no `p` (reading it gives undefined) and disposed nodes have it undefined, so `p` tells a linked
//   node, which dispose unlinks, from everything else.
// - I6 Stack overflow: a pass sets `held` only around each call (set before its `try`, cleared
//   after it, with no call or loop in between but the callback's), because V8 can throw RangeError
//   at a loop's back-edge or OSR entry, outside every `try` (a `finally` in that loop's frame does
//   not run either): `held` is false at those points, so such a throw only ends the pass early,
//   and later writes still start passes. A batch and a held first call clear or restore `held` in
//   a `finally` of their own loop-free frame before any other call.
//
// Unspecified (what this core does, not a promise):
// - Sibling order: the first sub, then the nodes newest first; across signals, the newest queue
//   entry first. Several errors in one pass: the last one caught reaches the caller (a batch end's
//   replaces its body's; a pass's after a failed first call replaces that call's).
// - Endless write loops hang in production, a sub writing NaN to its own signal included
//   (`set(s, Number(v))`: NaN never equals its record). Dev builds throw from each callback after a
//   pass's millionth call, so the pass drains and rethrows; the subs it skipped keep their old
//   records (a later write of the same value does not reach them), and a legitimate pass of more
//   than a million calls throws too.
// - After a RangeError (stack overflow) a write may go undelivered: its pass or batch end could not
//   start, its walk was cut short, or an overflow at the pass's entry lost the entry popped for it
//   (those subs lag until their signal's next write). Entries left queued ride with the next pass
//   (they left `dirty` set), which also clears a `dirty` left set on an empty queue.
// - Queue growth: one entry per write made while `held` that changes a signal with a sub (a
//   batch's writes, a callback's), so a batch of n such writes holds n entries until its end; the
//   queue keeps its peak capacity.
//
// Values compare with === (NaN counts as changed). Property names are short because minifiers
// keep them; `v, s, g` sit at the same offsets in signals and nodes.
//
// `=== undefined` and `=== false` / `=== true` tests are deliberate: V8 compiles a strict compare
// with undefined or a boolean to one pointer compare, where a truthiness test on a module `var`
// (bundlers turn module `let`/`const` into `var`) is a full ToBoolean, off the write path too
// (measured: truthy tests in `sub` cost V8 sub_dispose_churn 4–11%, in batch's end batch_s1 8%).
// A length tests truthy at no measured cost (batch's end). Chained assignments are deliberate
// (bytes); callbacks are typed Function.
// oxlint-disable id-length no-use-before-define no-multi-assign no-param-reassign max-depth
// oxlint-disable typescript/no-non-null-assertion node/no-process-env
// oxlint-disable typescript/no-unnecessary-boolean-literal-compare oxclippy/bool-comparison
// oxlint-disable unicorn/explicit-length-check
// oxlint-disable typescript/no-unsafe-function-type typescript/no-unsafe-call typescript/ban-types

import { checkCycle } from "../dev.ts";
// A disposed sub's callback: list apps ship it already
import { noop } from "../utils.ts";

declare const brand: unique symbol;
export interface Signal<T> {
  /** The current value. Write with `set`. */
  readonly v: T;
  readonly [brand]: "signal";
}
/** A sub's handle: what `sub` returns, for `dispose`. */
export interface Effect {
  readonly [brand]: "effect";
}

/** A signal, and the slot of its first sub. */
interface Head {
  /** The current value. */
  v: unknown;
  /** The newest node. */
  s: Node | undefined;
  /** The first sub's callback: undefined until it exists, `noop` once disposed (I4). */
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
  /** The callback; `noop` once disposed. */
  g: Function;
  /** The previous (newer) node, or the signal; undefined once disposed. */
  p: Head | Node | undefined;
}

/** True while a pass calls back, a batch is open or a first call is held: writes then queue (I1). */
let held = false;
/**
 * Signals with subs written while `held`, once per write; the pass pops them. Also the pass's
 * "nothing thrown" value (private, so no user code can throw it).
 */
const queue: Head[] = [];
/**
 * Set by every queued write and every error a pass catches; cleared when a pass ends (I2). False:
 * the queue is empty and the running pass has caught nothing.
 */
let dirty = false;

// The exports are typed by annotation, so their bodies take signals and nodes with no local alias

export const signal: <T>(value: T) => Signal<T> = (value: unknown) =>
  ({ v: value, s: undefined, g: undefined, c: undefined }) as never;

/** Reads a signal; same as `.v`. */
export const get: <T>(signal: Signal<T>) => T = ((s: Head): unknown => s.v) as never;

/**
 * Stores `value` when it differs (===) from the signal's value. At rest it then calls the signal's
 * subs, and those of the signals their calls write, before returning, and rethrows one of their
 * errors; inside a callback or batch it queues the signal until that callback returns or the
 * outermost batch ends.
 */
export const set: <T>(signal: Signal<T>, value: T) => void = ((s: Head, value: unknown): void => {
  if (s.v !== value) {
    s.v = value;
    if (s.g !== undefined) {
      if (held === false) flush(s);
      else {
        queue.push(s);
        dirty = true;
      }
    }
  }
}) as never;

/**
 * Calls `fn` with the signal's value now and after each change, until disposed. Writes the first
 * call makes are delivered after it returns (a write to the signal calls `fn` again): at rest
 * before `sub` returns; inside a callback or batch when that callback returns or the outermost
 * batch ends. If the first call throws, the sub is disposed before those writes are delivered and
 * the error rethrown; at rest, if their delivery throws, the sub is disposed too (inside a
 * callback or batch, the write or batch end delivering them rethrows it, and the sub stays).
 */
export const sub: <T>(signal: Signal<T>, fn: (value: T) => void) => Effect = ((
  s: Head,
  fn: Function,
): Head | Node => {
  // A free slot means no nodes, so `next` is undefined then
  const next = s.s;
  const x: Head | Node =
    s.g === undefined ? ((s.g = fn), (s.c = s.v), s) : (s.s = { v: s.v, s: next, g: fn, p: s });
  if (next !== undefined) next.p = x as Node;
  // Inside a callback or batch (`held` set: callbacks restore it in their own frames) the holder
  // delivers the first call's writes, and the catch only disposes and rethrows. At rest the call is
  // held like a batch; the finally clears `held` before any other call (I6: an overflow at `fn`'s
  // entry is inside the inner `try`, and the calls the catch makes run with `held` clear), the sub
  // is disposed before the pass that delivers the first call's writes, and a throw from that pass
  // disposes it too (the catch then finds the queue drained, unless an overflow cut that pass
  // short: it drains the rest). One catch and no saved flag: no value lives across the call (V8:
  // sub_first). The catch is cold, so it tests the length alone (I2)
  try {
    if (held === true) fn(s.v);
    else {
      held = true;
      try {
        fn(s.v);
      } finally {
        held = false;
      }
      if (dirty === true && queue.length !== 0) flush(queue.pop()!);
    }
  } catch (error) {
    dispose(x as never);
    if (held === false && queue.length) flush(queue.pop()!);
    throw error;
  }
  return x;
}) as never;

/** Stops a sub. Idempotent: a disposed node has no `p`, so disposing again only stores `noop`. */
export const dispose: (handle: Effect) => void = ((x: Node): void => {
  x.g = noop;
  if (x.p !== undefined) {
    const next = (x.p.s = x.s);
    if (next !== undefined) next.p = x.p;
    x.p = undefined;
  }
}) as never;

/**
 * Defers notifications to the end of the outermost batch (inside a callback, until that callback
 * returns).
 */
export const batch = <T>(fn: () => T): T => {
  const was = held;
  held = true;
  try {
    return fn();
  } finally {
    held = was;
    // The end's error replaces the body's (unspecified which wins)
    // Tests the length alone: a batch has nearly always queued (a non-empty queue is dirty: I2)
    if (was === false && queue.length) flush(queue.pop()!);
  }
};

/** Dev builds only: calls the running pass made (an endless write loop throws: `checkPass`). */
let calls = 0;
/** Dev builds only: inside a callback's `try`, so the pass drains (each call left throws too). */
const checkPass = (): void => {
  checkCycle(++calls, "cycle: a pass called subs a million times");
};

// A pass: walks `s`, then, while `dirty` (anything queued or caught), pops and walks until the
// queue is empty (newest first); rethrows the last error after. A walk calls the first sub, then
// every node, each when its record differs from the signal's value; two steps, so each sees one
// shape. `held` is set only around each call (I6). One walk serves the write and the drain (one
// loop: smaller, and what JSC inlines); one `dirty` test sits on the at-rest path.
const flush = (s: Head): void => {
  let error: unknown = queue;
  if (process.env.NODE_ENV !== "production") calls = 0;
  for (;;) {
    if (s.c !== s.v) {
      held = true;
      try {
        if (process.env.NODE_ENV !== "production") checkPass();
        s.g!((s.c = s.v));
      } catch (error_) {
        error = error_;
        dirty = true;
      }
      held = false;
    }
    for (let x = s.s; x !== undefined; x = x.s) {
      if (x.v !== s.v) {
        held = true;
        try {
          if (process.env.NODE_ENV !== "production") checkPass();
          x.g((x.v = s.v));
        } catch (error_) {
          error = error_;
          dirty = true;
        }
        held = false;
      }
    }
    if (dirty === false) return;
    // Test the length first: a never-pushed array pops slowly on JSC (exit churn)
    if (queue.length === 0) break;
    s = queue.pop()!;
  }
  dirty = false;
  if (error !== queue) throw error;
};
