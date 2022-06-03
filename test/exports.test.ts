/* eslint-disable guard-for-in */

import * as assert from 'uvu/assert';
import * as indexExports from '../src/index';
import * as keyedExports from '../src/reconcile/keyed';
import * as nonKeyedExports from '../src/reconcile/non-keyed';
import * as reuseNodesExports from '../src/reconcile/reuse-nodes';
import { describe } from './utils';

describe('index', (test) => {
  const PUBLIC_EXPORTS = [
    ['h', 'Function'],
    ['html', 'Function'],
    ['setupSyntheticEvent', 'Function'],
    ['deleteSyntheticEvent', 'Function'],
    ['noop', 'Function'],
    ['createFragment', 'Function'],
    ['create', 'Function'],
    ['append', 'Function'],
    ['prepend', 'Function'],
  ] as const;

  for (const [name, type] of PUBLIC_EXPORTS) {
    test(`exports public "${name}" ${type}`, () => {
      assert.ok(Object.hasOwnProperty.call(indexExports, name));
      assert.is(
        Object.prototype.toString.call(indexExports[name]),
        `[object ${type}]`,
      );
    });
  }

  test('does not export any private internals', () => {
    const publicExportNames = PUBLIC_EXPORTS.map((x) => x[0]);
    assert.is(publicExportNames.length, Object.keys(indexExports).length);
    for (const name in indexExports) {
      assert.ok((publicExportNames as string[]).includes(name));
    }
  });

  test('has no default export', () => {
    assert.not.ok(Object.hasOwnProperty.call(indexExports, 'default'));
  });
});

const RECONSILERS = [
  ['keyed', keyedExports],
  ['non-keyed', nonKeyedExports],
  ['reuse-nodes', reuseNodesExports],
] as const;

for (const [reconsiler, exports] of RECONSILERS) {
  describe(`reconcile/${reconsiler}`, (test) => {
    test('exports public "reconcile" Function', () => {
      assert.ok(Object.hasOwnProperty.call(exports, 'reconcile'));
      assert.is(
        Object.prototype.toString.call(exports.reconcile),
        '[object Function]',
      );
    });

    test('does not export any private internals', () => {
      const publicExportNames = ['reconcile'];
      assert.is(publicExportNames.length, Object.keys(exports).length);
      for (const name in exports) {
        assert.ok(publicExportNames.includes(name));
      }
    });

    test('has no default export', () => {
      assert.not.ok(Object.hasOwnProperty.call(exports, 'default'));
    });
  });
}
