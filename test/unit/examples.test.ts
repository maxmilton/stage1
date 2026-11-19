// What the examples promise (examples/*.ts: header comments and JSDoc; README "Async data"), one
// describe per example. Loads are settled by hand; `after` waits for the callbacks chained on a
// load's promise; timers are faked (`clock`). bun test fails the running test on an unhandled
// rejection (Bun 1.4.4), so every test also checks that it leaves none; whether a reader's throw is
// reported as one is observed in a subprocess (test/fixtures/reader-error.ts). Run in both modes:
// `bun test` and `NODE_ENV=production bun test`.

import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { dispose, get, set, type Signal, signal } from "stage1";
import { Profile, type User } from "../../examples/once.ts";
import { type User as Author, type Post, Posts } from "../../examples/posts.ts";
import { Profile as KeyedProfile } from "../../examples/profile.ts";
import { type Hit, Search } from "../../examples/search.ts";
import { type Todo, Todos } from "../../examples/todos.ts";
import { Validate } from "../../examples/validate.ts";
import { after, type Call, Caught, loader, poison, report } from "../fixtures/async.ts";

/** The text of each `li` under `parent`, in order. */
const rows = (parent: Element): string[] =>
  Array.from(parent.querySelectorAll("li"), (li) => li.textContent);

/**
 * Fakes setTimeout and clearTimeout until disposed (`using`): `advance(ms)` moves the clock on and
 * runs the timers due, then returns once the promise callbacks they led to have run.
 */
const clock = (): { advance: (ms: number) => Promise<void> } & Disposable => {
  const due = new Map<number, { at: number; fn: () => void }>();
  let now = 0;
  let last = 0;
  const setTimer = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms = 0) => {
    due.set(++last, { at: now + ms, fn });
    return last;
  }) as unknown as typeof setTimeout);
  const clearTimer = spyOn(globalThis, "clearTimeout").mockImplementation(((id: number) => {
    due.delete(id);
  }) as typeof clearTimeout);
  return {
    advance: async (ms) => {
      now += ms;
      for (const [id, timer] of due) {
        if (timer.at <= now) {
          due.delete(id);
          timer.fn();
        }
      }
      // A macrotask, not a sleep: the promise callbacks queued until then run before it
      const turn = Promise.withResolvers<unknown>();
      setImmediate(turn.resolve);
      await turn.promise;
    },
    [Symbol.dispose]: () => {
      setTimer.mockRestore();
      clearTimer.mockRestore();
    },
  };
};

let reports: Record<"once" | "search", Promise<string>>;
// Started together: a process takes about 0.1 s
beforeAll(() => {
  reports = {
    once: report("once"),
    search: report("search"),
  };
});

describe("examples/once.ts: Profile", () => {
  /** A Profile in a new parent; disposed at the end of the block (`using`). */
  const profile = (load: () => Promise<User>): { parent: HTMLDivElement } & Disposable => {
    const parent = document.createElement("div");
    const card = Profile(parent, load);
    return {
      parent,
      [Symbol.dispose]: () => {
        dispose(card);
      },
    };
  };

  test("shows … while the load is pending", () => {
    expect.assertions(1);
    const l = loader<string, User>();
    using m = profile(() => l.load("me"));
    expect(m.parent.textContent).toBe("…");
  });

  test("shows the user's name when the load resolves", async () => {
    expect.assertions(1);
    const l = loader<string, User>();
    using m = profile(() => l.load("me"));
    await l.calls[0].resolve({ name: "Ada" });
    expect(m.parent.textContent).toBe("Ada");
  });

  test("shows the error when the load rejects", async () => {
    expect.assertions(1);
    const l = loader<string, User>();
    using m = profile(() => l.load("me"));
    await l.calls[0].reject(new Error("x"));
    expect(m.parent.textContent).toBe("error: Error: x");
  });

  test("a synchronous throw from load shows the error", () => {
    expect.assertions(1);
    using m = profile(() => {
      throw new Error("bad");
    });
    expect(m.parent.textContent).toBe("error: Error: bad");
  });

  test("a synchronous throw from load does not throw out of Profile", () => {
    expect.assertions(1);
    expect(() => {
      dispose(
        Profile(document.createElement("div"), () => {
          throw new Error("bad");
        }),
      );
    }).not.toThrow();
  });

  test("a load resolving after disposal writes nothing", async () => {
    expect.assertions(1);
    const l = loader<string, User>();
    const m = profile(() => l.load("me"));
    m[Symbol.dispose]();
    const shown = m.parent.textContent;
    await l.calls[0].resolve({ name: "Ada" });
    expect(m.parent.textContent).toBe(shown);
  });

  test("a load rejecting after disposal writes nothing", async () => {
    expect.assertions(1);
    const l = loader<string, User>();
    const m = profile(() => l.load("me"));
    m[Symbol.dispose]();
    const shown = m.parent.textContent;
    await l.calls[0].reject(new Error("x"));
    expect(m.parent.textContent).toBe(shown);
  });

  test("an error thrown while showing the user is not shown as a failed load", async () => {
    expect.assertions(1);
    const user = Caught.resolve<User>(poison);
    using m = profile(() => user);
    const shown = m.parent.textContent;
    await after(user);
    expect(m.parent.textContent).toBe(shown);
  });

  test("an error thrown while showing the user is reported as an unhandled rejection", () => {
    expect.assertions(1);
    expect(reports.once).resolves.toBe("Error: reader");
  });
});

describe("examples/search.ts: Search", () => {
  /** A Search for `text` in a new parent; disposed at the end of the block (`using`). */
  const panel = (
    text: string,
    search: (query: string, signal: AbortSignal) => Promise<readonly Hit[]>,
  ): {
    query: Signal<string>;
    refresh: () => void;
    /** The titles of the rows shown. */
    hits: () => string[];
    status: () => string | undefined;
    loading: () => boolean;
  } & Disposable => {
    const parent = document.createElement("div");
    const query = signal(text);
    const s = Search(parent, query, search);
    return {
      query,
      refresh: s.refresh,
      hits: () => Array.from(parent.querySelectorAll("li"), (li) => li.textContent),
      status: () => parent.querySelector("p")?.textContent,
      loading: () => parent.classList.contains("loading"),
      [Symbol.dispose]: () => {
        dispose(s.scope);
      },
    };
  };

  test("shows the hits when the search resolves", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    await l.calls[0].resolve([
      { id: 1, title: "one" },
      { id: 2, title: "two" },
    ]);
    expect(p.hits()).toEqual(["one", "two"]);
  });

  test("a hit the next search returns again with a new title shows the new title", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    await l.calls[0].resolve([{ id: 1, title: "one" }]);
    set(p.query, "ab");
    await l.calls[1].resolve([{ id: 1, title: "uno" }]);
    expect(p.hits()).toEqual(["uno"]);
  });

  test("a search in flight sets the loading class", () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    expect(p.loading()).toBe(true);
  });

  test("the loading class goes when the hits land", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    await l.calls[0].resolve([{ id: 1, title: "one" }]);
    expect(p.loading()).toBe(false);
  });

  test("a new query keeps the previous hits until its own land", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    await l.calls[0].resolve([{ id: 1, title: "one" }]);
    set(p.query, "ab");
    expect(p.hits()).toEqual(["one"]);
  });

  test("the latest search wins when an older one resolves after it", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>(false);
    using p = panel("a", l.load);
    set(p.query, "ab");
    await l.calls[1].resolve([{ id: 2, title: "two" }]);
    await l.calls[0].resolve([{ id: 1, title: "one" }]);
    expect(p.hits()).toEqual(["two"]);
  });

  test("a superseded search is aborted", () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    set(p.query, "ab");
    expect(l.calls.map((c) => c.signal?.aborted)).toEqual([true, false]);
  });

  test("a superseded search's AbortError is not shown", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>(false);
    using p = panel("a", l.load);
    set(p.query, "ab");
    await l.calls[0].reject(new DOMException("aborted", "AbortError"));
    expect(p.status()).toBe("");
  });

  test("a settled search is not aborted by the next query", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    await l.calls[0].resolve([{ id: 1, title: "one" }]);
    set(p.query, "ab");
    expect(l.calls[0].signal?.aborted).toBe(false);
  });

  test("disposal aborts the search in flight", () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    const p = panel("a", l.load);
    p[Symbol.dispose]();
    expect(l.calls[0].signal?.aborted).toBe(true);
  });

  test("a failed search shows the error", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    await l.calls[0].reject(new Error("x"));
    expect(p.status()).toBe("error: Error: x");
  });

  test("a failed search keeps the previous hits", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    await l.calls[0].resolve([{ id: 1, title: "one" }]);
    set(p.query, "ab");
    await l.calls[1].reject(new Error("x"));
    expect(p.hits()).toEqual(["one"]);
  });

  test("clearing the query clears the hits at once", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    await l.calls[0].resolve([{ id: 1, title: "one" }]);
    set(p.query, "");
    expect(p.hits()).toEqual([]);
  });

  test("a search in flight when the query is cleared never shows its hits", async () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>(false);
    using p = panel("a", l.load);
    set(p.query, "");
    await l.calls[0].resolve([{ id: 1, title: "one" }]);
    expect(p.hits()).toEqual([]);
  });

  test("refresh searches the same query again", () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    using p = panel("a", l.load);
    p.refresh();
    expect(l.calls.map((c) => c.arg)).toEqual(["a", "a"]);
  });

  test("a signal search reads does not run it again", () => {
    expect.assertions(1);
    const l = loader<string, readonly Hit[]>();
    const limit = signal(10);
    using _ = panel("a", (text, abort) => {
      get(limit);
      return l.load(text, abort);
    });
    set(limit, 20);
    expect(l.calls).toHaveLength(1);
  });

  test("a synchronous throw from search shows the error", () => {
    expect.assertions(1);
    using p = panel("", () => {
      throw new Error("bad");
    });
    set(p.query, "a");
    expect(p.status()).toBe("error: Error: bad");
  });

  test("an error a row throws while hits land is not shown as the search's", async () => {
    expect.assertions(1);
    const hits = Caught.resolve<readonly Hit[]>([poison]);
    using p = panel("a", () => hits);
    await after(hits);
    expect(p.status()).toBe("");
  });

  test("an error a row throws while hits land is reported as an unhandled rejection", () => {
    expect.assertions(1);
    expect(reports.search).resolves.toBe("Error: reader");
  });
});

describe("examples/profile.ts: Profile", () => {
  /** A Profile for `id` 1 in a new parent; disposed at the end of the block (`using`). */
  const card = (
    load: (id: number, signal: AbortSignal) => Promise<User>,
  ): {
    id: Signal<number>;
    refresh: () => void;
    text: () => string | undefined;
    loading: () => boolean | undefined;
  } & Disposable => {
    const parent = document.createElement("div");
    const id = signal(1);
    const c = KeyedProfile(parent, id, load);
    return {
      id,
      refresh: c.refresh,
      text: () => parent.firstElementChild?.textContent,
      loading: () => parent.firstElementChild?.classList.contains("loading"),
      [Symbol.dispose]: () => {
        dispose(c.scope);
      },
    };
  };

  test("shows … while the first load is pending", () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    expect(c.text()).toBe("…");
  });

  test("a load in flight sets the loading class", () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    expect(c.loading()).toBe(true);
  });

  test("shows the user's name when the load resolves", async () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    await l.calls[0].resolve({ name: "Ada" });
    expect(c.text()).toBe("Ada");
  });

  test("the loading class goes when the load resolves", async () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    await l.calls[0].resolve({ name: "Ada" });
    expect(c.loading()).toBe(false);
  });

  test("the loading class goes when the load rejects", async () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    await l.calls[0].reject(new Error("x"));
    expect(c.loading()).toBe(false);
  });

  test("a new id keeps the last name while its load is pending", async () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    await l.calls[0].resolve({ name: "Ada" });
    set(c.id, 2);
    expect(c.text()).toBe("Ada");
  });

  test("loads the new id", () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    set(c.id, 2);
    expect(l.calls.map((call) => call.arg)).toEqual([1, 2]);
  });

  test("shows the error when the load rejects", async () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    await l.calls[0].reject(new Error("x"));
    expect(c.text()).toBe("error: Error: x");
  });

  test("a synchronous throw from load shows the error", () => {
    expect.assertions(1);
    using c = card(() => {
      throw new Error("bad");
    });
    expect(c.text()).toBe("error: Error: bad");
  });

  test("the latest id wins when an older load resolves after it", async () => {
    expect.assertions(1);
    const l = loader<number, User>(false);
    using c = card(l.load);
    set(c.id, 2);
    await l.calls[1].resolve({ name: "Grace" });
    await l.calls[0].resolve({ name: "Ada" });
    expect(c.text()).toBe("Grace");
  });

  test("a superseded load is aborted", () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    set(c.id, 2);
    expect(l.calls.map((call) => call.signal?.aborted)).toEqual([true, false]);
  });

  test("a superseded load's AbortError is not shown", async () => {
    expect.assertions(1);
    const l = loader<number, User>(false);
    using c = card(l.load);
    set(c.id, 2);
    await l.calls[0].reject(new DOMException("aborted", "AbortError"));
    expect(c.text()).toBe("…");
  });

  test("a settled load is not aborted by the next id", async () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    await l.calls[0].resolve({ name: "Ada" });
    set(c.id, 2);
    expect(l.calls[0].signal?.aborted).toBe(false);
  });

  test("a failed load is not aborted by the next id", async () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    await l.calls[0].reject(new Error("x"));
    set(c.id, 2);
    expect(l.calls[0].signal?.aborted).toBe(false);
  });

  test("disposal aborts the load in flight", () => {
    expect.assertions(1);
    const l = loader<number, User>();
    const c = card(l.load);
    c[Symbol.dispose]();
    expect(l.calls[0].signal?.aborted).toBe(true);
  });

  test("a load resolving after disposal shows nothing", async () => {
    expect.assertions(1);
    const l = loader<number, User>(false);
    const c = card(l.load);
    c[Symbol.dispose]();
    await l.calls[0].resolve({ name: "Ada" });
    expect(c.text()).toBe("…");
  });

  test("refresh loads the same id again", () => {
    expect.assertions(1);
    const l = loader<number, User>();
    using c = card(l.load);
    c.refresh();
    expect(l.calls.map((call) => call.arg)).toEqual([1, 1]);
  });

  test("a signal load reads does not load again", () => {
    expect.assertions(1);
    const l = loader<number, User>();
    const lang = signal("en");
    using _ = card((id, abort) => {
      get(lang);
      return l.load(id, abort);
    });
    set(lang, "fr");
    expect(l.calls).toHaveLength(1);
  });
});

describe("examples/todos.ts: Todos", () => {
  /** Todos in a new parent, loading the list from `load`; disposed at the end of the block. */
  const app = (
    load: () => Promise<readonly Todo[]>,
    save: (todo: Todo) => Promise<unknown>,
  ): { add: (title: string) => void; reload: () => void; rows: () => string[] } & Disposable => {
    const parent = document.createElement("div");
    const t = Todos(parent, load, save);
    return {
      add: t.add,
      reload: t.reload,
      rows: () => rows(parent),
      [Symbol.dispose]: () => {
        dispose(t.scope);
      },
    };
  };
  const milk: Todo = { id: "m", title: "milk" };

  test("shows the loaded todos", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    expect(a.rows()).toEqual(["milk"]);
  });

  test("add shows the todo before it is saved", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    a.add("eggs");
    expect(a.rows()).toEqual(["milk", "eggs"]);
  });

  test("add saves the todo", () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    a.add("eggs");
    expect(s.calls.map((call) => call.arg.title)).toEqual(["eggs"]);
  });

  test("a saved todo stays", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    a.add("eggs");
    await s.calls[0].resolve("ok");
    expect(a.rows()).toEqual(["milk", "eggs"]);
  });

  test("a save with nothing in between does not load the list again", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    a.add("eggs");
    await s.calls[0].resolve("ok");
    expect(l.calls).toHaveLength(1);
  });

  test("a failed save puts the list back", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    a.add("eggs");
    await s.calls[0].reject(new Error("x"));
    expect(a.rows()).toEqual(["milk"]);
  });

  test("a synchronous throw from save puts the list back", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    using a = app(
      () => l.load(0),
      () => {
        throw new Error("bad");
      },
    );
    await l.calls[0].resolve([milk]);
    a.add("eggs");
    expect(a.rows()).toEqual(["milk"]);
  });

  test("a failed save after another add loads the list again", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    a.add("eggs");
    a.add("tea");
    await s.calls[0].reject(new Error("x"));
    expect(l.calls).toHaveLength(2);
  });

  test("a save after a reload loads the list again", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    a.add("eggs");
    a.reload();
    await l.calls[1].resolve([milk]);
    await s.calls[0].resolve("ok");
    expect(l.calls).toHaveLength(3);
  });

  test("an add while the list loads drops that load", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    a.add("eggs");
    await l.calls[0].resolve([milk]);
    expect(a.rows()).toEqual(["eggs"]);
  });

  test("an add while the list loads shows the loaded list once the save settles", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    a.add("eggs");
    await l.calls[0].resolve([milk]);
    await s.calls[0].resolve("ok");
    await l.calls.at(-1)?.resolve([milk, s.calls[0].arg]);
    expect(a.rows()).toEqual(["milk", "eggs"]);
  });

  test("a failed add while the list loads loads the list again", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    a.add("eggs");
    await l.calls[0].resolve([milk]);
    await s.calls[0].reject(new Error("x"));
    await l.calls.at(-1)?.resolve([milk]);
    expect(a.rows()).toEqual(["milk"]);
  });

  test("reload loads the list again", () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    a.reload();
    expect(l.calls).toHaveLength(2);
  });

  test("a reload returning a todo with a new title shows the new title", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    using a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    a.reload();
    await l.calls[1].resolve([{ id: "m", title: "oat milk" }]);
    expect(a.rows()).toEqual(["oat milk"]);
  });

  test("a load resolving after disposal shows nothing", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    const a = app(() => l.load(0), s.load);
    a[Symbol.dispose]();
    await l.calls[0].resolve([milk]);
    expect(a.rows()).toEqual([]);
  });

  test("a failed save after disposal changes nothing shown", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    const a = app(() => l.load(0), s.load);
    await l.calls[0].resolve([milk]);
    a.add("eggs");
    a[Symbol.dispose]();
    await s.calls[0].reject(new Error("x"));
    expect(a.rows()).toEqual(["milk", "eggs"]);
  });

  test("a signal load reads does not load the list again", () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    const lang = signal("en");
    using _ = app(() => {
      get(lang);
      return l.load(0);
    }, s.load);
    set(lang, "fr");
    expect(l.calls).toHaveLength(1);
  });

  test("a save settling after disposal loads nothing", async () => {
    expect.assertions(1);
    const l = loader<number, readonly Todo[]>();
    const s = loader<Todo, unknown>();
    const a = app(() => l.load(0), s.load);
    a.add("eggs");
    a[Symbol.dispose]();
    await s.calls[0].resolve("ok");
    expect(l.calls).toHaveLength(1);
  });
});

describe("examples/posts.ts: Posts", () => {
  /**
   * Posts for the user named "ada" in a new parent; disposed at the end of the block. Both loaders
   * read `lang`, as a locale would.
   */
  const page = (): {
    name: Signal<string>;
    lang: Signal<string>;
    users: Call<string, Author>[];
    posts: Call<number, readonly Post[]>[];
    heading: () => string | undefined;
    status: () => string | undefined;
    rows: () => string[];
    loading: () => boolean | undefined;
    hidden: () => HTMLElement["hidden"] | undefined;
  } & Disposable => {
    const parent = document.createElement("div");
    const name = signal("ada");
    const lang = signal("en");
    const users = loader<string, Author>();
    const posts = loader<number, readonly Post[]>();
    const p = Posts(
      parent,
      name,
      (key) => {
        get(lang);
        return users.load(key);
      },
      (key) => {
        get(lang);
        return posts.load(key);
      },
    );
    return {
      name,
      lang,
      users: users.calls,
      posts: posts.calls,
      heading: () => parent.querySelector("h2")?.textContent,
      status: () => parent.querySelector("p")?.textContent,
      rows: () => rows(parent),
      loading: () => parent.querySelector("ul")?.classList.contains("loading"),
      hidden: () => parent.querySelector("section")?.hidden,
      [Symbol.dispose]: () => {
        dispose(p);
      },
    };
  };
  const ada: Author = { id: 1, name: "Ada" };
  const grace: Author = { id: 2, name: "Grace" };

  test("shows … while the user loads", () => {
    expect.assertions(1);
    using p = page();
    expect(p.heading()).toBe("…");
  });

  test("shows the user's name when the user loads", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    expect(p.heading()).toBe("Ada");
  });

  test("the posts wait while the user loads", () => {
    expect.assertions(1);
    using p = page();
    expect(p.posts).toHaveLength(0);
  });

  test("the posts have the loading class while the user loads", () => {
    expect.assertions(1);
    using p = page();
    expect(p.loading()).toBe(true);
  });

  test("the posts have the loading class while they load", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    expect(p.loading()).toBe(true);
  });

  test("the loading class goes when the posts load", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    await p.posts[0].resolve([{ id: 1, title: "Notes" }]);
    expect(p.loading()).toBe(false);
  });

  test("the loading class goes when the posts fail to load", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    await p.posts[0].reject(new Error("x"));
    expect(p.loading()).toBe(false);
  });

  test("loads the user's posts once the user loads", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    expect(p.posts.map((call) => call.arg)).toEqual([1]);
  });

  test("shows the posts when they load", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    await p.posts[0].resolve([{ id: 1, title: "Notes" }]);
    expect(p.rows()).toEqual(["Notes"]);
  });

  test("a user that fails to load shows the error", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].reject(new Error("x"));
    expect(p.heading()).toBe("error: Error: x");
  });

  test("a user that fails to load never loads the posts", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].reject(new Error("x"));
    expect(p.posts).toHaveLength(0);
  });

  test("a later user that fails to load hides the last user's posts", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    await p.posts[0].resolve([{ id: 1, title: "Notes" }]);
    set(p.name, "grace");
    await p.users[1].reject(new Error("x"));
    expect(p.hidden()).toBe(true);
  });

  test("a new name after a user that failed to load shows the posts again", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    set(p.name, "grace");
    await p.users[1].reject(new Error("x"));
    set(p.name, "linus");
    expect(p.hidden()).toBe(false);
  });

  test("posts that fail to load show the error", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    await p.posts[0].reject(new Error("x"));
    expect(p.status()).toBe("error: Error: x");
  });

  test("a new name loads the new user's posts once that user loads", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    set(p.name, "grace");
    await p.users[1].resolve(grace);
    expect(p.posts.map((call) => call.arg)).toEqual([1, 2]);
  });

  test("the last posts stay until the next user's posts land", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    await p.posts[0].resolve([{ id: 1, title: "Notes" }]);
    set(p.name, "grace");
    await p.users[1].resolve(grace);
    expect(p.rows()).toEqual(["Notes"]);
  });

  test("a next user's post with an id the last posts had shows its own title", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    await p.posts[0].resolve([{ id: 1, title: "Notes" }]);
    set(p.name, "grace");
    await p.users[1].resolve(grace);
    await p.posts[1].resolve([{ id: 1, title: "COBOL" }]);
    expect(p.rows()).toEqual(["COBOL"]);
  });

  test("the same user loaded again does not load the posts again", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    set(p.name, "Ada");
    await p.users[1].resolve({ id: 1, name: "Ada" });
    expect(p.posts).toHaveLength(1);
  });

  test("a previous user's posts resolving after the next user's never show", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    set(p.name, "grace");
    await p.users[1].resolve(grace);
    await p.posts[1].resolve([{ id: 2, title: "COBOL" }]);
    await p.posts[0].resolve([{ id: 1, title: "Notes" }]);
    expect(p.rows()).toEqual(["COBOL"]);
  });

  test("posts resolving after disposal show nothing", async () => {
    expect.assertions(1);
    const p = page();
    await p.users[0].resolve(ada);
    p[Symbol.dispose]();
    await p.posts[0].resolve([{ id: 1, title: "Notes" }]);
    expect(p.rows()).toEqual([]);
  });

  test("a signal the user's loader reads does not load the user again", () => {
    expect.assertions(1);
    using p = page();
    set(p.lang, "fr");
    expect(p.users).toHaveLength(1);
  });

  test("a signal the posts' loader reads does not load the posts again", async () => {
    expect.assertions(1);
    using p = page();
    await p.users[0].resolve(ada);
    set(p.lang, "fr");
    expect(p.posts).toHaveLength(1);
  });

  test("pages disposed while their posts wait can be collected", async () => {
    expect.assertions(1);
    // Loads that never settle and that nothing holds: only what the posts wait on could keep a page
    const refs = Array.from({ length: 20 }, () => {
      const parent = document.createElement("div");
      dispose(
        Posts(
          parent,
          signal("ada"),
          () => Promise.withResolvers<Author>().promise,
          () => Promise.withResolvers<readonly Post[]>().promise,
        ),
      );
      return new WeakRef(parent);
    });
    await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
    Bun.gc(true);
    // A bound, not 0: a conservative stack scan can keep a few
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBeLessThan(10);
  });
});

describe("examples/validate.ts: Validate", () => {
  /** A Validate of a new input holding `text`, with a 300 ms pause; disposed (`using`). */
  const field = (
    check: (text: string) => string | PromiseLike<string>,
    text = "",
  ): { type: (text: string) => void; note: () => string | null } & Disposable => {
    const input = document.createElement("form").appendChild(document.createElement("input"));
    input.value = text;
    const v = Validate(input, check, 300);
    return {
      type: (next) => {
        input.value = next;
        input.dispatchEvent(new window.Event("input"));
      },
      note: () => input.nextSibling?.textContent ?? null,
      [Symbol.dispose]: () => {
        dispose(v);
      },
    };
  };
  const short = (text: string): string => (text.length < 3 ? "at least 3 characters" : "");

  // test.serial: the clock replaces the global setTimeout and clearTimeout
  test.serial("checks nothing until typing pauses for ms", async () => {
    expect.assertions(1);
    using time = clock();
    const l = loader<string, string>();
    using f = field(l.load);
    f.type("ab");
    await time.advance(299);
    expect(l.calls).toHaveLength(0);
  });

  test.serial("checks the text once typing pauses for ms", async () => {
    expect.assertions(1);
    using time = clock();
    const l = loader<string, string>();
    using f = field(l.load);
    f.type("ab");
    await time.advance(300);
    expect(l.calls.map((call) => call.arg)).toEqual(["ab"]);
  });

  test.serial("checks the starting text once the pause ends", async () => {
    expect.assertions(1);
    using time = clock();
    const l = loader<string, string>();
    using _ = field(l.load, "ab");
    await time.advance(300);
    expect(l.calls.map((call) => call.arg)).toEqual(["ab"]);
  });

  test.serial("typing again before the pause ends checks only the latest text", async () => {
    expect.assertions(1);
    using time = clock();
    const l = loader<string, string>();
    using f = field(l.load);
    f.type("a");
    await time.advance(200);
    f.type("ab");
    await time.advance(300);
    expect(l.calls.map((call) => call.arg)).toEqual(["ab"]);
  });

  test.serial("shows a synchronous check's message", async () => {
    expect.assertions(1);
    using time = clock();
    using f = field(short);
    f.type("ab");
    await time.advance(300);
    expect(f.note()).toBe("at least 3 characters");
  });

  test.serial("shows an async check's message when it resolves", async () => {
    expect.assertions(1);
    using time = clock();
    const l = loader<string, string>();
    using f = field(l.load);
    f.type("ada");
    await time.advance(300);
    await l.calls[0].resolve("taken");
    expect(f.note()).toBe("taken");
  });

  test.serial("the last message stays while the next check waits", async () => {
    expect.assertions(1);
    using time = clock();
    using f = field(short);
    f.type("ab");
    await time.advance(300);
    f.type("abc");
    expect(f.note()).toBe("at least 3 characters");
  });

  test.serial("a check still running when the text changes never shows its message", async () => {
    expect.assertions(1);
    using time = clock();
    const l = loader<string, string>();
    using f = field(l.load);
    f.type("ada");
    await time.advance(300);
    f.type("adam");
    await time.advance(300);
    await l.calls[1].resolve("");
    await l.calls[0].resolve("taken");
    expect(f.note()).toBe("");
  });

  test.serial("a check that throws shows the error", async () => {
    expect.assertions(1);
    using time = clock();
    using f = field(() => {
      throw new Error("bad");
    });
    await time.advance(300);
    expect(f.note()).toBe("error: Error: bad");
  });

  test.serial("disposal during a pause checks nothing", async () => {
    expect.assertions(1);
    using time = clock();
    const l = loader<string, string>();
    const f = field(l.load);
    f.type("ab");
    f[Symbol.dispose]();
    await time.advance(300);
    expect(l.calls).toHaveLength(0);
  });

  test.serial("a check resolving after disposal shows nothing", async () => {
    expect.assertions(1);
    using time = clock();
    const l = loader<string, string>();
    const f = field(l.load);
    f.type("ada");
    await time.advance(300);
    f[Symbol.dispose]();
    await l.calls[0].resolve("taken");
    expect(f.note()).toBe("");
  });

  // test.serial: the inputs sit in the shared document, as a form that stays open would hold them
  test.serial("disposed Validates keep no check reachable while their inputs live on", async () => {
    expect.assertions(1);
    const form = document.body.appendChild(document.createElement("form"));
    using _ = {
      [Symbol.dispose]: () => {
        form.remove();
      },
    };
    const refs = Array.from({ length: 20 }, () => {
      const check = (): string => "";
      const input = form.appendChild(document.createElement("input"));
      dispose(Validate(input, check, 300));
      return new WeakRef(check);
    });
    await Bun.sleep(0); // a WeakRef keeps its target until the current job ends
    Bun.gc(true);
    // A bound, not 0: a conservative stack scan can keep a few
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBeLessThan(10);
  });
});
