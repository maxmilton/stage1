import { afterEach, describe, expect, mock, test } from 'bun:test';
import { deleteSyntheticEvent, setupSyntheticEvent } from '../../src/events';
import { cleanup, render } from './utils';

declare global {
  interface HTMLElement {
    /** `stage1` synthetic click event handler. */
    __click?(event: MouseEvent): void;
  }
}

describe('setupSyntheticEvent', () => {
  test('is a function', () => {
    expect(setupSyntheticEvent).toBeInstanceOf(Function);
  });

  test('expects 1 parameter', () => {
    expect(setupSyntheticEvent).toHaveLength(1);
  });

  test('returns undefined', () => {
    expect(setupSyntheticEvent('abort')).toBeUndefined();
  });

  describe('rendered', () => {
    afterEach(cleanup);

    test('calls synthetic click handler on click event', () => {
      const button = document.createElement('button');
      const callback = mock(() => {});
      button.__click = callback;
      render(button);
      setupSyntheticEvent('click');
      button.click();
      button.click();
      button.click();
      expect(callback).toHaveBeenCalledTimes(3);
      deleteSyntheticEvent('click');
    });

    test('propagates click event from deeply nested element', () => {
      const button = document.createElement('button');
      const div = document.createElement('div');
      const span = document.createElement('span');
      const img = document.createElement('img');
      const callback = mock(() => {});
      button.__click = callback;
      button.appendChild(div);
      div.appendChild(span);
      span.appendChild(img);
      render(button);
      setupSyntheticEvent('click');
      img.click();
      img.click();
      img.click();
      expect(callback).toHaveBeenCalledTimes(3);
      deleteSyntheticEvent('click');
    });

    test('propagates up to document body', () => {
      const button = document.createElement('button');
      const callback = mock(() => {});
      document.body.__click = callback;
      render(button);
      setupSyntheticEvent('click');
      button.click();
      expect(callback).toHaveBeenCalledTimes(1);
      deleteSyntheticEvent('click');
      // biome-ignore lint/performance/noDelete: cleanup
      delete document.body.__click;
    });

    test('no longer propagates click event once handled', () => {
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      const callback = mock(() => {});
      div1.__click = callback;
      div2.__click = callback;
      div1.appendChild(div2);
      render(div1);
      setupSyntheticEvent('click');
      div2.click();
      expect(callback).toHaveBeenCalledTimes(1); // only called once
      deleteSyntheticEvent('click');
    });

    test('does not call handler if synthetic event is not setup', () => {
      const button = document.createElement('button');
      const callback = mock(() => {});
      button.__click = callback;
      render(button);
      button.click();
      expect(callback).not.toHaveBeenCalled();
    });

    test('does not call handler if event originates from another DOM tree branch', () => {
      const div = document.createElement('div');
      const button1 = document.createElement('button');
      const button2 = document.createElement('button');
      const callback1 = mock(() => {});
      const callback2 = mock(() => {});
      button1.__click = callback1;
      button2.__click = callback2;
      render(div);
      div.appendChild(button1);
      div.appendChild(button2);
      setupSyntheticEvent('click');
      button1.click();
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
      deleteSyntheticEvent('click');
    });

    test('only registers synthetic click handler once', () => {
      const button = document.createElement('button');
      const callback = mock(() => {});
      button.__click = callback;
      render(button);
      setupSyntheticEvent('click');
      setupSyntheticEvent('click');
      button.click();
      expect(callback).toHaveBeenCalledTimes(1);
      deleteSyntheticEvent('click');
    });
  });
});

describe('deleteSyntheticEvent', () => {
  test('is a function', () => {
    expect(deleteSyntheticEvent).toBeInstanceOf(Function);
  });

  test('expects 1 parameter', () => {
    expect(deleteSyntheticEvent).toHaveLength(1);
  });

  test('returns undefined', () => {
    expect(deleteSyntheticEvent('abort')).toBeUndefined();
  });

  describe('rendered', () => {
    afterEach(cleanup);

    test('does not call synthetic click handler after delete', () => {
      const button = document.createElement('button');
      const callback = mock(() => {});
      button.__click = callback;
      render(button);
      setupSyntheticEvent('click');
      button.click();
      expect(callback).toHaveBeenCalledTimes(1);
      deleteSyntheticEvent('click');
      button.click();
      button.click();
      button.click();
      expect(callback).toHaveBeenCalledTimes(1); // still only one call
    });
  });
});
