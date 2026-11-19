// Signals, computeds, effects, subs and scopes: an ownership-first intrusive tree over a
// single-colour, value-recording dependency graph. An effect, sub or scope owns the effects, subs,
// computeds, scopes and cleanups (`defer`) its run, or a `within` it, creates: they are disposed,
// newest first, when it is disposed, and an effect's also before it re-runs.
//
// Dev checks sit behind `process.env.NODE_ENV !== "production"`: a production build (which must
// define it, e.g. `define: { "process.env.NODE_ENV": '"production"' }` in Bun.build) drops them
// whole, so they cost no bytes there.
//
// Invariants:
// - I1 A marked node's subscribers are marked (marks stop at marked nodes). Validation clears a
//   mark when it descends into the node, so it also terminates on cycles.
// - I2 A link's `v` is the value its subscriber read, or, after a `trigger` of its dep, `queue`:
//   no node holds it (unless a RangeError cut a trigger short), so the next check sees a change. A
//   run that reads a source again after its stamp was voided (I4) links it again, so every value
//   the run read has a link. A node is current when every link's `v` is its dep's current `v`
//   (deps validated first).
// - I3 Runners (effects, subs, scopes, cleanup nodes) keep their children in `s`, newest first. A
//   child's `n` is its older sibling and `p` its newer one, or its owner if it is the newest.
//   Effects, subs and scopes keep in `o` their climb target: the nearest effect or sub above them.
// - I4 Stamp: `runs` is the running reader's id (an effect's or sub's run or first run, a computed's
//   evaluation). Each run takes a fresh id from `ids` and gives back the id it found when it ends,
//   so what runs inside it (a nested run, untracked code) leaves its id as it was. A source's `o`
//   is the id of the last run that read it (NONE: none), so `o === runs` means the running reader
//   linked it in this run; `set` above depth 0 and an evaluation reset it (its value may change
//   while a run that read it is open). A read first tries the link after the cursor (static
//   re-runs), then the stamp. Ids repeat after 2^30 runs.
// - I5 Cursor: while an effect, sub or computed runs, its `v` is the last dep link its run read
//   (undefined before the first); the run's end stores the cleanup or value there.
// - I6 A marked effect is queued or running. A running effect a write marks (its own, its
//   cleanups', its children's first runs') does not run again for it: its run's end validates its
//   marked deps (restoring I1) and unmarks it, so its queue entry does nothing. Its links keep the
//   values it read, so a later check re-runs it if the write changed them for good. A sub stays
//   marked instead: its queue entry calls its fn again if the value moved, and what climbs to it
//   waits for that (`climb`: nothing runs while an effect or sub above it is marked).
// - I7 `depth` is above 0 while a batch, flush, effect's or sub's first run or disposal is open:
//   writes then only mark and queue. A scope's body does not hold it (owner scopes), nor does a
//   `within`: at depth 0 their writes run what they reach at once. At depth 0 no effect is marked or
//   running (computeds stay marked until read) and no tracker is set; the owner is none, the scope
//   whose body runs, or the target of a `within` in progress. A re-run sets the tracker and owner
//   and leaves them set (its teardown runs as its own); the flush gives back the owner it found and
//   no tracker.
// - I8 Teardown: children and cleanup nodes newest first, in one list, then the node's own
//   cleanup. A node leaves its owner's list only when its teardown is done, so a `dispose` that
//   re-enters a teardown in progress (a cleanup disposing an ancestor) finishes it first.
// - I9 Cleanup errors are dropped (dev builds console.error them): teardown never throws.
//
// Unspecified (what this core does, not a promise):
// - Sibling order: creation order (the stack drain). Several errors in one flush: the last one
//   thrown reaches the caller. Ids wrap after 2^30 runs.
// - Writes in a computed's getter, cycles and endless write loops (production). Dev builds throw
//   for a loop at a flush's millionth run, and for each run the flush still has queued.
// - After a RangeError (stack overflow) out of a write, flush, batch end or dispose, the graph is
//   unspecified, but the call returns by throwing (no hang): each retry of the flush consumes an
//   entry or unmarks a runner (`flush`, `climb`). A runner whose update overflowed misses that
//   write, and later ones that reach it only through a computed it read (that stays marked: marks
//   stop there) until something reads that computed. A batch whose end overflows, or a dispose
//   (also a failed first run's) whose teardown does, leaves `depth` above 0: nothing runs after it.
//   A trigger it cuts short can leave `queue` as the signal's value, its own lost: `set` one before
//   using the signal again.
// - What a cleanup creates belongs to the current owner: during a re-run's teardown, the effect
//   re-running (I7). Under a disposed owner, that owner: the end of its run disposes it, but a
//   teardown that disposed its own effect ends no run, so what a cleanup creates after that lives
//   on. Dev builds throw for it, except during a sub's call. Between runs of a flush the owner is
//   the last run's: computed getters validated there must not create (dev error). `owner()` returns
//   that owner too (in a getter: a dev error).
// - A `within` whose target is disposed during its fn: what fn then makes under it lives on until
//   the target is disposed again (dev builds throw at the creation or when fn returns, even where
//   an open run of the target, or of an owner above it, would dispose it).
// - A trigger, then a set back to the value its readers read, before they run (in a batch or a
//   run) still runs them: an extra run, never a missed one. A sub that triggers its source on every
//   call is an endless write loop.
// - A sub's later call that writes its source and then throws is called again in the same flush.
//   A node whose creation rethrows an error from the flush that ends its own effect()/sub() is
//   disposed. A computed as a sub's source works as `get` reads it (its error reaches the writer).
//
// oxlint-disable no-bitwise no-param-reassign no-use-before-define
// Short names, `=== undefined` tests and chained assignments are deliberate (bytes; V8 speed), and
// dev checks read process.env.
// oxlint-disable id-length no-continue no-multi-assign no-negated-condition no-shadow
// oxlint-disable node/no-process-env unicorn/no-negated-condition unicorn/no-useless-undefined
// oxlint-disable unicorn/number-literal-case typescript/explicit-member-accessibility
// oxlint-disable typescript/non-nullable-type-assertion-style typescript/no-unsafe-call
// oxlint-disable typescript/prefer-optional-chain
// The const enums are plain bit flags and numbers:
// oxlint-disable oxc/bad-bitwise-operator

import { checkCycle, checkReturn, checkRow, report, unwatched } from "./dev.ts";

/**
 * Bit flags; kinds and states, in `f`. Const enums, not consts: once a module has an import
 * (./dev.ts), Bun keeps its top-level consts as vars but still inlines enum members (dist.test.ts).
 */
const enum F {
  L = 0, // signal: no bits; test kinds with !(f & (C | E | S))
  C = 1, // computed
  E = 2, // effect: a runner that tracks its reads and re-runs when they change
  S = 4, // keeps its children until disposed: scope (a fn), cleanup node (none); with E, a sub
  M = 8, // marked: a dep may have changed since the last run or evaluation
  D = 16, // disposed
  X = 32, // computed: `v` is the error its getter threw
  R = 64, // dev builds only: a computed whose getter is running (cycle check)
}
/** Run ids wrap below 2^30 to stay small integers; NONE is no run's. */
const enum Id {
  MASK = 0x3fffffff,
  NONE = -1,
}

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
  declare f: F;
  declare v: unknown; // signal/computed: value (or error, X); runner: its cleanup; running: cursor (I5)
  declare g: (() => unknown) | undefined; // computed getter; effect/sub fn; scope fn (body only)
  declare d: Link | undefined; // deps, in read order
  declare s: Link | Node | undefined; // signal/computed: subscriber links; runner: children
  declare o: Node | number | undefined; // signal/computed: stamp (I4); effect/sub/scope: climb target (I3)
  declare n: Node | undefined; // older sibling
  declare p: Node | undefined; // newer sibling, or the owner (I3)
  constructor(f: F, g: (() => unknown) | undefined, v: unknown, p: Node | undefined) {
    this.f = f;
    this.v = v;
    this.g = g;
    this.d = undefined;
    this.s = undefined;
    this.o = Id.NONE;
    this.n = undefined;
    this.p = p;
  }
}

// TODO: Consider supporting disposal via Symbol.dispose either for all Node or add with an optional function.
// Node.prototype[Symbol.dispose] = function (this: Node): void {
//   dispose(this as unknown as Effect | Scope | Computed<unknown>);
// };
// const disposer = function (this: Effect | Scope | Computed<unknown>) {
//   dispose(this);
// };
// export const disposable = <T extends Effect | Scope | Computed<unknown>>(node: T): T & Disposable =>
//   Object.defineProperty(node, Symbol.dispose, {
//     value: disposer,
//   }) as T & Disposable;

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

/** The effect, sub or computed whose reads subscribe it. */
let tracker: Node | undefined;
/** The runner that owns what is created now. */
let owner: Node | undefined;
/** The running reader's id (I4). */
let runs = 0;
/** The last run id handed out. */
let ids = 0;
/** Batches, flushes, first runs and disposals in progress: effects wait while above 0 (I7). */
let depth = 0;
/** Effects to run (a stack: the flush pops the newest entry); also a value no node holds (I2). */
const queue: (Node | undefined)[] = [];
let tail = 0;
/** Walk stack (links), shared by mark and changed; each walk pops back to where it started. */
const stack: (Link | undefined)[] = [];
let sp = 0;

export const signal = <T>(value: T): Signal<T> =>
  new Node(F.L, undefined, value, undefined) as unknown as Signal<T>;

/** A new node, the newest child of the current owner (I3). */
const create = (f: F, g: (() => unknown) | undefined, v: unknown): Node => {
  const o = owner;
  if (process.env.NODE_ENV !== "production") {
    if (inComputed()) {
      report("critical", "effect, sub, computed, scope, or defer inside a computed");
    }
    // The owner disposed itself in this run: its end disposes what the rest creates, so only a
    // cleanup (it then runs) is meaningful. A sub's call is exempt, however deep the owner: it may
    // be a list's reconcile that cannot stop when a row's cleanup or effect disposed the sub; the
    // ends of the runs in progress dispose what the rest made, silently (a `within` target that
    // died during its fn may have no such end: `within` checks it when fn returns)
    if (o !== undefined && o.f & F.D && calling === 0 && g !== undefined) {
      report("critical", "effect, sub, computed, or scope under a disposed owner");
    }
    // Unscoped: made straight under a re-running wiring (an effect or sub), and not a scope (S with
    // a fn; a sub, E|S, and a cleanup node, S with none, are not)
    checkRow(o, o !== undefined && (o.f & F.E) !== 0 && (f !== F.S || g === undefined));
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
  create(F.C | F.M, fn, undefined) as unknown as Computed<T>;

/**
 * First run of a new effect, sub or scope: no teardown or trim (a first run only appends links),
 * and the tracker, owner and run id given back. An effect's or sub's holds the flush like a batch
 * (a scope's body does not: I7); if the run or the flush after it throws, the node is disposed.
 */
const start = (n: Node): Node => {
  const pt = tracker;
  const po = owner;
  const pr = runs;
  const d = depth;
  // Its climb target (I3): its owner if that is an effect or sub, else its owner's
  n.o = po === undefined || po.f & F.E ? po : po.o;
  owner = n;
  if (n.f & F.E) {
    depth++;
    tracker = n;
    runs = ids = (ids + 1) & Id.MASK;
  } else tracker = undefined;
  try {
    n.v = (n.g as () => unknown)();
    tracker = pt;
    owner = po;
    runs = pr;
    if (process.env.NODE_ENV !== "production") checkReturn(n);
    // Disposed during its run: dispose what the rest of it linked and made, and its cleanup
    if (n.f & F.D) kill(n);
    else if (n.f & F.M) repair(n);
    if (n.f & F.E) end();
    // A scope never runs again: it lets its fn (and what that holds) go
    else n.g = undefined;
  } catch (error) {
    tracker = pt;
    owner = po;
    runs = pr;
    depth = d;
    dispose(n as unknown as Effect);
    throw error;
  }
  return n;
};

/** Runs `fn` now and again after the values it read change; a returned function is its cleanup. */
// oxlint-disable-next-line typescript/no-invalid-void-type
export const effect = (fn: () => void | (() => void)): Effect =>
  start(create(F.E, fn, undefined)) as unknown as Effect;

/**
 * Calls `fn(value)` untracked now and after each change of `source` (a signal, or a computed read
 * as `get` reads it); a write to it during `fn` calls `fn` again after it returns, until the value
 * is stable. What `fn` creates belongs to the sub, across calls, until the sub is disposed. A sub
 * is an effect that keeps its children (E|S) and stays marked after its own writes (I6, `repair`).
 */
export const sub = <T>(source: Signal<T> | Computed<T>, fn: (value: T) => void): Effect =>
  start(
    create(
      F.E | F.S,
      (): void => {
        const value = get(source);
        // `start` or the flush gives the tracker back
        tracker = undefined;
        if (process.env.NODE_ENV !== "production") {
          calling++;
          try {
            fn(value);
          } finally {
            calling--;
          }
        } else fn(value);
      },
      undefined,
    ),
  ) as unknown as Effect;

/**
 * Runs `fn` once, untracked, as the owner of what it creates; a returned function runs when the
 * scope is disposed, after its children.
 */
// oxlint-disable-next-line typescript/no-invalid-void-type
export const scope = (fn: () => void | (() => void)): Scope =>
  start(create(F.S, fn, undefined)) as unknown as Scope;

/** Calls `fn` when the current owner is disposed or, for an effect, before its next run. */
export const defer = (fn: () => void): void => {
  if (process.env.NODE_ENV !== "production" && owner === undefined) {
    report("warn", "defer outside an effect, sub, or scope; its fn is never called");
  }
  create(F.S, undefined, fn);
};

export const get = <T>(node: Signal<T> | Computed<T>): T => {
  const n = node as unknown as Node;
  // Signals and current computeds take one test; dev builds also send disposed and running ones,
  // and runners (a cast reaches them: a tracked read would overwrite their climb target, `o`)
  if (
    n.f & (process.env.NODE_ENV !== "production" ? F.M | F.X | F.D | F.R | F.E | F.S : F.M | F.X)
  ) {
    return pull(n) as T;
  }
  const t = tracker;
  if (t !== undefined) track(n, t);
  return n.v as T;
};

/** `get` of a computed that is marked (or new) or holds an error. */
const pull = (n: Node): unknown => {
  if (process.env.NODE_ENV !== "production") {
    if (n.f & (F.E | F.S)) report("critical", "get of an effect, sub, or scope");
    if (n.f & F.D) report("critical", "get of a disposed computed");
    if (n.f & F.R) report("critical", "cycle: a computed read itself");
  }
  if (n.f & F.M) refresh(n);
  const t = tracker;
  if (t !== undefined) track(n, t);
  if (n.f & F.X) throw n.v;
  return n.v;
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
    // First read in this run, or again after a write voided its stamp (I2)
    n.o = runs;
    const h = n.s as Link | undefined;
    const l: Link = { D: n, S: sub, v: n.v, d: next, p: undefined, n: h };
    if (h !== undefined) h.p = l;
    n.s = l;
    if (c === undefined) sub.d = l;
    else c.d = l;
    sub.v = l;
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
  else c.f &= ~F.M;
};

/** Evaluates computed `c` as a run of its own (I4), boxing a throw (X); then trims its deps. */
const recompute = (c: Node): void => {
  const pt = tracker;
  const pr = runs;
  tracker = c;
  runs = ids = (ids + 1) & Id.MASK;
  // Its value may change: a run in progress that read it reads it again through the slow path
  c.o = Id.NONE;
  c.f &= ~(F.M | F.X);
  c.v = undefined;
  if (process.env.NODE_ENV !== "production") {
    c.f |= F.R;
    evaluating++;
  }
  let value: unknown;
  try {
    value = (c.g as () => unknown)();
  } catch (error) {
    value = error;
    c.f |= F.X;
  }
  if (process.env.NODE_ENV !== "production") {
    c.f &= ~F.R;
    evaluating--;
  }
  tracker = pt;
  runs = pr;
  const last = c.v as Link | undefined;
  c.v = value;
  trim(c, last);
};

/**
 * Validates `n` (I1, I2): whether a dep's value differs from the one `n` read, after re-evaluating
 * the marked computeds on the way (iteratively: chains may be deep). Its caller unmarks `n`.
 */
const changed = (n: Node): boolean => {
  const base = sp;
  let l = n.d;
  for (;;) {
    if (l === undefined) {
      // The node's deps are all as it read them; back to its reader's link
      if (sp === base) return false;
      l = stack[--sp] as Link;
    } else {
      const d = l.D;
      if (d.f & F.M) {
        d.f &= ~F.M;
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
    if (!(f & F.M)) {
      sub.f = f | F.M;
      if (f & F.E) queue[tail++] = sub;
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
  if (process.env.NODE_ENV !== "production" && inComputed()) {
    report("critical", "set inside a computed");
  }
  if (s.v !== value) {
    s.v = value;
    const l = s.s as Link | undefined;
    if (l !== undefined) {
      if (depth !== 0) {
        mark(l);
        // A run in progress that read it reads it again through the slow path (I4)
        s.o = Id.NONE;
      } else notify(l, value);
    }
  }
};

/** Runs what a write outside batches and runs reaches, through its first subscriber link `l`. */
const notify = (l: Link, value: unknown): void => {
  // Its only reader is an effect, and nothing is marked (I7): run it if what it read changed
  if (l.n === undefined && l.S.f & F.E) {
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

/**
 * Runs `e` (a write's only reader), then every queued effect, the newest entry first (siblings in
 * creation order). A throw does not stop it: every entry runs, then one error reaches the caller
 * (dev builds: past a million runs, each entry left throws instead of running: `run`).
 */
const flush = (e?: Node): void => {
  // Runs leave their tracker and owner set: the flush gives back the owner it found (a scope's
  // body that wrote stays the owner) and no tracker (I7)
  const o = owner;
  // No error yet: a private object, so a thrown undefined is rethrown too
  let error: unknown = queue;
  depth = 1;
  if (process.env.NODE_ENV !== "production") ran = 0;
  for (;;) {
    try {
      if (e !== undefined) run(e);
      while (tail !== 0) {
        const q = queue[--tail] as Node;
        queue[tail] = undefined;
        // Unmarked before any call: a stack overflow from here on leaves no popped runner marked
        if (q.f & F.M) {
          q.f &= ~F.M;
          update(q);
        }
      }
      break;
      // `error` is the flush's result above
      // oxlint-disable-next-line unicorn/catch-error-name
    } catch (thrown) {
      e = undefined;
      error = thrown;
    }
  }
  tracker = undefined;
  owner = o;
  depth = 0;
  if (error !== queue) throw error;
};

/**
 * Brings effect or sub `e` (popped marked; the flush unmarked it) up to date once no effect or sub
 * above it is marked (parent-first): `climb` picks the one to validate.
 */
const update = (e: Node): void => {
  if (e.o !== undefined) e = climb(e);
  if (changed(e)) run(e);
};

/**
 * The runner to bring up to date for unmarked `e`: `e` if no effect or sub above it is marked. Else
 * `e` and each marked one above it but the topmost wait in the queue again, marked (the higher, the
 * sooner), and the topmost, unmarked, is returned (an effect's re-run disposes what it owns; a sub
 * keeps it, and its fn may throw or mark itself or an owner again). No call in between: a throw
 * strands none, and a stack overflow cannot repeat a climb: each retry of the flush unmarks a
 * runner or consumes an entry.
 */
const climb = (e: Node): Node => {
  for (let o = e.o as Node | undefined; o !== undefined; o = o.o as Node | undefined) {
    if (o.f & F.M) {
      e.f |= F.M;
      queue[tail++] = e;
      e = o;
      e.f &= ~F.M;
    }
  }
  return e;
};

/**
 * Re-runs effect or sub `e` from a flush, as its tracker and owner (I7: nothing to give back; its
 * teardown's cleanups run as its own too): its teardown, if it has children or a cleanup (a sub
 * keeps them: its S is tested only then), then its fn, tracked; then drops the deps it did not read
 * again.
 */
const run = (e: Node): void => {
  // Dev builds: an endless write loop throws (the bound is far above any loop that settles); the
  // flush's catch then drains the queue, each run left throwing here too
  if (process.env.NODE_ENV !== "production") {
    checkCycle(++ran, "cycle: a flush ran effects and subs a million times");
  }
  tracker = owner = e;
  if ((e.s !== undefined || e.v !== undefined) && !(e.f & F.S)) {
    reset(e);
    // A cleanup disposed it
    if (e.f & F.D) return;
  }
  runs = ids = (ids + 1) & Id.MASK;
  let fn: unknown;
  try {
    fn = (e.g as () => unknown)();
  } finally {
    const last = e.v as Link | undefined;
    e.v = fn;
    // Disposed during its run: dispose what the rest of it linked and made, and its cleanup
    if (e.f & F.D) kill(e);
    else {
      trim(e, last);
      if (e.f & F.M) repair(e);
    }
  }
  if (process.env.NODE_ENV !== "production") checkReturn(e);
};

/**
 * A write during runner `e`'s run reached it (I6): validates its marked deps and unmarks an effect
 * (its queue entry does nothing). A sub (S) stays marked: its entry calls fn again if the value
 * moved.
 */
const repair = (e: Node): void => {
  if (!(e.f & F.S)) e.f &= ~F.M;
  for (let l = e.d; l !== undefined; l = l.d) if (l.D.f & F.M) refresh(l.D);
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
        report("error", "a cleanup threw", error);
      }
    } else {
      try {
        cleanup();
      } catch {
        // dropped
        // TODO: Consider using reportError. Bad browser coverage but can be polyfilled.
        // reportError(error);
      }
    }
    tracker = pt;
  }
};

/**
 * Disposes `n` and what it owns. Again (a cleanup below disposing an ancestor, or the end of a
 * run that disposed it), it finishes the teardown in progress and drops what was linked since.
 */
const kill = (n: Node): void => {
  n.f = (n.f & ~F.M) | F.D;
  drop(n.d);
  n.d = undefined;
  if (!(n.f & F.C)) {
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
    if (inComputed()) report("critical", "dispose inside a computed");
    if (!(n.f & (F.C | F.E | F.S))) report("critical", "dispose of a signal");
    if (n.f & F.C && !(n.f & F.D) && n.s !== undefined) {
      report("warn", "dispose of a computed that still has readers; a later get of it throws");
    }
  }
  depth++;
  kill(n);
  end();
};

export const batch = <T>(fn: () => T): T => {
  depth++;
  try {
    return fn();
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
    tracker = prev;
  }
};

/**
 * The effect, sub or scope that owns what is created now, if any: keep it to create under it later
 * (an event, timer or promise callback) with `within`.
 */
const getOwner = (): Effect | Scope | undefined => {
  if (process.env.NODE_ENV !== "production" && inComputed()) {
    report("critical", "owner inside a computed");
  }
  return owner as unknown as Effect | Scope | undefined;
};
export { getOwner as owner };

/**
 * Runs `fn` untracked as the owner `target`: what it creates belongs to `target`, as if its run had
 * created it (an effect disposes it before its next run). Not batched, as a scope's body. Gives
 * back the owner and tracker it found, even if `fn` throws, and returns what `fn` returns. A
 * disposed `target`: does not call `fn` and returns undefined. Only `fn`'s synchronous part runs as
 * the owner: after an `await`, nothing owns.
 */
export const within = <T>(target: Effect | Scope, fn: () => T): T | undefined => {
  if (process.env.NODE_ENV !== "production") {
    if (inComputed()) report("critical", "within inside a computed");
    if (!((target as unknown as Node).f & (F.E | F.S))) {
      report("critical", "within of a signal or computed");
    }
  }
  if ((target as unknown as Node).f & F.D) return undefined;
  const pt = tracker;
  const po = owner;
  tracker = undefined;
  owner = target as unknown as Node;
  try {
    if (process.env.NODE_ENV !== "production") {
      // Its caller chose the owner: no list's row check applies to what fn makes
      const value = unwatched(fn);
      // Disposed during fn, which made something under it after: unless a run of it (or of an
      // owner above it) is open, nothing disposes that; the check does not tell the cases apart
      if ((target as unknown as Node).f & F.D && (target as unknown as Node).s !== undefined) {
        report(
          "critical",
          "effect, sub, computed, scope, or defer under a within target disposed during its fn",
        );
      }
      return value;
    }
    return fn();
  } finally {
    tracker = pt;
    owner = po;
  }
};

/**
 * Notifies what read `signal` that its value changed in place: a `set` of a value no reader has
 * seen (its readers' links forget the value they read, I2), without replacing or comparing it.
 * Shallow: a computed that returns the same reference stops it. A list needs a new array instead.
 *
 * NOTE: It is recommended to use the documented "tick" recipe, as it is both faster and smaller
 * than this function. This is provided for convenience and simplicity.
 */
export const trigger = <T>(signal: Signal<T>): void => {
  const s = signal as unknown as Node;
  // Before any write: a computed boxes this throw, and the signal must keep its value and its
  // readers' links the values they read
  if (process.env.NODE_ENV !== "production" && inComputed()) {
    report("critical", "trigger inside a computed");
  }
  const value = s.v;
  // No node holds `queue`: every reader's next check sees a changed value, and so does `set`
  for (let l = s.s as Link | undefined; l !== undefined; l = l.n) l.v = queue;
  s.v = queue;
  set(signal, value as T);
};

// ── Dev Builds ───────────────────────────────────────────────────────────────

// The core's own dev state; the checks it shares with the other tiers are in ./dev.ts.

/** Dev builds only: getters running (untracked inside one does not hide them). */
let evaluating = 0;
const inComputed = (): boolean => evaluating !== 0;
/** Dev builds only: sub calls in progress (creating under a disposed owner is allowed there). */
let calling = 0;
/** Dev builds only: runs in the current flush (an endless write loop throws: `run`). */
let ran = 0;
