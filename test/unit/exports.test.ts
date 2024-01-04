/* eslint-disable guard-for-in */

import { describe, expect, test } from 'bun:test';
import * as browserExports from '../../src/browser/index';
import * as indexExports from '../../src/index';
import * as macroExports from '../../src/macro';
import * as keyedExports from '../../src/reconcile/keyed';
import * as nonKeyedExports from '../../src/reconcile/non-keyed';
import * as reuseNodesExports from '../../src/reconcile/reuse-nodes';

describe('browser', () => {
  const PUBLIC_EXPORTS = [
    ['h', Function],
    ['html', Function],
    ['collect', Function],
    ['setupSyntheticEvent', Function],
    ['deleteSyntheticEvent', Function],
    ['noop', Function],
    ['createFragment', Function],
    ['create', Function],
    ['append', Function],
    ['prepend', Function],
    ['clone', Function],
    ['onRemove', Function],
    ['store', Function],
  ] as const;

  for (const [name, type] of PUBLIC_EXPORTS) {
    test(`exports public "${name}" ${type.name}`, () => {
      expect(browserExports).toHaveProperty(name);
      expect(browserExports[name]).toBeInstanceOf(type);
    });
  }

  test('does not export any private internals', () => {
    const publicExportNames = PUBLIC_EXPORTS.map((x) => x[0]);
    for (const name in browserExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(browserExports).length);
  });

  test('has no default export', () => {
    expect(browserExports).not.toHaveProperty('default');
  });
});

describe('index', () => {
  const PUBLIC_EXPORTS = [
    ['h', Function],
    ['collect', Function],
    ['setupSyntheticEvent', Function],
    ['deleteSyntheticEvent', Function],
    ['noop', Function],
    ['createFragment', Function],
    ['create', Function],
    ['append', Function],
    ['prepend', Function],
    ['clone', Function],
    ['onRemove', Function],
    ['store', Function],
  ] as const;

  for (const [name, type] of PUBLIC_EXPORTS) {
    test(`exports public "${name}" ${type.name}`, () => {
      expect(indexExports).toHaveProperty(name);
      expect(indexExports[name]).toBeInstanceOf(type);
    });
  }

  test('does not export any private internals', () => {
    const publicExportNames = PUBLIC_EXPORTS.map((x) => x[0]);
    for (const name in indexExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(indexExports).length);
  });

  test('has no default export', () => {
    expect(indexExports).not.toHaveProperty('default');
  });
});

describe('macro', () => {
  const PUBLIC_EXPORTS = [['compile', Function]] as const;

  for (const [name, type] of PUBLIC_EXPORTS) {
    test(`exports public "${name}" ${type.name}`, () => {
      expect(macroExports).toHaveProperty(name);
      expect(macroExports[name]).toBeInstanceOf(type);
    });
  }

  test('does not export any private internals', () => {
    const publicExportNames = PUBLIC_EXPORTS.map((x) => x[0]);
    for (const name in macroExports) {
      expect(publicExportNames).toContain(name);
    }
    expect(publicExportNames).toHaveLength(Object.keys(macroExports).length);
  });

  test('has no default export', () => {
    expect(macroExports).not.toHaveProperty('default');
  });
});

const RECONSILERS = [
  ['keyed', keyedExports],
  ['non-keyed', nonKeyedExports],
  ['reuse-nodes', reuseNodesExports],
] as const;

for (const [reconsiler, exports] of RECONSILERS) {
  describe(`reconcile/${reconsiler}`, () => {
    test('exports public "reconcile" Function', () => {
      expect(exports).toHaveProperty('reconcile');
      expect(exports.reconcile).toBeInstanceOf(Function);
    });

    test('does not export any private internals', () => {
      const publicExportNames = ['reconcile'];
      for (const name in exports) {
        expect(publicExportNames).toContain(name);
      }
      expect(publicExportNames).toHaveLength(Object.keys(exports).length);
    });

    test('has no default export', () => {
      expect(exports).not.toHaveProperty('default');
    });
  });
}
