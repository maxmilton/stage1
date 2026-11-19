// Validation as you type with `task` (experimental, src/task.ts), with no network: the text (the
// starting text included) is checked once typing pauses for `ms`, and the check's message ("" when
// valid) shows next to the input. The async source is a timer: typing again clears it, so a pause
// cut short checks nothing. The check may also be async (a worker, IndexedDB): the latest text
// wins, and the last message stays until the next lands.
//
//   const input = form.appendChild(document.createElement("input"));
//   const v = Validate(input, (text) => (text.length < 3 ? "at least 3 characters" : ""), 300);
//   dispose(v);
import { defer, effect, get, type Scope, scope, set, signal, task, TaskStatus } from "stage1";

export const Validate = (
  input: HTMLInputElement,
  check: (text: string) => string | PromiseLike<string>,
  ms: number,
): Scope =>
  scope(() => {
    const note = document.createElement("span");
    input.after(note);
    const text = signal(input.value);
    const onInput = (): void => {
      set(text, input.value);
    };
    input.addEventListener("input", onInput);
    defer(() => {
      input.removeEventListener("input", onInput);
    });
    // The fallback "": no message until the first check lands
    const message = task(() => {
      const value = get(text);
      const pause = Promise.withResolvers<undefined>();
      const timer = setTimeout(pause.resolve, ms);
      // Before the next run and on disposal: a pause cut short never resolves
      defer(() => {
        clearTimeout(timer);
      });
      // check runs after the pause: what it reads is not tracked
      return pause.promise.then(() => check(value));
    }, "");
    effect(() => {
      const state = get(message);
      note.textContent =
        state.status === TaskStatus.Error ? `error: ${String(state.error)}` : state.value;
    });
  });
