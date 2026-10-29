// Reactivity in two tiers:
//  1. signal, get, set and sub: a value with direct sinks, no dependency tracking.
//  2. computed, effect and batch: a glitch-free push-pull graph, ported from
//     alien-signals 3.2.1 (https://github.com/stackblitz/alien-signals). Its first
//     use installs `hook` and `track`, so code using only tier 1 bundles none of it.
//
// Differences from alien-signals: values compare with Object.is; a computed read
// outside any effect does not link to its sources (it revalidates against a global
// write count instead, so nothing keeps it alive); and a throwing effect or sink does
// not stop the others, the first error is rethrown once all have run.
//
// Property names are short because minifiers keep them as written.

// Bit flags, labelled loops and chained assignments are alien-signals' own, kept as is.
// oxlint-disable id-length no-bitwise no-continue no-labels no-multi-assign oxclippy/never-loop
// oxlint-disable no-param-reassign no-use-before-define typescript/no-non-null-assertion
// oxlint-disable typescript/prefer-optional-chain max-depth unicorn/explicit-length-check

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
  /** Previous sink. */
  p: Sink | undefined;
}

/** An edge between a dependency and a subscriber, in both of their lists. */
interface Link {
  /** Version: the run of `S` that last read `D`. */
  v: number;
  /** Dependency. */
  D: Node;
  /** Subscriber. */
  S: Node;
  /** Previous and next link in `D`'s subscriber list. */
  ps: Link | undefined;
  ns: Link | undefined;
  /** Previous and next link in `S`'s dependency list. */
  pd: Link | undefined;
  nd: Link | undefined;
}

interface Node {
  /** Dependencies, head and tail. */
  d?: Link | undefined;
  e?: Link | undefined;
  /** Subscribers, head and tail. */
  s?: Link | undefined;
  t?: Link | undefined;
  /** Flags. */
  f: number;
}

interface SignalNode extends Node {
  v: unknown;
  /** Value the graph last saw; meaningful only while DIRTY. */
  c: unknown;
  /** Sinks, head. */
  k: Sink | undefined;
}

interface ComputedNode extends Node {
  v: unknown;
  g: () => unknown;
  /** Global write count when last evaluated outside any effect. */
  n: number;
}

interface EffectNode extends Node {
  g: () => void;
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

/** Sentinel for "no error caught", since anything can be thrown. */
const NONE = {};

let activeSub: Node | undefined;
let hook: ((s: SignalNode, prev: unknown) => void) | undefined;
let track: ((s: SignalNode) => void) | undefined;

// ── Tier 1 ──────────────────────────────────────────────────────────────────

export const signal = <T>(value: T): Signal<T> =>
  ({
    v: value,
    c: undefined,
    k: undefined,
    s: undefined,
    t: undefined,
    f: MUTABLE,
  }) as SignalNode as Signal<T>;

/** Reads a signal; inside a computed or effect, also subscribes it. */
export const get = <T>(s: Signal<T>): T => {
  if (activeSub) track!(s as SignalNode);
  return s.v;
};

export const set = <T>(s: Signal<T>, value: T): void => {
  const prev = s.v;
  if (Object.is(prev, value)) return;
  (s as SignalNode).v = value;
  if (hook) hook(s as SignalNode, prev);
  else rethrow(notify(s as SignalNode, NONE));
};

/**
 * Calls `fn` with the signal's value now and after every change, until the
 * returned function is called. Reads inside `fn` subscribe nothing.
 */
export const sub = <T>(s: Signal<T>, fn: (value: T) => void): (() => void) => {
  const node = s as SignalNode;
  const head = node.k;
  const sink: Sink = { f: fn, n: head, p: undefined };
  if (head) head.p = sink;
  node.k = sink;
  const dispose = (): void => {
    if (!sink.f) return;
    sink.f = null;
    // `sink.n` stays, so a notification currently at this sink can move on
    if (sink.p) sink.p.n = sink.n;
    else node.k = sink.n;
    if (sink.n) sink.n.p = sink.p;
  };
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
      if (!fns.size) {
        unsubscribe!();
        unsubscribe = undefined;
      }
    };
  };
};

/** Calls `fn(arg)`; returns `error` unless that is NONE and `fn` threw. */
const attempt = <A>(fn: (arg: A) => void, arg: A, error: unknown): unknown => {
  try {
    fn(arg);
  } catch (error_) {
    if (error === NONE) return error_;
  }
  return error;
};

const rethrow = (error: unknown): void => {
  if (error !== NONE) throw error;
};

// New sinks go first, so a notification in progress never reaches them.
const notify = (s: SignalNode, error: unknown): unknown => {
  for (let sink = s.k; sink; sink = sink.n) {
    if (sink.f) error = attempt(sink.f, s.v as never, error);
  }
  return error;
};

// ── Tier 2 ──────────────────────────────────────────────────────────────────

let cycle = 0;
let runDepth = 0;
let batchDepth = 0;
let writes = 0;
let notifyIndex = 0;
let queuedLength = 0;
const queued: (EffectNode | undefined)[] = [];
const batched = new Map<SignalNode, unknown>();

const install = (): void => {
  hook = write;
  track = trackSignal;
};

const trackSignal = (s: SignalNode): void => {
  if (s.f & DIRTY && updateSignal(s) && s.s) shallowPropagate(s.s);
  link(s, activeSub!, cycle);
};

const write = (s: SignalNode, prev: unknown): void => {
  writes++;
  if (s.s) {
    if (!(s.f & DIRTY)) {
      s.c = prev;
      s.f = MUTABLE | DIRTY;
    }
    propagate(s.s, runDepth > 0);
  }
  if (batchDepth) {
    if (!batched.has(s)) batched.set(s, prev);
    return;
  }
  const error = notifyUntracked(s, NONE);
  rethrow(queuedLength ? attempt(flush, undefined, error) : error);
};

const notifyUntracked = (s: SignalNode, error: unknown): unknown => {
  if (!s.k || !activeSub) return notify(s, error);
  const prevSub = activeSub;
  activeSub = undefined;
  error = notify(s, error);
  activeSub = prevSub;
  return error;
};

/** Defers sinks and effects until `fn` returns; nested batches wait for the outermost. */
export const batch = (fn: () => void): void => {
  install();
  ++batchDepth;
  try {
    fn();
  } finally {
    if (!--batchDepth) {
      let error: unknown = NONE;
      const entries = [...batched];
      batched.clear();
      for (const [s, prev] of entries) {
        if (!Object.is(prev, s.v)) error = notifyUntracked(s, error);
      }
      rethrow(attempt(flush, undefined, error));
    }
  }
};

/** A cached derivation of other signals and computeds, re-run lazily. */
export const computed = <T>(fn: () => T): (() => T) => {
  install();
  const c: ComputedNode = {
    v: undefined,
    g: fn,
    n: -1,
    d: undefined,
    e: undefined,
    s: undefined,
    t: undefined,
    f: 0,
  };
  return () => readComputed(c) as T;
};

/** Runs `fn` now and again whenever what it read changes, until disposed. */
export const effect = (fn: () => void): (() => void) => {
  install();
  const e: EffectNode = {
    g: fn,
    d: undefined,
    e: undefined,
    s: undefined,
    t: undefined,
    f: WATCHING | RECURSED_CHECK,
  };
  const prevSub = activeSub;
  activeSub = e;
  if (prevSub) {
    link(e, prevSub, 0);
    prevSub.f |= HAS_CHILD_EFFECT;
  }
  try {
    ++runDepth;
    fn();
  } finally {
    --runDepth;
    activeSub = prevSub;
    e.f &= ~RECURSED_CHECK;
  }
  return () => {
    disposeEffect(e);
  };
};

const readComputed = (c: ComputedNode): unknown => {
  const subscriber = activeSub;
  const flags = c.f;
  if (flags & DIRTY || (flags & PENDING && checkDirty(c.d!, c))) {
    if (updateComputed(c) && c.s) shallowPropagate(c.s);
  } else if (flags & PENDING) {
    c.f = flags & ~PENDING;
  } else if (!flags) {
    if (subscriber) {
      c.f = MUTABLE | RECURSED_CHECK;
      activeSub = c;
      try {
        c.v = c.g();
      } finally {
        activeSub = subscriber;
        c.f &= ~RECURSED_CHECK;
      }
    } else if (c.n !== writes) {
      // Unobserved: evaluate without linking, so the sources keep no reference
      const at = writes;
      c.v = c.g();
      c.n = at;
    }
  }
  if (subscriber) link(c, subscriber, cycle);
  return c.v;
};

const update = (node: Node): boolean => {
  if ("n" in node) return updateComputed(node as ComputedNode);
  return updateSignal(node as SignalNode);
};

const updateComputed = (c: ComputedNode): boolean => {
  c.e = undefined;
  c.f = MUTABLE | RECURSED_CHECK;
  const prevSub = activeSub;
  activeSub = c;
  try {
    ++cycle;
    const prev = c.v;
    return !Object.is(prev, (c.v = c.g()));
  } finally {
    activeSub = prevSub;
    c.f &= ~RECURSED_CHECK;
    purgeDeps(c);
  }
};

const updateSignal = (s: SignalNode): boolean => {
  s.f = MUTABLE;
  return !Object.is(s.c, s.v);
};

const run = (e: EffectNode): void => {
  const flags = e.f;
  if (flags & DIRTY || (flags & PENDING && checkDirty(e.d!, e))) {
    if (flags & HAS_CHILD_EFFECT) disposeChildEffects(e);
    e.e = undefined;
    e.f = WATCHING | RECURSED_CHECK;
    const prevSub = activeSub;
    activeSub = e;
    try {
      ++cycle;
      ++runDepth;
      e.g();
    } finally {
      --runDepth;
      activeSub = prevSub;
      e.f &= ~RECURSED_CHECK;
      purgeDeps(e);
    }
  } else if (e.d) {
    e.f = WATCHING | (flags & HAS_CHILD_EFFECT);
  }
};

const disposeChildEffects = (e: EffectNode): void => {
  for (let dep = e.e; dep;) {
    const prev = dep.pd;
    if (!("n" in dep.D) && !("k" in dep.D)) unlink(dep, e);
    dep = prev;
  }
};

const flush = (): void => {
  let error: unknown = NONE;
  while (notifyIndex < queuedLength) {
    const e = queued[notifyIndex]!;
    queued[notifyIndex++] = undefined;
    error = attempt(run, e, error);
  }
  notifyIndex = 0;
  queuedLength = 0;
  rethrow(error);
};

const disposeEffect = (e: Node): void => {
  e.f = 0;
  disposeDeps(e);
  if (e.s) unlink(e.s);
};

const disposeDeps = (subscriber: Node): void => {
  for (let dep = subscriber.e; dep;) {
    const prev = dep.pd;
    unlink(dep, subscriber);
    dep = prev;
  }
};

const purgeDeps = (subscriber: Node): void => {
  const tail = subscriber.e;
  let dep = tail ? tail.nd : subscriber.d;
  while (dep) dep = unlink(dep, subscriber);
};

// Queues an effect and its watching ancestors, outermost first.
const enqueue = (e: Node): void => {
  let insertIndex = queuedLength;
  let firstIndex = insertIndex;
  let node: Node | undefined = e;
  do {
    queued[insertIndex++] = node as EffectNode;
    node.f &= ~WATCHING;
    node = node.s?.S;
  } while (node && node.f & WATCHING);
  queuedLength = insertIndex;
  while (firstIndex < --insertIndex) {
    const left = queued[firstIndex];
    queued[firstIndex++] = queued[insertIndex];
    queued[insertIndex] = left;
  }
};

// A signal goes through disposeEffect too: clearing its flags is harmless, since
// a write sets them again and every tracked read commits a pending value first.
const unwatched = (node: Node): void => {
  if (!("n" in node)) disposeEffect(node);
  else if (node.e) {
    node.f = 0;
    (node as ComputedNode).n = -1;
    disposeDeps(node);
  }
};

const link = (dep: Node, subscriber: Node, version: number): void => {
  const prevDep = subscriber.e;
  if (prevDep?.D === dep) return;
  const nextDep = prevDep ? prevDep.nd : subscriber.d;
  if (nextDep?.D === dep) {
    nextDep.v = version;
    subscriber.e = nextDep;
    return;
  }
  const prevSub = dep.t;
  if (prevSub?.v === version && prevSub.S === subscriber) return;
  const edge: Link =
    (subscriber.e =
    dep.t =
      { v: version, D: dep, S: subscriber, pd: prevDep, nd: nextDep, ps: prevSub, ns: undefined });
  if (nextDep) nextDep.pd = edge;
  if (prevDep) prevDep.nd = edge;
  else subscriber.d = edge;
  if (prevSub) prevSub.ns = edge;
  else dep.s = edge;
};

const unlink = (edge: Link, subscriber = edge.S): Link | undefined => {
  const { D: dep, pd: prevDep, nd: nextDep, ns: nextSub, ps: prevSub } = edge;
  if (nextDep) nextDep.pd = prevDep;
  else subscriber.e = prevDep;
  if (prevDep) prevDep.nd = nextDep;
  else subscriber.d = nextDep;
  if (nextSub) nextSub.ps = prevSub;
  else dep.t = prevSub;
  if (prevSub) prevSub.ns = nextSub;
  else if (!(dep.s = nextSub)) unwatched(dep);
  return nextDep;
};

const propagate = (edge: Link, innerWrite: boolean): void => {
  let next = edge.ns;
  let stack: Stack<Link | undefined> | undefined;

  top: for (;;) {
    const subscriber = edge.S;
    let flags = subscriber.f;

    if (!(flags & (RECURSED_CHECK | RECURSED | DIRTY | PENDING))) {
      subscriber.f = flags | PENDING;
      if (innerWrite) subscriber.f |= RECURSED;
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

    if (flags & MUTABLE && subscriber.s) {
      edge = subscriber.s;
      if (edge.ns) {
        stack = { v: next, p: stack };
        next = edge.ns;
      }
      continue;
    }

    if (next) {
      edge = next;
      next = edge.ns;
      continue;
    }

    while (stack) {
      const resume = stack.v;
      stack = stack.p;
      if (resume) {
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
      if (update(dep)) {
        if (subs.ns) shallowPropagate(subs);
        dirty = true;
      }
    } else if ((flags & (MUTABLE | PENDING)) === (MUTABLE | PENDING)) {
      stack = { v: edge, p: stack };
      edge = dep.d!;
      subscriber = dep;
      ++checkDepth;
      continue;
    }

    if (!dirty && edge.nd) {
      edge = edge.nd;
      continue;
    }

    while (checkDepth--) {
      edge = stack!.v;
      stack = stack!.p;
      if (dirty) {
        const subs = subscriber.s!;
        if (update(subscriber)) {
          if (subs.ns) shallowPropagate(subs);
          subscriber = edge.S;
          continue;
        }
        dirty = false;
      } else {
        subscriber.f &= ~PENDING;
      }
      subscriber = edge.S;
      if (edge.nd) {
        edge = edge.nd;
        continue top;
      }
    }

    return dirty && subscriber.f !== 0;
  }
};

const shallowPropagate = (edge: Link | undefined): void => {
  for (; edge; edge = edge.ns) {
    const subscriber = edge.S;
    const flags = subscriber.f;
    if ((flags & (PENDING | DIRTY)) !== PENDING) continue;
    subscriber.f = flags | DIRTY;
    if ((flags & (WATCHING | RECURSED_CHECK)) === WATCHING) enqueue(subscriber);
  }
};

const isValidLink = (checkLink: Link, subscriber: Node): boolean => {
  for (let edge = subscriber.e; edge; edge = edge.pd) {
    if (edge === checkLink) return true;
  }
  return false;
};
