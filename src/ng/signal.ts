// Reactivity in two tiers:
//  1. signal, get, set, sub, untracked and batch: a value with direct sinks, no
//     dependency tracking. A batch installs `hook`, which defers sinks only.
//  2. computed and effect: a glitch-free push-pull graph, ported from alien-signals
//     3.2.1 (https://github.com/stackblitz/alien-signals). Their first use installs
//     `track` and `after` and replaces `hook`, so code using only tier 1 bundles none of it.
//
// A Bun build can fix the tier instead, with at most one feature flag:
//  - STAGE1_SIGNAL_LITE: tier 1 without batch. Nodes drop the batch and graph fields, and
//    batch, computed and effect throw.
//  - STAGE1_SIGNAL_GRAPH: both tiers and batch, with the graph wired into get, set and batch.
// Bun folds feature() only where it is the condition of an if or a ternary, so every site
// spells its flag out.
//
// Values compare with ===, as in alien-signals, so writing NaN again counts as a change and
// -0 equals 0. Differences from alien-signals: a computed read outside any effect does not
// link to its sources (it revalidates against a global write count instead, so nothing keeps
// it alive); a throwing effect or sink does not stop the others, the first error is rethrown
// once all have run; and a watched computed keeps an error it throws as its value, as Preact
// does: reads rethrow it, and what depends on it re-runs, until what it read changes.
// alien-signals leaves an effect whose dependency check threw dead.
//
// Property names are short because minifiers keep them as written. Every node lists the
// fields it shares with other kinds first, in one order, so a walk that meets several kinds
// loads each field at one offset. Tests compare with undefined rather than for truthiness: V8
// compiles a truthiness test on an object to a map load and bit test, a compare to one
// instruction. Notifying sinks is the exception: there, JSC is far slower comparing a
// function-or-null with null.

// Bit flags, labelled loops and chained assignments are alien-signals' own, kept as is.
// oxlint-disable id-length no-bitwise no-continue no-labels no-multi-assign oxclippy/never-loop
// oxlint-disable no-param-reassign no-use-before-define typescript/no-non-null-assertion
// oxlint-disable typescript/prefer-optional-chain max-depth oxclippy/excessive-nesting
// oxlint-disable unicorn/explicit-length-check unicorn/number-literal-case
// An effect returns nothing or a cleanup, typed as alien-signals and its conformance suite type it.
// oxlint-disable typescript/no-invalid-void-type

import { feature } from "bun:bundle";

export interface Signal<T> {
  /** The current value; reading it does not subscribe anything. */
  readonly v: T;
}

/** A sink subscribed to a signal: a node in a doubly linked list. */
interface Sink {
  /** Callback, or null once disposed. */
  f: ((value: never) => void) | null;
  /** Next sink. */
  n: Sink | undefined;
  /** Previous sink, or the signal for the first. */
  p: Sink | SignalNode;
}

/** An edge between a dependency and a subscriber, in both of their lists. */
interface Link {
  /** Version: the run of `S` that last read `D`. */
  v: number;
  /** Dependency. */
  D: Node;
  /** Subscriber. */
  S: Node;
  /** Previous link in `D`'s subscriber list. */
  ps: Link | undefined;
  /** Next link in `D`'s subscriber list. */
  ns: Link | undefined;
  /** Previous link in `S`'s dependency list. */
  pd: Link | undefined;
  /** Next link in `S`'s dependency list. */
  nd: Link | undefined;
}

interface Node {
  /** Flags. */
  f: number;
  /** Subscribers head. */
  s?: Link | undefined;
  /** Subscribers tail. */
  t?: Link | undefined;
  /** Dependencies head. */
  d?: Link | undefined;
  /** Dependencies tail. */
  e?: Link | undefined;
}

interface SignalNode extends Node {
  v: unknown;
  /** Value the graph last saw, while DIRTY; cleared when committed or unwatched. */
  c: unknown;
  /** Sinks, head. */
  n: Sink | undefined;
}

interface ComputedNode extends Node {
  v: unknown;
  g: () => unknown;
  /** Global write count when last evaluated outside any effect. */
  w: number;
}

/** The only node without `v`, which tells effects apart. */
interface EffectNode extends Node {
  g: () => (() => void) | void;
  /** Cleanup the last run returned. */
  c: (() => void) | void;
}

interface Stack<T> {
  v: T;
  p: Stack<T> | undefined;
}

const MUTABLE = 1;
const WATCHING = 2;
const RECURSED_CHECK = 4;
const RECURSED = 8;
const DIRTY = 16;
const PENDING = 32;
// Marks a parent effect whose dependencies include a child effect.
const HAS_CHILD_EFFECT = 64;
// Marks a computed whose value is the error its last evaluation threw. The graph treats it as
// clean; reading it rethrows.
const ERRORED = 128;
// A signal is never a subscriber, so it reuses WATCHING's and RECURSED_CHECK's bits for
// its sinks: QUEUED while in `pairs` for a batch end, and LATE once given a sink since,
// so that end notifies whatever the value.
const QUEUED = 2;
const LATE = 4;

/** Sentinel for "no error caught", since anything can be thrown. */
const NONE = {};

let activeSub: Node | undefined;
/** The graph's flush, once a computed or effect installs it. */
let after: (() => void) | undefined;
/**
 * What `set` calls besides notifying: a batch installs sink batching, and a computed or
 * effect replaces it with the graph's write. Measured: in V8, once `set` has run `defer` a
 * few times before the graph installs, `write` there is a second target, and graph-app writes
 * to signals with only sinks run about 1.2× slower. Two slots avoid that but give up 5–23%
 * on writes and batches in the usual order. A STAGE1_SIGNAL_GRAPH build calls `write` itself.
 */
let hook: ((s: SignalNode, prev: unknown) => void) | undefined;
let track: ((s: SignalNode) => void) | undefined;

// ── Tier 1 ──────────────────────────────────────────────────────────────────

export const signal = <T>(value: T): Signal<T> =>
  // A LITE node needs no graph or batch fields
  (feature("STAGE1_SIGNAL_LITE")
    ? { v: value, n: undefined }
    : {
        f: MUTABLE,
        s: undefined,
        t: undefined,
        v: value,
        c: undefined,
        n: undefined,
      }) as SignalNode as Signal<T>;

/** Reads a signal; inside a computed or effect, also subscribes it. */
export const get = <T>(s: Signal<T>): T => {
  // LITE has nothing to subscribe; GRAPH tracks directly
  if (!feature("STAGE1_SIGNAL_LITE") && activeSub !== undefined) {
    if (feature("STAGE1_SIGNAL_GRAPH")) trackSignal(s as SignalNode);
    else track!(s as SignalNode);
  }
  return s.v;
};

export const set = <T>(s: Signal<T>, value: T): void => {
  const prev = s.v;
  if (prev === value) return;
  (s as SignalNode).v = value;
  if (feature("STAGE1_SIGNAL_GRAPH")) write(s as SignalNode, prev);
  else if (feature("STAGE1_SIGNAL_LITE") || hook === undefined) notify(s as SignalNode);
  else hook(s as SignalNode, prev);
};

/**
 * Calls `fn` with the signal's value now and after every change, until the
 * returned function is called. Reads inside `fn` subscribe nothing. Subscribing
 * after a batch wrote the signal, but before it notifies the signal's sinks, makes
 * it notify every sink, even if the value is unchanged.
 */
export const sub = <T>(s: Signal<T>, fn: (value: T) => void): (() => void) => {
  // No local alias for the node: the minifier keeps it
  const head = (s as SignalNode).n;
  const sink: Sink = { f: fn, n: head, p: s as SignalNode };
  if (head !== undefined) head.p = sink;
  (s as SignalNode).n = sink;
  // A sink subscribed after a batched write saw a value the others didn't, so the
  // batch notifies when it ends even if it restores the value
  if (!feature("STAGE1_SIGNAL_LITE") && (s as SignalNode).f & QUEUED) {
    (s as SignalNode).f |= LATE;
  }
  const dispose = (): void => {
    if (sink.f === null) return;
    sink.f = null;
    // `sink.n` stays, so a notification currently at this sink can move on
    sink.p.n = sink.n;
    if (sink.n !== undefined) sink.n.p = sink.p;
  };
  // Without the graph nothing subscribes; Bun keeps the unused locals a shared body would leave
  if (feature("STAGE1_SIGNAL_LITE")) {
    try {
      fn(s.v);
    } catch (error) {
      dispose();
      throw error;
    }
    return dispose;
  }
  const prevSub = activeSub;
  activeSub = undefined;
  try {
    fn(s.v);
  } catch (error) {
    dispose();
    throw error;
  } finally {
    activeSub = prevSub;
  }
  return dispose;
};

// Calls every sink, then throws the first error. New sinks go first, so a
// notification in progress never reaches them.
const notify = (s: SignalNode): void => {
  let error: unknown = NONE;
  for (let sink = s.n; sink !== undefined; sink = sink.n) {
    if (sink.f) {
      try {
        sink.f(s.v as never);
      } catch (error_) {
        if (error === NONE) error = error_;
      }
    }
  }
  if (error !== NONE) throw error;
};

// ── Tier 2 ──────────────────────────────────────────────────────────────────

// `cycle` and `writes` wrap below 2^30, V8's small-integer limit: past it they turn into heap
// numbers, and the graph ran 11–47% slower in V8. A wrap reuses values after 2^30 steps.
let cycle = 0;
let runDepth = 0;
let batchDepth = 0;
let writes = 0;
let notifyIndex = 0;
let queuedLength = 0;
const queued: (EffectNode | undefined)[] = [];
/** Signals with sinks that batches wrote, each followed by its value before the write. */
const pairs: unknown[] = [];
/** 1 while the outermost batch notifies `pairs`, which it does at depth 1. */
let ending = 0;

// An unbatched write, the end of an outermost batch, and disposing an effect are each a pass:
// a sink, effect or cleanup that throws does not stop the others, and the pass throws the first
// error once all have run. A pass inside a sink or effect keeps its errors apart from the
// enclosing one.

/** The first error a sink, effect or cleanup threw in the current pass, or NONE. */
let thrown: unknown = NONE;

const report = (error: unknown): void => {
  if (thrown === NONE) thrown = error;
};

/** Ends a pass: restores the enclosing pass's error, then throws this pass's first. */
const end = (outer: unknown): void => {
  const error = thrown;
  thrown = outer;
  if (error !== NONE) throw error;
};

const install = (): void => {
  if (feature("STAGE1_SIGNAL_LITE")) {
    throw new Error("stage1: computed and effect are left out of a STAGE1_SIGNAL_LITE build");
  }
  if (track === undefined) {
    hook = write;
    track = trackSignal;
    after = flush;
  }
};

/** Whether a batch takes a write: queued for its end, or with no sinks to notify. */
const deferred = (s: SignalNode, prev: unknown): boolean => {
  if (s.n === undefined || s.f & QUEUED) return true;
  if (batchDepth > ending) {
    s.f |= QUEUED;
    pairs.push(s, prev);
    return true;
  }
  // A write made as the batch ends, outside a nested batch, notifies at once
  return false;
};

// Sinks only: a batch defers them, with no graph to propagate to
const defer = (s: SignalNode, prev: unknown): void => {
  if (!(batchDepth && deferred(s, prev))) notify(s);
};

const trackSignal = (s: SignalNode): void => {
  if (s.f & DIRTY && updateSignal(s)) shallowPropagate(s.s);
  link(s, activeSub!, cycle);
};

const write = (s: SignalNode, prev: unknown): void => {
  writes = (writes + 1) & 0x3fffffff;
  if (s.s !== undefined) {
    if (!(s.f & DIRTY)) {
      s.c = prev;
      s.f |= DIRTY;
    }
    propagate(s.s, runDepth ? RECURSED | PENDING : PENDING);
  }
  // No sinks, or a batch end that has yet to reach them notifies the final value
  if (batchDepth && deferred(s, prev)) return;
  const outer = thrown;
  thrown = NONE;
  if (s.n !== undefined) {
    // Sinks run outside any subscriber
    const prevSub = activeSub;
    activeSub = undefined;
    try {
      notify(s);
    } catch (error) {
      report(error);
    }
    activeSub = prevSub;
  }
  flush();
  end(outer);
};

/**
 * Defers sinks and effects until `fn` returns; sinks alone need no graph. Nested batches,
 * including one a sink starts as the outermost ends, wait for the outermost. As it ends, a
 * write to a signal it has yet to notify joins it. The order its signals' sinks run in is
 * unspecified.
 */
export const batch = (fn: () => void): void => {
  if (feature("STAGE1_SIGNAL_LITE")) {
    throw new Error("stage1: batch is left out of a STAGE1_SIGNAL_LITE build");
  }
  // Never replaces the graph's write, which batches too
  if (!feature("STAGE1_SIGNAL_GRAPH")) hook ??= defer;
  ++batchDepth;
  try {
    fn();
  } finally {
    if (!--batchDepth) {
      const outer = thrown;
      thrown = NONE;
      if (pairs.length) {
        const prevSub = activeSub;
        activeSub = undefined;
        // Writes by sinks see a batch, so one to a signal not yet reached joins it
        batchDepth = ending = 1;
        // Popped as notified: one pass, last written first. Measured: popping keeps V8's
        // backing store, where `length = 0` drops it and the next batch regrows it
        while (pairs.length) {
          const prev = pairs.pop();
          const s = pairs.pop() as SignalNode;
          const flags = s.f;
          s.f = flags & ~(QUEUED | LATE);
          if (flags & LATE || prev !== s.v) {
            try {
              notify(s);
            } catch (error) {
              report(error);
            }
          }
        }
        batchDepth = ending = 0;
        activeSub = prevSub;
      }
      if (feature("STAGE1_SIGNAL_GRAPH")) flush();
      else if (after !== undefined) after();
      end(outer);
    }
  }
};

/**
 * A cached derivation of other signals and computeds, re-run lazily. While watched, an error
 * `fn` throws is cached too: reading rethrows it until what `fn` read changes.
 */
export const computed = <T>(fn: () => T): (() => T) => {
  if (!feature("STAGE1_SIGNAL_GRAPH")) install();
  const c: ComputedNode = {
    f: 0,
    s: undefined,
    t: undefined,
    d: undefined,
    e: undefined,
    v: undefined,
    g: fn,
    w: -1,
  };
  return () => readComputed(c) as T;
};

/**
 * Runs `fn` now and again whenever what it read changes, until disposed. A function
 * `fn` returns is called, outside any subscriber, before the next run and on disposal;
 * one that throws disposes its effect. If the first run throws, the effect is disposed, with
 * any effects it created, and the error rethrown.
 */
export const effect = (fn: () => (() => void) | void): (() => void) => {
  if (!feature("STAGE1_SIGNAL_GRAPH")) install();
  const e: EffectNode = {
    f: WATCHING | RECURSED_CHECK,
    s: undefined,
    t: undefined,
    d: undefined,
    e: undefined,
    g: fn,
    c: undefined,
  };
  const prevSub = activeSub;
  activeSub = e;
  if (prevSub !== undefined) {
    link(e, prevSub, 0);
    prevSub.f |= HAS_CHILD_EFFECT;
  }
  try {
    try {
      ++runDepth;
      e.c = fn();
    } finally {
      --runDepth;
      activeSub = prevSub;
      e.f &= ~RECURSED_CHECK;
    }
  } catch (error) {
    // The caller never gets the disposer, so a failed first run leaves nothing behind. Errors
    // its children's cleanups throw stay out of the enclosing pass: this error goes first.
    const outer = thrown;
    disposeEffect(e);
    thrown = outer;
    throw error;
  }
  // A pass: throws the first error a cleanup threw. Measured: 22 B smaller than comparing
  // `thrown` before and after, for V8 disposing 6% slower (Max's choice)
  return () => {
    const outer = thrown;
    thrown = NONE;
    disposeEffect(e);
    end(outer);
  };
};

/** Calls `fn` outside any computed or effect, so its reads subscribe nothing. */
export const untracked = <T>(fn: () => T): T => {
  if (feature("STAGE1_SIGNAL_LITE")) return fn();
  const prevSub = activeSub;
  activeSub = undefined;
  try {
    return fn();
  } finally {
    activeSub = prevSub;
  }
};

// Watched and clean is the hot read: one mask test, then link. Everything else is outlined in
// `refresh`, which links and rethrows itself. Measured against the inline form: V8 write_graph
// 0.71, kairo 0.99, JSC 0.96; sharing one `link` and ERRORED test between them lost most of it.
const readComputed = (c: ComputedNode): unknown => {
  const subscriber = activeSub;
  if ((c.f & (MUTABLE | DIRTY | PENDING | ERRORED)) !== MUTABLE) return refresh(c, subscriber);
  if (subscriber !== undefined) link(c, subscriber, cycle);
  return c.v;
};

const refresh = (c: ComputedNode, subscriber: Node | undefined): unknown => {
  const flags = c.f;
  if (flags & DIRTY || (flags & PENDING && checkDirty(c.d!, c))) {
    if (updateComputed(c)) shallowPropagate(c.s);
  } else if (flags & PENDING) {
    c.f = flags & ~PENDING;
  } else if (!flags) {
    // First observed evaluation: updateComputed caches what it throws
    if (subscriber !== undefined) updateComputed(c);
    else if (c.w !== writes) {
      // Unobserved: evaluate without linking, so the sources keep no reference
      const at = writes;
      c.v = c.g();
      c.w = at;
    }
  }
  if (subscriber !== undefined) link(c, subscriber, cycle);
  if (c.f & ERRORED) throw c.v;
  return c.v;
};

const updateComputed = (c: ComputedNode): boolean => {
  c.e = undefined;
  c.f = MUTABLE | RECURSED_CHECK;
  const prevSub = activeSub;
  activeSub = c;
  try {
    cycle = (cycle + 1) & 0x3fffffff;
    const prev = c.v;
    return prev !== (c.v = c.g());
  } catch (error) {
    // The error becomes the value, and a change: a check never throws, and dependents re-run
    c.v = error;
    c.f |= ERRORED;
    return true;
  } finally {
    activeSub = prevSub;
    c.f &= ~RECURSED_CHECK;
    purgeDeps(c);
  }
};

const updateSignal = (s: SignalNode): boolean => {
  s.f &= ~DIRTY;
  const prev = s.c;
  // Releases the old value
  s.c = undefined;
  return prev !== s.v;
};

const run = (e: EffectNode): void => {
  const flags = e.f;
  if (flags & DIRTY || (flags & PENDING && checkDirty(e.d!, e))) {
    if (flags & HAS_CHILD_EFFECT) disposeChildEffects(e);
    if (e.c !== undefined) {
      cleanup(e);
      // The cleanup disposed it
      if (!e.f) return;
    }
    e.e = undefined;
    e.f = WATCHING | RECURSED_CHECK;
    const prevSub = activeSub;
    activeSub = e;
    try {
      cycle = (cycle + 1) & 0x3fffffff;
      ++runDepth;
      e.c = e.g();
    } finally {
      --runDepth;
      activeSub = prevSub;
      // A live effect keeps WATCHING or RECURSED_CHECK through its run: a child it queues clears
      // WATCHING. With neither, the run disposed the effect: drop what the rest of the run read
      // and created, and call the cleanup it returned. Measured: reading e.f twice here costs V8
      // 9% on effect re-runs.
      const f = e.f;
      e.f = f & ~RECURSED_CHECK;
      if (f & (WATCHING | RECURSED_CHECK)) purgeDeps(e);
      else disposeEffect(e);
    }
  } else if (e.d !== undefined) {
    e.f = WATCHING | (flags & HAS_CHILD_EFFECT);
  }
};

const disposeChildEffects = (e: EffectNode): void => {
  for (let dep = e.e; dep !== undefined;) {
    const prev = dep.pd;
    if (!("v" in dep.D)) unlink(dep, e);
    dep = prev;
  }
};

// Runs the queued effects, and any they queue.
const flush = (): void => {
  while (notifyIndex < queuedLength) {
    const e = queued[notifyIndex]!;
    queued[notifyIndex++] = undefined;
    try {
      run(e);
    } catch (error) {
      report(error);
    }
  }
  notifyIndex = queuedLength = 0;
};

const disposeEffect = (e: Node): void => {
  e.f = 0;
  disposeDeps(e);
  if (e.s !== undefined) unlink(e.s);
  if ((e as EffectNode).c !== undefined) cleanup(e as EffectNode);
};

// Runs outside any subscriber, and at most once; one that throws disposes its effect
const cleanup = (e: EffectNode): void => {
  const fn = e.c!;
  e.c = undefined;
  try {
    untracked(fn);
  } catch (error) {
    // A batch body is no pass. Its end reports the error: it notifies this stand-in signal,
    // LATE so whatever its value, and the sink rethrows. Measured: tracking the error in
    // `batch` costs it 21–28% on empty batches.
    if (batchDepth > ending)
      pairs.push(
        {
          f: LATE,
          n: {
            f: () => {
              throw error;
            },
          },
        },
        0,
      );
    else report(error);
    disposeEffect(e);
  }
};

const disposeDeps = (subscriber: Node): void => {
  subscriber.e = undefined;
  purgeDeps(subscriber);
};

const purgeDeps = (subscriber: Node): void => {
  const tail = subscriber.e;
  let dep = tail === undefined ? subscriber.d : tail.nd;
  while (dep !== undefined) dep = unlink(dep, subscriber);
};

// Queues an effect and its watching ancestors, outermost first.
const enqueue = (e: Node): void => {
  let insertIndex = queuedLength;
  let firstIndex = insertIndex;
  let node: Node | undefined = e;
  do {
    queued[insertIndex++] = node as EffectNode;
    node.f &= ~WATCHING;
    node = node.s === undefined ? undefined : node.s.S;
  } while (node !== undefined && node.f & WATCHING);
  queuedLength = insertIndex;
  while (firstIndex < --insertIndex) {
    const left = queued[firstIndex];
    queued[firstIndex++] = queued[insertIndex];
    queued[insertIndex] = left;
  }
};

// A signal, never a subscriber, has no deps tail. It keeps MUTABLE and its sink bits, which
// outlive its subscribers, but drops a pending previous value: no subscriber is left to see it.
const unwatched = (node: Node): void => {
  if (!("v" in node)) disposeEffect(node);
  else if (node.e !== undefined) {
    node.f = 0;
    (node as ComputedNode).w = -1;
    disposeDeps(node);
  } else if (node.f & DIRTY) {
    // A signal: a computed with no deps tail has no source to dirty it
    node.f &= ~DIRTY;
    (node as SignalNode).c = undefined;
  }
};

const link = (dep: Node, subscriber: Node, version: number): void => {
  const prevDep = subscriber.e;
  if (prevDep !== undefined && prevDep.D === dep) return;
  const nextDep = prevDep === undefined ? subscriber.d : prevDep.nd;
  if (nextDep !== undefined && nextDep.D === dep) {
    nextDep.v = version;
    subscriber.e = nextDep;
    return;
  }
  const prevSub = dep.t;
  if (prevSub !== undefined && prevSub.v === version && prevSub.S === subscriber) return;
  const edge: Link =
    (subscriber.e =
    dep.t =
      {
        v: version,
        D: dep,
        S: subscriber,
        pd: prevDep,
        nd: nextDep,
        ps: prevSub,
        ns: undefined,
      });
  if (nextDep !== undefined) nextDep.pd = edge;
  if (prevDep === undefined) subscriber.d = edge;
  else prevDep.nd = edge;
  if (prevSub === undefined) dep.s = edge;
  else prevSub.ns = edge;
};

const unlink = (edge: Link, subscriber = edge.S): Link | undefined => {
  const { D: dep, pd: prevDep, nd: nextDep, ns: nextSub, ps: prevSub } = edge;
  if (nextDep === undefined) subscriber.e = prevDep;
  else nextDep.pd = prevDep;
  if (prevDep === undefined) subscriber.d = nextDep;
  else prevDep.nd = nextDep;
  if (nextSub === undefined) dep.t = prevSub;
  else nextSub.ps = prevSub;
  if (prevSub !== undefined) prevSub.ns = nextSub;
  else if ((dep.s = nextSub) === undefined) unwatched(dep);
  return nextDep;
};

// `mark` is what a newly pending subscriber gets: PENDING, plus RECURSED for a write inside an effect.
const propagate = (edge: Link, mark: number): void => {
  let next = edge.ns;
  let stack: Stack<Link | undefined> | undefined;

  top: for (;;) {
    const subscriber = edge.S;
    let flags = subscriber.f;

    if (!(flags & (RECURSED_CHECK | RECURSED | DIRTY | PENDING))) {
      subscriber.f = flags | mark;
    } else if (!(flags & (RECURSED_CHECK | RECURSED))) {
      flags = 0;
    } else if (!(flags & RECURSED_CHECK)) {
      subscriber.f = (flags & ~RECURSED) | PENDING;
    } else if (!(flags & (DIRTY | PENDING)) && isValidLink(edge, subscriber)) {
      subscriber.f = flags | RECURSED | PENDING;
      flags &= MUTABLE;
    } else {
      flags = 0;
    }

    if (flags & WATCHING) enqueue(subscriber);

    if (flags & MUTABLE && subscriber.s !== undefined) {
      edge = subscriber.s;
      if (edge.ns !== undefined) {
        stack = { v: next, p: stack };
        next = edge.ns;
      }
      continue;
    }

    if (next !== undefined) {
      edge = next;
      next = edge.ns;
      continue;
    }

    while (stack !== undefined) {
      const resume = stack.v;
      stack = stack.p;
      if (resume !== undefined) {
        edge = resume;
        next = edge.ns;
        continue top;
      }
    }

    return;
  }
};

const checkDirty = (edge: Link, subscriber: Node): boolean => {
  let stack: Stack<Link> | undefined;
  let checkDepth = 0;
  let dirty = false;

  top: for (;;) {
    const dep = edge.D;
    const flags = dep.f;

    if (subscriber.f & DIRTY) {
      dirty = true;
    } else if ((flags & (MUTABLE | DIRTY)) === (MUTABLE | DIRTY)) {
      const subs = dep.s!;
      if ("w" in dep ? updateComputed(dep as ComputedNode) : updateSignal(dep as SignalNode)) {
        if (subs.ns !== undefined) shallowPropagate(subs);
        dirty = true;
      }
    } else if ((flags & (MUTABLE | PENDING)) === (MUTABLE | PENDING)) {
      stack = { v: edge, p: stack };
      edge = dep.d!;
      subscriber = dep;
      ++checkDepth;
      continue;
    }

    if (!dirty && edge.nd !== undefined) {
      edge = edge.nd;
      continue;
    }

    while (checkDepth--) {
      edge = stack!.v;
      stack = stack!.p;
      if (dirty) {
        // Only a computed is ever PENDING and MUTABLE, so only computeds are descended into
        const subs = subscriber.s!;
        if (updateComputed(subscriber as ComputedNode)) {
          if (subs.ns !== undefined) shallowPropagate(subs);
          subscriber = edge.S;
          continue;
        }
        dirty = false;
      } else {
        subscriber.f &= ~PENDING;
      }
      subscriber = edge.S;
      if (edge.nd !== undefined) {
        edge = edge.nd;
        continue top;
      }
    }

    return dirty && subscriber.f !== 0;
  }
};

const shallowPropagate = (edge: Link | undefined): void => {
  for (; edge !== undefined; edge = edge.ns) {
    const subscriber = edge.S;
    const flags = subscriber.f;
    if ((flags & (PENDING | DIRTY)) !== PENDING) continue;
    subscriber.f = flags | DIRTY;
    if ((flags & (WATCHING | RECURSED_CHECK)) === WATCHING) enqueue(subscriber);
  }
};

const isValidLink = (checkLink: Link, subscriber: Node): boolean => {
  for (let edge = subscriber.e; edge !== undefined; edge = edge.pd) {
    if (edge === checkLink) return true;
  }
  return false;
};

// At most one tier flag. Last, since a statement before the constants stops Bun inlining them
if (feature("STAGE1_SIGNAL_LITE") && feature("STAGE1_SIGNAL_GRAPH")) {
  throw new Error("stage1: set at most one of STAGE1_SIGNAL_LITE and STAGE1_SIGNAL_GRAPH");
}
