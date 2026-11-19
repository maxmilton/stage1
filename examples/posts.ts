// Chained loads with `task` (experimental, src/task.ts): the user named `name`, then that user's
// posts. The posts wait (`WAIT`) while the user has no value and load again when the user's id
// changes (not when the same user loads again); while they wait or load, the list has a "loading"
// class, and the last posts stay until the next ones land. Each shows "error: …" when its load
// fails; while the user's load has failed, the posts (the last user's) are hidden.
//
//   const name = signal("ada");
//   const page = Posts(
//     panel,
//     name,
//     (n) => fetch(`/api/users/${n}`).then((r) => r.json()),
//     (id) => fetch(`/api/users/${id}/posts`).then((r) => r.json()),
//   );
//   set(name, "grace");
//   dispose(page);
import {
  computed,
  effect,
  get,
  list,
  type Scope,
  scope,
  type Signal,
  sub,
  task,
  type TaskState,
  TaskStatus,
  untracked,
  WAIT,
} from "stage1";

export interface User {
  readonly id: number;
  readonly name: string;
}

export interface Post {
  readonly id: number;
  readonly title: string;
}

const NONE: readonly Post[] = [];

/** A load's error, or "" (pending or ready). */
const failed = (state: TaskState<unknown>): string =>
  state.status === TaskStatus.Error ? `error: ${String(state.error)}` : "";

export const Posts = (
  parent: Element,
  name: Signal<string>,
  loadUser: (name: string) => Promise<User>,
  loadPosts: (userId: number) => Promise<readonly Post[]>,
): Scope =>
  scope(() => {
    const heading = parent.appendChild(document.createElement("h2"));
    // The posts: their load's error, then the list
    const section = parent.appendChild(document.createElement("section"));
    const status = section.appendChild(document.createElement("p"));
    const ul = section.appendChild(document.createElement("ul"));
    const user = task(() => {
      const key = get(name);
      return untracked(() => loadUser(key));
    });
    // Through a computed: the user's every landing (pending included) writes a new record, and
    // only a new id should load the posts
    const userId = computed(() => get(user).value?.id);
    const posts = task(() => {
      const key = get(userId);
      // No user yet: pending, with no load
      return key === undefined ? WAIT : untracked(() => loadPosts(key));
    }, NONE);
    effect(() => {
      const state = get(user);
      heading.textContent = failed(state) || (state.value?.name ?? "…");
      section.hidden = state.status === TaskStatus.Error;
    });
    effect(() => {
      const state = get(posts);
      status.textContent = failed(state);
      ul.classList.toggle("loading", state.status === TaskStatus.Pending);
    });
    sub(
      computed(() => get(posts).value),
      list(
        ul,
        "id",
        (item: Post) => {
          const li = document.createElement("li");
          li.textContent = item.title;
          return li;
        },
        // The next user's post with an id the last posts had (ids per user) keeps that row
        (li, item) => {
          li.textContent = item.title;
        },
      ),
    );
  });
