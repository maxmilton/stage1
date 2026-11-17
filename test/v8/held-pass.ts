// Characterization fixture: the shape the lite tiers avoid. A pass (a write's, or a batch end's
// drain) holds `held` across its loops, so a RangeError V8 throws at a back-edge or OSR entry leaves
// it set, and every later write only queues.
// oxlint-disable typescript/no-non-null-assertion no-empty id-length vitest/require-hook

interface Source {
  v: unknown;
  fns: ((value: unknown) => void)[];
  seen: unknown[];
}

let held = false;
const queue: Source[] = [];

const pass = (first: Source): void => {
  held = true;
  for (let s: Source | undefined = first; s !== undefined; s = queue.pop()) {
    for (let index = 0; index < s.fns.length; index++) {
      if (s.seen[index] !== s.v) {
        try {
          s.fns[index]((s.seen[index] = s.v));
        } catch {}
      }
    }
  }
  held = false;
};

export const signal = (value: unknown): Source => ({ v: value, fns: [], seen: [] });

export const set = (s: Source, value: unknown): void => {
  if (s.v !== value) {
    s.v = value;
    if (held) queue.push(s);
    else pass(s);
  }
};

export const sub = (s: Source, fn: (value: unknown) => void): Source => {
  s.fns.push(fn);
  s.seen.push(s.v);
  fn(s.v);
  return s;
};

export const dispose = (_handle: Source): void => {
  // nothing to stop: the probe disposes only subs it never writes again
};

export const batch = <T>(fn: () => T): T => {
  const was = held;
  held = true;
  try {
    return fn();
  } finally {
    held = was;
    if (!was && queue.length > 0) pass(queue.pop()!);
  }
};
