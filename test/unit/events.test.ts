import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render } from '@maxmilton/test-utils/dom';
import {
  handleClick,
  ONCLICK,
  removeSyntheticClick,
  setupSyntheticClick,
} from '../../src/events.ts';

declare global {
  interface HTMLElement {
    /** `stage1` synthetic click event handler. */
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    [ONCLICK]?(event: Event): false | void | Promise<void>;
  }
}

describe('handleClick', () => {
  test('is a function', () => {
    expect.assertions(2);
    expect(handleClick).toBeFunction();
    expect(handleClick).not.toBeClass();
  });

  test('expects 1 parameter', () => {
    expect.assertions(1);
    expect(handleClick).toHaveParameters(1, 0);
  });

  test('returns undefined', () => {
    expect.assertions(1);
    expect(handleClick({} as Event)).toBeUndefined();
  });

  describe('in DOM', () => {
    afterEach(cleanup);

    test('returns undefined when event handler is noop', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      button[ONCLICK] = () => {};
      render(button);
      expect(handleClick({ target: button } as unknown as Event)).toBeUndefined();
    });

    test('returns false when event handler returns false', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      button[ONCLICK] = () => false;
      render(button);
      expect(handleClick({ target: button } as unknown as Event)).toBe(false);
    });

    test('calls synthetic event handler', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      handleClick({ target: button } as unknown as Event);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('does not call native event handler', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const handler = mock(() => {});
      button.onclick = handler;
      render(button);
      handleClick({ target: button } as unknown as Event);
      expect(handler).toHaveBeenCalledTimes(0);
    });
  });
});

describe('setupSyntheticClick', () => {
  test('is a function', () => {
    expect.assertions(2);
    expect(setupSyntheticClick).toBeFunction();
    expect(setupSyntheticClick).not.toBeClass();
  });

  test('expects 0 parameters', () => {
    expect.assertions(1);
    expect(setupSyntheticClick).toHaveParameters(0, 0);
  });

  test('returns undefined', () => {
    expect.assertions(1);
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(setupSyntheticClick()).toBeUndefined();
  });

  describe('in DOM', () => {
    afterEach(cleanup);

    test('calls synthetic click event handler on native click', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      button.click();
      button.click();
      button.click();
      expect(handler).toHaveBeenCalledTimes(3);
      removeSyntheticClick();
    });

    test('calls synthetic click event handler on synthetic click event', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      const event = new window.MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(event);
      button.dispatchEvent(event);
      button.dispatchEvent(event);
      expect(handler).toHaveBeenCalledTimes(3);
      removeSyntheticClick();
    });

    test('does not call synthetic event click handler on non-click event', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      button.dispatchEvent(new Event('mouseover'));
      expect(handler).not.toHaveBeenCalled();
      removeSyntheticClick();
    });

    test('propagates click event from deeply nested element', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const div = document.createElement('div');
      const span = document.createElement('span');
      const img = document.createElement('img');
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      button.appendChild(div);
      div.appendChild(span);
      span.appendChild(img);
      render(button);
      setupSyntheticClick();
      img.click();
      img.click();
      img.click();
      expect(handler).toHaveBeenCalledTimes(3);
      removeSyntheticClick();
    });

    test('propagates up to document body', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const handler = mock(() => {});
      document.body[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      button.click();
      expect(handler).toHaveBeenCalledTimes(1);
      removeSyntheticClick();
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete document.body[ONCLICK];
    });

    test('no longer propagates click event once handled', () => {
      expect.assertions(1);
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      const handler = mock(() => {});
      div1[ONCLICK] = handler;
      div2[ONCLICK] = handler;
      div1.appendChild(div2);
      render(div1);
      setupSyntheticClick();
      div2.click();
      expect(handler).toHaveBeenCalledTimes(1); // only called once
      removeSyntheticClick();
    });

    test('does not call handler if synthetic event is not setup', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      button.click();
      expect(handler).not.toHaveBeenCalled();
    });

    test('does not call handler if event originates from another DOM tree branch', () => {
      expect.assertions(2);
      const div = document.createElement('div');
      const button1 = document.createElement('button');
      const button2 = document.createElement('button');
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});
      button1[ONCLICK] = handler1;
      button2[ONCLICK] = handler2;
      render(div);
      div.appendChild(button1);
      div.appendChild(button2);
      setupSyntheticClick();
      button1.click();
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
      removeSyntheticClick();
    });

    test('only registers synthetic click handler once', () => {
      expect.assertions(1);
      const button = document.createElement('button');
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      setupSyntheticClick();
      button.click();
      expect(handler).toHaveBeenCalledTimes(1);
      removeSyntheticClick();
    });
  });
});

describe('removeSyntheticClick', () => {
  test('is a function', () => {
    expect.assertions(2);
    expect(removeSyntheticClick).toBeFunction();
    expect(removeSyntheticClick).not.toBeClass();
  });

  test('expects 0 parameters', () => {
    expect.assertions(1);
    expect(removeSyntheticClick).toHaveParameters(0, 0);
  });

  test('returns undefined', () => {
    expect.assertions(1);
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(removeSyntheticClick()).toBeUndefined();
  });

  describe('in DOM', () => {
    afterEach(cleanup);

    test('does not call synthetic click handler after delete', () => {
      expect.assertions(2);
      const button = document.createElement('button');
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      button.click();
      expect(handler).toHaveBeenCalledTimes(1);
      removeSyntheticClick();
      button.click();
      button.click();
      button.click();
      expect(handler).toHaveBeenCalledTimes(1); // still only one call
    });
  });
});
