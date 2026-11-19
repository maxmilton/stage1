// Load once when a component is created: "…", then the data or the error. Disposing the component
// first drops the outcome, so a late answer never writes to a page the user has left. No helper: the
// scope's cleanup clears a flag the callbacks check (README "Async data").
//
//   const card = Profile(document.body, () => fetch("/api/me").then((r) => r.json()));
//   dispose(card); // e.g. on navigation
import { type Scope, scope } from "stage1";

export interface User {
  readonly name: string;
}

export const Profile = (parent: Element, load: () => Promise<User>): Scope =>
  scope(() => {
    const el = parent.appendChild(document.createElement("p"));
    el.textContent = "…";
    let live = true;
    const fail = (error: unknown): void => {
      if (live) el.textContent = `error: ${String(error)}`;
    };
    try {
      // then(ok, err), not .then(ok).catch(err): an error thrown while showing the data is a bug to
      // report, not a failed load
      load().then((user) => {
        if (live) el.textContent = user.name;
      }, fail);
    } catch (error) {
      // A synchronous throw from load: without this the scope is disposed and the throw escapes
      fail(error);
    }
    // Runs when the scope is disposed
    return () => {
      live = false;
    };
  });
