// A list loaded with `task` (experimental, src/task.ts), with optimistic adds: add() shows the todo
// at once and saves it; if the save fails the list goes back to what it was. reload() loads it
// again. The list is empty (the task's fallback) until the first load lands. Errors are not
// shown here (examples/profile.ts shows them).
//
// add() is an optimistic write (src/task.ts, "Writes"): its `set` drops the load in flight, and
// setting back the record it replaced lets that load land again only if it has not settled. So a
// failed save puts the list back only if it was not loading (that load may have settled since) and
// nothing replaced the added one (a reload, another add); otherwise the list is loaded again once
// the save settles. An add while the list loads thus drops that load, and the list loads again once
// the save settles.
//
//   const todos = Todos(
//     panel,
//     () => fetch("/api/todos").then((r) => r.json()),
//     (todo) =>
//       fetch("/api/todos", { method: "POST", body: JSON.stringify(todo) }).then((r) => {
//         if (!r.ok) throw new Error(r.statusText);
//       }),
//   );
//   todos.add("milk");
//   todos.reload();
//   dispose(todos.scope);
import {
  computed,
  get,
  list,
  type Scope,
  scope,
  set,
  signal,
  sub,
  type Task,
  task,
  type TaskState,
  TaskStatus,
  untracked,
} from "stage1";

export interface Todo {
  /** Made on the client, so the saved todo keeps its row. */
  readonly id: string;
  readonly title: string;
}

const NONE: readonly Todo[] = [];

export const Todos = (
  parent: Element,
  load: () => Promise<readonly Todo[]>,
  save: (todo: Todo) => Promise<unknown>,
): { scope: Scope; add: (title: string) => void; reload: () => void } => {
  // reload(): a tick the task reads (README "Mutable data")
  const tick = signal(0);
  const reload = (): void => {
    set(tick, tick.v + 1);
  };
  // Made in the scope (its owner), used by add
  let todos!: Task<readonly Todo[], readonly Todo[]>;
  return {
    scope: scope(() => {
      const ul = parent.appendChild(document.createElement("ul"));
      todos = task(() => {
        get(tick);
        return untracked(load);
      }, NONE);
      // The rows function takes arrays, not records; the computed also skips the landings that
      // keep the array (pending, error)
      sub(
        computed(() => get(todos).value),
        list(
          ul,
          "id",
          (item: Todo) => {
            const li = document.createElement("li");
            li.textContent = item.title;
            return li;
          },
          // A reload returns new objects with the same ids: their rows are kept
          (li, item) => {
            li.textContent = item.title;
          },
        ),
      );
    }),
    add: (title) => {
      const prev = todos.v;
      // randomUUID needs a secure context (HTTPS or localhost)
      const todo: Todo = { id: crypto.randomUUID(), title };
      const next: TaskState<readonly Todo[], readonly Todo[]> = {
        status: TaskStatus.Ready,
        value: [...prev.value, todo],
      };
      // Wins over a load in flight: that load never lands, so it is loaded again below
      set(todos, next);
      const settle = (saved: boolean): void => {
        // Put back a record only while nothing replaced `next`, and never a pending one: had its
        // load settled meanwhile, it would stay pending until the next run
        if (todos.v === next && prev.status !== TaskStatus.Pending) {
          if (!saved) set(todos, prev);
        } else reload();
      };
      try {
        save(todo).then(
          () => {
            settle(true);
          },
          () => {
            settle(false);
          },
        );
      } catch {
        settle(false);
      }
    },
    reload,
  };
};
