// Search as you type: the latest query wins, a superseded search is aborted, and the previous hits
// stay (under a "loading" class) until the next ones land. Clearing the box clears the hits at once,
// and a search still in flight cannot bring them back. The flag in the effect's cleanup drops and
// aborts a superseded search: an effect's cleanup runs before its next run and when it is disposed
// (README "Async data").
//
//   const query = signal("");
//   input.oninput = () => set(query, input.value);
//   const search = Search(panel, query, (text, signal) =>
//     fetch(`/search?q=${encodeURIComponent(text)}`, { signal }).then((r) => r.json()),
//   );
import {
  effect,
  get,
  list,
  type Scope,
  scope,
  set,
  type Signal,
  signal,
  sub,
  untracked,
} from "stage1";

export interface Hit {
  readonly id: number;
  readonly title: string;
}

const NONE: readonly Hit[] = [];

export const Search = (
  parent: Element,
  query: Signal<string>,
  search: (query: string, signal: AbortSignal) => Promise<readonly Hit[]>,
): { scope: Scope; refresh: () => void } => {
  // refresh(): a tick the effect reads (README "Mutable data")
  const tick = signal(0);
  return {
    scope: scope(() => {
      const hits = signal(NONE);
      const status = parent.appendChild(document.createElement("p"));
      const ul = parent.appendChild(document.createElement("ul"));
      sub(
        hits,
        list(
          ul,
          "id",
          (item: Hit) => {
            const li = document.createElement("li");
            li.textContent = item.title;
            return li;
          },
          // A hit a later search returns again is a new object with the same id: its row is kept
          (li, item) => {
            li.textContent = item.title;
          },
        ),
      );
      const show = (value: readonly Hit[], text: string): void => {
        parent.classList.remove("loading");
        status.textContent = text;
        set(hits, value);
      };
      effect(() => {
        get(tick);
        const text = get(query);
        // This re-run has already dropped the search in flight (the cleanup below)
        if (text === "") {
          show(NONE, "");
          return undefined;
        }
        parent.classList.add("loading");
        const ac = new AbortController();
        // True while this run's search is the current one and has not settled
        let live = true;
        const ok = (value: readonly Hit[]): void => {
          if (live) {
            live = false;
            show(value, "");
          }
        };
        // Keeps the hits, shows the error; also swallows a superseded search's AbortError
        const fail = (error: unknown): void => {
          if (live) {
            live = false;
            show(hits.v, `error: ${String(error)}`);
          }
        };
        try {
          // untracked: what search reads synchronously must not re-run this effect. then(ok, err),
          // not .catch: an error a list callback throws during `set` stays reported (an unhandled
          // rejection); .catch would hand it to fail, which drops it (ok has cleared `live`)
          untracked(() => search(text, ac.signal)).then(ok, fail);
        } catch (error) {
          fail(error);
        }
        // Before the next run and on disposal: drop and abort a search still in flight (a settled
        // one is left alone: aborting costs an event and a DOMException)
        return () => {
          if (live) {
            live = false;
            ac.abort();
          }
        };
      });
    }),
    refresh: () => {
      set(tick, tick.v + 1);
    },
  };
};
