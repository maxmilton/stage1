// Shared by the async tests (test/unit/task.test.ts, test/unit/examples.test.ts) and their
// subprocess script (./reader-error.ts): loads settled by hand, a promise that catches what `then`
// returns, a value whose display throws, and the subprocess run. A module of its own, not a test
// file: importing a test file would run its tests again in the importer.
// Short names, as in the tests that use these (id-length is off for test files):
// oxlint-disable id-length

export const noop = (): void => {};

/** Returns once every callback chained on `p` so far has run (a promise runs them in order). */
export const after = async (p: PromiseLike<unknown>): Promise<void> => {
  await p.then(noop, noop);
};

export interface Call<A, T> {
  readonly arg: A;
  /** The AbortSignal passed with the call, if any. */
  readonly signal: AbortSignal | undefined;
  /** Resolves the call; returns once the callbacks chained on it so far have run. */
  readonly resolve: (value: T) => Promise<void>;
  /** Rejects the call; returns once the callbacks chained on it so far have run. */
  readonly reject: (error: unknown) => Promise<void>;
}

/**
 * A loader whose calls are settled by hand. With `honour` (the default), an abort rejects the call
 * with the signal's reason, as fetch does.
 */
export const loader = <A, T>(
  honour = true,
): { calls: Call<A, T>[]; load: (arg: A, signal?: AbortSignal) => Promise<T> } => {
  const calls: Call<A, T>[] = [];
  return {
    calls,
    load: (arg, abort) => {
      const { promise, resolve, reject } = Promise.withResolvers<T>();
      if (honour) {
        abort?.addEventListener("abort", () => {
          reject(abort.reason);
        });
      }
      calls.push({
        arg,
        signal: abort,
        resolve: async (value) => {
          resolve(value);
          await after(promise);
        },
        reject: async (error) => {
          reject(error);
          await after(promise);
        },
      });
      return promise;
    },
  };
};

/**
 * A promise whose `then` catches the promise it returns: a reader's throw while an outcome lands
 * rejects that promise, which would fail the test as an unhandled rejection.
 */
export class Caught<T> extends Promise<T> {
  /** What the promise the last `then` returned rejected with (undefined: it fulfilled). */
  public rejected: Promise<unknown> | undefined;

  // Plain promises from `then`, so catching one does not recurse
  public static override get [Symbol.species](): PromiseConstructor {
    return Promise;
  }

  // oxlint-disable-next-line unicorn/no-thenable -- catches what the code under test's then() returns
  public override then<A = T, B = never>(
    ok?: ((value: T) => A | PromiseLike<A>) | null,
    err?: ((error: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    // oxlint-disable-next-line promise/prefer-await-to-then -- the then() under test
    const p = super.then(ok, err);
    // oxlint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- catches it without awaiting it
    this.rejected = p.then(noop, (error: unknown) => error);
    return p;
  }
}

/** A user (`name`) or a hit (`title`) whose display throws. */
export const poison = {
  id: 1,
  get name(): string {
    throw new Error("reader");
  },
  get title(): string {
    throw new Error("reader");
  },
};

/**
 * What a process reports where a reader throws while `example`'s outcome lands (./reader-error.ts):
 * stdout, stderr, and the signal that killed it, if any.
 */
export const report = async (example: string): Promise<string> => {
  const proc = Bun.spawn(
    [process.execPath, "--preload", "./test/setup.ts", "test/fixtures/reader-error.ts", example],
    // A bound: a run that never ends (a reload loop) is killed, and the test says so
    { stderr: "pipe", timeout: 5000 },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return `${out}${err}${proc.signalCode ?? ""}`;
};
