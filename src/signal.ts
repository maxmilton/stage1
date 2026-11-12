// Signals, computeds, effects and scopes: an ownership-first intrusive tree over a single-colour,
// value-recording dependency graph. An effect or scope owns the effects, computeds, scopes and
// cleanups (`defer`) its run creates: they are disposed, newest first, before it re-runs and when
// it is disposed. Owner-aware primitives (list, mark: ./reconcile.ts) use the "Integration" section
// at the end; each export there tree-shakes when unused.
//
// Dev checks sit behind `process.env.NODE_ENV !== "production"`: a production build (which must
// define it, e.g. `define: { "process.env.NODE_ENV": '"production"' }` in Bun.build) drops them
// whole, so they cost no bytes there.
//
// Invariants:
// - I1 A marked node's subscribers are marked (marks stop at marked nodes). Validation clears a
//   mark when it descends into the node, so it also terminates on cycles.
// - I2 A link's `v` is the value its subscriber read, or the link itself (equal to no value) if one
//   run read two values through it. A node is current when every link's `v` is its dep's current
//   `v` (deps validated first).
// - I3 Runners (effects, scopes, cleanup nodes) keep their children in `s`, newest first. A child's
//   `n` is its older sibling and `p` its newer one, or its owner if it is the newest. Effects and
//   scopes also keep their owner in `o` (for the climb).
// - I4 Stamp: `runs` is the running reader's id (an effect's run or first run, a computed's
//   evaluation). Each run takes the next id, and so does a run that resumes after other code ran
//   (a nested run, or untracked code: a cleanup, a scope's fn, `untracked`), which may have stamped
//   with the current one. A source's `o` is the id of the last run that read it (NONE: none), so
//   `o === runs` means the running reader linked it since it started or resumed; `set` above
//   depth 0 resets it. A read first tries the link after the cursor (static re-runs), then the
//   stamp. Ids repeat after 2^30 runs.
// - I5 Cursor: while an effect or computed runs, its `v` is the last dep link its run read
//   (undefined before the first); the run's end stores the cleanup or value there.
// - I6 A marked effect is queued or running. A running effect a write marks (its own, its
//   cleanups', its children's first runs') does not run again for it: its run's end validates its
//   marked deps (restoring I1) and unmarks it, so its queue entry does nothing. Its links keep the
//   values it read, so a later check re-runs it if the write changed them for good.
// - I7 `depth` is above 0 while a batch, flush, first run or disposal is open: writes then only
//   mark and queue. At depth 0 no effect is marked or running (computeds stay marked until read),
//   so neither tracker nor owner is set when a flush starts.
// - I8 Teardown: children and cleanup nodes newest first, in one list, then the node's own
//   cleanup. A node leaves its owner's list only when its teardown is done, so a `dispose` that
//   re-enters a teardown in progress (a cleanup disposing an ancestor) finishes it first.
// - I9 Cleanup errors are dropped (dev builds console.error them): teardown never throws.
// oxlint-disable no-bitwise no-param-reassign no-use-before-define
// Short names, `=== undefined` tests and chained assignments are deliberate (bytes; V8 speed), and
// dev checks read process.env and log to the console.
// oxlint-disable id-length no-console no-continue no-multi-assign no-negated-condition no-shadow
// oxlint-disable node/no-process-env unicorn/no-negated-condition unicorn/no-useless-undefined
// oxlint-disable unicorn/number-literal-case typescript/explicit-member-accessibility
// oxlint-disable typescript/non-nullable-type-assertion-style typescript/no-unsafe-call
// oxlint-disable typescript/prefer-optional-chain

/** Kinds and states, in `f`. Signals are 0. */
const C = 1; // computed
const E = 2; // effect: a runner that tracks its reads
const S = 4; // scope (has a fn) or cleanup node (none): a runner that never tracks
const M = 8; // marked: a dep may have changed since the last run or evaluation
const D = 16; // disposed
const X = 32; // computed: `v` is the error its getter threw
const N = 64; // effect or scope with an effect among its owners: it climbs (parent-first)
const R = 128; // dev builds only: a computed whose getter is running (cycle check)
/** Run ids wrap below 2^30 to stay small integers; NONE is no run's. */
const MASK = 0x3fffffff;
const NONE = -1;

/**
 * An object literal, made in one place (`track`) in this field order: with a class, a GC after the
 * last Link died deoptimized every function that used one (V8).
 */
interface Link {
  D: Node; // dep
  S: Node; // subscriber
  v: unknown; // the value S read from D (I2)
  d: Link | undefined; // next dep of S (continues S's `d`)
  p: Link | undefined; // previous (newer) subscriber of D
  n: Link | undefined; // next (older) subscriber of D (named apart from Node.s: sharing it stops JSC inlining run)
}

class Node {
  declare f: number;
  declare v: unknown; // signal/computed: value (or error, X); runner: its cleanup; running: cursor (I5)
  declare g: (() => unknown) | undefined; // computed getter, effect/scope fn
  declare d: Link | undefined; // deps, in read order
  declare s: Link | Node | undefined; // signal/computed: subscriber links; runner: children
  declare o: Node | number | undefined; // signal/computed: stamp (I4); effect/scope: owner
  declare n: Node | undefined; // older sibling
  declare p: Node | undefined; // newer sibling, or the owner (I3)
  constructor(f: number, g: (() => unknown) | undefined, v: unknown, p: Node | undefined) {
    this.f = f;
    this.v = v;
    this.g = g;
    this.d = undefined;
    this.s = undefined;
    this.o = NONE;
    this.n = undefined;
    this.p = p;
  }
}

declare const brand: unique symbol;
export interface Signal<T> {
  /** The current value: the untracked read. Write with `set`. */
  readonly v: T;
  readonly [brand]: "signal";
}
export interface Computed<T> {
  readonly [brand]: "computed";
  readonly t?: T;
}
export interface Effect {
  readonly [brand]: "effect";
}
export interface Scope {
  readonly [brand]: "scope";
}

/** The effect or computed whose reads subscribe it. */
let tracker: Node | undefined;
/** The runner that owns what is created now. */
let owner: Node | undefined;
/** The running reader's id, or the last one handed out (I4). */
let runs = 0;
/** Batches, flushes, first runs and disposals in progress: effects wait while above 0 (I7). */
let depth = 0;
const queue: (Node | undefined)[] = [];
let head = 0;
let tail = 0;
/** Walk stack (links), shared by mark and changed; each walk pops back to where it started. */
const stack: (Link | undefined)[] = [];
let sp = 0;

const fail = (message: string): never => {
  throw new Error(`stage1: ${message}`);
};
/** Dev builds only: getters running (untracked inside one does not hide them). */
let evaluating = 0;
const inGetter = (): boolean => evaluating !== 0;

export const signal = <T>(value: T): Signal<T> =>
  new Node(0, undefined, value, undefined) as unknown as Signal<T>;

/** A new node, the newest child of the current owner (I3). */
const create = (f: number, g: (() => unknown) | undefined, v: unknown): Node => {
  const o = owner;
  if (process.env.NODE_ENV !== "production") {
    if (inGetter()) fail("effect, computed, scope or defer created inside a computed");
    // The owner disposed itself in this run: its end disposes what the rest creates, so only a
    // cleanup (it then runs) is meaningful
    if (o !== undefined && o.f & D && g !== undefined) fail("created under a disposed owner");
  }
  const n = new Node(f, g, v, o);
  if (o !== undefined) {
    const h = o.s as Node | undefined;
    if (h !== undefined) {
      h.p = n;
      n.n = h;
    }
    o.s = n;
  }
  return n;
};

export const computed = <T>(fn: () => T): Computed<T> =>
  create(C | M, fn, undefined) as unknown as Computed<T>;

/**
 * First run of a new effect or scope: no teardown or trim (a first run only appends links). It
 * holds the flush like a batch; if the run or the flush after it throws, the node is disposed.
 */
const start = (n: Node): Node => {
  const pt = tracker;
  const po = owner;
  const d = depth++;
  if (po !== undefined && po.f & (E | N)) n.f |= N;
  owner = n;
  if (n.f & E) {
    tracker = n;
    runs = (runs + 1) & MASK;
  } else tracker = undefined;
  try {
    n.v = (n.g as () => unknown)();
    resume(pt);
    owner = n.o = po;
    if (process.env.NODE_ENV !== "production") checkReturn(n);
    // Disposed during its run: dispose what the rest of it linked and made, and its cleanup
    if (n.f & D) kill(n);
    else if (n.f & M) repair(n);
    end();
  } catch (error) {
    resume(pt);
    owner = po;
    depth = d;
    dispose(n as unknown as Effect);
    throw error;
  }
  return n;
};

/** Runs `fn` now and again after the values it read change; a returned function is its cleanup. */
// oxlint-disable-next-line typescript/no-invalid-void-type
export const effect = (fn: () => void | (() => void)): Effect =>
  start(create(E, fn, undefined)) as unknown as Effect;

/**
 * Runs `fn` once, untracked, as the owner of what it creates; a returned function runs when the
 * scope is disposed, after its children.
 */
// oxlint-disable-next-line typescript/no-invalid-void-type
export const scope = (fn: () => void | (() => void)): Scope =>
  start(create(S, fn, undefined)) as unknown as Scope;

/** Calls `fn` when the current owner is disposed or, for an effect, before its next run. */
export const defer = (fn: () => void): void => {
  if (process.env.NODE_ENV !== "production" && owner === undefined) {
    console.warn("stage1: defer outside a scope or effect is never called");
  }
  create(S, undefined, fn);
};

export const get = <T>(node: Signal<T> | Computed<T>): T => {
  const n = node as unknown as Node;
  // Signals and current computeds take one test; dev builds also send disposed and running ones,
  // and runners (a cast reaches them: a tracked read would overwrite their owner, `o`)
  if (n.f & (process.env.NODE_ENV !== "production" ? M | X | D | R | E | S : M | X)) {
    return pull(n) as T;
  }
  const t = tracker;
  if (t !== undefined) track(n, t);
  return n.v as T;
};

/** `get` of a computed that is marked (or new) or holds an error. */
const pull = (n: Node): unknown => {
  if (process.env.NODE_ENV !== "production") {
    if (n.f & (E | S)) fail("get of an effect or scope");
    if (n.f & D) fail("read of a disposed computed");
    if (n.f & R) fail("cycle: a computed read itself");
  }
  if (n.f & M) refresh(n);
  const t = tracker;
  if (t !== undefined) track(n, t);
  if (n.f & X) throw n.v;
  return n.v;
};

/** Gives the tracker back to `t`; a run resumed takes a fresh id (I4: what ran may have stamped). */
const resume = (t: Node | undefined): void => {
  tracker = t;
  if (t !== undefined) runs = (runs + 1) & MASK;
};

/** Subscribes running `sub` to `n` at its cursor, unless this run did already (I4, I5). */
const track = (n: Node, sub: Node): void => {
  const c = sub.v as Link | undefined;
  const next = c === undefined ? sub.d : c.d;
  if (next !== undefined && next.D === n) {
    // Read here last run (static re-runs)
    next.v = n.v;
    sub.v = next;
    n.o = runs;
  } else if (n.o !== runs) {
    n.o = runs;
    if (c !== undefined && c.D === n) {
      // Read again right after a write or a resume voided its stamp: another value makes two (I2)
      if (c.v !== n.v) c.v = c;
    } else {
      const h = n.s as Link | undefined;
      const l: Link = { D: n, S: sub, v: n.v, d: next, p: undefined, n: h };
      if (h !== undefined) h.p = l;
      n.s = l;
      if (c === undefined) sub.d = l;
      else c.d = l;
      sub.v = l;
    }
  }
};

/** Unlinks `l` and the deps after it from their deps' subscribers. */
const drop = (l: Link | undefined): void => {
  for (; l !== undefined; l = l.d) {
    if (l.p === undefined) l.D.s = l.n;
    else l.p.n = l.n;
    if (l.n !== undefined) l.n.p = l.p;
  }
};

/** Ends a run of `n` whose cursor is `last`: drops the deps after it (not read again), if any. */
const trim = (n: Node, last: Link | undefined): void => {
  const l = last === undefined ? n.d : last.d;
  if (l !== undefined) {
    if (last === undefined) n.d = undefined;
    else last.d = undefined;
    drop(l);
  }
};

/** Brings marked computed `c` up to date: evaluates it if it is new or a dep's value changed. */
const refresh = (c: Node): void => {
  if (c.d === undefined || changed(c)) recompute(c);
};

/** Evaluates computed `c` as a run of its own (I4), boxing a throw (X); then trims its deps. */
const recompute = (c: Node): void => {
  const pt = tracker;
  tracker = c;
  runs = (runs + 1) & MASK;
  c.f &= ~(M | X);
  c.v = undefined;
  if (process.env.NODE_ENV !== "production") {
    c.f |= R;
    evaluating++;
  }
  let value: unknown;
  try {
    value = (c.g as () => unknown)();
  } catch (error) {
    value = error;
    c.f |= X;
  }
  if (process.env.NODE_ENV !== "production") {
    c.f &= ~R;
    evaluating--;
  }
  resume(pt);
  const last = c.v as Link | undefined;
  c.v = value;
  trim(c, last);
};

/**
 * Validates marked `n` (I1, I2): whether a dep's value differs from the one `n` read, after
 * re-evaluating the marked computeds on the way (iteratively: chains may be deep).
 */
const changed = (n: Node): boolean => {
  const base = sp;
  let l = n.d;
  n.f &= ~M;
  for (;;) {
    if (l === undefined) {
      // The node's deps are all as it read them; back to its reader's link
      if (sp === base) return false;
      l = stack[--sp] as Link;
    } else {
      const d = l.D;
      if (d.f & M) {
        d.f &= ~M;
        stack[sp++] = l;
        l = d.d;
      } else if (l.v === d.v) {
        l = l.d;
      } else {
        if (sp === base) return true;
        recompute(l.S);
        l = stack[--sp] as Link;
      }
    }
  }
};

/** Marks the subscriber of `l`, its older siblings and what reads them (I1); queues the effects. */
const mark = (l: Link): void => {
  const base = sp;
  for (;;) {
    const sub = l.S;
    const f = sub.f;
    if (!(f & M)) {
      sub.f = f | M;
      if (f & E) queue[tail++] = sub;
      else if (sub.s !== undefined) {
        if (l.n !== undefined) stack[sp++] = l.n;
        l = sub.s as Link;
        continue;
      }
    }
    if (l.n !== undefined) l = l.n;
    else if (sp === base) return;
    else l = stack[--sp] as Link;
  }
};

export const set = <T>(signal: Signal<T>, value: T): void => {
  const s = signal as unknown as Node;
  if (process.env.NODE_ENV !== "production" && inGetter()) fail("set inside a computed");
  if (s.v !== value) {
    s.v = value;
    const l = s.s as Link | undefined;
    if (l !== undefined) {
      if (depth !== 0) {
        mark(l);
        // A run in progress that read it reads it again through the slow path (I4)
        s.o = NONE;
      } else notify(l, value);
    }
  }
};

/** Runs what a write outside batches and runs reaches, through its first subscriber link `l`. */
const notify = (l: Link, value: unknown): void => {
  // Its only reader is an effect, and nothing is marked (I7): run it if what it read changed
  if (l.n === undefined && l.S.f & E) {
    if (l.v !== value) flush(l.S);
  } else {
    mark(l);
    if (tail !== 0) flush();
  }
};

/** Leaves a batch, first run or disposal: the outermost one runs what was queued. */
const end = (): void => {
  if (--depth === 0 && tail !== 0) flush();
};

/** Runs `e` (a write's only reader), then every queued effect; a throw finishes the rest first. */
const flush = (e?: Node): void => {
  depth = 1;
  try {
    if (e !== undefined) run(e);
    while (head < tail) {
      const q = queue[head] as Node;
      queue[head++] = undefined;
      if (q.f & M) update(q);
    }
  } finally {
    depth = 0;
    if (head < tail) flush();
    else head = tail = 0;
  }
};

/** Brings effect `e` up to date, its marked owners first: an owner's re-run disposes it. */
const update = (e: Node): void => {
  if (e.f & N) update(e.o as Node);
  if (e.f & M && changed(e)) run(e);
};

/**
 * Re-runs effect `e` from a flush (I7: no tracker or owner to restore): its teardown, if it has
 * children or a cleanup, then its fn, tracked; then drops the deps it did not read again.
 */
const run = (e: Node): void => {
  if (e.s !== undefined || e.v !== undefined) {
    reset(e);
    // A cleanup disposed it
    if (e.f & D) return;
  }
  runs = (runs + 1) & MASK;
  tracker = owner = e;
  let fn: unknown;
  try {
    fn = (e.g as () => unknown)();
  } finally {
    tracker = owner = undefined;
    const last = e.v as Link | undefined;
    e.v = fn;
    // Disposed during its run: dispose what the rest of it linked and made, and its cleanup
    if (e.f & D) kill(e);
    else {
      trim(e, last);
      if (e.f & M) repair(e);
    }
  }
  if (process.env.NODE_ENV !== "production") checkReturn(e);
};

/** A write during `e`'s run reached it (I6): unmarks it and validates its marked deps. */
const repair = (e: Node): void => {
  e.f &= ~M;
  for (let l = e.d; l !== undefined; l = l.d) if (l.D.f & M) refresh(l.D);
};

/** Disposes `n`'s children and cleanup nodes, newest first, then calls its cleanup (I8, I9). */
const reset = (n: Node): void => {
  while (n.s !== undefined) kill(n.s as Node);
  const cleanup = n.v;
  n.v = undefined;
  // Not a function: undefined, or the cursor of a node disposed during its run
  if (typeof cleanup === "function") {
    const pt = tracker;
    tracker = undefined;
    // I9: dropped in production (two copies: a catch binding would cost bytes there)
    if (process.env.NODE_ENV !== "production") {
      try {
        cleanup();
      } catch (error) {
        console.error("stage1: a cleanup threw", error);
      }
    } else {
      try {
        cleanup();
      } catch {
        // dropped
      }
    }
    resume(pt);
  }
};

/**
 * Disposes `n` and what it owns. Again (a cleanup below disposing an ancestor, or the end of a
 * run that disposed it), it finishes the teardown in progress and drops what was linked since.
 */
const kill = (n: Node): void => {
  n.f = (n.f & ~M) | D;
  drop(n.d);
  n.d = undefined;
  if (!(n.f & C)) {
    // A runner lets its fn go; a computed keeps its getter (D marks it dead): V8 recompiles the
    // getters of computeds whose `g` was written after creation
    n.g = undefined;
    reset(n);
  }
  // Leaves its owner's list after its teardown, once (I8)
  const p = n.p;
  if (p !== undefined) {
    const older = n.n;
    n.p = undefined;
    if (p.s === n) p.s = older;
    else p.n = older;
    if (older !== undefined) older.p = p;
  }
};

/** Disposes `node` and what it owns: children first, then its cleanup. Idempotent. */
export const dispose = (node: Effect | Scope | Computed<unknown>): void => {
  const n = node as unknown as Node;
  if (process.env.NODE_ENV !== "production") {
    if (inGetter()) fail("dispose inside a computed");
    if (!(n.f & (C | E | S))) fail("dispose of a signal");
    if (n.f & C && !(n.f & D) && n.s !== undefined) {
      console.warn("stage1: disposed a computed that still has readers; its value freezes");
    }
  }
  depth++;
  kill(n);
  end();
};

export const batch = (fn: () => void): void => {
  depth++;
  try {
    fn();
  } finally {
    end();
  }
};

/** Runs `fn` without subscribing; the owner stays. */
export const untracked = <T>(fn: () => T): T => {
  const prev = tracker;
  tracker = undefined;
  try {
    return fn();
  } finally {
    resume(prev);
  }
};

/** Dev builds only: an effect or scope returned neither a function nor undefined. */
const checkReturn = (n: Node): void => {
  if (n.v !== undefined && typeof n.v !== "function") {
    n.v = undefined;
    fail("an effect or scope returned neither a function nor undefined");
  }
};

// ── Integration (list, mark: ./reconcile.ts; each export tree-shakes when unused) ──────────────
// A holder is a scope-kind node with no fn: it never runs (it has no deps, so no write marks it)
// and owns what is created `within` it; `kill` tears it down like any runner (I8, then `v` if it
// is a function). Its `o` is the node its children climb to (parent-first), which need not be the
// owner whose list holds it: a list's rows' holders sit in the list's holder but climb to its
// subscription, which owns nothing, so its re-runs tear nothing down.

/** An owner that never runs (see `holder`). `g` is the caller's data, undefined once disposed. */
export interface Holder extends Effect {
  readonly g: unknown;
}

/**
 * Calls `fn(a, b)` with tracking off and `o` as the owner (undefined: none), then gives both back
 * (a tracked run resumes with a fresh id). For code that owns on behalf of something else
 * (list rows) and async callbacks (keep a handle, then `within(handle, cb)`).
 */
export const within = <A, B, R>(
  o: Effect | Scope | undefined,
  fn: (a: A, b: B) => R,
  a?: A,
  b?: B,
): R => {
  if (process.env.NODE_ENV !== "production" && inGetter()) fail("within inside a computed");
  const t = tracker;
  const prev = owner;
  tracker = undefined;
  owner = o as unknown as Node | undefined;
  try {
    return fn(a as A, b as B);
  } finally {
    resume(t);
    owner = prev;
  }
};

/**
 * An owner that never runs (a scope without a fn), in no owner's list until `own`ed. What is
 * created `within` it is its child; `dispose` disposes those, newest first, then calls `v`; `g` is
 * the caller's data, cleared on disposal. Effects made in it climb to `up` (default: the current
 * owner) as they would from a child of `up`, so they re-run after `up`'s marked owners.
 */
export const holder = (
  v?: () => void,
  g?: unknown,
  up: Effect | Scope | undefined = owner as never,
): Holder => {
  const h = new Node(S, g as never, v, undefined);
  const o = up as unknown as Node | undefined;
  h.o = o;
  if (o !== undefined && o.f & (E | N)) h.f |= N;
  return h as unknown as Holder;
};

/** The current owner (if any) adopts `h`: it becomes its newest child, disposed with it. */
export const own = <T extends Holder>(h: T): T => {
  const n = h as unknown as Node;
  // In another owner's list already: threading it into a second would corrupt both (I3)
  if (process.env.NODE_ENV !== "production" && n.p !== undefined) {
    fail("own of a holder that already has an owner");
  }
  const o = owner;
  if (o !== undefined) {
    const k = o.s as Node | undefined;
    if (k !== undefined) {
      k.p = n;
      n.n = k;
    }
    n.p = o;
    o.s = n;
  }
  return h;
};

/** Whether `h` owns something newer than `after` (one of its children; default: anything). */
export const owns = (h: Holder, after?: unknown): boolean => (h as unknown as Node).s !== after;

/** Disposes what `h` owns newer than `after` (default: all of it), newest first; `h` stays. */
export const release = (h: Holder, after?: unknown): void => {
  const n = h as unknown as Node;
  depth++;
  for (let k; (k = n.s as Node | undefined) !== after && k !== undefined;) kill(k);
  end();
};
