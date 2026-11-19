// Subprocess fixture for test/unit/examples.test.ts and test/unit/task.test.ts: bun test fails the
// running test on an unhandled rejection (Bun 1.4.4), so whether a reader's throw while a load's
// outcome lands is reported as one is observed here. Run: bun --preload ./test/setup.ts <this file>
// once|search|task. At exit it prints the reason of each unhandled rejection, one per line.
// A script, not a test: its top level is the scenario
// oxlint-disable vitest/require-hook
import { Profile } from "../../examples/once.ts";
import { Search } from "../../examples/search.ts";
import { effect, get, scope, signal } from "../../src/signal.ts";
import { task } from "../../src/task.ts";
import { poison } from "./async.ts";

const reasons: string[] = [];
process.on("unhandledRejection", (reason: unknown) => {
  // A dev build wraps the error a list callback throws (as its cause)
  reasons.push(
    String(reason instanceof Error && reason.cause !== undefined ? reason.cause : reason),
  );
});
process.on("exit", () => {
  process.stdout.write(reasons.join("\n"));
});

switch (process.argv[2]) {
  case "once":
    Profile(document.body, () => Promise.resolve(poison));
    break;
  case "search":
    Search(document.body, signal("a"), () => Promise.resolve([poison]));
    break;
  case "task":
    scope(() => {
      const user = task(() => Promise.resolve(poison));
      effect(() => {
        document.body.textContent = get(user).value?.name ?? "…";
      });
    });
    break;
  default:
    throw new Error(`unknown example: ${process.argv[2]}`);
}
