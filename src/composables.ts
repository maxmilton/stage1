// Composables: app-state helpers built on the full core (./signal.ts).
//
// reactive: a class whose `$key` signal fields also read and write as plain `key` properties.
// EXPERIMENTAL AND UNSTABLE: its API and behaviour may change, or it may be removed, in any
// release.
//
//   class Counter {
//     declare count: number; // the key's type (`declare` emits no field)
//     declare readonly double: number; // a computed field's key: read only
//     readonly $count = signal(0);
//     readonly $double = computed(() => this.count * 2);
//     inc(): void {
//       this.count++; // set(this.$count, get(this.$count) + 1)
//     }
//   }
//   reactive(Counter);
//   const c = new Counter();
//   effect(() => show(c.count, c.double)); // get(c.$count), get(c.$double), tracked
//   c.count = 5; // set(c.$count, 5)
//
// `reactive(C)` makes one instance, `new C()` with no arguments, and gives each own enumerable
// `$key` field of it an accessor pair `key` on C.prototype: a read is `get(this.$key)` (tracked), a
// write `set(this.$key, value)`. It returns C itself, so identity, statics, `instanceof`, `#private`
// members, and instances made before are kept. Instances cost what the class's own constructor
// does, and `x.$key` stays the exact signal (for `sub`, `trigger`, and `get`/`set` on hot paths).
//
// What stays with you:
// - The constructor runs once more, at the call, with no arguments: every parameter needs a default
//   (the types require one), and its side effects happen once more (a counter or a registry sees one
//   more instance; an effect, sub, or scope it makes, a `task`'s effect included, is never
//   disposed, and development builds throw: make those in a method the app calls). That instance
//   has no accessors yet, so a write to `key` in the constructor, or in what it calls, gives it an
//   own `key` that nothing reads (development builds then make one more instance, after installing
//   the accessors, to tell it from a field). A `$` field it sets only for some arguments gets no
//   accessor.
// - Call it once per class, at module level, after the class. A subclass with `$` fields of its own
//   is passed too (its accessors go on its own prototype).
// - Type each key with `declare key: V;` in the class: a field (`key!: V`, `key = …`) is an own
//   property that hides the accessor. The types reject a missing or mismatched declaration (a method
//   of the key's name included, and one narrower than the value type) and a `$` field, method, or
//   getter that is neither a signal nor a computed.
// - A `$` field may hold a computed: its key reads it as `get` does. Declare it `declare readonly
//   key: V;`, as writing it is an error (development builds throw; production ones write over the
//   computed's value until it evaluates again). Like any computed, it belongs to the owner it is
//   made under: the one the instance is made under.
// - A key that is already a member of C.prototype or above (a method, an accessor, `constructor`,
//   Object.prototype's `toString`, a base class's member) is replaced on C.prototype.
// - The accessors are enumerable, as an object literal's are: `for…in` lists each key after the
//   own fields. Own-property reads (Object.keys, spread, JSON.stringify, structuredClone) see the
//   `$` signals, not the keys; JSON.stringify and structuredClone throw once a signal has a reader
//   (structuredClone at once for a computed: it holds its getter).
// - Speed: `x.key` is an accessor call, which top-tier code inlines. Every key shares one accessor
//   pair, so out of line its `this[f]` sees every key: a megamorphic keyed load in V8, and in JSC
//   reads about 2.8× and writes 2.4× slower once about 12 keys share it. Code that stays in V8's mid
//   tier (Maglev) pays about 2× a `get(x.$key)` read and 1.5× a `set` of it, the fastest forms at
//   every tier.
// The accessors are a getter and a setter of an object literal, copied as they are (V8's Turbolev
// inlines only accessor-kind functions). `f`, the `$` name, is Object.keys' internalized string
// (one built per call, "$" + k, sends V8 Maglev into a deopt loop). The setter has a block body (a
// call in tail position recompiles JSC's setter).
//
// Development builds check (each check sits behind `process.env.NODE_ENV`, so production builds
// drop them, and this module's import of ./dev.ts with them):
// - at the call, they throw for a constructor that throws with no arguments (with the cause),
//   returns an object that does not inherit C.prototype, or makes or runs an effect, sub, or scope
//   (./dev.ts `sampled`); a `$` field that holds neither a signal nor a computed of this tier (a
//   value, an effect, a lite tier's signal); a key that is already a member of C.prototype or
//   above, unless a reactive() call put it there for the same field; an own `key` next to `$key`
//   (a field) on the instance and on a second one they make after installing the accessors (a
//   write to `key` in the constructor gives only the first an own `key`);
// - at the call, they warn of a class passed again; a second class with the same source (a class
//   literal in a function: a new class per call; a module evaluated again, as a hot reload does); a
//   call inside an effect, sub, or scope (it owns what the constructor makes, and the
//   constructor's reads subscribe an effect);
// - each access goes through accessors of their own, which throw for a `$` field that no longer
//   holds a signal or computed (replaced, or missing from this instance) and for a write to a
//   computed's key, and warn, once per class, of a subclass not passed whose own `$` fields have
//   no accessor. Production builds install the plain accessors.
// Not caught: a forgotten call.
//
// Short names are deliberate (bytes), dev checks read process.env, and their helpers and state sit
// after the code that uses them (as in ./signal.ts):
// oxlint-disable id-length no-bitwise node/no-process-env no-negated-condition no-use-before-define
// oxlint-disable typescript/non-nullable-type-assertion-style

import { report, sampled } from "./dev.ts";
import { type Computed, get, owner, set, type Signal, signal } from "./signal.ts";

/**
 * The keys reactive() gives an instance `I`: `key: V` for each `$key` field that holds a
 * `Signal<V>` or a `Computed<V>`; any other `$` field, and a key `I` declares narrower than `V`,
 * gives `never`. A class declares them, `declare key: V;` (`declare readonly key: V;` for a
 * computed), and reactive() requires it.
 */
export type ReactiveKeys<I> = {
  -readonly [K in keyof I as K extends `$${infer N}` ? N : never]: Exact<
    I,
    K,
    I[K] extends Signal<infer V> ? V : I[K] extends Computed<infer V> ? V : never
  >;
};

/**
 * `V`, the value type of `I`'s field `K`, or `never` if `I` declares its key narrower (a `number`
 * for a `Signal<number | undefined>`): the declaration must be assignable to `V` and back.
 */
type Exact<I, K, V> = K extends `$${infer N extends keyof I & string}`
  ? [V] extends [I[N]]
    ? V
    : never
  : V;

/** An instance's `$` fields, as the accessors read them (a computed too: reads only). */
type Fields = Record<string, Signal<unknown>>;

/**
 * EXPERIMENTAL: may change or be removed. Gives each own `$key` signal or computed field of `new
 * C()` (made once, with no arguments) a `key` accessor pair on C.prototype (a tracked get and a set
 * of the field); returns C.
 */
export const reactive = <T extends new () => ReactiveKeys<InstanceType<T>>>(C: T): T => {
  for (const f of Object.keys(process.env.NODE_ENV !== "production" ? checkClass(C) : new C())) {
    if (f[0] === "$") {
      const k = f.slice(1);
      Object.defineProperties(
        C.prototype as object,
        Object.getOwnPropertyDescriptors(
          process.env.NODE_ENV !== "production"
            ? checked(k, f)
            : {
                get [k]() {
                  return get((this as Fields)[f]);
                },
                set [k](v: unknown) {
                  set((this as Fields)[f], v);
                },
              },
        ),
      );
    }
  }
  if (process.env.NODE_ENV !== "production") checkOwn(C);
  return C;
};

// ── Dev Builds ───────────────────────────────────────────────────────────────

// This module's own dev state; `report` and `sampled` are shared (./dev.ts).

/** Dev builds only: a class passed to reactive(). */
type Class = abstract new (...args: never) => object;
/** Dev builds only: the core's node field `f` (./signal.ts F: 1 computed, 2 effect, 4 scope). */
interface Flags {
  f: number;
}

/** Dev builds only: the prototypes given accessors, and the keys each was given. */
const done = new WeakMap<object, string[]>();
/** Dev builds only: prototypes the dev accessors met that reactive() was not given. */
const seen = new WeakSet<object>();
/** Dev builds only: classes passed, per source text (a class literal evaluated again). */
const sources = new Map<string, number>();
/** Dev builds only: the keys the instance checkClass made last has own, next to their `$` fields. */
let owned: string[] = [];
/** Dev builds only: the core's node class (from one signal, made at the first check). */
let Node: Class | undefined;

/** Dev builds only: the name messages give `C`. */
const nameOf = (C: Class): string => C.name || "an anonymous class";

/** Dev builds only: a signal or computed of this tier, a core node with no runner bits (2, 4). */
const isNode = (v: unknown): v is Flags =>
  v instanceof (Node ??= (signal(0) as object).constructor as Class) && !((v as Flags).f & 6);

/** Dev builds only: a `$` field's value that `isNode` rejected, as messages give it. */
const what = (v: unknown): string => {
  if (v === null || v === undefined) return String(v);
  if (typeof v !== "object") return `a ${typeof v}`;
  return v instanceof (Node as Class) ? "an effect, sub, or scope" : "an object";
};

/**
 * Dev builds only, `reactive(C)`: makes the instance and checks the call, the instance, and its `$`
 * fields; records the keys, and those it has own for checkOwn; returns the instance.
 */
const checkClass = (C: Class): object => {
  const name = nameOf(C);
  const p = C.prototype as object;
  if (done.has(p)) {
    report("warn", `reactive(${name}) again: call it once per class`);
  } else {
    // A class literal evaluated again (in a function: a new class per call; its module evaluated
    // again, as a hot reload does), or a duplicate class elsewhere (also warned)
    const source = Function.prototype.toString.call(C);
    const count = (sources.get(source) ?? 0) + 1;
    sources.set(source, count);
    if (count === 2) {
      report(
        "warn",
        `reactive(${name}): a second class with the same source; a class literal in a function makes a new class per call: move it, with the reactive() call, to module level (a module evaluated again, as a hot reload does, makes one too: harmless)`,
      );
    }
  }
  if (owner() !== undefined) {
    report(
      "warn",
      `reactive(${name}) inside an effect, sub, or scope: call it once per class, at module level`,
    );
  }
  let x: object;
  let ran: boolean;
  try {
    [x, ran] = sampled(() => new (C as new () => object)());
  } catch (error) {
    report(
      "critical",
      `reactive(${name}): the constructor threw when called with no arguments (see cause); reactive() makes one instance that way to find the $ fields, so every parameter needs a default (a custom element: define it first)`,
      { cause: error },
    );
  }
  if (!(x instanceof C)) {
    report(
      "critical",
      `reactive(${name}): the constructor returned an object that does not inherit the class's prototype, so the accessors would not apply`,
    );
  }
  if (ran) {
    report(
      "critical",
      `reactive(${name}): the constructor made or ran an effect, sub, or scope (a write runs those that read it); reactive() makes one instance to find the $ fields, and nothing disposes what it makes: do that in a method the app calls`,
    );
  }
  const keys: string[] = [];
  const own: string[] = [];
  for (const f of Object.keys(x)) {
    if (f[0] === "$") {
      const v = (x as Fields)[f];
      if (!isNode(v)) {
        report(
          "critical",
          `reactive(${name}): ${f} holds ${what(v)}, not a signal or computed (a stage1 one, not a lite tier's)`,
        );
      }
      const k = f.slice(1);
      if (Object.hasOwn(x, k)) own.push(k);
      // The nearest prototype that has `k`, if any
      let q = p as object | null;
      while (q !== null && !Object.hasOwn(q, k)) q = Object.getPrototypeOf(q) as object | null;
      if (q !== null && !done.get(q)?.includes(k)) {
        const at =
          q === p ? "the class's prototype" : `${nameOf(q.constructor as Class)}.prototype`;
        report(
          "critical",
          `reactive(${name}): ${k} is already a member of ${at}, and the accessor for ${f} would replace it; rename the field`,
        );
      }
      keys.push(k);
    }
  }
  done.set(p, keys);
  // Set last: the constructor can call reactive() for another class
  owned = own;
  return x;
};

/**
 * Dev builds only, `reactive(C)` once the accessors are on C.prototype: if the instance checkClass
 * made had an own `key` next to `$key`, makes a second one, and throws if it has one too (a field
 * hides the accessor). Otherwise the first one's came from a constructor write, which the accessor
 * now takes.
 */
const checkOwn = (C: Class): void => {
  const keys = owned;
  if (keys.length > 0) {
    const x = new (C as new () => object)();
    for (const k of keys) {
      if (Object.hasOwn(x, k)) {
        report(
          "critical",
          `reactive(${nameOf(C)}): an own ${k} hides the accessor for $${k}: type the key with \`declare ${k}\`, not a field`,
        );
      }
    }
  }
};

/** Dev builds only: the accessor pair for the field `f`, under the key `k`, checking each access. */
const checked = (k: string, f: string): object => ({
  get [k]() {
    return get(field(this, f, false));
  },
  set [k](v: unknown) {
    set(field(this, f, true), v);
  },
});

/**
 * Dev builds only, a dev accessor's read (or, `write`, write) of `x`'s field `f`: warns, once per
 * prototype reactive() was not given, of its own `$` fields with no accessor (a subclass not
 * passed); throws if `x[f]` is neither a signal nor a computed, or is a computed and this writes
 * it. Returns `x[f]`.
 */
const field = (x: object, f: string, write: boolean): Signal<unknown> => {
  const p = Object.getPrototypeOf(x) as object;
  if (!done.has(p) && !seen.has(p)) {
    seen.add(p);
    const missing = Object.keys(x).filter((g) => g[0] === "$" && !(g.slice(1) in x));
    if (missing.length > 0) {
      report(
        "warn",
        `${nameOf(p.constructor as Class)} extends a reactive class but was not passed to reactive(): ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no accessor`,
      );
    }
  }
  const n = (x as Fields)[f];
  if (!isNode(n)) {
    report(
      "critical",
      `${nameOf(p.constructor as Class)}: ${f} holds ${what(n)}, not a signal or computed; every instance needs the $ fields the one reactive() made has, and a $ field must not be replaced`,
    );
  }
  if (write && n.f & 1) {
    report(
      "critical",
      `${nameOf(p.constructor as Class)}: a write to ${f.slice(1)}, whose ${f} holds a computed: write the signals it reads instead`,
    );
  }
  return n;
};
