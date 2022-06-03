import { spy } from 'nanospy';
import * as assert from 'uvu/assert';
import { deleteSyntheticEvent, setupSyntheticEvent } from '../src/events';
import { cleanup, describe, render } from './utils';

declare global {
  interface HTMLElement {
    /** `stage1` synthetic click event handler. */
    __click?(event: MouseEvent): void;
  }
}

describe('setupSyntheticEvent', (test) => {
  test.after.each(cleanup);

  test('is a function', () => {
    assert.type(setupSyntheticEvent, 'function');
  });

  test('expects 1 parameter', () => {
    assert.is(setupSyntheticEvent.length, 1);
  });

  test('returns undefined', () => {
    assert.is(setupSyntheticEvent('abort'), undefined);
  });

  test('calls synthetic click handler on click event', () => {
    const button = document.createElement('button');
    const callback = spy();
    button.__click = callback;
    render(button);
    setupSyntheticEvent('click');
    button.click();
    button.click();
    button.click();
    assert.is(callback.callCount, 3);
    deleteSyntheticEvent('click');
  });

  test('propagates click event from deeply nested element', () => {
    const button = document.createElement('button');
    const div = document.createElement('div');
    const span = document.createElement('span');
    const img = document.createElement('img');
    const callback = spy();
    button.__click = callback;
    button.appendChild(div);
    div.appendChild(span);
    span.appendChild(img);
    render(button);
    setupSyntheticEvent('click');
    img.click();
    img.click();
    img.click();
    assert.is(callback.callCount, 3);
    deleteSyntheticEvent('click');
  });

  test('propagates up to document body', () => {
    const button = document.createElement('button');
    const callback = spy();
    document.body.__click = callback;
    render(button);
    setupSyntheticEvent('click');
    button.click();
    assert.is(callback.callCount, 1);
    deleteSyntheticEvent('click');
    delete document.body.__click;
  });

  test('no longer propagates click event once handled', () => {
    const div1 = document.createElement('div');
    const div2 = document.createElement('div');
    const callback = spy();
    div1.__click = callback;
    div2.__click = callback;
    div1.appendChild(div2);
    render(div1);
    setupSyntheticEvent('click');
    div2.click();
    assert.is(callback.callCount, 1); // only called once
    deleteSyntheticEvent('click');
  });

  test('does not call handler if synthetic event is not setup', () => {
    const button = document.createElement('button');
    const callback = spy();
    button.__click = callback;
    render(button);
    button.click();
    assert.is(callback.callCount, 0);
  });

  test('does not call handler if event originates from another DOM tree branch', () => {
    const div = document.createElement('div');
    const button1 = document.createElement('button');
    const button2 = document.createElement('button');
    const callback1 = spy();
    const callback2 = spy();
    button1.__click = callback1;
    button2.__click = callback2;
    render(div);
    div.appendChild(button1);
    div.appendChild(button2);
    setupSyntheticEvent('click');
    button1.click();
    assert.is(callback1.callCount, 1);
    assert.is(callback2.callCount, 0);
    deleteSyntheticEvent('click');
  });

  test('only registers synthetic click handler once', () => {
    const button = document.createElement('button');
    const callback = spy();
    button.__click = callback;
    render(button);
    setupSyntheticEvent('click');
    setupSyntheticEvent('click');
    button.click();
    assert.is(callback.callCount, 1);
    deleteSyntheticEvent('click');
  });
});

describe('deleteSyntheticEvent', (test) => {
  test('is a function', () => {
    assert.type(deleteSyntheticEvent, 'function');
  });

  test('expects 1 parameter', () => {
    assert.is(deleteSyntheticEvent.length, 1);
  });

  test('returns undefined', () => {
    assert.is(deleteSyntheticEvent('abort'), undefined);
  });

  test('does not call synthetic click handler after delete', () => {
    const button = document.createElement('button');
    const callback = spy();
    button.__click = callback;
    render(button);
    setupSyntheticEvent('click');
    button.click();
    assert.is(callback.callCount, 1);
    deleteSyntheticEvent('click');
    button.click();
    button.click();
    button.click();
    assert.is(callback.callCount, 1); // still only one call
    cleanup();
  });
});
