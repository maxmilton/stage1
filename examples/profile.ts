// A keyed load with `task` (experimental, src/task.ts): the profile for `id`, loaded again when id
// changes. While a load is pending the last profile stays, under a "loading" class; a failed load
// shows "error: …". The latest id wins: a superseded load never lands, and one still in flight is
// aborted. refresh() loads the same id again.
//
//   const id = signal(1);
//   const card = Profile(panel, id, (key, signal) =>
//     fetch(`/api/users/${key}`, { signal }).then((r) => r.json()),
//   );
//   set(id, 2);
//   card.refresh();
//   dispose(card.scope); // aborts a load in flight
import {
  defer,
  effect,
  get,
  type Scope,
  scope,
  set,
  type Signal,
  signal,
  task,
  TaskStatus,
  untracked,
} from "stage1";

export interface User {
  readonly name: string;
}

export const Profile = (
  parent: Element,
  id: Signal<number>,
  load: (id: number, signal: AbortSignal) => Promise<User>,
): { scope: Scope; refresh: () => void } => {
  // refresh(): a tick the task reads (README "Mutable data")
  const tick = signal(0);
  return {
    scope: scope(() => {
      const el = parent.appendChild(document.createElement("p"));
      const user = task(() => {
        get(tick);
        const key = get(id);
        const ac = new AbortController();
        // Before the next run and on disposal: abort the load. `ac.abort()` alone is correct; the
        // status check leaves a settled load alone, which saves an abort event and a DOMException
        defer(() => {
          if (user.v.status === TaskStatus.Pending) ac.abort();
        });
        // untracked: what load reads must not reload the profile
        return untracked(() => load(key, ac.signal));
      });
      // In an effect of its own: one that also made the task would make a new one on every landing
      effect(() => {
        const state = get(user);
        el.classList.toggle("loading", state.status === TaskStatus.Pending);
        el.textContent =
          state.status === TaskStatus.Error
            ? `error: ${String(state.error)}`
            : (state.value?.name ?? "…");
      });
    }),
    refresh: () => {
      set(tick, tick.v + 1);
    },
  };
};
