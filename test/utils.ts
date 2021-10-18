import { JSDOM } from 'jsdom';

// increase limit from 10
global.Error.stackTraceLimit = 100;

const mountedContainers = new Set<HTMLDivElement>();

export function setup(): void {
  if (global.window) {
    throw new Error(
      'JSDOM globals already exist, did you forget to run teardown()?',
    );
  }

  const dom = new JSDOM('<!DOCTYPE html>', {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });

  global.window = dom.window.document.defaultView!;
  global.document = global.window.document;
}

export function teardown(): void {
  if (!global.window) {
    throw new Error('No JSDOM globals exist, did you forget to run setup()?');
  }

  // https://github.com/jsdom/jsdom#closing-down-a-jsdom
  global.window.close();
  // @ts-expect-error - cleaning up
  // eslint-disable-next-line no-multi-assign
  global.window = global.document = undefined;
}

export interface RenderResult {
  /** A wrapper DIV which contains your mounted component. */
  container: HTMLDivElement;
  /**
   * A helper to print the HTML structure of the mounted container. The HTML is
   * prettified and may not accurately represent your actual HTML. It's intended
   * for debugging tests only and should not be used in any assertions.
   *
   * @param el - An element to inspect. Default is the mounted container.
   */
  debug(el?: Element): void;
  unmount(): void;
}

export function render(component: Node): RenderResult {
  const container = document.createElement('div');

  container.appendChild(component);
  document.body.appendChild(container);

  mountedContainers.add(container);

  return {
    container,
    debug(el = container) {
      // eslint-disable-next-line no-console
      console.log('DEBUG:\n', el.innerHTML);
    },
    unmount() {
      container.removeChild(component);
    },
  };
}

export function cleanup(): void {
  if (!mountedContainers || mountedContainers.size === 0) {
    throw new Error(
      'No mounted components exist, did you forget to call render()?',
    );
  }

  mountedContainers.forEach((container) => {
    if (container.parentNode === document.body) {
      container.remove();
    }

    mountedContainers.delete(container);
  });
}

type MockFn<T> = T & {
  calledTimes(): number;
};

const noop = () => {};

// @ts-expect-error - FIXME:!
// eslint-disable-next-line @typescript-eslint/ban-types
export function mockFn<T extends Function>(imlp: T = noop): MockFn<T> {
  let callCount = 0;

  // @ts-expect-error - FIXME:!
  const fn: MockFn<T> = new Proxy(imlp, {
    apply(target, thisArg, args) {
      callCount += 1;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return Reflect.apply(target, thisArg, args);
    },
  });

  fn.calledTimes = () => callCount;

  return fn;
}

export function mocksSetup(): void {
  global.DocumentFragment = window.DocumentFragment;
}

export function mocksTeardown(): void {
  // @ts-expect-error - Cleaning up
  global.DocumentFragment = undefined;
}
