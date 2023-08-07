// XXX: This file has the same tests as test/unit/compile.test.ts, keep them in sync.

import { describe, expect, spyOn, test } from 'bun:test';
// eslint-disable-next-line import/no-duplicates
import { compile } from '../../src/runtime/macro' assert { type: 'macro' };
// eslint-disable-next-line import/no-duplicates
import { compile as compileNoMacro } from '../../src/runtime/macro';

// TODO: Consider using inline snapshots once bun:test supports them.

describe('compile', () => {
  // FIXME: Test for each of the compile macro options; keepComments, keepSpace
  //  ↳ When keepComments, check refs metadata calculations are still correct.
  //  ↳ Currently blocked by bun bug; https://github.com/oven-sh/bun/issues/3832

  test('outputs an object', () => {
    const meta = compile('<div></div>');
    expect(meta).toBeInstanceOf(Object);
  });
  test('outputs html property with string value', () => {
    const meta = compile('<div></div>');
    expect(meta).toHaveProperty('html');
    expect(typeof meta.html).toBe('string');
  });
  test('outputs k property with array value', () => {
    const meta = compile('<div></div>');
    expect(meta).toHaveProperty('k');
    expect(meta.k).toBeInstanceOf(Array);
  });
  test('outputs d property with array value', () => {
    const meta = compile('<div></div>');
    expect(meta).toHaveProperty('d');
    expect(meta.d).toBeInstanceOf(Array);
  });

  test('has empty k and d properties when no node refs', () => {
    const meta = compile('<div></div>');
    expect(meta.k).toHaveLength(0);
    expect(meta.d).toHaveLength(0);
  });

  test('has 3 k and d properties when 3 node refs', () => {
    const meta = compile('<div @a><div @b></div><div @c></div></div>');
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
  });

  test('has 3 k and d properties when 3 node refs with whitespace', () => {
    // FIXME: Whitespace handling is broken in happy-dom; https://github.com/capricorn86/happy-dom/issues/971
    // const meta = compile(
    //   '\n\n\t<div><div     @a  ></div> \t\t\n\n\n<div \n\t @b></  div> <div @c></\n\tdiv>\n\n</div>\n',
    // );
    const meta = compile(`
      <div>
        <div @a></div>
        <div @b></div>
        <div @c></div>
      </div>
    `);
    expect(meta.k).toHaveLength(3);
    expect(meta.d).toHaveLength(3);
  });

  test('does not minify in whitespace-sensitive blocks', () => {
    const meta = compile(`
      <div>
        <pre>
          a
           b
          c


          &lt;span&gt; Foo  &lt;/span&gt;
        </pre>
        <span>
          Bar
        </span>
        <code>
          &lt;span&gt;
            Baz
          &lt;/span&gt;
        </code>

      </div>
    `);
    expect(meta.html).toBe(
      '<div><pre>\n          a\n           b\n          c\n\n\n          &lt;span&gt; Foo  &lt;/span&gt;\n        </pre><span>Bar</span><code>\n          &lt;span&gt;\n            Baz\n          &lt;/span&gt;\n        </code></div>',
    );
  });

  test('does not escape html entities', () => {
    const template = '<div>&lt;span&gt;Foo&lt;/span&gt;</div>';
    const meta = compile(template);
    expect(meta.html).toBe(template);
  });

  test('logs error when more than one root element', () => {
    const spy = spyOn(console, 'error')
      // @ts-expect-error - noop stub
      .mockImplementation(() => {});
    compileNoMacro('<div></div><div></div>');
    // TODO: Check for specific error message once bun:test supports it.
    // expect(spy).toHaveBeenCalledWith('Expected template to have a single root element');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  describe('keepComments option', () => {
    test('removes comments by default', () => {
      const meta = compile('<div><!-- comment --></div>');
      expect(meta.html).toBe('<div></div>');
    });

    // TODO: This test is currently blocked by bun bug; https://github.com/oven-sh/bun/issues/3832
    test.todo('keeps comments when option is true', () => {
      // const meta = compile('<div><!-- comment --></div>', { keepComments: true });
      // expect(meta.html).toBe('<div><!-- comment --></div>');
    });

    // TODO: This test is currently blocked by bun bug; https://github.com/oven-sh/bun/issues/3832
    test.todo('removes comments when option is false', () => {
      // const meta = compile('<div><!-- comment --></div>', { keepComments: false });
      // expect(meta.html).toBe('<div></div>');
    });
  });

  describe('keepSpaces option', () => {
    test('removes spaces between tags and text by default', () => {
      const meta = compile('<div> x   \n\t\t  </div>');
      expect(meta.html).toBe('<div>x</div>');
    });

    // TODO: This test is currently blocked by bun bug; https://github.com/oven-sh/bun/issues/3832
    test.todo('keeps spaces between tags and text when option is true', () => {
      // const meta = compile('<div> x   \n\t\t  </div>', { keepSpaces: true });
      // expect(meta.html).toBe('<div> x </div>');
    });

    // TODO: This test is currently blocked by bun bug; https://github.com/oven-sh/bun/issues/3832
    test.todo('removes spaces between tags and text when option is false', () => {
      // const meta = compile('<div> x   \n\t\t  </div>', { keepSpaces: false });
      // expect(meta.html).toBe('<div>x</div>');
    });
  });
});
