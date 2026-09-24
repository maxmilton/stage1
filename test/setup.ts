// Set process-wide state for tests. Safe only while bun runs a file's tests
// sequentially and nothing else writes to these globals.

// oxlint-disable vitest/require-hook
/* eslint-disable unicorn/no-global-object-property-assignment */

import "@maxmilton/test-utils/extend";
import { setupDOM } from "@maxmilton/test-utils/dom";

function setupMocks(): void {
  // @ts-expect-error - noop stub
  global.performance.mark = () => {};
  // @ts-expect-error - noop stub
  global.performance.measure = () => {};
  // @ts-expect-error - writable at runtime despite readonly type
  Bun.enableANSIColors = false; // deterministic for tests

  global.Node = window.Node;
}

setupDOM();
setupMocks();
