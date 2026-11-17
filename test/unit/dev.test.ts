// The dev-only module (src/dev.ts): no production bundle keeps it, and its list guard, through
// `list`: a list keeps the items array it last rendered and diffs the next one against it, so an
// array it rendered must not change in place. Dev: each in-place change throws the guard's error,
// and legitimate use never does. Production: the guard is absent; what the same changes do there
// is pinned as a characterization.
// Run in both modes: `bun test` (dev checks on) and `NODE_ENV=production bun test`.
// oxlint-disable vitest/no-conditional-in-test node/no-process-env

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as lite from "../../src/lite/signal.ts";
import { list, mark, type Rows } from "../../src/reconcile.ts";
import { set, signal, sub } from "../../src/signal.ts";

const DEV = process.env.NODE_ENV !== "production";
const GUARD = /^stage1: a list's items array was changed in place/u;

interface Item {
  readonly id: string;
}
type Row = HTMLLIElement & { item: Item };
const item = (id: string): Item => ({ id });
const items = (ids: string): Item[] => Array.from(ids, (id) => item(id));

/**
 * A list in a detached ul whose rows show their item's id; its create and update call `create` and
 * `update` first, and `drop` is its drop. `text()` is the rows' ids in order.
 */
const mount = (
  create: (it: Item) => void = () => {},
  update: (it: Item) => void = () => {},
  drop?: (li: Row) => void,
): { rows: Rows<Item, string, Row>; text: () => string } => {
  const ul = document.createElement("ul");
  const rows = list(
    ul,
    "id",
    (it: Item): Row => {
      create(it);
      return Object.assign(document.createElement("li"), { item: it, textContent: it.id });
    },
    (li, it) => {
      update(it);
      li.textContent = it.id;
    },
    drop,
  );
  return { rows, text: () => [...ul.children].map((li) => li.textContent).join("") };
};

/** The error `fn` throws, or undefined. */
const thrown = (fn: () => void): Error | undefined => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  return undefined;
};

/** Bundles all of `entry`'s exports, unminified, as an app's build would in `nodeEnv`. */
const bundle = async (entry: string, nodeEnv: string): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/dev-test-`);
  try {
    await Bun.write(`${dir}/entry.ts`, `export * from "${import.meta.dir}/../../${entry}";`);
    const out = await Bun.build({
      entrypoints: [`${dir}/entry.ts`],
      target: "browser",
      define: { "process.env.NODE_ENV": JSON.stringify(nodeEnv) },
    });
    return await out.outputs[0].text();
  } finally {
    await rm(dir, { recursive: true });
  }
};

// Unminified, Bun heads each bundled module's code with a comment naming its path
const DEV_MODULE = /^\/\/ (?:.*\/)?src\/dev\.ts$/mu;

describe("bundle", () => {
  test.each(["src/index.ts", "src/lite/index.ts", "src/ultralite/index.ts"])(
    "a production app on %s bundles nothing of src/dev.ts",
    async (entry) => {
      expect.assertions(1);
      expect(DEV_MODULE.exec(await bundle(entry, "production"))).toBeNull();
    },
  );

  // Guards the test above: the pattern finds the module when it is bundled
  test("a development app bundles src/dev.ts", async () => {
    expect.assertions(1);
    expect(DEV_MODULE.test(await bundle("src/index.ts", "development"))).toBe(true);
  });
});

type Call = (next: readonly Item[]) => void;

// Each starts from rows a b c rendered from `rendered`, changes it in place and calls the rows
// function again; the third field is what production renders
const CHANGES: [name: string, change: (rows: Call, rendered: Item[]) => void, prod: string][] = [
  [
    "push, then the same array",
    (rows, a) => {
      a.push(item("x"));
      rows(a);
    },
    "abc",
  ],
  [
    "push, then a copy",
    (rows, a) => {
      a.push(item("x"));
      rows([...a]);
    },
    "abc",
  ],
  [
    "reverse in place, then the same array",
    (rows, a) => {
      a.reverse();
      rows(a);
    },
    "abc",
  ],
  [
    "sort in place, then a copy",
    (rows, a) => {
      a.sort((x, y) => y.id.localeCompare(x.id));
      rows([...a]);
    },
    "abc",
  ],
  [
    "splice out an item, then the same array",
    (rows, a) => {
      a.splice(1, 1);
      rows(a);
    },
    "abc",
  ],
  [
    "splice in an item, then a copy",
    (rows, a) => {
      a.splice(1, 0, item("x"));
      rows([...a]);
    },
    "abc",
  ],
  [
    "an item replaced in place (arr[i] = item), then the same array",
    (rows, a) => {
      a[1] = item("x");
      rows(a);
    },
    "abc",
  ],
  [
    "the first item replaced in place, then a copy",
    (rows, a) => {
      a[0] = item("x");
      rows([...a]);
    },
    "abc",
  ],
  [
    "pop, then a new array keeping the first item (the diff still reads the popped array)",
    (rows, a) => {
      a.pop();
      rows([a[0], item("z")]);
    },
    // c's row is never removed
    "acz",
  ],
  [
    "emptied in place (length = 0), then the same array",
    (rows, a) => {
      a.length = 0;
      rows(a);
    },
    // Right by accident (a clear reads no items); the next push into the array would not be
    "",
  ],
];

describe.if(DEV)("dev: the guard", () => {
  test.each(CHANGES)("throws for: %s", (_name, change) => {
    expect.assertions(1);
    const { rows } = mount();
    const rendered = items("abc");
    rows(rendered);
    expect(() => {
      change(rows, rendered);
    }).toThrow(GUARD);
  });

  test("its error names the fix: a new array", () => {
    expect.assertions(1);
    const { rows } = mount();
    const rendered = items("ab");
    rows(rendered);
    rendered.push(item("c"));
    expect(
      thrown(() => {
        rows(rendered);
      })?.message,
    ).toBe(
      "stage1: a list's items array was changed in place after it was passed to the list; pass a new array instead ([...items, item], items.toSorted(), or items.with(i, item))",
    );
  });

  test("throws on the next call for a create that pushed onto the array it was rendering", () => {
    expect.assertions(1);
    const rendered = items("abc");
    const { rows } = mount((it) => {
      if (it.id === "c") rendered.push(item("x"));
    });
    rows(rendered);
    expect(() => {
      rows([...rendered]);
    }).toThrow(GUARD);
  });

  test("keeps throwing on later calls, a clear included, leaving the rows as last rendered", () => {
    expect.assertions(2);
    const { rows, text } = mount();
    const rendered = items("abc");
    rows(rendered);
    rendered.push(item("x"));
    const errors = [rendered, items("abcx"), []].map((next) =>
      thrown(() => {
        rows(next);
      }),
    );
    expect(errors.map((error) => GUARD.test(error?.message ?? ""))).toEqual([true, true, true]);
    expect(text()).toBe("abc");
  });

  test("stage1: push then set of a copy throws from set", () => {
    expect.assertions(1);
    const { rows } = mount();
    const s = signal(items("ab"));
    sub(s, rows);
    s.v.push(item("c"));
    expect(() => {
      set(s, [...s.v]);
    }).toThrow(GUARD);
  });

  test("stage1/lite: push then set of a copy throws from set", () => {
    expect.assertions(1);
    const { rows } = mount();
    const s = lite.signal(items("ab"));
    lite.sub(s, rows);
    s.v.push(item("c"));
    expect(() => {
      lite.set(s, [...s.v]);
    }).toThrow(GUARD);
  });

  // The guard runs after the busy check: had it run first, the inner call would have checked the
  // list's array against the copy of the one being rendered, and thrown the guard's error
  test("a call made during a reconcile gets the busy check's error, not the guard's", () => {
    expect.assertions(1);
    const { rows } = mount((it) => {
      if (it.id === "c") rows(items("z"));
    });
    const rendered = items("ab");
    rows(rendered);
    const error = thrown(() => {
      rows([...rendered, item("c")]);
    });
    expect([
      GUARD.test(error?.message ?? ""),
      (error?.cause as Error | undefined)?.message.includes("called again during their reconcile"),
    ]).toEqual([false, true]);
  });

  test("a drop that splices the array being replaced, making the reconcile throw, gets the guard's error", () => {
    expect.assertions(1);
    const rendered = items("abcdef");
    const { rows } = mount(undefined, undefined, (li) => {
      rendered.splice(rendered.indexOf(li.item), 1);
    });
    rows(rendered);
    expect(() => {
      rows([rendered[0], rendered[5]]);
    }).toThrow(GUARD);
  });

  test("a create that shortens the array being rendered, making the reconcile throw, gets the guard's error", () => {
    expect.assertions(1);
    const rendered = items("ab");
    const next = [...rendered, item("x"), item("y")];
    const { rows } = mount((it) => {
      if (it.id === "x") next.pop();
    });
    rows(rendered);
    expect(() => {
      rows(next);
    }).toThrow(GUARD);
  });

  test.each([
    ["the array being rendered", (_held: Item[], next: Item[]) => next.pop()],
    ["the array the list holds", (held: Item[]) => held.push(item("y"))],
  ])(
    "after a create changes %s and throws, the guard's error keeps the create's as its cause",
    (_name, change) => {
      expect.assertions(1);
      const failure = new Error("create failed");
      const rendered = items("ab");
      const next = [...rendered, item("x")];
      const { rows } = mount((it) => {
        if (it.id !== "x") return;
        change(rendered, next);
        throw failure;
      });
      rows(rendered);
      const error = thrown(() => {
        rows(next);
      });
      expect([GUARD.test(error?.message ?? ""), error?.cause === failure]).toEqual([true, true]);
    },
  );

  test("keeps a copy per list: another list rendering the changed array does not hide the change", () => {
    expect.assertions(1);
    const first = mount();
    const second = mount();
    const shared = items("abc");
    first.rows(shared);
    shared.push(item("x"));
    second.rows(shared);
    expect(() => {
      first.rows([...shared]);
    }).toThrow(GUARD);
  });

  test("keeps no copy of an array the list no longer holds: a clear releases its items", async () => {
    expect.assertions(1);
    // 20 lists of one item each, so a stray pointer keeps one item, not all. In a function, so no
    // frame of this test holds the items
    const cleared = (): [refs: WeakRef<Item>[], held: Call[]] => {
      const lists = Array.from({ length: 20 }, () => mount().rows);
      const refs = lists.map((rows, index) => {
        const it = item(String(index));
        rows([it]);
        rows([]);
        return new WeakRef(it);
      });
      return [refs, lists];
    };
    const [refs, held] = cleared();
    // GC from fresh event-loop turns until most are gone, at most 10: the stack is scanned
    // conservatively, so a stray item may stay; kept copies keep all 20
    let alive = refs.length;
    for (let turn = 0; turn < 10 && alive >= refs.length / 2; turn++) {
      // oxlint-disable-next-line no-await-in-loop -- each turn ends before the next collection
      await Bun.sleep(0);
      Bun.gc(true);
      alive = refs.filter((ref) => ref.deref() !== undefined).length;
    }
    // Reading `held` keeps the lists, and so the guard's copies, alive until here
    expect([alive < refs.length / 2, held.length]).toEqual([true, 20]);
  });

  test("after a create throws, a change to the array the list still holds throws on the next call", () => {
    expect.assertions(1);
    const { rows } = mount((it) => {
      if (it.id === "bad") throw new Error("create failed");
    });
    const rendered = items("abc");
    rows(rendered);
    thrown(() => {
      rows([...rendered, item("bad")]);
    });
    rendered.push(item("x"));
    expect(() => {
      rows([...rendered]);
    }).toThrow(GUARD);
  });
});

describe.if(!DEV)("production: without the guard (characterization)", () => {
  test.each(CHANGES)("%s renders as listed, without throwing", (_name, change, prod) => {
    expect.assertions(2);
    const { rows, text } = mount();
    const rendered = items("abc");
    rows(rendered);
    expect(
      thrown(() => {
        change(rows, rendered);
      }),
    ).toBeUndefined();
    expect(text()).toBe(prod);
  });

  test("after push then the same array, removing the pushed item throws: its row is a hole", () => {
    expect.assertions(1);
    const { rows } = mount();
    const rendered = items("abc");
    rows(rendered);
    rendered.push(item("x"));
    rows(rendered);
    expect(() => {
      rows(rendered.slice(0, 3));
    }).toThrow(TypeError);
  });
});

// Both modes: the guard never fires, so these behave as they would without it
describe("legitimate use", () => {
  test("the same unchanged array again is a no-op", () => {
    expect.assertions(1);
    const { rows, text } = mount();
    const rendered = items("abc");
    rows(rendered);
    rows(rendered);
    expect(text()).toBe("abc");
  });

  test("new arrays sharing items: appended, filtered, reversed, an item replaced, sorted", () => {
    expect.assertions(1);
    const { rows, text } = mount();
    const seen: string[] = [];
    let next = items("abc");
    rows(next);
    for (const make of [
      (a: Item[]) => [...a, item("x")],
      (a: Item[]) => a.filter((it) => it.id !== "b"),
      (a: Item[]) => a.toReversed(),
      (a: Item[]) => a.with(1, item("y")),
      (a: Item[]) => a.toSorted((x, y) => x.id.localeCompare(y.id)),
    ]) {
      next = make(next);
      rows(next);
      seen.push(text());
    }
    expect(seen).toEqual(["abcx", "acx", "xca", "xya", "axy"]);
  });

  test("a copy changed before it is passed", () => {
    expect.assertions(1);
    const { rows, text } = mount();
    const rendered = items("abc");
    rows(rendered);
    const next = [...rendered, item("x")];
    next.reverse();
    next.splice(1, 1, item("y"));
    rows(next);
    expect(text()).toBe("xyba");
  });

  // A false-positive guard: the guard compares contents, not whether the array was touched
  test("a change undone before the next call", () => {
    expect.assertions(1);
    const { rows, text } = mount();
    const rendered = items("abc");
    rows(rendered);
    rendered.push(item("x"));
    rendered.pop();
    rows(items("xy"));
    expect(text()).toBe("xy");
  });

  test("an array the list no longer holds may change (two buffers, alternating)", () => {
    expect.assertions(1);
    const { rows, text } = mount();
    const front = items("abc");
    const back = items("xy");
    const seen: string[] = [];
    rows(front);
    rows(back);
    front.push(item("d"));
    rows(front);
    back.length = 0;
    back.push(item("z"));
    rows(back);
    seen.push(text());
    rows(front);
    seen.push(text());
    expect(seen).toEqual(["z", "abcd"]);
  });

  test("clear and replace", () => {
    expect.assertions(1);
    const { rows, text } = mount();
    const seen: string[] = [];
    const rendered = items("abc");
    for (const next of [rendered, [], rendered, items("xyz"), items("xyz"), []]) {
      rows(next);
      seen.push(text());
    }
    expect(seen).toEqual(["abc", "", "abc", "xyz", "xyz", ""]);
  });

  test("mark lookups, scanned and through the key map, around a new array", () => {
    expect.assertions(1);
    const { rows, text } = mount();
    const lit: string[] = [];
    const show = mark(rows, (li, on) => {
      if (on) lit.push(li.textContent);
    });
    const first = items("abcdefghij");
    rows(first);
    // Past SCANS (8) lookups: the last ones go through the map
    for (const id of "abcdefghij") show(id);
    rows([...first.slice(5), item("k")]);
    for (const id of "fgk") show(id);
    expect([lit.join(""), text()]).toEqual(["abcdefghijfgk", "fghijk"]);
  });

  test("stage1: a create that writes the items (a new array)", () => {
    expect.assertions(1);
    const s = signal<readonly Item[]>([]);
    const { rows, text } = mount((it) => {
      if (it.id === "x") set(s, [...s.v, item("y")]);
    });
    sub(s, rows);
    set(s, items("abx"));
    expect(text()).toBe("abxy");
  });

  test("stage1: an update that writes the items (a new array)", () => {
    expect.assertions(1);
    const s = signal<readonly Item[]>(items("abc"));
    const { rows, text } = mount(undefined, (it) => {
      if (it.id === "b") set(s, [...s.v, item("u")]);
    });
    sub(s, rows);
    set(s, s.v.with(1, item("b")));
    expect(text()).toBe("abcu");
  });

  test("stage1: a drop that writes the items (a new array)", () => {
    expect.assertions(1);
    const s = signal<readonly Item[]>(items("abc"));
    const { rows, text } = mount(undefined, undefined, (li) => {
      if (li.item.id === "a")
        set(
          s,
          s.v.filter((it) => it.id !== "c"),
        );
    });
    sub(s, rows);
    set(s, s.v.slice(1));
    expect(text()).toBe("b");
  });

  test("stage1: a mark callback that writes the items (a new array)", () => {
    expect.assertions(1);
    const s = signal<readonly Item[]>(items("abc"));
    const selected = signal("");
    const { rows, text } = mount();
    sub(s, rows);
    sub(
      selected,
      mark(rows, (li, on) => {
        if (on && li.item.id === "b") set(s, [...s.v, item("m")]);
      }),
    );
    set(selected, "b");
    expect(text()).toBe("abcm");
  });

  // A false-positive guard: the copy of an array whose reconcile threw is not the one checked
  test("after a create throws (unsupported), the next call is not checked against the failed array", () => {
    expect.assertions(2);
    const { rows } = mount((it) => {
      if (it.id === "bad") throw new Error("create failed");
    });
    const rendered = items("abc");
    rows(rendered);
    const failed = [...rendered, item("bad")];
    expect(() => {
      rows(failed);
    }).toThrow();
    expect(
      GUARD.test(
        thrown(() => {
          rows(items("xy"));
        })?.message ?? "",
      ),
    ).toBe(false);
  });
});
