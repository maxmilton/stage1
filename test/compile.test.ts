/* eslint-disable @typescript-eslint/no-var-requires, global-require */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import {
  cleanup,
  mocksSetup,
  mocksTeardown,
  render,
  setup,
  teardown,
} from './utils';

type BasicComponent = typeof import('./fixtures/Basic');

test.before(setup);
test.before(mocksSetup);
test.after(teardown);
test.after(mocksTeardown);
test.after.each(cleanup);

test('renders correctly', () => {
  const { Basic } = require('./fixtures/Basic') as BasicComponent;
  const rendered = render(Basic());
  assert.fixture(
    rendered.container.innerHTML,
    `<nav id="basic">
<a href="l1">Link 1</a>
<a href="l2">Link 2</a>
<a href="l3">Link 3</a>
</nav>`,
  );
});

test.run();
