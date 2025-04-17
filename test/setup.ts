import '@maxmilton/test-utils/extend';

import { setupDOM } from '@maxmilton/test-utils/dom';

const noop = () => {};

function setupMocks(): void {
  // @ts-expect-error - noop stub
  global.performance.mark = noop;
  // @ts-expect-error - noop stub
  global.performance.measure = noop;
}

setupDOM();
setupMocks();
