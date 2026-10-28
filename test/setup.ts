// Process-wide test state; safe only while tests touching these globals run serially.

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
