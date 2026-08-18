import "@maxmilton/test-utils/extend";

import { setupDOM } from "@maxmilton/test-utils/dom";

// NOTE: Everything below is process-wide state, set once per test process and
// never restored. test/unit/test-env.test.ts asserts against it. Safe only
// while bun runs a file's tests sequentially and nothing else writes to these
// globals. The other tests which touch process-wide state are the ones calling
// setupSyntheticClick() in test/unit/events.test.ts (a document click listener,
// plus `document.body[ONCLICK]` in one test) — each undoes its own via
// onTestFinished, which unlike cleanup at the end of a body also runs when the
// test fails — and test/unit/dist.test.ts, which reads dist/ from disk.
// Bun.enableANSIColors otherwise defaults to whether a TTY is attached, which
// would make any assertion on exact console output (e.g. test/unit/macro.test.ts's
// error messages) pass or fail depending on how the suite is invoked.

const noop = () => {};

function setupMocks(): void {
  // @ts-expect-error - noop stub
  global.performance.mark = noop;
  // @ts-expect-error - noop stub
  global.performance.measure = noop;
  // @ts-expect-error - writable at runtime despite readonly type
  Bun.enableANSIColors = false;
}

setupDOM();
setupMocks();

// eslint-disable-next-line unicorn/no-global-object-property-assignment
global.Node = window.Node;
