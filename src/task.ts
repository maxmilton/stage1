// task: an async load held in a signal, for loads that follow other signals.
//
// EXPERIMENTAL AND UNSTABLE: a starting point for async work in the core. Its API and behaviour
// may change, or it may be removed, in any release. Prefer the README "Async data" recipes: written
// out, they give the most control and clarity.
//
//   const user = task(() => fetchUser(get(id))); // reloads when id changes
//   effect(() => {
//     const u = get(user);
//     if (u.status === TaskStatus.Error) show(`error: ${String(u.error)}`);
//     else show(u.value?.name ?? "…", u.status === TaskStatus.Pending);
//   });
//
// What it does for you: the latest run wins (a run superseded by a change, or by its owner's
// disposal, never lands, and neither does its rejection); a plain value lands at once, with no
// pending state; a throw from `fn` or a rejection becomes the error state, never an unhandled
// rejection; the value is kept while pending and after an error; each state is one record, so no
// reader sees a value of one load with the status of another; `fn` may be async.
//
// Examples: examples/profile.ts (a keyed load with abort and refresh), todos.ts (a list with an
// optimistic add), posts.ts (one task waiting for another), validate.ts (a debounced check).
//
// Rules:
// - Inputs: what `fn` reads before it returns its promise (before its first `await`) is tracked;
//   nothing after an `await` is, and nothing owns what it creates there (a `defer` there is never
//   called). Call the loader `untracked` only if it reads signals itself (`fetch` reads none):
//   `task(() => { const k = get(id); return untracked(() => load(k)); })`.
// - Reading: read the task in an effect of its own, never in the effect that makes it (that effect
//   runs again on every landing and makes a new task each time). In `fn`, read the task only with
//   `.v`, and not on its first run (it is assigned when `task` returns): a tracked read reloads it
//   on every landing.
// - Lifetime: like an effect, it belongs to the current owner until that owner is disposed or, for
//   an effect, runs again (its next run makes a new task). Make it in a scope you dispose (for a
//   list row, in `drop`): made in a sub's callback or a list's create, it outlives the call that
//   made it, and made at top level it lives on. From an event handler or a later callback, make it
//   inside `within(parent, …)`. The returned signal is not a handle: `dispose` of a signal throws
//   in development builds and, when it has readers, never returns in production ones.
// - Records: every landing writes a new record, so its readers run even when the value is the
//   same. A reader of the value alone goes through a computed, `computed(() => get(user).value)`,
//   and so does a list, whose rows function takes arrays: `sub(computed(() => get(items).value),
//   rows)` with a fallback (below), or `?? NONE` (one shared empty array) without one.
// - Writes: a `set` of the returned signal (an optimistic value) drops the load in flight. Setting
//   back the record that set replaced, before the load settles, lets it land again; any other
//   record stays until the next run, so reload rather than restore a pending record.
//
// Recipes:
// - Fallback: `task(load, NONE)` gives `value` the loader's type in every record: it is `NONE`
//   until the first value lands (`task(fn)`: undefined).
// - Refresh: read a tick signal in `fn` (README "Mutable data").
// - Abort: `fn` may `defer` an abort (it runs before the next run and on disposal):
//   `defer(() => ac.abort())` is correct alone. Checking the status first leaves a load that
//   already settled alone, which saves an abort event and a DOMException:
//     const user = task(() => {
//       const ac = new AbortController();
//       defer(() => { if (user.v.status === TaskStatus.Pending) ac.abort(); });
//       return fetchUser(get(id), ac.signal);
//     });
//   (A load dropped by a `set` of a ready or error record is not aborted that way: the status is
//   no longer pending.)
// - Waiting for another task: read its value through a computed (its pending flips then do not run
//   this one), and return `WAIT` until the value is there:
//     const userId = computed(() => get(user).value?.id);
//     const posts = task(() => {
//       const id = get(userId);
//       return id === undefined ? WAIT : fetchPosts(id);
//     });
//
// Edge cases:
// - Writing in `fn`: a `set` of a signal `fn` read does not run it again (a run's own write): the
//   load for the value it read goes on, and a later write back to that value does nothing. A `set`
//   of the task itself is kept: the pending or error record its run then writes carries that value
//   (a plain value replaces it).
// - A plain value lands during the run: a burst of synchronous changes runs the readers each time
//   (a `batch` delivers once).
// - A reader's throw is never the task's error. During a promise's landing it rejects the promise
//   the task's `then` returned, so it is reported as an unhandled rejection; during a run (a plain
//   value, the pending state) it reaches the write that ran the task again.
// - Thenables are expected to settle as promises do: once, asynchronously, with a plain value. One
//   that settles from inside an abort listener while its run is torn down lands as if its run were
//   current. A promise that never settles keeps the callbacks each run gives it: wait with `WAIT`,
//   never with one shared promise (it would keep every task that returned it reachable).
//
// Development builds check (each check sits behind `process.env.NODE_ENV`, so production builds
// drop them, and this module's import of ./dev.ts with them):
// - a task that runs again inside its own landing, or inside a landing its own led to (A's
//   landing runs B, and B's runs A; up to 11 tasks round): `fn` reads the task with `get`, or a
//   reader writes what `fn` reads. Warns once per task, also for an intended reload (pagination,
//   retry, or polling that writes `fn`'s input on each landing);
// - 10 tasks in a row, each made inside the landing of the one before: an effect that makes a task
//   and reads it. Warns once per landing task, also for intended generations (a task per page, each
//   made when the page before lands);
// - a stage1 development error thrown in `fn` (a misuse, such as a `get` of a disposed computed) is
//   rethrown, not kept as the error state (a rejection's as an unhandled rejection; a superseded or
//   disposed run's is dropped).
// The core checks the rest it can see: a `dispose` of the returned signal and a task made inside a
// computed throw; a `defer` after an `await` in `fn`, and a list's create that makes a task outside
// a row scope (a list without `drop`), warn. Not caught: a landing inside a batch or a run (a
// plain value, or a thenable that calls back at once: an endless loop of those throws at the core's
// cycle bound); writes moved out of a landing (a microtask, a timer).
//
// Dev checks read process.env, and their helpers and state sit after the code that uses them (as in
// ./signal.ts); then(ok, err) is deliberate (above):
// oxlint-disable node/no-process-env no-negated-condition no-use-before-define
// oxlint-disable promise/prefer-await-to-then promise/prefer-await-to-callbacks
// oxlint-disable promise/prefer-catch

import { report } from "./dev.ts";
import { effect, set, type Signal, signal } from "./signal.ts";

/** EXPERIMENTAL: a task's state kind (a const enum: a bundler inlines the members it reads). */
export const enum TaskStatus {
  Pending = 0,
  Ready = 1,
  Error = 2,
}

/**
 * EXPERIMENTAL: a task's state, one immutable record per state. `value` is kept while pending and
 * after an error; until the first value lands it is the fallback (`Fallback`: undefined if none).
 */
export type TaskState<T, Fallback = undefined> =
  | { readonly status: TaskStatus.Pending; readonly value: T | Fallback }
  | { readonly status: TaskStatus.Ready; readonly value: T }
  | { readonly status: TaskStatus.Error; readonly value: T | Fallback; readonly error: unknown };

/** EXPERIMENTAL: what `task` returns, a signal holding the task's state. */
export type Task<T, Fallback = undefined> = Signal<TaskState<T, Fallback>>;

/** Every task's state until its first write, if it has no fallback (shared: no allocation). */
const START: TaskState<never> = { status: TaskStatus.Pending, value: undefined };

/**
 * EXPERIMENTAL: may change or be removed. Runs `fn` in an effect and holds its outcome in the
 * returned signal: a plain value lands at once (no pending state), a thenable after it settles, and
 * a throw or rejection becomes the error state. Belongs to the current owner.
 */
export const task: {
  <T>(fn: () => T | PromiseLike<T>): Task<T>;
  <T, Fallback>(fn: () => T | PromiseLike<T>, fallback: Fallback): Task<T, Fallback>;
} = <T, Fallback>(fn: () => T | PromiseLike<T>, fallback?: Fallback): Task<T, Fallback> => {
  const state = signal(
    (fallback === undefined ? START : { status: TaskStatus.Pending, value: fallback }) as TaskState<
      T,
      Fallback
    >,
  );
  // The current run's id: a settle from an older run (superseded) or after disposal is dropped
  let run = 0;
  // Every run's cleanup, one per task: a re-run or disposal invalidates the run in flight
  const stop = (): number => run++;
  let watch: Watch;
  if (process.env.NODE_ENV !== "production") watch = checkCreate();
  effect(() => {
    if (process.env.NODE_ENV !== "production") checkRun(watch);
    const id = run;
    // The record a landing applies to: a write since then drops the landing. Declared here, not in
    // the block: a block's captured variables would get a context of their own
    let cur: TaskState<T, Fallback>;
    try {
      const out = fn();
      if (typeof (out as PromiseLike<T> | undefined)?.then === "function") {
        // `.v`, not get: a tracked read of its own state would re-run it on every landing. Read
        // after fn: what fn wrote to it stays
        cur = state.v;
        // Already pending (the first run, or a load it supersedes): no write, no reader runs
        if (cur.status !== TaskStatus.Pending) {
          set(state, (cur = { status: TaskStatus.Pending, value: cur.value }));
        }
        // then(ok, err), not .catch: a reader's throw during a landing's `set` stays reported (it
        // rejects the promise `then` returns); .catch would hand it to err, whose guard drops it
        (out as PromiseLike<T>).then(
          (next) => {
            if (id === run && state.v === cur) {
              const ready: TaskState<T, Fallback> = { status: TaskStatus.Ready, value: next };
              if (process.env.NODE_ENV !== "production") land(watch, state, ready);
              else set(state, ready);
            }
          },
          (error: unknown) => {
            if (id === run && state.v === cur) {
              if (process.env.NODE_ENV !== "production" && isReport(error)) throw error;
              // Written out twice, not held in a const: Bun would keep that const
              if (process.env.NODE_ENV !== "production") {
                land(watch, state, { status: TaskStatus.Error, value: cur.value, error });
              } else set(state, { status: TaskStatus.Error, value: cur.value, error });
            }
          },
        );
      } else set(state, { status: TaskStatus.Ready, value: out as T });
    } catch (error) {
      // A rethrown run returns no cleanup: move the id on, so its callbacks (if any) never land
      if (process.env.NODE_ENV !== "production" && isReport(error)) throw (run++, error);
      set(state, { status: TaskStatus.Error, value: state.v.value, error });
    }
    // oxlint-disable-next-line typescript/strict-void-return -- a cleanup's return value is ignored
    return stop;
  });
  return state;
};

/**
 * EXPERIMENTAL: a thenable that never settles and keeps nothing (its `then` drops the callbacks):
 * return it from a task's `fn` to stay pending, e.g. until another task's value is there. Never
 * `await WAIT` in an async `fn`: the rest of that call (its `finally` blocks included) never runs.
 */
// oxlint-disable-next-line unicorn/no-thenable -- a thenable is the point
export const WAIT: Pick<PromiseLike<never>, "then"> = { then: () => WAIT };

// ── Dev Builds ───────────────────────────────────────────────────────────────

// This module's own dev state; `report` is shared (./dev.ts).

/**
 * Dev builds only: a task's check state. `chain` is 0 for a task made outside a landing, else one
 * more than the task whose landing made it; `by`: the task whose landing its last run ran inside,
 * if any; `warned`: it warned that a landing it led to ran it again.
 */
interface Watch {
  chain: number;
  by: Watch | undefined;
  warned: boolean;
}

/** Dev builds only: the task whose landing is being delivered, if any. */
let landing: Watch | undefined;

/** Dev builds only: a new task's check state; warns at the 10th task in a chain of landings. */
const checkCreate = (): Watch => {
  const by = landing;
  const watch: Watch = { chain: by === undefined ? 0 : by.chain + 1, by: undefined, warned: false };
  if (by?.chain === 9) {
    // Once per landing task: the tasks it makes after this one count on from 11
    by.chain = 10;
    report(
      "warn",
      "10 tasks in a row, each made inside the landing of the one before; an effect that makes a task reads it (read it in an effect of its own)",
    );
  }
  return watch;
};

/**
 * Dev builds only: warns once if the task `watch` belongs to runs inside its own landing, or inside
 * a landing its own led to (A's landing ran B, and B's landing runs A: up to 11 tasks round).
 */
const checkRun = (watch: Watch): void => {
  let at = landing;
  for (let hop = 0; at !== undefined && at !== watch && hop < 10; hop++) at = at.by;
  watch.by = landing;
  if (at === watch && !watch.warned) {
    watch.warned = true;
    report(
      "warn",
      "task run inside its own landing, or one it led to; its fn reads the task with get (use .v), or a reader writes what fn reads",
    );
  }
};

/** Dev builds only: delivers a landing of the task `watch` belongs to, as the one in progress. */
const land = <T>(watch: Watch, state: Signal<T>, next: T): void => {
  // A thenable that calls back at once lands inside the landing in progress
  const prev = landing;
  landing = watch;
  try {
    set(state, next);
  } finally {
    landing = prev;
  }
};

/** Dev builds only: a stage1 development check's error (`report`), not a load's. */
const isReport = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith("stage1: ");
