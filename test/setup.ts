import { expect } from 'bun:test';
import { GlobalWindow, type Window } from 'happy-dom';

/* eslint-disable no-var, vars-on-top */
declare global {
  /** Real bun console. `console` is mapped to happy-dom's virtual console. */
  // biome-ignore lint/style/noVar: define global
  var console2: Console;
  // biome-ignore lint/style/noVar: define global
  var happyDOM: Window['happyDOM'];
}
/* eslint-enable */

declare module 'bun:test' {
  interface Matchers {
    /** Asserts that a value is a plain `object`. */
    toBePlainObject(): void;
  }
}

expect.extend({
  // XXX: Bun's `toBeObject` matcher is the equivalent of `typeof x === 'object'`.
  toBePlainObject(received: unknown) {
    return Object.prototype.toString.call(received) === '[object Object]'
      ? { pass: true }
      : {
          pass: false,
          message: () => `expected ${String(received)} to be a plain object`,
        };
  },
});

const originalConsole = global.console;
const noop = () => {};

function setupDOM() {
  const dom = new GlobalWindow();
  global.happyDOM = dom.happyDOM;
  global.console2 = originalConsole;
  // @ts-expect-error - happy-dom only implements a subset of the DOM API
  global.window = dom.window.document.defaultView;
  global.document = window.document;
  global.console = window.console; // https://github.com/capricorn86/happy-dom/wiki/Virtual-Console
  global.DocumentFragment = window.DocumentFragment;
  global.MutationObserver = window.MutationObserver;
}

function setupMocks(): void {
  // @ts-expect-error - noop stub
  global.performance.mark = noop;
  // @ts-expect-error - noop stub
  global.performance.measure = noop;

  // TODO: Remove once happy-dom supports `HTMLLIElement` again.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (window.HTMLLIElement) {
    throw new TypeError('HTMLLIElement already defined');
  }
  // @ts-expect-error - mock element
  window.HTMLLIElement = window.HTMLElement;
}

export async function reset(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (global.happyDOM) {
    await happyDOM.abort();
    window.close();
  }

  setupDOM();
  setupMocks();
}

await reset();
